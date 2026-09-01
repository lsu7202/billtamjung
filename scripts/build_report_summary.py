#!/usr/bin/env python3
"""빌더 처리결과 한눈에 — 파이프라인이 끝날 때 보여 주는 표(2026-09-01 신설).

## 왜 신설하나

빌더마다 `data/tools/_reports/*.json` 을 쓰고 있었는데 **아무도 안 열어 봤다.**
파일로만 남으니 그 안에 「전유공용 1,982만 줄이 한 줄도 안 잡혀 있다」가 두 달을
누워 있어도 모른다. 실제로 오늘 손으로 열어 보고서야 구멍 셋을 찾았다.

셈이 맞는지도 여기서 본다: **읽은줄 = 실제출력 + 버림 + 합침** 이어야 한다.
안 맞으면 어딘가에서 줄이 조용히 사라진 것이고, 그게 제일 무서운 종류의 사고다.

    data/.venv/bin/python scripts/build_report_summary.py
"""
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "data", "tools", "_reports")


def tot(v):
    return sum(v.values()) if isinstance(v, dict) else (v or 0)


def main():
    files = sorted(glob.glob(os.path.join(DIR, "*.json")))
    if not files:
        print("처리결과 문서가 없습니다 — 빌더를 먼저 돌리세요")
        return 0

    print(f"{'빌더':22}{'읽은줄':>12}{'낸줄':>12}{'대상아님':>11}{'버림':>9}{'합침':>12}"
          f"{'바꿈':>7}{'비움':>7}  판정")
    print("─" * 104)
    bad, unbalanced = [], []
    for f in files:
        d = json.load(open(f, encoding="utf-8"))
        read, out = d["읽은줄"], d.get("실제출력", d["낸줄"])
        drop, merge = tot(d.get("버림")), tot(d.get("합침(중복·접기)"))
        skip = tot(d.get("대상아님"))
        fix, null = tot(d.get("우리가바꿈")), tot(d.get("비움"))
        print(f"{d['빌더']:22}{read:>12,}{out:>12,}{skip:>11,}{drop:>9,}{merge:>12,}"
              f"{fix:>7,}{null:>7,}  {d['판정']}")
        if d["판정"] != "정상":
            bad.append((d["빌더"], d.get("사유")))
        # 셈: 읽은 줄은 낸 줄 + 버린 줄 + 합쳐진 줄로 남김없이 갈려야 한다
        if read != out + drop + merge + skip:
            unbalanced.append((d["빌더"], read, out, drop + skip, merge))
        for sd in d.get("함께읽은원본", []):
            so = sd.get("접은뒤", sd["읽은줄"])
            print(f"{'  └ ' + sd['마트']:22}{sd['읽은줄']:>12,}{so:>12,}"
                  f"{0:>11,}{sd.get('버림', 0):>9,}{sd.get('합침', 0):>12,}")
            if sd["읽은줄"] != so + sd.get("버림", 0) + sd.get("합침", 0):
                unbalanced.append((d["빌더"] + " / " + sd["마트"], sd["읽은줄"], so,
                                   sd.get("버림", 0), sd.get("합침", 0)))

    print()
    for name, why in bad:
        print(f"  ⚠️ {name}: {why}")
    for name, r, o, dr, mg in unbalanced:
        print(f"  ❌ {name}: 셈이 안 맞습니다 — 읽은 {r:,} ≠ 낸 {o:,} + 버림 {dr:,} + 합침 {mg:,}"
              f" (차이 {r - o - dr - mg:+,})")
    if unbalanced:
        print("\n  줄이 어디로 갔는지 문서에 안 남았다는 뜻입니다. 빌더에 rep.drop/merge 를 다세요.")
        return 1
    if not bad:
        print("  ✅ 전 빌더 정상 · 읽은 줄이 모두 설명됩니다")
    return 0


if __name__ == "__main__":
    sys.exit(main())
