"""좌표가 없어 통째로 빠졌던 건물을 넣는다(2026-08-27).

원천 서울 표제부 585,896동 중 DB 에 560,016동만 있었다. 빌더는 다 만드는데
`pipeline/export_seoul.py` 가 「좌표 없으면 제외(지도 필수)」로 25,880동을 버렸다 —
원천 연속지적도에 그 PNU 가 없어서다. 지적도가 없다고 건물이 없는 것은 아니다:
대장·면적·용도·층수는 다 아는데 위치만 모른다.

export/loader 는 이미 고쳤지만(좌표 없으면 geom NULL) 전체 재빌드는 원천 6GB 를
다시 파싱해야 해서 오래 걸린다. 그동안 **빠진 것만** 넣어 검색·상세가 되게 한다.
다음 정기 파이프라인이 돌면 이 스크립트 없이도 같은 상태가 된다.

    backend/.venv/bin/python scripts/backfill_missing_buildings.py [--dry]
"""
import os
import sys
import json
import asyncio
import argparse

import asyncpg
from decimal import Decimal

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
SRC = os.path.join(os.path.dirname(__file__), "..", "data", "tools", "_integrated.jsonl")


def _num(v):
    """'123.45' → Decimal. 빈 값·읽을 수 없는 값은 None(0 으로 채우지 않는다).

    COPY 는 INSERT 와 달리 형변환을 안 해 준다 — numeric 컬럼엔 Decimal 을 줘야 한다.
    """
    if v in (None, "", "-"):
        return None
    try:
        f = float(str(v).replace(",", ""))
    except ValueError:
        return None
    return Decimal(str(round(f, 4))) if f == f else None


def _int(v):
    f = _num(v)
    return int(f) if f is not None else None


def _date(v):
    """'19980605' → date. 형식이 아니면 None — 지어내지 않는다."""
    s = str(v or "").strip()
    if len(s) != 8 or not s.isdigit() or not ("1800" <= s[:4] <= "2100"):
        return None
    if not ("01" <= s[4:6] <= "12") or not ("01" <= s[6:] <= "31"):
        return None
    from datetime import date
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:]))
    except ValueError:
        return None


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="세어만 보고 넣지 않는다")
    args = ap.parse_args()

    c = await asyncpg.connect(DSN)
    have = {r["building_pk"] for r in await c.fetch("SELECT building_pk FROM master.buildings")}
    # PK 만으로는 못 거른다(2026-08-27 실측) — 대장 PK 는 표제부가 재생성되면 바뀐다.
    # 세대가 다른 원천을 섞으면 같은 건물이 옛 PK·새 PK 로 두 번 잡혀서, PK 로만 걸렀더니
    # 6,007동이 중복으로 들어갔다. 주소+연면적+승인일 지문으로 한 번 더 거른다.
    fp = {(r["addr"], str(r["total_area"]), str(r["approval_ymd"]))
          for r in await c.fetch("SELECT addr, total_area, approval_ymd FROM master.buildings")}
    print(f"DB 에 있는 건물 {len(have):,}동")

    rows = []
    total = 0
    with open(SRC) as f:
        for line in f:
            d = json.loads(line)
            total += 1
            pk = str(d.get("PK") or "")
            if not pk or pk in have:
                continue
            addr = d.get("주소") or ""
            key = (addr, str(_num(d.get("연면적"))), str(_date(d.get("사용승인일"))))
            if key in fp:
                continue          # 같은 건물이 다른 PK 로 이미 있다
            pnu = str(d.get("PNU") or "")
            rows.append((
                pk, addr,
                addr.replace("서울특별시 ", "").replace(" ", "").replace("번지", ""),   # jibun_norm
                pnu or None, pnu[:5] or None, pnu[:10] or None,
                _num(d.get("대지면적")), _num(d.get("연면적")),
                _int(d.get("지상층수")), _int(d.get("지하층수")),
                _num(d.get("건폐율")), _num(d.get("용적률")),
                str(d.get("주용도코드") or "") or None, d.get("주용도") or None,
                d.get("기타용도") or None, d.get("구조") or None,
                _date(d.get("사용승인일")), _date(d.get("최근대수선일")),
                _num(d.get("건축면적")), _num(d.get("용적률산정연면적")),
                _int(d.get("엘리베이터")), _int(d.get("주차")),
                # 출처를 같이 실어야 한다. 값만 있고 출처가 비면 「대장이 아닌 값」으로
                # 보여 나중에 쓸려나간다(0144 가 그 기준으로 청소한다).
                d.get("건폐율출처") or None, d.get("용적률출처") or None,
            ))
    print(f"원천 {total:,}행 · DB 에 없는 것 {len(rows):,}동")
    if not rows:
        print("넣을 것이 없습니다 — 이미 다 들어와 있습니다")
        await c.close()
        return
    if args.dry:
        for r in rows[:5]:
            print(f"  {r[0]} · {r[1]}")
        await c.close()
        return

    # geom 은 넣지 않는다(NULL). 이웃 필지 좌표로 근사하면 지도에 엉뚱한 자리로 찍히고,
    # 그건 「모른다」보다 나쁘다. PostGIS 공간조건은 NULL 을 거짓으로 보므로 지도에서 알아서 빠진다.
    #
    # **뷰가 아니라 실제 테이블에 COPY 로 넣는다.** master.buildings 는 뷰이고 그 뒤 테이블엔
    # 인덱스가 스물셋 붙어 있다. executemany 로 개별 INSERT 를 이만육천 번 하면 매 행마다
    # 인덱스 스물셋을 갱신해서, 실측으로 삼십 분이 지나도 안 끝나고 DB 전체가 막혔다.
    tbl = await c.fetchval(
        """SELECT n.nspname || '.' || c.relname
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname='master' AND c.relkind='r' AND c.relname ~ '^buildings_v[0-9]+$'
            ORDER BY (regexp_replace(c.relname, '[^0-9]', '', 'g'))::int DESC LIMIT 1""")
    print(f"적재 대상: {tbl}")
    await c.copy_records_to_table(
        tbl.split(".")[1], schema_name="master", records=rows,
        columns=["building_pk", "addr", "jibun_norm", "pnu", "sgg_code", "bjd_code",
                 "land_area", "total_area", "floors_above", "floors_below", "bcr", "far",
                 "main_use", "main_use_name", "etc_use", "structure",
                 "approval_ymd", "remodel_ymd", "build_area", "far_area", "elevator", "parking",
                 "bcr_src", "far_src"])
    got = await c.fetchval("SELECT count(*) FROM master.buildings")
    print(f"넣었습니다 — 건물 {got:,}동 (geom NULL {len(rows):,}동: 지적도에 PNU 없음)")
    await c.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()) or 0)
