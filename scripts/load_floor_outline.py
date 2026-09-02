#!/usr/bin/env python3
"""층별개요 적재 — master.floor_outline. **이 마디가 없어서 사고가 났다.**

## 왜 신설하나

`build_all.py` 는 `build_floor_outline.py` 로 CSV 를 만드는데, 그걸 **Postgres 에 넣는 코드가
어디에도 없었다.** export 목록에도 loader SOURCES 에도 없다. 그래서 298만 행이 손으로 들어갔고,
그 결과가 2026-08-29 에 드러난 사고다:

  8/07 에 층 표기 정규화를 고쳤는데(`지1층`·`지1`·`지층` → 지하로), 그 뒤 **8/02 에 만든
  옛 CSV로 재적재**하면서 원본 표기로 되돌아갔다. 지하 21만 층이 두 달간 지상 요율로
  계산됐다(지하1층 ㎡당 22,840원 ← 12,290원이 맞는 값).

세 겹으로 안 걸렸다: `apply.sh` 는 적용된 마이그레이션을 다시 안 돌리고, `master_loads` 에
적재 기록이 없어 언제 덮였는지 추적할 수 없었고, 화면은 층 **이름**을 그대로 그려서
`지1층` 이 이상해 보이지 않았다 — 틀린 건 옆의 금액이었다.

## 그래서 이 스크립트가 지키는 것

  · **컬럼 검사** — 옛 CSV(5컬럼·`exclusive_area`)를 거부한다. 지금 빌더는 6컬럼이고
    `floor_raw`(원본 표기)를 따로 갖는다. 헤더가 다르면 애초에 안 넣는다.
  · **정규화 검사** — 지하가 지상으로 뒤집혔는지 대장 요약(floors_below)과 대조한다.
    일치율이 기준 아래면 적재를 **되돌린다**. 조용히 넣느니 안 넣는 게 낫다.
  · **적재 기록** — master_loads 에 남긴다. 다음에 「언제 덮였나」를 답할 수 있어야 한다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/load_floor_outline.py [CSV]
"""
import asyncio
import csv
import io
import os
import sys
import uuid

import asyncpg

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "tools", "_floor_outline.csv")
# 2026-09-01 — 빌더가 칸을 넷 늘렸는데(동명칭·면적제외여부·구조·주부속구분) 여기가 안 따라와
# 적재가 막혔다. 검사는 옳게 걸린 것이다: **모양이 다르면 안 넣는다**가 이 스크립트의 일이다.
# 늘어난 칸은 원본 그대로 text 로 싣는다. 면적제외여부를 참/거짓으로 옮기지 않는 이유는
# 원본이 무엇을 넣는지(0/1·N/Y·빈칸) 우리가 정하지 않기 때문이다.
COLS = ["building_pk", "seq", "floor", "floor_raw", "use", "floor_area",
        "dong", "area_excluded", "structure", "main_sub"]
MIN_MATCH = 95.0     # 대장 지하층수와 이만큼은 맞아야 한다(정상 99.7%)


async def main() -> None:
    if not os.path.exists(SRC):
        print(f"✗ 파일이 없습니다: {SRC}")
        sys.exit(1)

    with io.open(SRC, encoding="utf-8") as f:
        head = next(csv.reader(f))
    if head != COLS:
        print(f"✗ 컬럼이 다릅니다.\n  받은 것: {head}\n  기대: {COLS}")
        print("  → 옛 빌더(8/02·exclusive_area)의 산출물일 수 있습니다. build_floor_outline.py 를 다시 돌리세요.")
        sys.exit(1)

    c = await asyncpg.connect(DSN, timeout=60, command_timeout=7200)
    run_id = uuid.uuid4()
    try:
        before = await c.fetchval("SELECT count(*) FROM master.floor_outline")
        await c.execute(
            """INSERT INTO master.master_loads(run_id, source, started_at, status)
               VALUES($1,'floor_outline', now(), 'running')""", run_id)

        # 새 표에 부어 놓고 통째로 바꾼다. 살아 있는 표를 지우고 채우면 그 사이 화면이 빈다.
        await c.execute("DROP TABLE IF EXISTS master._floor_outline_new")
        await c.execute("""
            CREATE TABLE master._floor_outline_new(
              id bigserial, building_pk text NOT NULL, seq int NOT NULL,
              floor text, use text, floor_area numeric, floor_raw text,
              dong text, area_excluded text, structure text, main_sub text)""")

        rows, n = [], 0
        with io.open(SRC, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                rows.append((r["building_pk"], int(r["seq"]) if r["seq"] else 0,
                             r["floor"] or None, r["use"] or None,
                             float(r["floor_area"]) if r["floor_area"] else None,
                             r["floor_raw"] or None,
                             r["dong"] or None, r["area_excluded"] or None,
                             r["structure"] or None, r["main_sub"] or None))
                if len(rows) >= 100_000:
                    await c.copy_records_to_table(
                        "_floor_outline_new", schema_name="master", records=rows,
                        columns=["building_pk", "seq", "floor", "use", "floor_area", "floor_raw",
                                 "dong", "area_excluded", "structure", "main_sub"])
                    n += len(rows); rows = []
                    print(f"  읽는 중 {n:,}", flush=True)
        if rows:
            await c.copy_records_to_table(
                "_floor_outline_new", schema_name="master", records=rows,
                columns=["building_pk", "seq", "floor", "use", "floor_area", "floor_raw",
                                 "dong", "area_excluded", "structure", "main_sub"])
            n += len(rows)
        print(f"파일 {n:,}행 (전 {before:,}행)")

        if n < before * 0.9:
            raise RuntimeError(f"행이 너무 줄었습니다({before:,}→{n:,}) — 원본이 온전한지 확인하세요")

        # **지하가 지상으로 뒤집혔나** — 대장 요약과 대조한다. 이 검사가 없어서 두 달을 놓쳤다.
        #
        # 2026-09-01 — 세는 것이 아니라 **제일 깊은 층**을 본다. 「지하층수 2」는
        # 「지하 줄이 둘」이 아니라 「지하 2층까지 있다」는 뜻이다. 둘은 다르다:
        #   · 같은 층이 용도별로 여러 줄이면 줄로 세면 부푼다(실측 82.9%)
        #   · 층으로 세도 중간 층이 빠지면 어긋난다(지2층만 있고 지1층 줄이 없는 건물, 99.6%)
        #   · 깊이로 보면 둘 다 안 걸린다(99.7%)
        # qa/data/qa_data.py 가 쓰는 잣대와 같게 맞춘 것이다. 두 검사가 다른 자를
        # 쓰면 한쪽은 통과하고 한쪽은 막는데, 어느 쪽이 맞는지 사람이 매번 다시 따져야 한다.
        pct = await c.fetchval("""
            WITH g AS (
              SELECT f.building_pk,
                     max(-app.signed_floor(f.floor))
                       FILTER (WHERE app.signed_floor(f.floor) BETWEEN -199 AND -1) AS below
                FROM master._floor_outline_new f GROUP BY 1)
            SELECT 100.0 * count(*) FILTER (WHERE COALESCE(g.below,0) = b.floors_below)
                     / NULLIF(count(*),0)
              FROM g JOIN master.buildings b USING (building_pk)
             WHERE b.floors_below IS NOT NULL""")
        print(f"지하층수 일치 {pct:.1f}% (기준 {MIN_MATCH}%)")
        if pct is None or pct < MIN_MATCH:
            raise RuntimeError(f"지하층수 일치 {pct}% — 층 표기가 정규화되지 않았습니다. 적재를 중단합니다")

        # **표는 그대로 두고 안만 갈아 끼운다.** 이름을 바꿔 다는 방식이었는데 두 가지가 걸렸다
        # (2026-09-01, 두 번째 적재에서 처음 드러났다 — 첫 적재 때는 쥐고 있는 것이 없었다):
        #   · 인덱스 이름은 표를 따라 안 바뀐다. 옛 표가 floor_outline_pk 를 쥔 채 남는다.
        #   · 이 표를 읽는 MV(floor_est_by_floor·floor_est_total)는 이름이 아니라 표 자체를
        #     붙든다. 이름을 바꾸면 **MV 가 옛 표를 따라가** 새 데이터를 안 본다.
        # 검사는 여전히 staging(_floor_outline_new)에서 끝낸 뒤에 한다 — 통과 못 하면
        # 살아 있는 표는 손도 안 댄다. 트랜잭션이라 읽는 쪽은 잠깐 기다릴 뿐 빈 표를 보지 않는다.
        # 표 모양(칸)은 db/migrations/0152 가 맡는다.
        async with c.transaction():
            await c.execute("TRUNCATE master.floor_outline RESTART IDENTITY")
            await c.execute("""
                INSERT INTO master.floor_outline
                  (building_pk, seq, floor, use, floor_area, floor_raw,
                   dong, area_excluded, structure, main_sub)
                SELECT building_pk, seq, floor, use, floor_area, floor_raw,
                       dong, area_excluded, structure, main_sub
                  FROM master._floor_outline_new""")
        await c.execute("DROP TABLE IF EXISTS master._floor_outline_new")

        # 층 추정이 이 표를 읽는다 — 함께 굴린다
        for mv in ("master.floor_est_by_floor", "master.floor_est_total"):
            try:
                await c.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv}")
                print(f"  · {mv} 갱신")
            except Exception as e:
                print(f"  ⚠️ {mv} 갱신 실패(무시): {e}")

        await c.execute(
            """UPDATE master.master_loads
                  SET finished_at=now(), status='success', rows_in=$2,
                      validation=jsonb_build_object('columns',true,'floor_norm',$3::numeric)
                WHERE run_id=$1""", run_id, n, round(pct, 2))
        print(f"✅ 적재 완료 {n:,}행")
    except Exception as e:
        await c.execute(
            """UPDATE master.master_loads SET finished_at=now(), status='failed', error=$2
                WHERE run_id=$1""", run_id, str(e)[:500])
        await c.execute("DROP TABLE IF EXISTS master._floor_outline_new")
        print(f"✗ {e}")
        sys.exit(1)
    finally:
        await c.close()


asyncio.run(main())
