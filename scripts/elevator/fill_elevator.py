"""[이 스크립트는 안 돌린다] master.buildings.elevator 를 직접 고치던 보정.

## 승강기 데이터 자체는 그대로 쓴다 — 오해 없기를

한국승강기안전공단 설치현황은 **건축HUB 와 무관한 별도 출처**이고 계속 쓴다:

    원본   data/raw/한국승강기안전공단_승강기 설치 현황_{2015년 이전,2016년 이후}.csv
    수집   scripts/crawl_all.py — data.go.kr 15112638, 분기마다 자동
    사용   data/tools/build_building_master.py 의 load_kelisa() · _elev()

대장은 승강기 누락이 많아서 이 보정이 없으면 안 된다.
실제로 585,731동 중 119,043동(20.3%)에 값이 붙는다.

## 그럼 이 스크립트는 왜 안 돌리나 (2026-08-31)

**같은 일을 build_building_master 가 한다.** 이 스크립트는 live DB 를 직접 UPDATE 했는데,
그러면 다시 적재할 때 날아간다. 원래 주석에도 「파이프라인 편입: build_building_master 가
넣어야 재적재에도 유지됨」이라고 적혀 있었고, 그대로 옮겼다.

읽던 전국본(mart_djy_03_seoul.txt)도 서울본 CSV 로 갈아타면서 없어졌다.
고쳐 쓸 이유가 없어 그대로 두되, 「왜 live 를 직접 고치던 스크립트가 있었나」에 대한
답으로 남긴다.

── 아래는 옛 주석 원문 ──────────────────────────────────────

master.buildings.elevator 재계산 — 대장(표제부) 원본 + 한국승강기안전공단 보정(멱등).

승강기공단 설치현황이 건축물대장보다 정확(대장은 승강기 누락 다수). 대장 원본을 기준으로,
대장이 없음(NULL/0)인 건물만 승강기공단 데이터로 채운다. 대장 원본에서 재계산하므로 몇 번 돌려도 동일.

- 대장 원본: data/raw/seoul/mart_djy_03_seoul.txt (PK=p[0], 승용승강기=p[45]) ← build_building_master와 동일
- 승강기공단: 종류에서 에스컬레이터·자동차용 제외(사람 승강기), 상태 운행중/휴지, 승강기고유번호=행 단위(대수 정확)
- 매칭: 도로명주소 정규화. 단, 한 도로명에 여러 건물이면 대수를 건물별로 못 나눔 →
    · 도로명 = 단일 건물: 정확 대수
    · 도로명 = 복수 건물: 과다계상 방지 위해 '있음'(1)만
- 갱신: 대장 양수는 원본 보존, NULL/0만 승강기공단으로

    backend/.venv/bin/python scripts/elevator/fill_elevator.py

★ 파이프라인 편입: 이 보정은 build_building_master.py가 마스터 CSV를 만들 때 넣어야 재적재에도 유지됨.
  (현재는 이 스크립트가 live master를 직접 재계산 — build_building_master의 elevator 로직과 동일 규칙)
"""
import os
import re
import csv
import asyncio
import collections

import asyncpg

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
DAEJANG = os.path.join(ROOT, "data", "raw", "seoul", "mart_djy_03_seoul.txt")
ELEV_FILES = [os.path.join(ROOT, "data", "raw", "한국승강기안전공단_승강기 설치 현황_2016년 이후.csv"),
              os.path.join(ROOT, "data", "raw", "한국승강기안전공단_승강기 설치 현황_2015년 이전.csv")]
EXCLUDE_TYPE = ("에스컬레이터", "자동차용")   # 사람 승강기 아님
KEEP_STATUS = ("운행중", "휴지")              # 폐지 제외(물리적 존재)

_paren = re.compile(r"\(.*?\)")
_ws = re.compile(r"\s+")


def norm(addr):
    if not addr:
        return None
    a = _ws.sub("", _paren.sub("", addr))
    return a or None


def _fnum(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return 0.0


def load_daejang_elevator():
    """대장 원본 elevator: building_pk → 승용승강기(대). build_building_master.py와 동일(p[45])."""
    out = {}
    with open(DAEJANG, "rb") as f:
        for line in f:
            p = [x.decode("utf-8", errors="replace") for x in line.rstrip(b"\r\n").split(b"|")]
            if len(p) < 46:
                continue
            out[p[0]] = int(_fnum(p[45])) or 0
    return out


def load_kelisa_counts():
    """승강기공단: 정규화 도로명 → 엘리베이터 대수(서울)."""
    cnt = collections.Counter()
    for path in ELEV_FILES:
        with open(path, encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                if row.get("시도") != "서울":
                    continue
                if any(t in (row.get("승강기종류") or "") for t in EXCLUDE_TYPE):
                    continue
                if (row.get("승강기상태") or "") not in KEEP_STATUS:
                    continue
                k = norm(row.get("건물주소"))
                if k:
                    cnt[k] += 1
    return cnt


async def main():
    print("대장 원본 로드…")
    dj = load_daejang_elevator()
    print(f"  표제부 {len(dj):,}동 · 대장 elevator>0 {sum(1 for v in dj.values() if v):,}")
    print("승강기공단 로드…")
    kel = load_kelisa_counts()
    print(f"  정규화 주소 {len(kel):,}건 · 총 {sum(kel.values()):,}대")

    c = await asyncpg.connect(DSN)
    rows = await c.fetch(
        "SELECT building_pk, road_addr FROM master.buildings WHERE bjd_code LIKE '11%'")
    # 도로명 다중도(같은 도로명에 몇 개 건물) — 복수면 대수 배분 불가 → 있음(1)만
    multi = collections.Counter(norm(r["road_addr"]) for r in rows if r["road_addr"])

    updates, filled, from_dj = [], 0, 0
    for r in rows:
        pk = r["building_pk"]
        orig = dj.get(pk, 0)
        if orig and orig > 0:
            final = orig
            from_dj += 1
        else:
            k = norm(r["road_addr"])
            cnt = kel.get(k) if k else None
            if cnt:
                final = cnt if multi.get(k, 0) <= 1 else 1   # 단일 도로명=대수 / 복수=있음
                filled += 1
            else:
                final = None
        updates.append((pk, final))

    await c.executemany(
        # **뷰에 쓴다.** 0137 때는 master.buildings 가 pnu_bldg_cnt 를 조인해 자동 갱신이
        # 안 됐는데, 0144 가 그 조인을 걷어내 지금은 한 표를 그대로 내보내는 단순 뷰다
        # (is_updatable=YES). 세대 이름(_vN)을 박으면 적재 한 번에 깨진다 — 2026-09-01 에
        # buildings 가 v4 로 가면서 실제로 여러 곳이 깨졌다.
        "UPDATE master.buildings SET elevator=$2 WHERE building_pk=$1", updates)
    has = await c.fetchval("SELECT count(*) FROM master.buildings WHERE bjd_code LIKE '11%' AND elevator>0")
    print(f"재계산 완료 — 대장 원본 {from_dj:,}동 + 승강기공단 보정 {filled:,}동 = 엘리베이터 있음 {has:,}동")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main())
