# -*- coding: utf-8 -*-
"""토지이음(eum.go.kr) 대조 크롤러 — 용도지역·법정 건폐율·용적률 검증(2026-08-27).

우리 DB 의 용도지역·법정 건폐/용적은 여러 원천(연속지적 UQA 레이어·토지특성·조례표)을
조립한 값이라, 정부 열람 서비스(토지이음)와 실제로 맞는지 잰 적이 없다.
필지마다 토지이음을 열어 세 값을 받아 DB 와 나란히 적는다.

요청은 필지당 둘이다:
  ① POST /web/ar/lu/luLandDet.jsp (pnu)      → 지정현황(용도지역들) + ucodes + 세션쿠키
  ② GET  /web/ar/lu/luLandDetUseGYAjax.jsp   → 숨은 input gun_basic_*/yong_basic_* (조례 %)

전수(89.9만 필지 × 2요청)는 며칠 걸리므로 기본은 **구별 층화표본**이고,
--all 을 주면 전수를 이어서 돈다(끊겨도 CSV 를 보고 이어받는다).

    backend/.venv/bin/python scripts/eum_check/crawl_eum.py --per-sgg 120     # 표본
    backend/.venv/bin/python scripts/eum_check/crawl_eum.py --all             # 전수(수일)
"""
import argparse
import csv
import os
import random
import re
import sys
import time

import requests

BASE = "https://www.eum.go.kr/web/ar/lu"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh) bildetective-data-check",
      "Referer": f"{BASE}/luLandDet.jsp"}
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "eum_check.csv")
DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")

# 지정현황에서 용도지역(UQA*)만 골라낸다 — 지구단위·도로 접합 등은 별개 항목
RE_UCODES = re.compile(r'name="ucodes" id="ucodes" value="([^"]*)"')
RE_MARK = re.compile(r'name="mark_ucode" value="(U[A-Z0-9]+)"')
RE_ZONE_NAME = re.compile(r"openLandLayer\('live_layer_(UQA[0-9X]+)_\d+'\);\" class=\"link\">([^<]+)</a>")
# 지역·지구 등 지정여부 **전부**(2026-08-27). 예전엔 UQA(용도지역)만 뽑고 나머지를 버렸다.
# 실제로는 같은 자리에 규제가 다 들어 있다: 가축사육제한구역·대공방어협조구역·과밀억제권역·
# 지구단위계획구역·정비구역 등. 우리 parcels.reg_district 와 대조할 재료다.
RE_ANY_LAYER = re.compile(r"openLandLayer\('live_layer_([A-Z0-9X]+)_\d+'\);\"[^>]*>([^<]+)</a>")
RE_GUN = re.compile(r'id="gun_basic_(U[A-Z0-9]+)" value="\s*([0-9.]+)"')
RE_YONG = re.compile(r'id="yong_basic_(U[A-Z0-9]+)" value="\s*([0-9.]+)"')
RE_YONG_EXTRA = re.compile(r'(\d+)%\s*(?:<[^>]+>\s*)*\(([^)]+)\)')   # 800% <br> 600% (서울도심)


def fetch_one(sess: requests.Session, pnu: str) -> dict:
    r = sess.post(f"{BASE}/luLandDet.jsp", headers=UA, timeout=25,
                  data={"selGbn": "umd", "isNoScr": "script", "s_type": "1",
                        "mode": "search", "pnu": pnu, "add": "land"})
    html = r.content.decode("euc-kr", errors="replace")
    m = RE_UCODES.search(html)
    ucodes = m.group(1) if m else ""
    zones = {c: n.strip() for c, n in RE_ZONE_NAME.findall(html)}
    # 규제 전체 — 용도지역(UQA)을 뺀 나머지가 「지역·지구 등 지정여부」다.
    # &lt;법률명&gt; 이 붙어 오므로 되돌린다.
    def _unesc(t):
        return (t.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").strip())
    regs = [_unesc(n) for c, n in RE_ANY_LAYER.findall(html) if not c.startswith("UQA")]
    if not ucodes:
        return {"pnu": pnu, "eum_zone": "", "eum_bcr": "", "eum_far": "",
                "eum_reg": "", "eum_reg_n": "0", "note": "지정현황 없음"}

    r2 = sess.get(f"{BASE}/luLandDetUseGYAjax.jsp", headers=UA, timeout=25,
                  params={"ucodes": ucodes, "sggcd": pnu[:5], "pnu": pnu, "carGbn": "GY"})
    h2 = r2.content.decode("euc-kr", errors="replace")
    guns = dict(RE_GUN.findall(h2))
    yongs = dict(RE_YONG.findall(h2))
    unames = {c: n for c, n in re.findall(r'id="car_uname_(U[A-Z0-9]+)" value="([^"]*)"', h2)}
    # 용적률 변형(서울도심 600% 등) — 본값 뒤에 병기
    extras = ";".join(f"{v}%({t.strip()})" for v, t in RE_YONG_EXTRA.findall(h2))

    # 대표 용도지역 = GY 표의 첫 코드(토지이음이 대표로 세운 것)
    code = next(iter(guns), None)
    return {
        "pnu": pnu,
        "eum_zone": unames.get(code) or zones.get(code, ""),
        "eum_zone_all": "|".join(unames.values()) or "|".join(zones.values()),
        "eum_bcr": guns.get(code, ""),
        "eum_far": yongs.get(code, ""),
        "eum_far_extra": extras,
        "eum_reg": "|".join(regs),          # 지역·지구 등 지정여부(용도지역 제외)
        "eum_reg_n": str(len(regs)),
        "note": "",
    }


def db_rows(per_sgg: int | None):
    import asyncio
    import asyncpg

    async def _q():
        c = await asyncpg.connect(DSN)
        if per_sgg:
            # 구별 층화 무작위 — 조례는 구 단위라 구마다 뽑아야 전 조례를 훑는다
            rows = await c.fetch("""
                SELECT pnu, use_zone, legal_bcr, legal_far, reg_district FROM (
                  SELECT pnu, use_zone, legal_bcr, legal_far, reg_district,
                         row_number() OVER (PARTITION BY substr(pnu,1,5) ORDER BY md5(pnu)) rn
                    FROM master.parcels WHERE use_zone IS NOT NULL) t
                WHERE rn <= $1""", per_sgg)
        else:
            rows = await c.fetch(
                "SELECT pnu, use_zone, legal_bcr, legal_far, reg_district FROM master.parcels ORDER BY pnu")
        await c.close()
        return [(r["pnu"], r["use_zone"], r["legal_bcr"], r["legal_far"], r["reg_district"]) for r in rows]

    return asyncio.run(_q())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-sgg", type=int, default=None, help="구별 표본 수(층화)")
    ap.add_argument("--all", action="store_true", help="전수(며칠 걸린다)")
    ap.add_argument("--delay", type=float, default=0.35, help="요청 간격(초) — 예의는 지킨다")
    args = ap.parse_args()
    if not args.all and not args.per_sgg:
        args.per_sgg = 120

    rows = db_rows(None if args.all else args.per_sgg)
    random.shuffle(rows)

    done = set()
    if os.path.exists(OUT):
        with open(OUT, newline="") as f:
            done = {r["pnu"] for r in csv.DictReader(f)}
        print(f"이어받기 — 이미 {len(done):,}건", flush=True)

    fields = ["pnu", "db_zone", "db_bcr", "db_far", "db_reg",
              "eum_zone", "eum_zone_all", "eum_bcr", "eum_far", "eum_far_extra",
              "eum_reg", "eum_reg_n", "note"]
    new_file = not os.path.exists(OUT)
    sess = requests.Session()
    n_ok = n_err = 0
    with open(OUT, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        if new_file:
            w.writeheader()
        for i, (pnu, zone, bcr, far, reg) in enumerate(rows):
            if pnu in done:
                continue
            try:
                d = fetch_one(sess, pnu)
            except Exception as e:            # 한 필지 실패로 전체를 멈추지 않는다
                d = {"pnu": pnu, "eum_zone": "", "eum_bcr": "", "eum_far": "",
                     "eum_reg": "", "eum_reg_n": "0", "note": f"ERR {e}"}
                n_err += 1
                if n_err % 20 == 0:
                    sess = requests.Session()   # 세션이 죽었을 수 있다
            d.update({"db_zone": zone or "", "db_bcr": (bcr or "").replace("%", ""),
                      "db_far": (far or "").replace("%", ""), "db_reg": reg or ""})
            w.writerow({k: d.get(k, "") for k in fields})
            n_ok += 1
            if n_ok % 100 == 0:
                f.flush()
                print(f"{n_ok:,}건 · 오류 {n_err}", flush=True)
            time.sleep(args.delay)
    print(f"끝 — {n_ok:,}건 기록, 오류 {n_err}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
