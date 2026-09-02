"""생활인구 zip → master.living_pop 적재 — 격자당 한 줄로 접는다.

하루 25만 행(격자 8,558 × 24시간)이라 원본을 그대로 쌓지 않는다.
받은 날들을 **시간대별로 평균**해 격자당 한 줄(hourly 24칸 + 파생값)로 만든다.

격자 좌표: 국가지점번호. 서울 전역이 「다사」 하나이고 뒤 8자리가 그 100km 구역 안
좌표(10m 단위)다. 원점은 EPSG:5179 의 (900000, 1900000) — 서울 건물 범위로 역산해
다사52255325 → 종로구 무악동으로 검증했다(0129 주석 참조).

값이 5 미만인 칸은 원본이 `*`로 가린다(비식별). 합계는 가리지 않아서 우리가 쓰는
생활인구합계엔 영향이 없다 — 성연령 칸은 지금 안 쓴다.

    data/.venv/bin/python scripts/seoul_open/load_living_pop.py [--dir data/raw/_living_pop]
"""
import os
import re
import csv
import io
import sys
import glob
import zipfile
import argparse
import datetime as dt
from collections import defaultdict

import psycopg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
# 「다사」 구역 원점(EPSG:5179). 서울은 이 한 구역에 다 들어간다.
OX, OY = 900_000, 1_900_000
CELL = 250
GRID = re.compile(r"^(..)(\d{4})(\d{4})$")
DAY_H = range(11, 22)      # 11~21시 — 상업 유동
NIGHT_H = [22, 23, 0, 1, 2, 3, 4, 5, 6]


def cell_center(grid: str) -> tuple[float, float] | None:
    m = GRID.match(grid)
    if not m:
        return None
    x = OX + int(m.group(2)) * 10 + CELL / 2
    y = OY + int(m.group(3)) * 10 + CELL / 2
    return x, y


def read_zip(path: str, acc: dict, dongs: dict) -> str | None:
    """zip 하나를 읽어 (격자, 시간) → 인구 합·건수에 더한다. 반환=그 날짜"""
    day = None
    with zipfile.ZipFile(path) as z:
        name = next((n for n in z.namelist() if n.lower().endswith(".csv")), None)
        if not name:
            return None
        with z.open(name) as fh:
            r = csv.reader(io.TextIOWrapper(fh, encoding="cp949"))
            next(r, None)                                    # 머리줄
            for row in r:
                if len(row) < 5:
                    continue
                day = day or row[0].strip()
                try:
                    hour = int(row[1])
                    pop = float(row[4])
                except ValueError:
                    continue                                 # 값이 가려졌거나 깨진 줄은 버린다
                g = row[3].strip()
                acc[(g, hour)][0] += pop
                acc[(g, hour)][1] += 1
                dongs.setdefault(g, row[2].strip())
    return day


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="data/raw/_living_pop")
    a = ap.parse_args()

    zips = sorted(glob.glob(os.path.join(a.dir, "250_LOCAL_RESD_*.zip")))
    if not zips:
        print(f"zip 이 없습니다 — {a.dir}. download_living_pop.py 를 먼저 돌리세요.")
        return 1

    acc: dict = defaultdict(lambda: [0.0, 0])
    dongs: dict = {}
    days: list[str] = []
    for p in zips:
        d = read_zip(p, acc, dongs)
        if d:
            days.append(d)
        print(f"  읽음 {os.path.basename(p)} — {d}")

    # 격자별 24칸으로 접는다
    by_grid: dict = defaultdict(lambda: [None] * 24)
    for (g, h), (s, n) in acc.items():
        if 0 <= h < 24 and n:
            by_grid[g][h] = round(s / n, 2)

    rows = []
    skipped = 0
    for g, hourly in by_grid.items():
        c = cell_center(g)
        if not c:
            skipped += 1
            continue
        have = [v for v in hourly if v is not None]
        if not have:
            continue
        day_v = [hourly[h] for h in DAY_H if hourly[h] is not None]
        night_v = [hourly[h] for h in NIGHT_H if hourly[h] is not None]
        peak = max(have)
        rows.append((
            g, c[0], c[1], dongs.get(g),
            hourly,
            round(sum(day_v) / len(day_v), 2) if day_v else None,
            round(sum(night_v) / len(night_v), 2) if night_v else None,
            peak, hourly.index(peak),
            len(days),
            dt.datetime.strptime(min(days), "%Y%m%d").date(),
            dt.datetime.strptime(max(days), "%Y%m%d").date(),
        ))

    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.executemany("""
            INSERT INTO master.living_pop
              (grid, geom, dong_code, hourly, day_avg, night_avg, peak, peak_hour, days, from_date, to_date)
            VALUES (%s, ST_Transform(ST_SetSRID(ST_MakePoint(%s,%s),5179),4326), %s,
                    %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (grid) DO UPDATE SET
              geom=EXCLUDED.geom, dong_code=EXCLUDED.dong_code, hourly=EXCLUDED.hourly,
              day_avg=EXCLUDED.day_avg, night_avg=EXCLUDED.night_avg, peak=EXCLUDED.peak,
              peak_hour=EXCLUDED.peak_hour, days=EXCLUDED.days,
              from_date=EXCLUDED.from_date, to_date=EXCLUDED.to_date
        """, rows)
    print(f"생활인구 격자 {len(rows):,}칸 · {len(days)}일({min(days)}~{max(days)})"
          + (f" · 좌표 못 읽은 격자 {skipped}" if skipped else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
