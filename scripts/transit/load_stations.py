"""서울 역사마스터 → master.subway_stations (자동완성 역 검색용).
정적 참조 데이터 — 파이프라인 독립, 갱신 시 재실행. 사용: BT_DATABASE_URL=... python load_stations.py"""
import asyncio, json, os
import asyncpg

RAW = os.path.join(os.path.dirname(__file__), "../../data/raw/서울시 역사마스터 정보.json")

async def main():
    d = json.load(open(RAW))
    rows = d.get("DATA") if isinstance(d, dict) else d
    conn = await asyncpg.connect(os.environ.get("BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung"))
    await conn.execute("""CREATE TABLE IF NOT EXISTS master.subway_stations(
          name text NOT NULL, route text NOT NULL, lng double precision, lat double precision,
          PRIMARY KEY(name, route))""")
    await conn.execute("TRUNCATE master.subway_stations")
    n = 0
    for r in rows:
        try:
            await conn.execute("INSERT INTO master.subway_stations VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
                               r["bldn_nm"].strip(), r["route"].strip(), float(r["lot"]), float(r["lat"]))
            n += 1
        except (KeyError, ValueError):
            pass
    print(f"✓ subway_stations {n}건 적재")
    await conn.close()

asyncio.run(main())
