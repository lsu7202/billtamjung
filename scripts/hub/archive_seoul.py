#!/usr/bin/env python3
"""건축HUB 서울본 원본 CSV 압축 보관 — 다 쓰고 나서(2026-09-01).

## 왜

원본 CSV 가 22GB 다. 다 쓰고 나면(빌드→적재까지 끝나면) 디스크에 그대로 둘 이유가 없다.
그렇다고 지우면 안 된다 — **다시 받으려면 한 시간 반이 걸리고**, 그 사이 HUB 가 다음 달
판으로 넘어가면 같은 스냅샷을 못 만든다.

압축해 두면 둘 다 된다. 실측(대장/표제부 종로구 11.2MB):

    zstd -3    13.7%   빠름
    zstd -10   10.7%   ← 이걸 쓴다. 22GB → 약 2.4GB
    zstd -19    9.1%   느리다(같은 파일에 4초). 1.6%p 더 줄자고 몇 시간을 쓸 이유가 없다

## 어떻게 되돌리나

    python scripts/hub/archive_seoul.py --restore [--only 대장_표제부]

압축본은 마트별 한 덩어리(.tar.zst)다. 구 단위로 25개씩 두면 파일이 1,375개가 되고,
그건 관리가 안 된다.

## 안전장치

**적재를 마치기 전에는 압축하지 않는다.** --check-loaded 를 기본으로 켜서
master.master_loads 에 성공 기록이 있는 마트만 압축한다. 기록을 못 읽으면 멈춘다 —
「아마 됐겠지」로 원본을 치우면 안 된다.

기록이 **있는지**가 아니라 **원본보다 나중인지**를 본다. 실제로 걸린 일:
표제부의 buildings 적재 기록이 2026-07-21(전국본 시절)로 남아 있었다. 있는지만 봤으면
아직 안 실은 서울본 원본을 지웠을 것이다.

    python scripts/hub/archive_seoul.py                # 적재 끝난 것만 압축
    python scripts/hub/archive_seoul.py --only 대장_전유공용
    python scripts/hub/archive_seoul.py --restore --only 대장_전유공용
    python scripts/hub/archive_seoul.py --list
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HUB = os.path.join(ROOT, "data", "raw", "hub_seoul")
ARC = os.path.join(ROOT, "data", "raw", "_archive", "hub_seoul")
LEVEL = 10

# 마트 → 그 마트가 들어가는 loader 소스.
#
# 여기 **없는** 마트는 아직 빌더가 없다는 뜻이다 — 쓰는 곳이 없으니 압축해도 잃을 게 없다.
# 여기 **있는** 마트는 그 소스의 적재 성공 기록이 있어야 압축한다.
#
# 주의: 한 마트가 여러 소스로 갈리기도 하고(전유부·전유공용 → unit),
# 한 소스가 여러 마트를 읽기도 한다(buildings 는 표제부·총괄표제부·층별개요·부속지번을 본다).
# 그래서 **제일 늦게 적재되는 소스**를 적는다 — 그게 끝났으면 앞의 것도 끝났다.
LOADED_BY = {
    "대장_표제부": "buildings", "대장_총괄표제부": "complex",
    "대장_전유부": "unit", "대장_전유공용": "unit",
    "대장_기본개요": "basic", "대장_오수정화": "septic",
    "대장_공동주택가격": "aptprice", "대장_지역지구구역": "zone",
    "폐쇄말소_표제부": "closed",
    "에너지_전기": "energy", "에너지_가스": "energy",
    # 아래 둘은 buildings 가 아니라 **자기 경로**로 적재된다.
    #   층별개요 → _floor_outline.csv → scripts/load_floor_outline.py
    #   부속지번 → _annex_ALL.json  → export_parcels → building_parcels
    "대장_층별개요": "floor_outline", "대장_부속지번": "building_parcels",
}


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


def size_of(path):
    if os.path.isfile(path):
        return os.path.getsize(path)
    t = 0
    for d, _, fs in os.walk(path):
        for f in fs:
            t += os.path.getsize(os.path.join(d, f))
    return t


def marts():
    if not os.path.isdir(HUB):
        sys.exit(f"✗ {HUB} 없음")
    return sorted(d for d in os.listdir(HUB) if os.path.isdir(os.path.join(HUB, d)))


def loaded_at():
    """소스 → 마지막 성공 적재 시각(epoch). 못 읽으면 None — 그러면 멈춘다."""
    dsn = os.environ.get("DATABASE_URL") or os.environ.get("BT_DATABASE_URL")
    if not dsn:
        return None
    q = ("select source, extract(epoch from max(finished_at))::bigint "
         "from master.master_loads where status='success' group by source")
    r = sh(f'docker exec docker-db-1 psql -U postgres -d billtamjung -tAc "{q}"')
    if r.returncode != 0:
        return None
    d = {}
    for ln in r.stdout.split("\n"):
        if "|" in ln:
            k, v = ln.split("|", 1)
            if v.strip():
                d[k.strip()] = int(v.strip())
    return d


def newest_mtime(path):
    """폴더 안에서 제일 늦게 받은 파일의 시각. 이보다 적재가 빨랐으면 안 실은 것이다."""
    t = 0
    for d, _, fs in os.walk(path):
        for f in fs:
            t = max(t, os.path.getmtime(os.path.join(d, f)))
    return t


def _same_as_archive(src, tar):
    """풀어 둔 원본이 압축본과 같은가 — 파일 이름과 바이트 수로 본다.

    md5 까지 안 보는 이유: 22GB 를 두 번 읽는 값이 크고, 이 자리에서 막고 싶은 것은
    「다른 판을 받아 둔 것을 압축본이 있다는 이유로 날리는 일」이라 이름·크기면 걸린다.
    """
    r = sh(f'tar --use-compress-program="zstd -d" -tvf "{tar}"')
    if r.returncode != 0:
        return False, "압축본을 못 읽음"
    # tar -tv 의 칸 자리가 BSD 와 GNU 가 다르다(BSD 는 owner·group 이 따로, GNU 는 붙어 있다).
    # 자리 번호로 세지 말고 **날짜 바로 앞 칸**을 크기로 읽는다.
    MON = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}
    arc = {}
    for ln in r.stdout.split("\n"):
        if not ln or ln.startswith("d"):
            continue
        p = ln.split()
        i = next((k for k, t in enumerate(p)
                  if t in MON or re.fullmatch(r"\d{4}-\d{2}-\d{2}", t)), None)
        if i is None or i == 0 or not p[i - 1].isdigit():
            continue
        arc[os.path.basename(p[-1])] = int(p[i - 1])
    if not arc:
        return False, "압축본 목록을 못 읽음"
    live = {}
    for d, _, fs in os.walk(src):
        for f in fs:
            live[f] = os.path.getsize(os.path.join(d, f))
    if arc == live:
        return True, ""
    only_a = sorted(set(arc) - set(live))[:2]
    only_l = sorted(set(live) - set(arc))[:2]
    diff = [k for k in set(arc) & set(live) if arc[k] != live[k]][:2]
    return False, f"압축본만 {only_a} · 원본만 {only_l} · 크기다름 {diff}"


def archive(names, check_loaded=True):
    os.makedirs(ARC, exist_ok=True)
    ok_src = loaded_at() if check_loaded else {}
    if check_loaded and ok_src is None:
        sys.exit("✗ 적재 기록을 못 읽었습니다(DATABASE_URL·docker 확인).\n"
                 "  적재를 마쳤는지 모르는 채로 원본을 치우면 안 됩니다.\n"
                 "  확인했다면 --no-check-loaded 로 넘기세요.")
    done = skipped = 0
    freed = 0
    for m in names:
        src = os.path.join(HUB, m)
        need = LOADED_BY.get(m)
        if check_loaded and need:
            when = ok_src.get(need)
            got = newest_mtime(src)
            if when is None:
                print(f"  ⏭ {m}: '{need}' 적재 기록이 없습니다 — 압축하지 않습니다")
                skipped += 1
                continue
            # 원본을 받은 뒤에 적재했어야 그 원본이 들어간 것이다.
            if when < got:
                print(f"  ⏭ {m}: '{need}' 적재가 {time.strftime('%m-%d %H:%M', time.localtime(when))}"
                      f" 로 원본({time.strftime('%m-%d %H:%M', time.localtime(got))})보다 빠릅니다"
                      f" — 이 원본은 아직 안 실렸습니다")
                skipped += 1
                continue
        tar = os.path.join(ARC, f"{m}.tar.zst")
        if os.path.exists(tar):
            # --restore 로 풀어 둔 원본이 남아 있을 수 있다. 압축본과 **같은지 확인한 뒤**
            # 원본만 치운다. 확인 없이 지우면 다른 판을 받아 둔 것을 날린다.
            same, why = _same_as_archive(src, tar)
            if same:
                before = size_of(src)
                shutil.rmtree(src)
                freed += before
                done += 1
                print(f"  ✅ {m:22} 압축본과 같아 원본 {before/2**30:.2f}GB 치움")
            else:
                print(f"  ⏭ {m}: 압축본이 있는데 원본과 다릅니다({why}) — 손대지 않습니다")
                skipped += 1
            continue
        before = size_of(src)
        t0 = time.time()
        r = sh(f'cd "{HUB}" && tar --use-compress-program="zstd -{LEVEL} -T0" '
               f'-cf "{tar}" "{m}"')
        if r.returncode != 0:
            print(f"  ✗ {m}: 압축 실패 — {r.stderr.strip()[:120]}")
            continue
        after = os.path.getsize(tar)
        shutil.rmtree(src)
        freed += before - after
        done += 1
        print(f"  ✅ {m:22} {before/2**30:6.2f}GB → {after/2**30:5.2f}GB "
              f"({after/before*100:4.1f}%) {time.time()-t0:5.0f}초")
    print(f"\n압축 {done}개 · 건너뜀 {skipped}개 · 확보 {freed/2**30:.1f}GB")


def restore(names):
    for m in names:
        tar = os.path.join(ARC, f"{m}.tar.zst")
        if not os.path.exists(tar):
            print(f"  ✗ {m}: 압축본이 없습니다")
            continue
        if os.path.isdir(os.path.join(HUB, m)):
            print(f"  ⏭ {m}: 원본이 이미 있습니다")
            continue
        os.makedirs(HUB, exist_ok=True)
        r = sh(f'cd "{HUB}" && tar --use-compress-program="zstd -d" -xf "{tar}"')
        if r.returncode != 0:
            print(f"  ✗ {m}: 해제 실패 — {r.stderr.strip()[:120]}")
            continue
        print(f"  ✅ {m:22} 복원 {size_of(os.path.join(HUB, m))/2**30:.2f}GB")


def show():
    live = marts() if os.path.isdir(HUB) else []
    arcs = sorted(f[:-8] for f in os.listdir(ARC)) if os.path.isdir(ARC) else []
    print(f"원본 {len(live)}개 · 압축본 {len(arcs)}개\n")
    for m in sorted(set(live) | set(arcs)):
        a = "압축" if m in arcs else "  "
        b = "원본" if m in live else "  "
        sz = (size_of(os.path.join(HUB, m)) if m in live
              else os.path.getsize(os.path.join(ARC, f"{m}.tar.zst")))
        print(f"  {a} {b}  {m:24} {sz/2**30:6.2f}GB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--restore", action="store_true", help="압축본을 되돌린다")
    ap.add_argument("--list", action="store_true", help="원본·압축본 현황")
    ap.add_argument("--only", help="마트 하나만 (예: 대장_전유공용)")
    ap.add_argument("--no-check-loaded", action="store_true",
                    help="적재 확인 없이 압축(사람이 확인했을 때만)")
    a = ap.parse_args()

    if a.list:
        return show()
    if a.restore:
        arcs = sorted(f[:-8] for f in os.listdir(ARC)) if os.path.isdir(ARC) else []
        return restore([a.only] if a.only else arcs)
    names = [a.only] if a.only else marts()
    archive(names, check_loaded=not a.no_check_loaded)


if __name__ == "__main__":
    main()
