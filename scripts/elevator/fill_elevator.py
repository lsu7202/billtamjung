"""master.buildings.elevator 보정 — 한국승강기안전공단 설치현황(건축물대장보다 정확).

건축물대장 기반 elevator가 NULL/0인 서울 건물을, 승강기공단 데이터의 도로명주소 매칭으로 채운다.
- 대상 승강기: 종류에서 에스컬레이터·자동차용 제외(사람 엘리베이터), 상태 운행중/휴지(폐지 제외)
- 매칭: 도로명주소 정규화(괄호(동) 제거·공백 제거) → building.road_addr 동일 정규화와 대조
- 갱신: elevator IS NULL OR elevator=0 인 건물만(기존 대장 양수값은 보존)
    backend/.venv/bin/python scripts/elevator/fill_elevator.py
※ 지속화: 재적재(loader) 후 소실되므로, 정착 시 loader 파이프라인 단계로 편입 필요.
"""
import os
import re
import csv
import asyncio
import collections

import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
RAW = os.path.join(os.path.dirname(__file__), "..", "..", "data", "raw")
FILES = ["한국승강기안전공단_승강기 설치 현황_2016년 이후.csv",
         "한국승강기안전공단_승강기 설치 현황_2015년 이전.csv"]
EXCLUDE_TYPE = ("에스컬레이터", "자동차용")   # 사람 승강기 아님
KEEP_STATUS = ("운행중", "휴지")              # 폐지 제외(물리적 존재)

_paren = re.compile(r"\(.*?\)")
_ws = re.compile(r"\s+")


def norm(addr: str | None) -> str | None:
    """도로명주소 정규화 — 괄호(동)·모든 공백 제거. CSV·DB 동일 적용."""
    if not addr:
        return None
    a = _ws.sub("", _paren.sub("", addr))
    return a or None


def load_csv_counts() -> dict[str, int]:
    """정규화 도로명주소 → 엘리베이터 대수(서울)."""
    cnt: dict[str, int] = collections.Counter()
    for fn in FILES:
        path = os.path.join(RAW, fn)
        with open(path, encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                if row.get("시도") != "서울":
                    continue
                if any(t in (row.get("승강기종류") or "") for t in EXCLUDE_TYPE):
                    continue
                if (row.get("승강기상태") or "") not in KEEP_STATUS:
                    continue
                k = norm(row.get("건물주소"))
                if k:
                    cnt[k] += 1
    return cnt


async def main():
    counts = load_csv_counts()
    print(f"승강기 주소(정규화) {len(counts):,}건 · 총 엘리베이터 {sum(counts.values()):,}대")

    c = await asyncpg.connect(DSN)
    rows = await c.fetch(
        """SELECT building_pk, road_addr, elevator FROM master.buildings
           WHERE bjd_code LIKE '11%' AND road_addr IS NOT NULL""")
    # 정규화 주소 → building_pk 리스트(동일 도로명 복수 건물 대비)
    updates = []
    matched_addr = set()
    for r in rows:
        if r["elevator"] not in (None, 0):
            continue   # 대장 양수값 보존
        k = norm(r["road_addr"])
        n = counts.get(k) if k else None
        if n:
            updates.append((r["building_pk"], n))
            matched_addr.add(k)

    await c.executemany(
        "UPDATE master.buildings SET elevator=$2 WHERE building_pk=$1", updates)
    print(f"보정 건물 {len(updates):,}동 · 매칭 주소 {len(matched_addr):,}건 "
          f"(승강기주소 중 {len(matched_addr)/max(1,len(counts))*100:.1f}% 활용)")

    # 검증 리포트
    seoul_null = await c.fetchval(
        "SELECT count(*) FROM master.buildings WHERE bjd_code LIKE '11%' AND (elevator IS NULL OR elevator=0)")
    seoul_has = await c.fetchval(
        "SELECT count(*) FROM master.buildings WHERE bjd_code LIKE '11%' AND elevator>0")
    print(f"보정 후 서울: 엘리베이터 있음 {seoul_has:,}동 · 없음/미상 {seoul_null:,}동")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
