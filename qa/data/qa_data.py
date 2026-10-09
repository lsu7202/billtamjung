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
    # 칸 모양이 되돌아가지 않았는지 — 0153 에서 text → integer[] 로 바꿨다.
    # text 로 되돌아가면 읽는 쪽 열 곳이 각자 정규식을 쓰게 되고, 그 버그가
    # 2026-09-02 하루에 여섯 개 나왔다. 값이 아니라 **모양**을 지키는 검사다.
    t = await c.fetchval("""SELECT data_type FROM information_schema.columns
                             WHERE table_schema='master' AND table_name='parcels'
                               AND column_name='legal_bcr'""")
    chk(t == "ARRAY", f"legal_bcr 칸 모양 {t}", "integer[] 이어야 한다(0153)")
    # 병기가 있어야 정상이다 — 0이면 걸침 계산이 통째로 빠진 것이다
    m = await c.fetchval("""SELECT count(*) FROM master.parcels
                             WHERE array_length(legal_bcr, 1) > 1""")
    chk(m > 1000, f"병기된 필지 {m:,}", "기준 1,000 (걸침 계산이 빠지면 0이 된다)")

    print("\n[파생 배치] 원천이 바뀌면 같이 돌아야 하는 계산값 — 비어 있지 않은가")
    # 파생 배치는 파이프라인 밖에 있어서 「돌린 적 없음」이 조용히 0행으로 남았다(2026-08-30).
    # 화면은 0행을 「값 없음」으로 그려서 티가 안 난다 — 여기서 잡는다.
    for tbl, floor_n in (("master.parcel_sale_est", 100_000),
                         ("master.building_legal", 400_000),
                         ("master.road_segment", 30_000)):
        n = await c.fetchval(f"SELECT count(*) FROM {tbl}")
        chk(n >= floor_n, f"{tbl.split('.')[1]} {n:,}행", f"기준 {floor_n:,}")

    print("\n[검색 전용 계산값] 대장을 덮지 않았나 · 채워졌나")
    # 이 표는 검색만 읽는다(0143). 대장에 값이 있는 건물이 여기 담기면 **화면 값이 흔들린다** —
    # 화면 값은 계약서·확인설명서로 이어지므로 건축물대장과 일치해야 한다.
    # 이름을 bad 로 쓰면 main 의 지역 변수가 돼 요약 · 종료 코드가 실패 수 대신 이 값을 읽는다(10-08 고침)
    over = await c.fetchval("""
        SELECT count(*) FROM master.building_calc c JOIN master.buildings b USING (building_pk)
         WHERE (c.far_calc IS NOT NULL AND b.far IS NOT NULL)
            OR (c.bcr_calc IS NOT NULL AND b.bcr IS NOT NULL)""")
    chk(over == 0, f"대장을 덮은 계산값 {over:,}건", "0이어야 한다")
    r = await c.fetchrow("SELECT count(far_calc) f, count(bcr_calc) b FROM master.building_calc")
    chk(r["f"] >= 15_000, f"계산 용적률 {r['f']:,}동", "기준 15,000")
    chk(r["b"] >= 14_000, f"계산 건폐율 {r['b']:,}동", "기준 14,000")

    # ── 주변 소식 — 조용한 실패를 잡는다 ─────────────────────────────
    # 파이프라인이 「돌긴 도는데 0건으로 성공」하는 일이 실제로 세 번 있었다.
    # 표가 비어도 화면은 뜬다 — 카드가 안 서고 끝이라 아무도 모른다.
    print("\n[주변 소식] 표가 비었는가 · 갈래가 살아 있는가")
    for tbl, floor in (("master.area_event", 1000), ("master.urban_notice", 40000),
                       ("master.city_facility", 20000), ("master.building_permit", 500000),
                       ("master.g2b_bid", 1000), ("master.sbiz_store", 500000),
                       ("master.localdata_permit", 2000000)):
        try:
            n = await c.fetchval(f"SELECT count(*) FROM {tbl}")
        except asyncpg.exceptions.UndefinedTableError:
            chk(False, f"{tbl} 없음", "적재가 안 돌았다")
            continue
        chk(n >= floor, f"{tbl} {n:,}줄 (기준 {floor:,})", "적재가 덜 됐거나 원천이 바뀌었다")

    # ── 카카오 장소(업체 크롤링, 2026-09-27) — 층별 정보·입주 업종 검색의 재료 ─────────
    print("\n[카카오 장소] 적재됐는가 · 건물에 붙었는가 · 업체와 1:1 인가")
    try:
        r = await c.fetchrow("""SELECT count(*) n, count(building_pk) b FROM master.place WHERE gone_on IS NULL""")
        chk(r["n"] >= 800_000, f"지금 있는 장소 {r['n']:,}곳 (기준 800,000)", "수집이 덜 됐거나 적재가 안 돌았다")
        chk(r["b"] >= 0.8 * r["n"], f"건물 붙은 장소 {100.0*r['b']/max(r['n'],1):.1f}% (기준 80%)",
            "load_places.py 의 건물 붙이기(지번 대조)가 어긋났다")
        orphan = await c.fetchval("""SELECT count(*) FROM master.place p WHERE p.biz_id IS NULL
                                      AND NOT coalesce(p.cat_tokens[1:2] = array['부동산','빌딩'], false)""")
        chk(orphan == 0, f"업체로 안 이어진 장소 {orphan:,}곳", "0이어야 한다 — biz 를 다시 만드는 단계가 끊겼다")
        nobody = await c.fetchval("SELECT count(*) FROM ref.biz_cat WHERE depth > 1 AND parent_id IS NULL")
        chk(nobody == 0, f"업종 나무 부모 잃은 마디 {nobody:,}", "0이어야 한다")
    except asyncpg.exceptions.UndefinedTableError:
        chk(False, "master.place 없음", "places.crawl 적재가 안 돌았다")

    kinds = {r["kind"]: r["n"] for r in await c.fetch(
        "SELECT kind, count(*) n FROM master.area_event GROUP BY 1")}
    # 「정책 발표」는 보도자료라 **본문이 없어야 한다**(공공누리 4유형). 아래에서 따로 본다.
    for k in ("정비·개발", "기반시설", "건축 인허가", "정책 발표"):
        chk(kinds.get(k, 0) > 0, f"갈래 「{k}」 {kinds.get(k, 0):,}줄",
            "build_area_event 의 UNION 한 갈래가 죽었다")

    # 본문 되붙임이 area_event 재빌드 **뒤에** 돌았는가. 순서가 어긋나면 여기서 0 이 된다.
    r = await c.fetchrow("""SELECT count(*) t, count(body) b FROM master.area_event
                             WHERE src_table IN ('district_plan','city_facility')""")
    p_body = 100.0 * r["b"] / max(r["t"], 1)
    chk(p_body >= 80.0, f"고시 본문 붙음 {p_body:.1f}% (기준 80%)",
        "load_urban_notice.py 가 build_area_event.py **뒤에** 다시 돌아야 한다")

    # 이름 자리에 자리표시가 서면 안 된다 — 「(기구축내용없음)」이 화면에 164줄 섰다(2026-09-06).
    #   빈 이름·포털 빈 제목은 build_area_event 가 법정 표기로 바꿔 부른다.
    n_ph = await c.fetchval(r"""SELECT count(*) FROM master.area_event
                                  WHERE name IS NULL OR btrim(name) = '' OR name ~ '기구축|내용없음|^서울특별시 고시 제0000'""")
    chk(n_ph == 0, f"이름 자리표시 없음 ({n_ph}줄)",
        "build_area_event 의 이름 CASE 나 load_urban_notice 의 이름 갈기가 빠졌다")

    # 보도자료에서 온 줄은 **본문이 비어 있어야 한다** — 채우면 저작권 위반이다
    n_body = await c.fetchval(
        "SELECT count(*) FROM master.area_event WHERE kind='정책 발표' AND body IS NOT NULL")
    chk(n_body == 0, f"정책 발표 줄에 본문 없음 ({n_body}줄)",
        "보도자료는 공공누리 4유형 — area_event.body 를 채우면 안 된다")

    # 보도자료는 본문을 저장하지 않는다(공공누리 4유형). 칸이 생기면 사고다.
    cols = {r["column_name"] for r in await c.fetch(
        "SELECT column_name FROM information_schema.columns"
        " WHERE table_schema='master' AND table_name='press_event'")}
    chk("body" not in cols and "content" not in cols,
        "press_event 에 본문 칸이 없다",
        "보도자료는 공공누리 4유형 — 본문을 저장하면 안 된다")

    print("\n[열쇠] FK 를 못 거는 칸 — 가리키는 줄이 있는가(0257)")
    # master.parcels 는 파이프라인이 통째로 다시 싣는 표라 FK 를 걸면 다시 싣기가 막힌다. 여기서 센다
    for t, col in (("listing_parcels", "pnu"), ("hidden_parcels", "pnu"), ("seeks", "pnu")):
        rows = await c.fetch(f"""SELECT x.{col} FROM app.{t} x
                                  WHERE NOT EXISTS (SELECT 1 FROM master.parcels p WHERE p.pnu = x.{col}) LIMIT 5""")
        chk(not rows, f"{t}.{col} 이 지적도에 있다", " ".join(r[col] for r in rows))
    # 참석자 ref_id 는 ref_kind 에 따라 매수자 · 매도자를 가리켜 FK 하나로 못 묶는다
    n = await c.fetchval("""SELECT count(*) FROM app.schedule_people sp
                             WHERE sp.ref_kind IN ('buyer', 'owner') AND sp.ref_id IS NOT NULL
                               AND NOT EXISTS (SELECT 1 FROM app.buyers b WHERE sp.ref_kind = 'buyer' AND b.id = sp.ref_id)
                               AND NOT EXISTS (SELECT 1 FROM app.owners o WHERE sp.ref_kind = 'owner' AND o.id = sp.ref_id)""")
    chk(n == 0, "일정 참석자가 가리키는 매수자 · 매도자가 있다", f"{n}줄")

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
