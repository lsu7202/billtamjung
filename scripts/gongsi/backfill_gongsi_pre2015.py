"""master.gongsi_series 2015년 이전 백필 — 개별공시지가 연도별 CSV(1990~2015).

기존 파이프라인(V-World)이 2016년 이후만 제공 → 그 이전은 이 일회성 스크립트로 채운다.
★ 일회성: 최초 1회만 사용. 이후 공시지가 업데이트는 기존 V-World 파이프라인(export_series 등) 계속 사용.

- 원본: data/raw/공시지가_YYYY년.csv (CP949). 키=토지코드(PNU 19자리), 값=공시지가(원/㎡), 연도=기준년도
- 대상: master.gongsi_series_v3 (뷰 master.gongsi_series의 실테이블, PK(pnu,year), price=원/㎡ 동일 단위)
- 필터: 서울(시군구코드 11%) · 필지구분=토지 · 공시지가>0 · PNU 19자리 숫자
- 적재: <2016만, ON CONFLICT(pnu,year) DO NOTHING (기존 2016+ 불변)

    backend/.venv/bin/python scripts/gongsi/backfill_gongsi_pre2015.py
"""
import os
import re
import csv
import asyncio
import unicodedata

import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
RAW = os.path.join(os.path.dirname(__file__), "..", "..", "data", "raw")
PRICE_COL = "공시지가(원/㎡)"


def year_files():
    # macOS 파일명은 NFD 정규화 → 패턴(NFC)과 안 맞음. listdir 후 정규화 매칭, open은 원본명 사용.
    out = []
    for fn in os.listdir(RAW):
        m = re.search(r"공시지가_(\d{4})년.*\.csv$", unicodedata.normalize("NFC", fn))
        if m and int(m.group(1)) < 2016:
            out.append((int(m.group(1)), os.path.join(RAW, fn)))
    return sorted(out)


def parse(path, yr_fallback):
    """서울·토지·유효 PNU/가격 행만 (pnu, year, price)."""
    with open(path, encoding="cp949", errors="replace") as f:
        for row in csv.DictReader(f):
            if not (row.get("시군구코드") or "").startswith("11"):
                continue
            if row.get("필지구분명") != "토지":
                continue
            pnu = (row.get("토지코드") or "").strip()
            if len(pnu) != 19 or not pnu.isdigit():
                continue
            pr = (row.get(PRICE_COL) or "").strip()
            if not pr.isdigit() or int(pr) <= 0:
                continue
            yb = (row.get("기준년도") or "").strip()
            yr = int(yb) if yb.isdigit() else yr_fallback
            yield (pnu, yr, int(pr))


async def main():
    files = year_files()
    print(f"대상 파일 {len(files)}개: {files[0][0]}~{files[-1][0]}")
    c = await asyncpg.connect(DSN)
    await c.execute("DROP TABLE IF EXISTS master._gongsi_stage")
    await c.execute("CREATE UNLOGGED TABLE master._gongsi_stage(pnu text, year int, price bigint)")

    total = 0
    for yr, path in files:
        recs = list(parse(path, yr))
        if recs:
            await c.copy_records_to_table("_gongsi_stage", records=recs,
                                          columns=["pnu", "year", "price"], schema_name="master")
        total += len(recs)
        print(f"  {yr}: {len(recs):,}행")
    print(f"스테이징 {total:,}행")

    # 중복(pnu,year) 제거 후 적재 — 기존 2016+ 불변
    ins = await c.execute("""
        INSERT INTO master.gongsi_series_v3(pnu, year, price)
        SELECT DISTINCT ON (pnu, year) pnu, year, price
        FROM master._gongsi_stage WHERE year < 2016
        ORDER BY pnu, year, price DESC
        ON CONFLICT (pnu, year) DO NOTHING""")
    await c.execute("DROP TABLE master._gongsi_stage")
    print(f"적재 결과: {ins}")

    # 검증
    cov = await c.fetch("""SELECT year, count(*) n FROM master.gongsi_series
                           WHERE year < 2016 GROUP BY year ORDER BY year""")
    print("연도별 적재:", {r["year"]: r["n"] for r in cov})
    rng = await c.fetchrow("SELECT min(year) mn, max(year) mx, count(*) tot FROM master.gongsi_series")
    print(f"전체 범위: {rng['mn']}~{rng['mx']} · {rng['tot']:,}행")
    sample = await c.fetch("""SELECT year, price FROM master.gongsi_series
                              WHERE pnu='1111010100100010000' ORDER BY year""")
    print("표본 필지(청운동 1-0) 시계열:", {r["year"]: r["price"] for r in sample})
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
