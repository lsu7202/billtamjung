#!/usr/bin/env python3
"""도로명주소 도로구간 → master.road_segment (도로폭 마스터).

대장의 'road_frontage'는 광대/중로/소로 같은 분류 코드라 실제 폭(m)이 없다.
연속지적도의 도로 필지로 폭을 계산해봤지만 도로가 잘게 쪼개져 있어 대로변에서 크게 빗나갔다
(노량진동 54-8: 실제 25m → 추정 9.3m). 도로명주소 도로구간에는 ROAD_BT(폭원, m)가 실측으로 들어 있다.

원천: 국가공간정보포털/V-World 「도로명주소 도로구간」
      https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=MK&dsId=30055
      data/raw/(도로명주소)도로구간_서울/TL_SPRD_MANAGE.Seoul.shp (EPSG:5179)
출력: road_width.csv (rn_cd, rn, road_bt, road_lt, cls, sig_cd, wkt) → \\copy로 적재
"""
import csv
import os
import sys

import shapefile
from pyproj import Transformer

SRC = "data/raw/(도로명주소)도로구간_서울/TL_SPRD_MANAGE.Seoul"
OUT = sys.argv[1] if len(sys.argv) > 1 else "data/tools/_road_width.csv"

# 도로구간은 중부원점TM(EPSG:5179) — 우리 마스터는 WGS84(4326)
_T = Transformer.from_crs("EPSG:5179", "EPSG:4326", always_xy=True)

# ROA_CLS_SE 도로구분 코드 — 표기용
CLS = {"0": "고속도로", "1": "일반국도", "2": "특별광역시도", "3": "국가지원지방도",
       "4": "지방도", "5": "시군도", "6": "구도", "7": "농어촌도로", "8": "기타"}


def main() -> None:
    r = shapefile.Reader(shp=open(SRC + ".shp", "rb"), dbf=open(SRC + ".dbf", "rb"),
                         shx=open(SRC + ".shx", "rb"), encoding="cp949")
    names = [f[0] for f in r.fields[1:]]
    idx = {n: i for i, n in enumerate(names)}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    w = csv.writer(open(OUT, "w", newline=""))
    w.writerow(["rn_cd", "rn", "road_bt", "road_lt", "cls", "sig_cd", "wkt"])

    n = skipped = 0
    for sh, rec in zip(r.iterShapes(), r.iterRecords()):
        bt = rec[idx["ROAD_BT"]]
        pts = list(sh.points)
        if not bt or bt <= 0 or len(pts) < 2:
            skipped += 1
            continue
        # 여러 파트(멀티라인)는 첫 파트만 — 도로구간은 대부분 단일 라인
        parts = list(sh.parts) + [len(pts)]
        seg = pts[parts[0]:parts[1]]
        if len(seg) < 2:
            skipped += 1
            continue
        ll = [_T.transform(x, y) for x, y in seg]
        wkt = "LINESTRING(" + ", ".join(f"{x:.7f} {y:.7f}" for x, y in ll) + ")"
        w.writerow([rec[idx["RN_CD"]], rec[idx["RN"]], bt, rec[idx["ROAD_LT"]],
                    CLS.get(str(rec[idx["ROA_CLS_SE"]]), ""), rec[idx["SIG_CD"]], wkt])
        n += 1
    print(f"도로구간 {n:,}건 → {OUT} (폭원 없음·비정상 {skipped:,}건 제외)")


if __name__ == "__main__":
    main()
