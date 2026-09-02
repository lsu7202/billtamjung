"""건물 → 생활인구 격자 매칭(master.building_pop). 멱등 — 몇 번 돌려도 같다.

격자는 EPSG:5179 위의 250m 정사각이고 ID 는 국가지점번호다. 서울 전역이 「다사」 한 구역
안에 들어가고 뒤 8자리가 그 구역 원점(900000, 1900000)에서 10m 단위 좌표다.
그래서 건물 좌표를 250 으로 나누면 어느 칸인지 바로 나온다 — 공간 조인이 필요 없다.
56만 동에 ST_Contains 를 돌리면 몇 분이지만 나눗셈은 한 번 훑기면 끝난다.

접두(「다사」)는 하드코딩하지 않고 living_pop 에서 읽는다. 서울 밖으로 넓힐 때
구역이 갈리면 하드코딩이 조용히 틀린 격자를 만든다.

    data/.venv/bin/python scripts/seoul_open/match_building_pop.py
선행: scripts/seoul_open/load_living_pop.py (master.living_pop 적재)
"""
import os
import sys

import psycopg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
OX, OY = 900_000, 1_900_000
CELL = 250

SQL = """
INSERT INTO master.building_pop(building_pk, grid, day_avg, night_avg, peak, peak_hour)
SELECT b.building_pk, g.grid, l.day_avg, l.night_avg, l.peak, l.peak_hour
  FROM (
    SELECT b.building_pk,
           %(pfx)s
           || lpad((floor((ST_X(t.p) - %(ox)s) / %(cell)s) * (%(cell)s / 10))::int::text, 4, '0')
           || lpad((floor((ST_Y(t.p) - %(oy)s) / %(cell)s) * (%(cell)s / 10))::int::text, 4, '0') AS grid
      FROM master.buildings b,
           LATERAL (SELECT ST_Transform(b.geom, 5179) AS p) t
     WHERE b.geom IS NOT NULL
  ) g
  JOIN master.buildings b USING (building_pk)
  JOIN master.living_pop l ON l.grid = g.grid
ON CONFLICT (building_pk) DO UPDATE SET
  grid = EXCLUDED.grid, day_avg = EXCLUDED.day_avg, night_avg = EXCLUDED.night_avg,
  peak = EXCLUDED.peak, peak_hour = EXCLUDED.peak_hour
"""


def main() -> int:
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*), min(left(grid,2)), max(left(grid,2)) FROM master.living_pop")
        n, lo, hi = cur.fetchone()
        if not n:
            print("master.living_pop 이 비었습니다 — load_living_pop.py 를 먼저 돌리세요.")
            return 1
        if lo != hi:
            # 구역이 갈리면 나눗셈 한 벌로는 못 푼다(원점이 구역마다 다르다). 조용히 틀리느니 멈춘다.
            print(f"격자 구역이 둘 이상입니다({lo}, {hi}) — 원점을 구역별로 나눠야 합니다.")
            return 1
        cur.execute(SQL, {"pfx": lo, "ox": OX, "oy": OY, "cell": CELL})
        matched = cur.rowcount
        cur.execute("SELECT count(*) FROM master.buildings WHERE geom IS NOT NULL")
        total = cur.fetchone()[0]
    print(f"건물 {matched:,} / {total:,}동 매칭 ({matched / total * 100:.1f}%) · 격자 {n:,}칸")
    return 0


if __name__ == "__main__":
    sys.exit(main())
