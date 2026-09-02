#!/usr/bin/env python3
"""빌드 산출물 검사 — 적재 전에 export CSV 가 성한지 본다(2026-08-31).

## 왜 필요한가
3단계 빌드는 **종료코드만** 봤다. 16단계 중 스스로 멈추는 조건을 가진 것이 하나도 없어서,
행이 절반으로 줄어도·칸이 통째로 비어도·파일이 0바이트로 나와도 「성공」이었다.
실제로 두 가지가 3주 넘게 묻혀 있었다:
  · 8/8 높이 컬럼을 더하면서 sqlite INSERT 자리표시자를 안 고침 → 3단계가 죽어 있었다
  · 8/10 건폐율·용적률 출처를 도입하면서 build_sqlite 에 칸을 안 더함 → export 가 죽어 있었다
둘 다 「돌려 봤으면 첫 줄에서 터질」 것이었다. 아무도 안 돌렸을 뿐이다.

## 무엇을 보나
적재(4단계)의 검증은 **DB 에 넣어 본 뒤에** 판정한다. 여기서는 그 앞, 파일 상태에서 본다.
  ① 존재·크기      다섯 파일이 다 있고 0바이트가 아닌가
  ② 헤더           schema_buildings.COLUMNS 정본과 일치하는가
  ③ 행수           지금 DB 대비 급감하지 않았는가(세대 스왑 row_floor 와 같은 선)
  ④ 키             PK 중복 · 참조 무결성(건물↔필지↔공시↔실거래)
  ⑤ 채움률         칸이 조용히 비지 않았는가 — DB 대비 5%p 넘게 떨어지면 잡는다
  ⑥ 형식           숫자·날짜·좌표·JSON·WKT 가 그 형식인가
  ⑦ 값 범위        건폐율 0~100 · 용적률 0~2000 · 면적>0 · 층수 등
  ⑧ 규칙           건폐율·용적률 출처가 '대장' 또는 빈값만인가(0144)

    BT_DATABASE_URL=... backend/.venv/bin/python backend/tests/qa_build.py [--dir DIR]
DB 가 없으면 ③·⑤ 는 건너뛰고 나머지만 본다.
"""
import argparse
import asyncio
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pipeline"))
from schema_buildings import COLUMNS, EXPECT_DATA  # noqa: E402

# 필지 폴리곤 WKT 한 칸이 128KB 기본 한도를 넘는다(강남 대형 필지). 한도를 올린다.
csv.field_size_limit(1 << 27)

DSN = os.environ.get("BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
ROW_FLOOR = 0.95          # 지금 DB 대비 하한 — 적재 검증(row_floor)과 같은 선
COV_DROP = 5.0            # 채움률이 이만큼(%p) 떨어지면 조용한 누락으로 본다
SEOUL = (126.7, 37.4, 127.2, 37.7)

FILES = {                 # 파일 → (DB 표, 키 컬럼)
    "buildings.csv": ("master.buildings", "building_pk"),
    "parcels.csv": ("master.parcels", "pnu"),
    "building_parcels.csv": ("master.building_parcels", None),
    "gongsi_series.csv": ("master.gongsi_series", None),
    "sales_history.csv": ("master.sales_history", None),
    "complex.csv": ("master.building_complex", "complex_pk"),
}

ok = bad = 0


def chk(cond, name, detail=""):
    global ok, bad
    if cond:
        ok += 1
        print(f"  ✓ {name}")
    else:
        bad += 1
        print(f"  ✗ {name}   {detail}")


def _num(v):
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def _ymd(v):
    """적재는 YYYY-MM-DD 를 기대한다(norm_ymd 가 만든다). 빈값은 통과."""
    return not v or bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", v))


def _read(path, limit=None):
    with open(path, encoding="utf-8") as f:
        for i, row in enumerate(csv.DictReader(f)):
            if limit and i >= limit:
                break
            yield row


async def db_stats(c):
    """지금 DB 의 행수·컬럼 채움률 — 비교 기준선."""
    out = {}
    for f, (tbl, _) in FILES.items():
        try:
            out[f] = {"n": await c.fetchval(f"SELECT count(*) FROM {tbl}")}
        except Exception:                                        # noqa: BLE001
            out[f] = {"n": None}
    cov = {}
    for col in COLUMNS:
        dbcol = {"lng": None, "lat": None}.get(col, col)          # 좌표는 geom 으로 들어간다
        if dbcol is None:
            continue
        try:
            cov[col] = await c.fetchval(
                f"SELECT count({dbcol})::float / NULLIF(count(*),0) * 100 FROM master.buildings")
        except Exception:                                        # noqa: BLE001
            pass
    out["buildings.csv"]["cov"] = cov
    return out


def check_files(d):
    print("\n[① 존재·크기] 다섯 파일이 다 있고 비어 있지 않은가")
    for f in FILES:
        p = os.path.join(d, f)
        sz = os.path.getsize(p) if os.path.exists(p) else -1
        chk(sz > 1000, f"{f} {sz/1048576:.1f}MB" if sz >= 0 else f"{f} 없음",
            "파일이 없거나 사실상 비었다 — 빌드가 중간에 죽었다")


def check_header(d):
    print("\n[② 헤더] 정본(schema_buildings.COLUMNS)과 같은가")
    with open(os.path.join(d, "buildings.csv"), encoding="utf-8") as f:
        h = next(csv.reader(f))
    chk(h == list(COLUMNS), f"buildings.csv 헤더 {len(h)}개",
        f"CSV에만 {set(h)-set(COLUMNS)} · 정본에만 {set(COLUMNS)-set(h)}")


def scan_buildings(d):
    """buildings.csv 를 한 번만 훑어 필요한 통계를 전부 모은다(1.4GB라 두 번 읽지 않는다)."""
    n = 0
    cnt = {c: 0 for c in COLUMNS}
    pk = set()
    dup = 0
    bad_num = {c: 0 for c in ("land_area", "total_area", "build_area", "far_area",
                              "bcr", "far", "floors_above", "floors_below", "height",
                              "gongsi_latest", "station_dist")}
    bad_ymd = {c: 0 for c in ("approval_ymd", "remodel_ymd")}
    bad_json = {c: 0 for c in ("subway_json", "bus_json", "use_zone_mix")}
    out_bbox = rng_bcr = rng_far = neg_area = 0
    srcs = {}
    for row in _read(os.path.join(d, "buildings.csv")):
        n += 1
        for c in COLUMNS:
            if row[c] not in ("", None):
                cnt[c] += 1
        k = row["building_pk"]
        if k in pk:
            dup += 1
        pk.add(k)
        for c in bad_num:
            v = row[c]
            if v and not _num(v):
                bad_num[c] += 1
        for c in bad_ymd:
            if not _ymd(row[c]):
                bad_ymd[c] += 1
        for c in bad_json:
            v = row[c]
            if v:
                try:
                    json.loads(v)
                except ValueError:
                    bad_json[c] += 1
        if row["lng"] and row["lat"] and _num(row["lng"]) and _num(row["lat"]):
            x, y = float(row["lng"]), float(row["lat"])
            if not (SEOUL[0] <= x <= SEOUL[2] and SEOUL[1] <= y <= SEOUL[3]):
                out_bbox += 1
        if row["bcr"] and _num(row["bcr"]) and not (0 < float(row["bcr"]) <= 100):
            rng_bcr += 1
        if row["far"] and _num(row["far"]) and not (0 < float(row["far"]) <= 2000):
            rng_far += 1
        for c in ("land_area", "total_area"):
            if row[c] and _num(row[c]) and float(row[c]) < 0:
                neg_area += 1
        srcs[row["bcr_src"]] = srcs.get(row["bcr_src"], 0) + 1
    return {"n": n, "cnt": cnt, "dup": dup, "bad_num": bad_num, "bad_ymd": bad_ymd,
            "bad_json": bad_json, "out_bbox": out_bbox, "rng_bcr": rng_bcr,
            "rng_far": rng_far, "neg_area": neg_area, "srcs": srcs, "pk": pk}


def check_keys(d, st):
    print("\n[④ 키] 중복·참조 무결성")
    chk(st["dup"] == 0, f"buildings PK 중복 {st['dup']}건", "같은 건물이 두 줄")

    pnus = {r["pnu"] for r in _read(os.path.join(d, "parcels.csv"))}
    chk(len(pnus) > 800_000, f"parcels 고유 PNU {len(pnus):,}", "필지가 너무 적다")

    miss_pk = miss_pnu = tot = 0
    for r in _read(os.path.join(d, "building_parcels.csv")):
        tot += 1
        if r["building_pk"] not in st["pk"]:
            miss_pk += 1
        if r["pnu"] not in pnus:
            miss_pnu += 1
    chk(miss_pk == 0, f"building_parcels → buildings 미아 {miss_pk}/{tot:,}",
        "연결표가 없는 건물을 가리킨다")
    chk(miss_pnu / max(tot, 1) < 0.05,
        f"building_parcels → parcels 미아 {miss_pnu:,}/{tot:,} ({miss_pnu/max(tot,1)*100:.1f}%)",
        "부속필지가 parcels 에 없다 — F-04 롤업이 과소집계된다(기준 5%)")

    miss = tot = 0
    for r in _read(os.path.join(d, "sales_history.csv")):
        tot += 1
        if r["building_pk"] not in st["pk"]:
            miss += 1
    chk(miss == 0, f"sales_history → buildings 미아 {miss}/{tot:,}", "comp 가 없는 건물을 가리킨다")

    miss = tot = 0
    for r in _read(os.path.join(d, "gongsi_series.csv")):
        tot += 1
        if r["pnu"] not in pnus:
            miss += 1
    chk(miss / max(tot, 1) < 0.02,
        f"gongsi_series → parcels 미아 {miss:,}/{tot:,} ({miss/max(tot,1)*100:.2f}%)",
        "공시지가가 없는 필지를 가리킨다(기준 2%)")


def check_parcels(d):
    """필지 파일 자체 — 폴리곤이 성한가, 규제 값이 형식에 맞는가."""
    print("\n[④-b 필지] 폴리곤·규제·PNU 형식")
    n = bad_wkt = bad_pnu = neg_area = rng_lbcr = rng_lfar = 0
    rep = 0
    cov = {c: 0 for c in ("use_zone", "legal_bcr", "legal_far", "gongsi_latest", "wkt")}
    for r in _read(os.path.join(d, "parcels.csv")):
        n += 1
        w = r["wkt"]
        if not w or not w.startswith(("POLYGON", "MULTIPOLYGON")):
            bad_wkt += 1
        if not re.fullmatch(r"\d{19}", r["pnu"] or ""):
            bad_pnu += 1
        if r["area"] and _num(r["area"]) and float(r["area"]) < 0:
            neg_area += 1
        for c, lo, hi, tgt in (("legal_bcr", 0, 100, "rng_lbcr"), ("legal_far", 0, 2000, "rng_lfar")):
            v = r[c]
            if v and _num(v) and not (lo < float(v) <= hi):
                if tgt == "rng_lbcr":
                    rng_lbcr += 1
                else:
                    rng_lfar += 1
        if r["is_rep"] in ("1", "true", "True", "t"):
            rep += 1
        for c in cov:
            if r[c] not in ("", None):
                cov[c] += 1
    chk(bad_wkt == 0, f"폴리곤 아닌 wkt {bad_wkt}/{n:,}", "지도가 이 필지를 못 그린다")
    chk(bad_pnu == 0, f"PNU 19자리 아님 {bad_pnu}", "PNU 형식이 깨졌다 — 조인이 통째로 어긋난다")
    chk(neg_area == 0, f"음수 면적 {neg_area}", "")
    chk(rng_lbcr == 0, f"법정건폐율 0~100 벗어남 {rng_lbcr}", "")
    chk(rng_lfar == 0, f"법정용적률 0~2000 벗어남 {rng_lfar}", "")
    for c, v in cov.items():
        pct = v / max(n, 1) * 100
        floor = {"use_zone": 99.0, "legal_bcr": 95.0, "legal_far": 95.0,
                 "gongsi_latest": 50.0, "wkt": 99.0}[c]
        chk(pct >= floor, f"{c} 채움 {pct:.1f}% ({v:,}/{n:,})", f"기준 {floor}%")


def check_series(d):
    """공시지가·실거래 — 연도·금액·형식."""
    print("\n[④-c 시계열] 공시지가·실거래")
    n = bad_year = bad_price = 0
    years = set()
    for r in _read(os.path.join(d, "gongsi_series.csv")):
        n += 1
        y = r["year"]
        if not (y.isdigit() and 1985 <= int(y) <= 2030):
            bad_year += 1
        else:
            years.add(int(y))
        if not (r["price"] or "").isdigit() or int(r["price"]) <= 0:
            bad_price += 1
    chk(bad_year == 0, f"공시 연도 범위 밖 {bad_year}/{n:,}", "1985~2030")
    chk(bad_price == 0, f"공시지가 0 이하·숫자 아님 {bad_price}", "")
    chk(len(years) >= 30, f"공시 연도 구간 {min(years)}~{max(years)} ({len(years)}개)",
        "1990~2026 전 구간이 있어야 시점보정이 산다")

    n = bad_ym = bad_price = bad_area = 0
    for r in _read(os.path.join(d, "sales_history.csv")):
        n += 1
        if not re.fullmatch(r"\d{6}", r["contract_ym"] or ""):
            bad_ym += 1
        if not _num(r["price"]) or float(r["price"]) <= 0:
            bad_price += 1
        if not _num(r["total_area"]) or float(r["total_area"]) <= 0:
            bad_area += 1
    chk(bad_ym == 0, f"실거래 계약년월 YYYYMM 아님 {bad_ym}/{n:,}", "")
    chk(bad_price == 0, f"실거래 금액 0 이하 {bad_price}", "comp 로 쓸 수 없다")
    chk(bad_area == 0, f"실거래 연면적 0 이하 {bad_area}", "단가를 못 낸다")


def check_complex(d, st):
    """총괄표제부(단지) — 대장 세 층 중 맨 위. 동(buildings)과 단위가 다르다."""
    print("\n[④-d 총괄표제부] 단지")
    path = os.path.join(d, "complex.csv")
    if not os.path.exists(path):
        chk(False, "complex.csv 없음", "build_complex.py · export_complex.py 를 돌리세요")
        return
    n = dup = bad_pnu = bad_ymd = rng_bcr = rng_far = 0
    seen = set()
    cov = {c: 0 for c in ("pnu", "name", "land_area", "far", "households", "parking", "approval_ymd")}
    orphan = 0
    for r in _read(path):
        n += 1
        if r["complex_pk"] in seen:
            dup += 1
        seen.add(r["complex_pk"])
        if r["pnu"] and not re.fullmatch(r"\d{19}", r["pnu"]):
            bad_pnu += 1
        for c in ("permit_ymd", "start_ymd", "approval_ymd"):
            if not _ymd(r[c]):
                bad_ymd += 1
        if r["bcr"] and _num(r["bcr"]) and not (0 < float(r["bcr"]) <= 100):
            rng_bcr += 1
        if r["far"] and _num(r["far"]) and not (0 < float(r["far"]) <= 3000):
            rng_far += 1
        for c in cov:
            if r[c] not in ("", None):
                cov[c] += 1
    chk(n > 15_000, f"단지 {n:,}개", "서울 총괄표제부는 1.9만 개다")
    chk(dup == 0, f"단지 PK 중복 {dup}", "")
    chk(bad_pnu == 0, f"PNU 19자리 아님 {bad_pnu}", "")
    chk(bad_ymd == 0, f"날짜 형식 아님 {bad_ymd}", "YYYY-MM-DD")
    chk(rng_bcr == 0, f"건폐율 0~100 벗어남 {rng_bcr}", "")
    chk(rng_far == 0, f"용적률 0~3000 벗어남 {rng_far}", "")
    chk(cov["pnu"] / n > 0.99, f"PNU 채움 {cov['pnu']/n*100:.1f}%", "기준 99%")
    # 단지명·면적은 대장이 안 적은 것이 많다 — 채움률이 낮은 게 정상이라 하한만 본다
    for c, floor in (("name", 30.0), ("land_area", 40.0), ("far", 40.0),
                     ("households", 30.0), ("parking", 35.0), ("approval_ymd", 25.0)):
        pct = cov[c] / n * 100
        chk(pct >= floor, f"{c} 채움 {pct:.1f}%", f"기준 {floor}% — 대장이 안 적은 게 많아 낮은 게 정상")

    # 단지 PK 가 buildings 와 섞이면 안 된다 — 단위가 다르다
    mixed = len(seen & st["pk"])
    chk(mixed == 0, f"동(buildings) PK 와 겹침 {mixed}", "총괄과 표제부는 PK 계열이 다르다")

    # building_parcels 미아가 이제 갈 곳이 있는가
    miss = 0
    for r in _read(os.path.join(d, "building_parcels.csv")):
        if r["building_pk"] not in st["pk"] and r["building_pk"] not in seen:
            miss += 1
    chk(miss == 0, f"building_parcels 가 동·단지 어디에도 없는 행 {miss}",
        "연결표가 가리킬 표가 없다")


def check_format(d, st):
    print("\n[⑥ 형식] 숫자·날짜·좌표·JSON")
    b = [f"{c}={v}" for c, v in st["bad_num"].items() if v]
    chk(not b, f"숫자 칸이 숫자가 아닌 행 {sum(st['bad_num'].values())}", " ".join(b))
    b = [f"{c}={v}" for c, v in st["bad_ymd"].items() if v]
    chk(not b, f"날짜 형식(YYYY-MM-DD) 아닌 행 {sum(st['bad_ymd'].values())}", " ".join(b))
    b = [f"{c}={v}" for c, v in st["bad_json"].items() if v]
    chk(not b, f"JSON 파싱 실패 {sum(st['bad_json'].values())}", " ".join(b))
    chk(st["out_bbox"] == 0, f"서울 밖 좌표 {st['out_bbox']}", "좌표계가 어긋났다")

    print("\n[⑦ 값 범위]")
    chk(st["rng_bcr"] == 0, f"건폐율 0~100 벗어남 {st['rng_bcr']}", "원본 오류가 안 걸러졌다")
    chk(st["rng_far"] == 0, f"용적률 0~2000 벗어남 {st['rng_far']}", "〃")
    chk(st["neg_area"] == 0, f"음수 면적 {st['neg_area']}", "")

    print("\n[⑧ 규칙] 화면 값은 대장만(0144)")
    extra = {k: v for k, v in st["srcs"].items() if k not in ("대장", "")}
    chk(not extra, f"건폐율 출처 {dict(sorted(st['srcs'].items(), key=lambda x: -x[1]))}",
        f"계산 라벨이 남아 있다: {extra} — 빌더가 아직 계산한다")

    print("\n[⑤-a 빈 칸] 전 행이 비어 있는 칸 — 조용한 누락")
    empty = [c for c in EXPECT_DATA if st["cnt"].get(c, 0) == 0]
    chk(not empty, f"전 행 빈 칸 {len(empty)}개", " ".join(empty))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="data/exports/_load")
    a = ap.parse_args()
    d = a.dir
    print(f"== 빌드 산출물 검사 — {d} ==")
    check_files(d)
    check_header(d)
    print("\n  buildings.csv 훑는 중…", flush=True)
    st = scan_buildings(d)
    check_keys(d, st)
    check_parcels(d)
    check_series(d)
    check_complex(d, st)
    check_format(d, st)

    base = None
    try:
        import asyncpg
        c = await asyncpg.connect(DSN, timeout=10, command_timeout=300)
        base = await db_stats(c)
        await c.close()
    except Exception as e:                                       # noqa: BLE001
        print(f"\n  · DB 접속 불가({type(e).__name__}) — 행수·채움률 비교는 건너뜁니다")

    if base:
        print("\n[③ 행수] 지금 DB 대비 급감하지 않았는가")
        for f, (tbl, _) in FILES.items():
            n_csv = sum(1 for _ in _read(os.path.join(d, f))) if f != "buildings.csv" else st["n"]
            n_db = base[f]["n"]
            if not n_db:
                print(f"  · {f} — DB 기준선 없음, 건너뜀")
                continue
            chk(n_csv >= n_db * ROW_FLOOR, f"{f} {n_csv:,} (DB {n_db:,}, {n_csv/n_db*100:.1f}%)",
                f"기준 {ROW_FLOOR*100:.0f}% — 원천이 줄었거나 빌드가 중간에 끊겼다")

        print(f"\n[⑤-b 채움률] DB 대비 {COV_DROP}%p 넘게 떨어진 칸")
        drops = []
        for col, dbcov in (base["buildings.csv"].get("cov") or {}).items():
            if dbcov is None:
                continue
            csvcov = st["cnt"][col] / st["n"] * 100
            if dbcov - csvcov > COV_DROP:
                drops.append(f"{col} {dbcov:.1f}%→{csvcov:.1f}%")
        chk(not drops, f"채움률 급락 {len(drops)}칸", " · ".join(drops))

    print(f"\n{ok} ✓ · {bad} ✗")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    asyncio.run(main())
