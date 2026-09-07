#!/usr/bin/env python3
"""단위·파생이 스스로 선언한 검증을 한 번에 훑는다 — 정본은 `pipeline/units.py` 다.

## 왜 여기서 다시 도나

평소엔 단위가 자기 검증을 자기가 돌린다(`run_unit.py` 의 넷째 마디). 그런데 그건 **그 단위가
돌 때만** 돈다. 주간 소식을 갱신해도 대장 표가 멀쩡한지는 아무도 안 본다.
그래서 커밋 전·배포 전에 전부 한 번 훑는 자리가 따로 있어야 한다.

**검사문은 여기에 안 적는다.** 두 곳에 적으면 곧 어긋난다 — 정본은 `pipeline/units.py` 의
`verify` · `DERIVE_VERIFY` · `CRAWL_VERIFY` 셋이고, 이 파일은 그걸 읽어 돌리기만 한다.

    BT_DATABASE_URL=... python3 qa/data/qa_units.py [--only 단위이름]
"""
import argparse
import glob
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from pipeline.units import UNITS, DERIVES                      # noqa: E402

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")

OK = FAIL = 0


def say(ok: bool, name: str, detail: str = "") -> None:
    global OK, FAIL
    if ok:
        OK += 1
    else:
        FAIL += 1
    print(f"  {'✓' if ok else '✗'} {name}" + (f"  {detail}" if detail else ""))


def sql_check(name: str, sql: str) -> None:
    r = subprocess.run(["psql", DSN, "-X", "-A", "-t", "-c", sql],
                       capture_output=True, text=True, timeout=600)
    if r.returncode:
        first = (r.stderr.strip().splitlines() or ["?"])[0]
        say(False, name, f"질의 오류 — {first[:110]}")
        return
    p = r.stdout.strip().split("|")
    say(p[0].strip() == "t", name, p[1].strip() if len(p) > 1 else "")


def file_check(name: str, pat: str, min_bytes: int, head: str | None, min_files: int) -> None:
    files = sorted(glob.glob(os.path.join(ROOT, pat)))
    small = [f for f in files if os.path.getsize(f) < min_bytes]
    bad = []
    if head:
        for f in files:
            try:
                with open(f, "rb") as fh:
                    d = fh.read(4096)
                if head.encode() not in d and head.encode("cp949", "ignore") not in d:
                    bad.append(f)
            except OSError:
                bad.append(f)
    detail = f"{len(files)}개"
    if small:
        detail += f" · 너무 작다: {os.path.basename(small[0])}"
    if bad:
        detail += f" · 머리글이 다르다: {os.path.basename(bad[0])}"
    say(len(files) >= min_files and not small and not bad, name, detail)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="이 단위·파생만")
    a = ap.parse_args()

    for k, u in UNITS.items():
        if a.only and a.only != k:
            continue
        rules, checks = u.get("verify_files") or [], u.get("verify") or []
        if not rules and not checks:
            continue
        print(f"\n[{k}] {u['label']}")
        for r in rules:
            file_check(*r)
        for name, sql in checks:
            sql_check(name, sql)

    for d in DERIVES:
        if a.only and a.only != d["step"]:
            continue
        if not d.get("verify"):
            continue
        print(f"\n[파생 {d['step']}] {d['label']}")
        for name, sql in d["verify"]:
            sql_check(name, sql)

    print(f"\n{OK} ✓ · {FAIL} ✗")
    return 1 if FAIL else 0


sys.exit(main())
