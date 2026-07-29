"""master.land_adjust 적재 — 자치구별 연도→현재 누적 지가변동률(F-17 시점보정).

(연) 지역별 지가변동률.json → 서울 구별 연 변동률 → 누적(comp 거래연도→현재).
하드코딩 TA({2022:.03,...}) 대체. 구명→bjd코드는 DB에서 매핑.
    python scripts/rent_estimate/build_land_adjust.py
"""
import os
import json
import asyncio
import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
SRC = os.path.join(os.path.dirname(__file__), "..", "..", "data", "raw", "(연) 지역별 지가변동률.json")


def _load():
    d = json.load(open(SRC))
    sh = d["sheet"]["1"]["data"]
    hdr = sh["0"]
    ycol = {c: int(str(hdr[c])[:4]) for c in hdr if str(hdr[c]).endswith("년")}
    out = {}   # 구명 → {year: rate%}
    for row in sh.values():
        if str(row.get("1")) != "서울":
            continue
        gu = str(row.get("2"))
        if gu in ("서울", "None", ""):
            continue
        rates = {}
        for c, y in ycol.items():
            try:
                rates[y] = float(row[c])
            except (TypeError, ValueError, KeyError):
                pass
        if rates:
            out[gu] = rates
    return out, max(ycol.values())


async def main():
    rates, last_yr = _load()
    c = await asyncpg.connect(DSN)
    # 구명 → bjd 앞5 코드 (addr에서 '○○구' 파싱)
    name2code = {}
    for r in await c.fetch(
            "SELECT DISTINCT substr(bjd_code,1,5) code, addr FROM master.buildings WHERE bjd_code LIKE '11%' AND addr LIKE '%구%'"):
        addr = r["addr"] or ""
        for part in addr.split():
            if part.endswith("구"):
                name2code.setdefault(part, r["code"])
                break
    await c.execute("""DROP TABLE IF EXISTS master.land_adjust;
        CREATE TABLE master.land_adjust(gu text, yr int, adj numeric, PRIMARY KEY(gu, yr))""")
    ins = []
    for gu, rr in rates.items():
        code = name2code.get(gu)
        if not code:
            continue
        for y in range(2013, last_yr + 2):   # comp 거래연도 y → 현재 누적
            factor = 1.0
            for yy in range(y + 1, last_yr + 1):   # y+1 ~ last_yr 연 변동 누적
                factor *= (1 + rr.get(yy, 0) / 100)
            ins.append((code, y, round(factor - 1, 5)))
    # 서울 평균 폴백(구코드 '11')
    savg = {}
    for y in range(2013, last_yr + 2):
        vals = [rr.get(yy, 0) for gu, rr in rates.items() if gu == "서울" for yy in [y]]
        savg[y] = None
    seoul_row = rates.get("서울", {})
    for y in range(2013, last_yr + 2):
        factor = 1.0
        for yy in range(y + 1, last_yr + 1):
            factor *= (1 + seoul_row.get(yy, 0) / 100)
        ins.append(("11", y, round(factor - 1, 5)))
    await c.executemany("INSERT INTO master.land_adjust(gu,yr,adj) VALUES($1,$2,$3)", ins)
    print(f"land_adjust 적재: {len(ins)}행 · 구 {len(set(x[0] for x in ins))}개 · {2013}~{last_yr}")
    # 검증: 강남 시점보정
    r = await c.fetch("SELECT yr, adj FROM master.land_adjust WHERE gu='11680' ORDER BY yr")
    print("  강남(11680) 시점보정:", {x["yr"]: f"{float(x['adj'])*100:.1f}%" for x in r})
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
