"""데이터 불변식 검사 — 조용히 썩는 것을 잡는다(2026-08-29).

만든 이유. 0031(층 표기 통일)은 apply.sh 이력표에 「적용됨」으로 남아 있었는데
**값은 한 건도 안 바뀌어 있었다.** 마이그레이션이 SQL 로는 스키마만 만들고 실제 변환은
외부 파이썬(scripts/normalize_floor_labels.py)에 맡겼는데, apply.sh 는 SQL 만 돌린다.
그래서 「적용됨」이 두 가지 뜻이 됐다 — 스키마가 들어간 것과 데이터가 맞춰진 것.

그 결과 지하 32만 층이 지상으로 읽혔다. 상가에서 가장 싼 층에 가장 비싼 1층 요율이
붙었고, 아무도 두 달 동안 몰랐다.

**정답은 DB 안에 이미 있었다.** 대장 요약(floors_above·floors_below)과 층별개요를
대조하면 지하층수 일치가 16.9% 로 나왔을 것이다. 그 한 줄을 아무도 안 세어 봤다.

그래서 이 파일은 「독립된 두 출처가 서로 맞는가」만 묻는다. 산식이 옳은지는 안 본다 —
그건 백테스트의 일이다. 여기는 **데이터가 스스로 모순되지 않는가**를 본다.

    backend/.venv/bin/python backend/tests/qa_data.py
"""
import asyncio
import os
import sys

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")

ok = bad = 0


def chk(cond, name, detail=""):
    global ok, bad
    if cond:
        ok += 1
        print(f"  ✓ {name}")
    else:
        bad += 1
        print(f"  ✗ {name}   {detail}")


async def main():
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)

    print("[층 표기] 대장 요약 ↔ 층별개요 — 서로 다른 출처가 맞아야 한다")
    r = await c.fetchrow("""
        WITH g AS (
          SELECT fo.building_pk, b.floors_above::int fa, b.floors_below::int fb,
                 max(app.signed_floor(fo.floor))
                   FILTER (WHERE app.signed_floor(fo.floor) BETWEEN 1 AND 199) up,
                 max(-app.signed_floor(fo.floor))
                   FILTER (WHERE app.signed_floor(fo.floor) BETWEEN -199 AND -1) dn
            FROM master.floor_outline fo JOIN master.buildings b USING (building_pk)
           WHERE b.floors_above IS NOT NULL AND b.floors_below IS NOT NULL
           GROUP BY 1,2,3)
        SELECT count(*) n,
               100.0*count(*) FILTER (WHERE COALESCE(up,0)=fa)/count(*) p_up,
               100.0*count(*) FILTER (WHERE COALESCE(dn,0)=fb)/count(*) p_dn
          FROM g""")
    chk(r["p_up"] >= 99.0, f"지상층수 일치 {r['p_up']:.1f}% (기준 99%)", f"건물 {r['n']:,}")
    chk(r["p_dn"] >= 99.0, f"지하층수 일치 {r['p_dn']:.1f}% (기준 99%)",
        "0031 정규화가 안 돌았을 수 있다 → scripts/normalize_floor_labels.py")

    n = await c.fetchval(
        "SELECT count(*) FROM master.floor_outline"
        " WHERE floor !~ '^(내)?(지하|옥탑|중)?[0-9]+층$'")
    chk(n < 20000, f"정규 표기 아닌 층 {n:,}행 (기준 2만)",
        "판정 불가는 남기는 게 규칙이지만 늘어나면 규칙에 구멍이 생긴 것")

    print("\n[층 임대 추정] 층이 뒤집히면 여기서 드러난다")
    r = await c.fetchrow("""
        WITH u AS (
          SELECT app.signed_floor(fo.floor) sf,
                 fre.rent_est / NULLIF(fo.floor_area,0) unit
            FROM master.floor_outline fo
            JOIN master.floor_rent_est fre
              ON fre.building_pk = fo.building_pk AND fre.seq = fo.seq
           WHERE fo.floor_area > 0 AND fre.rent_est > 0)
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY unit) FILTER (WHERE sf = 1) f1,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY unit) FILTER (WHERE sf = -1) b1,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY unit) FILTER (WHERE sf = 2) f2
          FROM u""")
    if r and r["f1"] and r["b1"]:
        chk(float(r["b1"]) < float(r["f1"]),
            f"지하1층({r['b1']:,.0f}) < 지상1층({r['f1']:,.0f})",
            "지하가 1층보다 비싸다 = 층 판정이 뒤집혔다")
        chk(float(r["f2"]) < float(r["f1"]),
            f"2층({r['f2']:,.0f}) < 1층({r['f1']:,.0f})", "상가는 1층이 가장 비싸다")

    # 지하 깊이 — 층대를 한 칸으로 묶으면 깊은 지하가 얕은 지하와 같은 값을 받는다.
    # v4 를 처음 적재했을 때 실제로 그랬다(2026-08-30).
    #
    # **같은 건물 안에서** 재야 한다. 건물을 섞어 중앙값을 비교하면 깊은 지하가 더 비싸게
    # 나오는데, 그건 산식이 아니라 **깊은 지하가 큰 건물·비싼 땅에만 있기 때문**이다.
    # 처음에 그렇게 짰다가 멀쩡한 데이터를 실패로 잡았다.
    r = await c.fetchrow("""
        WITH u AS (
          SELECT fo.building_pk pk, app.signed_floor(fo.floor) sf,
                 fre.rent_est / fo.floor_area AS unit
            FROM master.floor_outline fo
            JOIN master.floor_rent_est fre
              ON fre.building_pk = fo.building_pk AND fre.seq = fo.seq
           WHERE fo.floor_area > 0 AND fre.rent_est > 0),
        p AS (
          SELECT pk, max(unit) FILTER (WHERE sf = -1)  AS b1,
                     max(unit) FILTER (WHERE sf <= -3) AS b3
            FROM u GROUP BY 1)
        SELECT count(*) n, percentile_cont(0.5) WITHIN GROUP (ORDER BY b3 / b1) ratio
          FROM p WHERE b1 > 0 AND b3 > 0""")
    if r and r["n"] and r["n"] > 100:
        v = float(r["ratio"])
        chk(v <= 1.0, f"한 건물 안 지하3 ÷ 지하1 = {v:.2f} (건물 {r['n']:,})",
            "같은 건물인데 깊은 지하가 더 비싸다 = 지하 깊이 보정이 빠졌다")

    print("\n[면적] 층별개요 합계 ↔ 대장 연면적")
    r = await c.fetchrow("""
        WITH g AS (
          SELECT fo.building_pk, b.total_area::float ta, sum(fo.floor_area)::float s
            FROM master.floor_outline fo JOIN master.buildings b USING (building_pk)
           WHERE b.total_area > 0 AND fo.floor_area > 0
             AND fo.floor !~ '^내'          -- 내부구획은 별개 공간(합치면 이중계상)
             -- **옥탑은 연면적에 안 들어간다.** 건축법상 옥탑이 건축면적의 1/8 이하면
             -- 층수·연면적에서 뺀다. 이걸 안 빼서 이 검사가 72.4%로 떠 있었는데,
             -- 데이터가 깨진 게 아니라 검사가 틀린 것이었다(2026-08-29).
             --   수유동 508-97: 87.39+90.12+94.84 = 272.35 = 연면적 정확히. 옥탑 11.7이 더해져 어긋났다.
             AND fo.floor !~ '옥탑|^옥'
           GROUP BY 1,2)
        SELECT count(*) n,
               100.0*count(*) FILTER (WHERE abs(s-ta)/ta < 0.02)/count(*) p
          FROM g""")
    chk(r["p"] >= 90.0, f"층 면적 합 ≒ 연면적 {r['p']:.1f}% (기준 90%)", f"건물 {r['n']:,}")

    print("\n[임대 눈금] 크롤 호가 대비 — 산식이 통째로 밀리면 여기서 드러난다")
    # 잣대 표(master._crawl_rent)는 로컬에만 있다. 없는 곳(프로덕션)에서는 건너뛴다 —
    # 잣대가 없다고 검사 전체가 죽으면 뒤에 오는 검사들까지 못 돈다.
    r = None
    try:
        r = await c.fetchrow("""
        WITH ours AS (
          SELECT fo.building_pk pk, app.signed_floor(fo.floor) sf,
                 fre.rent_est / fo.floor_area AS unit
            FROM master.floor_outline fo
            JOIN master.floor_rent_est fre
              ON fre.building_pk = fo.building_pk AND fre.seq = fo.seq
           WHERE fo.floor_area > 0 AND fre.rent_est > 0),
        bench AS (
          SELECT building_pk pk, floor sf,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY rent/area_c) AS unit
            FROM master._crawl_rent
           WHERE building_pk IS NOT NULL AND floor IS NOT NULL AND area_c > 0
             AND rent/area_c BETWEEN 3000 AND 400000
           GROUP BY 1,2 HAVING count(*) >= 2)
        SELECT count(*) n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY o.unit / b.unit) ratio
          FROM ours o JOIN bench b USING (pk, sf)""")
    except Exception as e:                                       # noqa: BLE001
        print(f"  · 잣대 표 없음({type(e).__name__}) — 눈금 검사 건너뜀")
    if r and r["n"] and r["n"] > 1000:
        v = float(r["ratio"])
        # 우리는 실계약(부동산원) 기준이고 잣대는 호가라 1.0 이 아니라 0.8 언저리가 맞다.
        # 창을 넓게 잡은 건 「통째로 밀렸나」만 보려는 것이다 — 흩어짐은 backtest_rent 가 잰다.
        chk(0.70 <= v <= 1.00, f"호가 대비 눈금 {v:.2f} (표본 {r['n']:,}층)",
            "0.70~1.00 밖 = 산식 눈금이 밀렸다. backtest_rent.py 로 확인")
    else:
        print("  · 크롤 잣대 없음 — 눈금 검사 건너뜀")

    print("\n[임대 추정 커버리지]")
    r = await c.fetchrow("""
        SELECT (SELECT count(*) FROM master.buildings b
                 WHERE b.bjd_code LIKE '11%'
                   AND (b.land_use IN ('상업용','업무용','상업기타','주상용','주상기타')
                        OR substr(b.main_use,1,2) IN ('03','04','05','07','09','13','14','15','16'))) tgt,
               (SELECT count(DISTINCT building_pk) FROM master.floor_rent_est WHERE rent_est > 0) got""")
    p = r["got"] * 100.0 / max(r["tgt"], 1)
    chk(p >= 70.0, f"임대 추정 있는 건물 {r['got']:,}/{r['tgt']:,} ({p:.1f}%)", "기준 70%")

    print("\n[필지 규제] 적재가 지우고 가는 칸 — 되붙었나")
    # parcels 세대 스왑은 이 네 칸을 안 들고 온다(원장에서 따로 오는 값이라 CSV 에 없다).
    # scripts/load_parcel_luris.py 가 적재 뒤 되붙이는데, 그게 빠지면 여기서 걸린다.
    r = await c.fetchrow("""
        SELECT count(*) n, count(use_zone) z, count(regulations) g, count(legal_bcr) b
          FROM master.parcels""")
    pz = 100.0 * r["z"] / max(r["n"], 1)
    chk(pz >= 95.0, f"용도지역 있는 필지 {r['z']:,}/{r['n']:,} ({pz:.1f}%)", "기준 95%")
    pg = 100.0 * r["g"] / max(r["n"], 1)
    chk(pg >= 95.0, f"규제 있는 필지 {r['g']:,}/{r['n']:,} ({pg:.1f}%)", "기준 95%")
    # 법정 건폐/용적도 같은 칸이다 — 적재가 지우고 load_parcel_luris 가 되붙인다.
    # 2026-09-02 이전엔 걸침 필지가 통째로 비어 95.2% 였고, 지금은 99.6% 다.
    # 이 값은 확인설명서로 그대로 나가므로 조용히 비면 안 된다.
    pb = 100.0 * r["b"] / max(r["n"], 1)
    chk(pb >= 95.0, f"법정 건폐/용적 있는 필지 {r['b']:,}/{r['n']:,} ({pb:.1f}%)", "기준 95%")

    print("\n[파생 배치] 원천이 바뀌면 같이 돌아야 하는 계산값 — 비어 있지 않은가")
    # 파생 배치는 파이프라인 밖에 있어서 「돌린 적 없음」이 조용히 0행으로 남았다(2026-08-30).
    # 화면은 0행을 「값 없음」으로 그려서 티가 안 난다 — 여기서 잡는다.
    for tbl, floor_n in (("master.building_score", 500_000),
                         ("master.building_sale_est", 100_000),
                         ("master.building_rent_est", 100_000),
                         ("master.floor_rent_est", 500_000),
                         ("master.building_redevel", 50_000),
                         ("master.road_segment", 30_000),
                         ("master.trade_area", 1_000),
                         ("master.sanggwon", 50)):
        n = await c.fetchval(f"SELECT count(*) FROM {tbl}")
        chk(n >= floor_n, f"{tbl.split('.')[1]} {n:,}행", f"기준 {floor_n:,}")

    print("\n[검색 전용 계산값] 대장을 덮지 않았나 · 채워졌나")
    # 이 표는 검색만 읽는다(0143). 대장에 값이 있는 건물이 여기 담기면 **화면 값이 흔들린다** —
    # 화면 값은 계약서·확인설명서로 이어지므로 건축물대장과 일치해야 한다.
    bad = await c.fetchval("""
        SELECT count(*) FROM master.building_calc c JOIN master.buildings b USING (building_pk)
         WHERE (c.far_calc IS NOT NULL AND b.far IS NOT NULL)
            OR (c.bcr_calc IS NOT NULL AND b.bcr IS NOT NULL)""")
    chk(bad == 0, f"대장을 덮은 계산값 {bad:,}건", "0이어야 한다")
    r = await c.fetchrow("SELECT count(far_calc) f, count(bcr_calc) b FROM master.building_calc")
    chk(r["f"] >= 15_000, f"계산 용적률 {r['f']:,}동", "기준 15,000")
    chk(r["b"] >= 14_000, f"계산 건폐율 {r['b']:,}동", "기준 14,000")

    print("\n[마이그레이션 이력] 파일과 DB 기록이 맞는가")
    mig = await c.fetch("SELECT version FROM app.schema_migrations")
    have = {m["version"] for m in mig}
    d = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "db", "migrations")
    # 이력표 자신(0039)은 이력에 안 남는다 — apply.sh 가 매번 먼저 돌리는 멱등 파일이라
    # 기록할 표가 아직 없을 때 실행된다. 이걸 안 빼면 늘 「안 들어감 1개」로 뜬다.
    files = {f for f in os.listdir(d) if f.endswith(".sql")} - {"0039_schema_migrations.sql"}
    missing = sorted(files - have)
    chk(not missing, f"안 들어간 마이그레이션 {len(missing)}개",
        " ".join(missing[:5]) if missing else "")

    await c.close()
    print(f"\n{ok} ✓ · {bad} ✗")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    asyncio.run(main())
