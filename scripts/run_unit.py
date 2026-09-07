#!/usr/bin/env python3
"""원천 단위 실행기 — 바뀐 것만, 그것을 읽는 파생만 돌린다(2026-09-06).

지금까지는 `run_pipeline.sh` 하나였고 어느 원천이 바뀌었든 대장 전체 빌드가 따라 돌았다.
디스크 25GB 를 쓰고 몇 시간이 걸리며, 2026-09-06 밤엔 그러다 디스크가 0 이 됐다.
주간 소식 하나 갱신하려고 대장을 다시 조립할 이유가 없다.

## 한 단위는 네 마디로 돈다

    ① 크롤   원천을 받는다                     --no-crawl 로 끈다
    ② 빌드   받은 것을 표 모양으로 조립한다     대장·실거래·공시지가만 있다
    ③ 적재   포스트그레스에 싣는다              세대 스왑(v8→v9)
    ④ 검증   자기가 낸 결과를 잰다              깨지면 판을 안 올린다

**판을 안 올리면 그 단위를 읽는 파생도 안 돈다.** 반쯤 적재된 표 위에서 임대추정·적정가를
다시 계산하는 것이 가장 나쁘다(2026-09-06 에 실제로 그랬다).

## 부르는 법

    scripts/run_unit.py --list                     # 단위·주기·마지막 판 보기
    scripts/run_unit.py --unit gongsi              # 「오늘은 공시지가 하는 날」
    scripts/run_unit.py --unit news.press          # 「오늘은 보도자료 하는 날」
    scripts/run_unit.py --cadence weekly           # 그 주기 것 전부 + 뒤따르는 파생
    scripts/run_unit.py --unit ledger              # 전체 빌드(디스크 40GB 를 먼저 잰다)
    scripts/run_unit.py --derive area_event        # 파생만

    --no-crawl        받지 않고 이미 있는 파일로
    --phase load      한 마디만 (crawl·build·load)
    --from-step 라벨  빌드를 그 단계부터 재개 (예: --from-step integrated)
    --force           지문이 같아도 실행
    --dry-run         무엇을 부를지만 보인다
    --seed            지금 상태를 판 1 로 찍는다(도입 때 한 번)

선언은 pipeline/units.py 한 곳 — 명령·주기·문지기·지문·검증이 다 거기 있다.
장부는 master.source_version(원천) · master.derive_run(파생).
전부 한 번에 훑으려면 `qa/run.sh units`.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from pipeline.units import UNITS, DERIVES, CADENCES, units_of   # noqa: E402

PY = {"gis": os.path.join(ROOT, "data", ".venv", "bin", "python"),
      "app": os.path.join(ROOT, "backend", ".venv", "bin", "python")}


# ── 환경 ────────────────────────────────────────────────────────────────
def load_env() -> str:
    """backend/.env(접속) · scripts/.env.pipeline(자격증명) 을 읽는다. 값은 절대 찍지 않는다."""
    for f in ("backend/.env", os.environ.get("BT_ENV", "scripts/.env.pipeline")):
        p = os.path.join(ROOT, f)
        if not os.path.exists(p):
            continue
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    dsn = os.environ.get("BT_DATABASE_URL") or os.environ.get("DATABASE_URL") or ""
    for k in ("DATABASE_URL", "BT_DATABASE_URL", "RENT_DSN"):
        os.environ[k] = dsn
    return dsn


def q(dsn: str, sql: str) -> str | None:
    """psql 한 줄 조회. asyncpg 를 안 쓰는 이유는 이 파일이 어느 venv 에서도 돌아야 해서다."""
    try:
        r = subprocess.run(["psql", dsn, "-X", "-A", "-t", "-c", sql],
                           capture_output=True, text=True, timeout=120)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def x(dsn: str, sql: str, *args: str) -> bool:
    """장부에 쓴다. 값은 :\'a1\' … 로 받는다.

    **SQL 은 stdin 으로 넣는다.** `psql -c` 는 문자열을 서버로 그대로 보내고 psql 변수를 펼치지 않는다.
    처음에 -c 로 짰다가 열두 단위·아홉 파생이 「찍었다」고 말만 하고 장부는 빈 채로 남았다(2026-09-06).
    **실패는 반드시 말한다** — 조용한 실패가 틀린 값보다 나쁘다는 게 이 저장소의 규칙이다.
    """
    cmd = ["psql", dsn, "-X", "-q", "-v", "ON_ERROR_STOP=1"]
    for i, a in enumerate(args, 1):
        cmd += ["-v", f"a{i}={a}"]
    r = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        err = " ".join((r.stderr or "").strip().splitlines()[:2])
        print(f"    ⚠ 장부 기록 실패: {err}")
    return r.returncode == 0


# ── 지문 ────────────────────────────────────────────────────────────────
def fingerprint(unit: dict, dsn: str) -> str | None:
    """입력이 지난번과 같은지 재는 값. 파일은 (경로·크기), 표는 선언한 질의.

    **mtime 은 안 쓴다.** fetch_notices 는 새 글이 0건이어도 jsonl 을 통째로 다시 쓴다.
    mtime 을 지문에 넣으면 내용이 같아도 매번 「바뀌었다」가 되어 건너뛰기가 아무 일도 안 한다.
    덧붙임·전체판 원천 둘 다 크기가 곧 판이다.
    """
    if unit.get("sig_sql"):
        return q(dsn, unit["sig_sql"])
    parts: list[str] = []
    for pat in unit.get("inputs") or []:
        for p in sorted(glob.glob(os.path.join(ROOT, pat))):
            try:
                st = os.stat(p)
                parts.append(f"{os.path.relpath(p, ROOT)}|{st.st_size}")
            except OSError:
                pass
    return hashlib.sha1("\n".join(parts).encode()).hexdigest()[:16] if parts else None


def ledger(dsn: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    rows = q(dsn, "select unit||'\t'||coalesce(input_sig,'')||'\t'||version||'\t'"
                  "||coalesce(loaded_at::date::text,'-')||'\t'||coalesce(rows::text,'-') "
                  "from master.source_version") or ""
    for line in rows.splitlines():
        f = line.split("\t")
        if len(f) == 5:
            out[f[0]] = dict(sig=f[1], version=int(f[2]), at=f[3], rows=f[4])
    return out


def bump(dsn: str, unit: str, cadence: str, sig: str | None, rows: str | None, status: str) -> None:
    x(dsn, """INSERT INTO master.source_version(unit,cadence,input_sig,version,loaded_at,rows,status)
              VALUES(:'a1',:'a2',nullif(:'a3','')::text,1,now(),nullif(:'a4','')::bigint,:'a5')
              ON CONFLICT (unit) DO UPDATE SET cadence=EXCLUDED.cadence, input_sig=EXCLUDED.input_sig,
                version=master.source_version.version+1, loaded_at=now(),
                rows=EXCLUDED.rows, status=EXCLUDED.status""",
      unit, cadence, sig or "", rows or "", status)


# ── 실행 ────────────────────────────────────────────────────────────────
def run_step(step: dict, dry: bool, from_step: str | None = None) -> bool:
    # 한 칸이 빠졌다고 28단계를 처음부터 돌 이유가 없다. 전체 빌드 스크립트에만 꽂는다
    # (다른 명령엔 --from 이 없다). 2026-09-06: 승강기 한 칸 때문에 34분을 통째로 다시 돌았다.
    if from_step and step["cmd"][0].endswith("build_all.py"):
        step = dict(step, cmd=step["cmd"] + ["--from", from_step])
    need = step.get("need")
    if need and not os.path.exists(os.path.join(ROOT, need)):
        print(f"    ⏭  {need} 없음, 건너뜀")
        return True
    py = PY.get(step.get("py", "app")) or sys.executable
    if not os.path.exists(py):
        py = sys.executable
    cmd = step["cmd"]
    full = cmd if cmd[0] in ("bash", "sh") else [py] + cmd
    print("    $", " ".join(cmd))
    if dry:
        return True
    return subprocess.run(full, cwd=ROOT).returncode == 0


def sweep(pats: list[str] | None, dry: bool) -> None:
    """다시 만들 수 있는 중간산물을 치운다. 원천은 절대 여기 오지 않는다(units.py 주석 참고)."""
    freed = 0
    for pat in pats or []:
        for f in glob.glob(os.path.join(ROOT, pat)):
            try:
                if os.path.isdir(f):
                    freed += sum(os.path.getsize(os.path.join(r, n))
                                 for r, _, fs in os.walk(f) for n in fs)
                    if not dry:
                        shutil.rmtree(f)
                else:
                    freed += os.path.getsize(f)
                    if not dry:
                        os.remove(f)
            except OSError:
                pass
    if freed:
        verb = "치울 것" if dry else "치움"
        print(f"    🧹 중간산물 {freed / 1e9:.1f}GB {verb} · 여유 {shutil.disk_usage(ROOT).free / 1e9:.0f}GB")


def verify_files(rules: list | None, who: str, dry: bool) -> bool:
    """받은 파일이 **진짜인지** 그 자리에서 잰다.

    2026-09-02 에 실거래 2016년이 1,006바이트짜리 HTML 오류 페이지로 받아졌다. 아무도 안 재서
    나흘 뒤 적재 문턱에서야 걸렸고, 그동안 그 원본으로 빌드를 돌렸다. 받은 날 잡아야 한다.

    규칙 하나 = (이름, glob, 최소바이트, 첫줄에 있어야 할 것|None, 최소 파일 수)
    """
    if not rules or dry:
        return True
    print(f"  ── 받은 것 확인 {who}")
    ok_all = True
    for name, pat, min_bytes, head_has, min_files in rules:
        files = sorted(glob.glob(os.path.join(ROOT, pat)))
        small = [f for f in files if os.path.getsize(f) < min_bytes]
        bad_head = []
        if head_has:
            for f in files:
                try:
                    with open(f, "rb") as fh:
                        first = fh.read(4096)
                    if head_has.encode() not in first and \
                       head_has.encode("cp949", "ignore") not in first:
                        bad_head.append(f)
                except OSError:
                    bad_head.append(f)
        ok = len(files) >= min_files and not small and not bad_head
        detail = f"{len(files)}개"
        if small:
            detail += f" · 너무 작다 {len(small)}개: {os.path.basename(small[0])}"
        if bad_head:
            detail += f" · 머리글이 다르다 {len(bad_head)}개: {os.path.basename(bad_head[0])}"
        if len(files) < min_files:
            detail += f" · {min_files}개 이상이어야 한다"
        print(f"    {'✓' if ok else '✖'} {name}  {detail}")
        ok_all = ok_all and ok
    return ok_all


def verify(checks: list | None, dsn: str, who: str, dry: bool) -> bool:
    """단위·파생이 스스로 낸 결과를 잰다. **적재가 끝났다고 맞게 들어간 것은 아니다.**

    2026-09-06 에 building_legal 이 0줄로 만들어졌는데 파생은 「성공」으로 끝났다.
    자기 결과를 안 재기 때문이다. 여기서 깨지면 판을 안 올리고 뒤따르는 파생도 안 돈다.

    검사 하나 = (이름, SQL). SQL 은 **두 칸**을 낸다 — 참/거짓, 그리고 사람이 읽을 값.
        ("연도 구간 1990~2026",
         "select min(year)='1990' and max(year)='2026', min(year)||'~'||max(year) from ...")
    """
    if not checks or dry:
        return True
    print(f"  ── 검증 {who}")
    ok_all = True
    for name, sql in checks:
        r = q(dsn, sql)
        if r is None:
            print(f"    ✖ {name} — 질의가 실패했다")
            ok_all = False
            continue
        parts = r.split("|")
        ok = parts[0].strip() == "t"
        detail = parts[1].strip() if len(parts) > 1 else ""
        print(f"    {'✓' if ok else '✖'} {name}" + (f"  {detail}" if detail else ""))
        ok_all = ok_all and ok
    return ok_all


def count_rows(dsn: str, table: str | None) -> str | None:
    return q(dsn, f"select count(*) from {table}") if table else None


def run_unit(name: str, dsn: str, a) -> bool:
    u = UNITS[name]
    print(f"\n▶ {name} — {u['label']} ({u['cadence']})")
    # 디스크 문지기는 **빌드가 실제로 돌 때만** 잰다. 적재만 다시 하는 실행(--phase load)은
    # 압축본을 펴지도, 중간산물을 쓰지도 않는다 — 거기서 막으면 복구를 못 한다.
    if u.get("full_build") and (not a.phase or "build" in a.phase):
        free = shutil.disk_usage(ROOT).free / 1e9
        need = u.get("min_free_gb", 40)
        # 문지기 값은 **압축본을 펴는 것까지** 셈한 값이다(637MB → 22GB). 이미 펴져 있으면
        # 그만큼은 다시 안 든다 — 안 빼면 복구 실행이 영영 막힌다.
        unfolded = os.path.join(ROOT, "data", "raw", "hub_seoul")
        if os.path.isdir(unfolded) and len(os.listdir(unfolded)) >= 20:
            need -= 22
            print(f"  압축본이 이미 펴져 있다 — 문지기 {need:.0f}GB")
        if free < need and not a.force:
            print(f"  ✖ 디스크 여유 {free:.0f}GB < {need}GB — 시작하지 않는다"
                  f"(2026-09-06 여기서 디스크가 0이 됐다). 비우고 다시 부르거나 --force")
            return False
        print(f"  디스크 여유 {free:.0f}GB")

    lg = ledger(dsn).get(name, {})
    for phase in ("crawl", "build", "load"):
        if phase == "crawl" and a.no_crawl:
            continue
        if a.phase and phase not in a.phase:
            continue
        for st in u.get(phase) or []:
            if not run_step(st, a.dry_run, a.from_step):
                # **실패는 판을 올리지 않는다.** 올리면 이 단위를 읽는 파생이 전부 「낡음」이 되어
                # 반쯤 적재된 표 위에서 계산한다 — 2026-09-06 대장 적재가 그렇게 파생 여덟을 끌고 돌았다.
                x(dsn, """INSERT INTO master.source_version(unit,cadence,status,loaded_at)
                          VALUES(:'a1',:'a2','failed',now())
                          ON CONFLICT (unit) DO UPDATE SET status='failed'""", name, u["cadence"])
                print(f"  ✖ {name} {phase} 실패 — 판을 올리지 않는다(뒤따르는 파생도 안 돈다)")
                return False
        if phase in ("build", "load"):
            sweep(u.get(f"clean_after_{phase}"), a.dry_run)
        if phase == "crawl" and not verify_files(u.get("verify_files"), name, a.dry_run):
            x(dsn, """INSERT INTO master.source_version(unit,cadence,status,loaded_at)
                      VALUES(:'a1',:'a2','failed',now())
                      ON CONFLICT (unit) DO UPDATE SET status='failed'""", name, u["cadence"])
            print(f"  ✖ {name} 받은 것이 온전하지 않다 — 적재로 넘어가지 않는다")
            return False
        # 크롤이 끝난 뒤 지문을 다시 재야 「새로 받은 게 있나」를 안다
        if phase == "crawl":
            sig = fingerprint(u, dsn)
            if sig and sig == lg.get("sig") and not a.force and not a.dry_run:
                print(f"  ⏭  입력이 지난 판과 같다(판 {lg.get('version')}) — 적재·파생 건너뜀")
                return False

    if a.dry_run:
        return True
    if not verify(u.get("verify"), dsn, name, a.dry_run):
        x(dsn, """INSERT INTO master.source_version(unit,cadence,status,loaded_at)
                  VALUES(:'a1',:'a2','failed',now())
                  ON CONFLICT (unit) DO UPDATE SET status='failed'""", name, u["cadence"])
        print(f"  ✖ {name} 검증 실패 — 판을 올리지 않는다(뒤따르는 파생도 안 돈다)")
        return False
    rows = count_rows(dsn, u.get("table"))
    bump(dsn, name, u["cadence"], fingerprint(u, dsn), rows, "success")
    print(f"  ✔ {name} 판 올림" + (f" · {u['table']} {int(rows):,}줄" if rows else ""))
    return True


def run_derive(d: dict, dsn: str, a) -> bool:
    print(f"\n▷ 파생 {d['step']} — {d['label']}")
    for st in d["run"]:
        if not run_step(st, a.dry_run, a.from_step):
            print(f"  ✖ {d['step']} 실패 — 옛 값이 남는다")
            if not a.dry_run:
                x(dsn, "INSERT INTO master.derive_run(step,status) VALUES(:'a1','failed')", d["step"])
            return False
    if a.dry_run:
        return True
    if not verify(d.get("verify"), dsn, d["step"], a.dry_run):
        print(f"  ✖ {d['step']} 검증 실패 — 판을 올리지 않는다")
        x(dsn, "INSERT INTO master.derive_run(step,status) VALUES(:'a1','failed')", d["step"])
        return False
    lg = ledger(dsn)
    snap = {r: lg.get(r, {}).get("version", 0) for r in d["reads"]}
    x(dsn, "INSERT INTO master.derive_run(step,input_versions,status) VALUES(:'a1',:'a2'::jsonb,'success')",
      d["step"], json.dumps(snap))
    bump(dsn, d["step"], "derive", None, None, "success")
    print(f"  ✔ {d['step']}")
    return True


def stale(d: dict, dsn: str) -> bool:
    """읽는 것 중 하나라도 마지막 실행 때보다 판이 올랐으면 돌아야 한다."""
    lg = ledger(dsn)
    last = q(dsn, f"select input_versions::text from master.derive_run "
                  f"where step='{d['step']}' and status='success' order by ran_at desc limit 1")
    snap = json.loads(last) if last else {}
    return any(lg.get(r, {}).get("version", 0) > snap.get(r, -1) for r in d["reads"])


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--list", action="store_true")
    p.add_argument("--seed", action="store_true",
                   help="이미 적재된 지금 상태를 판 1 로 찍는다(장부 도입 1회). 아무것도 실행하지 않는다")
    p.add_argument("--unit", action="append", default=[])
    p.add_argument("--cadence", choices=CADENCES)
    p.add_argument("--derive", action="append", default=[])
    p.add_argument("--no-crawl", action="store_true")
    p.add_argument("--phase", action="append", default=[], choices=["crawl", "build", "load"],
                   help="이 마디만 돈다. 적재만 다시 할 때 --phase load")
    p.add_argument("--from-step", metavar="라벨", default=None,
                   help="빌드를 이 단계부터 재개한다(예: --from-step integrated)")
    p.add_argument("--force", action="store_true", help="지문이 같아도 돈다")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    dsn = load_env()
    if not dsn:
        print("✖ BT_DATABASE_URL 이 없다 — backend/.env 를 본다")
        return 2

    if a.seed:
        # 장부는 2026-09-06 에 생겼고 표는 그전에 이미 차 있다. 지금 상태를 출발점으로 찍어 두지 않으면
        # 첫 실행이 「전부 갱신 필요」라고 말한다 — 사실이 아니고, 그러면 임대추정 33분이 헛돈다.
        for k, u in UNITS.items():
            rows = count_rows(dsn, u.get("table"))
            bump(dsn, k, u["cadence"], fingerprint(u, dsn), rows, "seeded")
            print(f"  {k:<18} {u.get('table') or '-':<28} {rows or '-'}")
        # **판을 먼저 다 찍고 그 다음에 스냅샷을 뜬다.** 거꾸로 하면 파생끼리 읽는 사슬
        # (building_rent_est ← floor_rent_est)이 아직 판 0 으로 찍혀 곧바로 「낡음」이 된다.
        for d in DERIVES:
            bump(dsn, d["step"], "derive", None, None, "seeded")
        lg = ledger(dsn)
        for d in DERIVES:
            snap = {r: lg.get(r, {}).get("version", 0) for r in d["reads"]}
            x(dsn, "INSERT INTO master.derive_run(step,input_versions,status,note) "
                   "VALUES(:'a1',:'a2'::jsonb,'success','seed')", d["step"], json.dumps(snap))
        print(f"\n  ✔ 단위 {len(UNITS)} · 파생 {len(DERIVES)} 을 판 1 로 찍었다")
        return 0

    if a.list:
        lg = ledger(dsn)
        CAD = {"weekly": "주", "monthly": "월", "quarterly": "분기",
               "semiannual": "반기", "yearly": "연"}
        print(f"{'단위':<18}{'주기':<6}{'판':>4}  {'마지막':<11}{'줄수':>13}  마디")
        for c in CADENCES:
            for k in units_of(c):
                u, v = UNITS[k], lg.get(k, {})
                # 어느 마디가 있는지 한눈에. 검증이 없는 단위는 눈에 띄어야 한다
                marks = "".join(m if u.get(f) else "·" for m, f in
                                (("크", "crawl"), ("빌", "build"), ("적", "load")))
                nv = len(u.get("verify") or []) + len(u.get("verify_files") or [])
                rows = v.get("rows", "-")
                rows = f"{int(rows):,}" if str(rows).isdigit() else rows
                flag = " ⚠실패" if v.get("status") == "failed" else ""
                print(f"{k:<18}{CAD[c]:<6}{v.get('version', 0):>4}  {v.get('at', '-'):<11}"
                      f"{rows:>13}  {marks} 검{nv or '없음'}{flag}")
        print("\n파생:")
        for d in DERIVES:
            nv = len(d.get("verify") or [])
            print(f"  {d['step']:<18} 검{nv or '없음':<4} ← {' · '.join(d['reads'])}"
                  + ("   [갱신 필요]" if stale(d, dsn) else ""))
        print("\n  마디: 크=크롤 빌=빌드 적=적재 · 검=검증 개수 · 전부 훑기는 qa/run.sh units")
        return 0

    names = list(a.unit) + (units_of(a.cadence) if a.cadence else [])
    bad = [n for n in names if n not in UNITS]
    if bad:
        print(f"✖ 모르는 단위: {', '.join(bad)}")
        return 2
    if not names and not a.derive:
        p.print_help()
        return 2

    t0 = dt.datetime.now()
    changed = {n for n in names if run_unit(n, dsn, a)}
    # **선언 순서가 의존 순서다.** 앞엣것이 판을 올리면 그것을 읽는 뒤엣것이 그때 「낡음」이 된다 —
    # 목록을 미리 굳히지 않고 차례마다 다시 잰다.
    ok, steps = True, []
    for d in DERIVES:
        if a.derive:
            if d["step"] not in a.derive:
                continue
        elif not stale(d, dsn):
            continue
        steps.append(d)
        ok = run_derive(d, dsn, a) and ok
    mins = (dt.datetime.now() - t0).total_seconds() / 60
    print(f"\n== 끝 · {len(changed)}단위 · 파생 {len(steps)} · {mins:.1f}분 ==")
    if changed:
        print("   판 오른 것: " + ", ".join(sorted(changed)))
    return 0 if ok else 1


sys.exit(main())
