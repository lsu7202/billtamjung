#!/usr/bin/env python3
"""실거래 여덟 갈래 → 거래 표 + 지번 연결 (2026-10-08 · 스펙 12 §1). build_sales.py 를 대신한다.

    data/.venv/bin/python data/tools/build_trades.py [--out data/exports/_load]

## 무엇을 내나
- trade.csv       원천 한 줄 = 거래 하나. 지운 거래 없음(해제 · 지분 · 집합 · 못 붙은 거래 전부)
- trade_match.csv 지번에 **확실히** 붙은 거래만

## 붙이는 규칙 · 방식마다 다르고, 하나라도 안 맞으면 안 붙인다
- 호실 단위(아파트 · 연립다세대 · 오피스텔 · 분양입주권) · 집합(상업업무용 · 공장창고): 번지가 가려지지 않는다.
  법정동 + 본번 · 부번(부번 없으면 0)이 지적도에 있으면 그 지번.
- 통매(상업업무용 · 공장창고 일반, 단독다가구): 법정동 · 가려진 번지 모양(산 · 자릿수 · 앞자리) · 도로명이 맞는 지번 중
  대지면적(필지 면적 또는 그 동이 걸친 필지 합 ±2%) 그리고 연면적(한 동 또는 지번 모든 동의 합 ±3%)
  그리고 건축년도(한 동으로 맞았으면 그 동 · 합으로 맞았으면 어느 동이든 ±1 · 원천에 없으면 뺌)가
  다 맞는 지번이 하나뿐일 때만.
- 지분: 신고 면적이 지분 몫이다. 규칙을 재기 전까지 안 붙인다.
- 토지: 가려진 번지 모양 · 지목 · 계약면적(필지 면적 ±0.5%)이 맞는 지번이 하나뿐일 때만.
- 해제: 규칙은 같다. canceled_on 으로 가른다.

대장 대지면적은 대조에 안 쓴다 — 실거래 대지면적은 필지(땅) 면적이다(10-07 측정).
지번 · 건물 · 필지 면적은 살아 있는 DB 에서 읽는다(대장 · 필지 적재 뒤에 돈다).
"""
import argparse
import collections
import csv
import glob
import hashlib
import os
import re
import sys

import psycopg

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbf_inspect import read_dbf          # noqa: E402
from build_report import Report           # noqa: E402

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
RAW = "data/raw/실거래가"
KINDS = ("아파트", "연립다세대", "단독다가구", "오피스텔", "분양입주권", "상업업무용", "토지", "공장창고")
UNIT_KINDS = {"아파트", "연립다세대", "오피스텔", "분양입주권"}
COLS = ["id", "kind", "bjd_code", "dong_name", "jibun_raw", "road_name", "complex_name", "contract_ym",
        "contract_day", "price_won", "total_area", "excl_area", "land_area", "floor", "bldg_dong", "build_year",
        "house_type", "deal_kind", "main_use", "use_zone", "jimok", "road_cond", "share", "right_kind",
        "deal_type", "canceled_on", "registered_on", "buyer", "seller", "broker_area", "src"]


def num(s):
    s = (s or "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def ymd(s):
    """20260210 · 26.03.04 → 2026-02-10 · 2026-03-04. 못 읽으면 빈칸."""
    s = (s or "").strip()
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", s)
    if m:
        return f"{m[1]}-{m[2]}-{m[3]}"
    m = re.fullmatch(r"(\d{2})\.(\d{2})\.(\d{2})", s)
    if m:
        return f"20{m[1]}-{m[2]}-{m[3]}"
    return ""


def rows():
    for path in sorted(glob.glob(f"{RAW}/*_매매_서울_*.csv")):
        kind = os.path.basename(path).split("_")[0]
        if kind not in KINDS:
            continue
        with open(path, encoding="cp949", errors="replace") as f:
            hdr = None
            for i, r in enumerate(csv.reader(f), 1):
                if hdr is None:
                    if r and r[0].strip() == "NO" and "시군구" in r:
                        hdr = {c.strip(): j for j, c in enumerate(r)}
                    continue
                if len(r) < len(hdr):
                    continue
                yield kind, {k: r[j].strip() for k, j in hdr.items()}, f"{os.path.basename(path)}:{i}"


def jibun_of(d):
    """원천 번지 칸 → (산, 본번, 부번 | None, 가려짐)"""
    raw = d.get("번지") or d.get("지번") or ""
    if d.get("본번"):
        return raw, ("산" in raw), d["본번"].lstrip("0") or "0", d.get("부번", "").lstrip("0") or "0", False
    m = re.match(r"^(산)?\s*([0-9*]+)(?:-([0-9*]+))?", raw)
    if not m:
        return raw, False, None, None, True
    return raw, bool(m[1]), m[2], m[3], "*" in raw


def pnu_of(code, san, bon, bu):
    return f"{code}{'2' if san else '1'}{int(bon):04d}{int(bu or 0):04d}"


def ok(a, t, tol):
    return bool(a and t and abs(a - t) / t <= tol)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/exports/_load")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    print("법정동 이름 → 코드…", flush=True)
    name2code = {}
    for dbf in sorted(glob.glob("data/raw/토지특성/AL_D194_*/AL_D194_*.dbf")):
        n, f, rr = read_dbf(dbf, ("cp949",))
        for r in rr():
            name2code.setdefault(r["A3"].strip(), r["A2"])

    print("지적도 · 건물 · 건물↔필지(살아 있는 DB)…", flush=True)
    with psycopg.connect(DSN) as pc, pc.cursor() as cur:
        cur.execute("SELECT pnu, area::float, coalesce(jimok,'') FROM master.parcels")
        parea, pjimok = {}, {}
        for p, ar, jm in cur:
            parea[p] = ar or 0.0
            pjimok[p] = jm
        cur.execute("SELECT building_pk, pnu FROM master.building_parcels")
        bpar = collections.defaultdict(list)
        for pk, p in cur:
            bpar[pk].append(p)
        cur.execute("""SELECT building_pk, pnu, total_area::float, left(approval_ymd::text, 4), coalesce(road_addr, '')
                         FROM master.buildings""")
        onp = collections.defaultdict(list)
        for pk, p, ta, yr, road in cur:
            rn = re.sub(r"\s*\(.*\)$", "", road).split()
            b = dict(ta=ta or 0.0, yr=int(yr) if yr and yr.isdigit() else None,
                     rn=rn[2] if len(rn) > 2 else "",
                     land=sum(parea.get(x, 0.0) for x in bpar.get(pk, [p])))
            for x in set(bpar.get(pk, [p])):
                onp[x].append(b)
    idx = collections.defaultdict(list)       # (법정동, 산, 본번 자릿수, 본번 첫 자리) → 지번
    for p in parea:
        bon = p[11:15].lstrip("0") or "0"
        idx[(p[:10], p[10], len(bon), bon[0])].append(p)

    def masked(code, san, bon, bu):
        if not bon:
            return []
        out = []
        for p in idx.get((code, "2" if san else "1", len(bon), bon[0]), []):
            pb = p[11:15].lstrip("0") or "0"
            if all(c == "*" or c == x for c, x in zip(bon, pb)):
                if bu and "*" not in bu and (p[15:19].lstrip("0") or "0") != (bu.lstrip("0") or "0"):
                    continue
                out.append(p)
        return out

    def whole(code, san, bon, bu, road, dae, yeon, byr):
        hits = []
        for p in masked(code, san, bon, bu):
            bs = onp.get(p, [])
            if road and any(b["rn"] for b in bs) and not any(b["rn"] == road for b in bs):
                continue
            if not dae or not any(ok(l, dae, 0.02) for l in ({parea.get(p, 0.0)} | {b["land"] for b in bs})):
                continue
            if not yeon:
                continue
            one = [b for b in bs if ok(b["ta"], yeon, 0.03)]
            if one:
                if byr and not any(b["yr"] and abs(b["yr"] - byr) <= 1 for b in one):
                    continue
            elif ok(sum(b["ta"] for b in bs), yeon, 0.03):
                if byr and not any(b["yr"] and abs(b["yr"] - byr) <= 1 for b in bs):
                    continue
            else:
                continue
            hits.append(p)
        return hits

    def land(code, san, bon, bu, jimok, area):
        hits = []
        for p in masked(code, san, bon, bu):
            if jimok and pjimok.get(p) and pjimok[p] != jimok:
                continue
            if ok(parea.get(p, 0.0), area, 0.005):
                hits.append(p)
        return hits

    doc = Report("build_trades", src="국토부 실거래 여덟 갈래(서울 · 매매)")
    seen = collections.Counter()
    stat = collections.defaultdict(collections.Counter)
    ft = open(os.path.join(a.out, "trade.csv"), "w", newline="")
    fm = open(os.path.join(a.out, "trade_match.csv"), "w", newline="")
    wt, wm = csv.writer(ft), csv.writer(fm)
    wt.writerow(COLS)
    wm.writerow(["trade_id", "pnu", "method"])
    print("원천 읽기 · 붙이기…", flush=True)
    for kind, d, src in rows():
        doc.read()
        g = d.get
        raw, san, bon, bu, hidden = jibun_of(d)
        code = name2code.get(g("시군구", ""))
        price = num(g("거래금액(만원)"))
        yeon = num(g("전용/연면적(㎡)")) if kind in ("상업업무용", "공장창고") else num(g("연면적(㎡)"))
        excl = num(g("전용면적(㎡)"))
        if kind in ("상업업무용", "공장창고") and g("유형") == "집합":
            excl, yeon = yeon, None                     # 집합의 「전용/연면적」은 호실 전용면적이다
        landa = num(g("대지면적(㎡)")) or num(g("대지권면적(㎡)")) or num(g("계약면적"))
        byr = int(g("건축년도")) if (g("건축년도") or "").isdigit() else None
        cancel = ymd(g("해제사유발생일"))
        vals = [kind, code or "", g("시군구", ""), raw, g("도로명", ""), g("단지명") or g("건물명") or "",
                g("계약년월", ""), g("계약일", ""), int(price * 10000) if price else "", yeon or "", excl or "",
                landa or "", g("층", ""), g("동", ""), byr or "", g("주택유형", ""), g("유형", ""),
                g("건축물주용도", ""), g("용도지역", ""), g("지목", ""), g("도로조건", ""), g("지분구분", ""),
                g("분/입주권", ""), g("거래유형", ""), cancel, ymd(g("등기일자")), g("매수") or g("매수자") or "",
                g("매도") or g("매도자") or "", g("중개사소재지", ""), src]
        vals = ["" if v in ("-",) else v for v in vals]
        h = hashlib.md5("|".join(map(str, vals[:-1])).encode()).hexdigest()[:16]
        seen[h] += 1
        tid = h if seen[h] == 1 else f"{h}#{seen[h]}"
        wt.writerow([tid] + vals)
        doc.write()

        way = ("호실" if kind in UNIT_KINDS else
               "집합" if g("유형") == "집합" else
               "지분" if g("지분구분") == "지분" else
               "토지" if kind == "토지" else "통매")
        key = f"{kind}·{way}" + ("·해제" if cancel else "")
        stat[key]["원천"] += 1
        if not code:
            stat[key]["동 못 찾음"] += 1
            continue
        hit, method = [], ""
        if way in ("호실", "집합") and bon and not hidden:
            p = pnu_of(code, san, bon, bu)
            hit, method = ([p] if p in parea else []), "번지그대로"
        elif way == "통매":
            hit, method = whole(code, san, bon, bu, g("도로명", ""), landa, yeon, byr), "전부일치"
        elif way == "토지":
            hit, method = land(code, san, bon, bu, g("지목", ""), landa), "토지"
        if len(hit) == 1:
            wm.writerow([tid, hit[0], method])
            stat[key]["붙음"] += 1
        else:
            stat[key]["여럿" if hit else "안 붙음"] += 1
    ft.close(); fm.close()
    for k in sorted(stat):
        c = stat[k]
        doc.note(f"{k}: {dict(c)}")
        print(f"  {k}\t원천 {c['원천']:,}\t붙음 {c['붙음']:,} ({c['붙음'] / c['원천'] * 100:.1f}%)\t여럿 {c['여럿']:,}\t안 붙음 {c['안 붙음']:,}", flush=True)
    doc.finish()


if __name__ == "__main__":
    main()
