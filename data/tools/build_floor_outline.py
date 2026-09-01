#!/usr/bin/env python3
"""층별개요 → 층별 프리필 CSV.

대장이 주는 이 면적은 그 층의 **바닥면적**이다 — 전용면적이 아니다(층별 합 = 연면적, 0035).
출력: floor_outline.csv → master.floor_outline.

층 표기는 원본이 제각각이라(같은 3층이 '3층'·'3'·'지상3층'·'삼층') floor_label 로 통일한다.
문자열로 층을 맞추는 곳이 전부 어긋났었다 — **원본은 floor_raw 에 보존한다.**

## 2026-08-31 — 이름으로 읽고, 두 칸을 더 싣는다

자리 번호로 읽던 것을 이름으로 옮겼다. 그리고 옛 판이 안 읽던 칸 둘을 싣는다:

  · **면적제외여부** — 연면적 산정에서 빼는 층인지. 이걸 모르면 층별 합이 연면적과 안 맞는다
  · **동명칭** — 한 필지에 여러 동이 있을 때 층을 동별로 갈라야 한다

    data/.venv/bin/python data/tools/build_floor_outline.py [출력경로]
"""
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from floor_label import normalize             # noqa: E402
from hub_csv import rows as hub_rows          # noqa: E402
from build_report import Report               # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "data/tools/_floor_outline.csv"

# ── 층별개요에서 읽는 칸 ────────────────────────────────────────
F = {
    "PK": "관리건축물대장PK", "동명": "동명칭",
    "층구분": "층구분코드명", "층번호명": "층번호명",
    "용도": "주용도코드명", "기타용도": "기타용도",
    "면적": "면적(㎡)", "면적제외": "면적제외여부",
    "구조": "구조코드명", "주부속구분": "주부속구분코드명",
}


def main():
    w = csv.writer(open(OUT, "w", newline=""))
    w.writerow(["building_pk", "seq", "floor", "floor_raw", "use", "floor_area",
                "dong", "area_excluded", "structure", "main_sub"])
    rep = Report("build_floor_outline", src=("대장", "층별개요"), used=F.values())
    seq: dict[str, int] = {}
    n = 0
    excluded = 0

    for r in hub_rows("대장", "층별개요", need=list(F.values())):
        g = lambda k: (r[F[k]] or '').strip()
        rep.read()
        pk = g('PK')
        if not pk:
            rep.drop("PK 없음"); continue

        floor_raw = g('층번호명')
        floor, _kind = normalize(floor_raw)
        if floor_raw and not floor:
            # 원본 표기를 못 알아봤다. **버리지 않고 원문 그대로 둔다** —
            # 층을 지어내는 것보다 원문이 낫다.
            rep.note_odd("층 표기를 못 알아봄 — 원문 그대로", pk, floor_raw)

        ex = g('면적제외')
        if ex and ex not in ('0', 'N', ''):
            excluded += 1

        s = seq.get(pk, 0)
        seq[pk] = s + 1
        w.writerow([pk, s, floor or floor_raw, floor_raw, g('용도'), g('면적'),
                    g('동명'), ex, g('구조'), g('주부속구분')])
        rep.write()
        n += 1

    rep.note(f"면적제외 층 {excluded:,}행")
    rep.finish()
    print(f"\n층별개요 {n:,}행 · {len(seq):,}건물 → {OUT}")
    print(f"  면적제외 층 {excluded:,}행")


if __name__ == "__main__":
    main()
