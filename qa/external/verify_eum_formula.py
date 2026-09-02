#!/usr/bin/env python3
"""이식한 산식이 토지이음 화면을 그대로 내는지 잰다 (2026-09-02).

## 왜 따로 재나

`verify_luris_vs_eum.py` 는 「우리 면적으로 낸 값」과 「저쪽 면적으로 낸 값」을 견준다.
둘 다 **우리 코드**로 계산한 것이라, 산식 이식 자체가 맞는지는 안 재진다.

여기서는 저쪽 것만 넣는다.

    저쪽 면적(MapPlan) + 저쪽 용도지역 목록(그 페이지가 보낸 ucodes) + 저쪽 전체면적
    → 우리 eum_rule.calc()  vs  **저쪽 화면에 뜬 값**

같으면 산식은 완전히 맞는 것이고, 남는 오차는 전부 면적(도면 판) 때문이다.
덤으로 **우리 원장이 뽑은 용도지역 목록이 저쪽 것과 같은지**도 같이 본다.

화면 값은 브라우저가 만들어야 나오므로(서버는 빈 틀만 준다) 페이지를 연다.
공공 사이트라 표본만 본다.

    backend/.venv/bin/python scripts/verify_eum_formula.py [--n 30] [PNU ...]
"""
import asyncio
import csv
import glob
import json
import os
import random
import re
import sys
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "tools"))
import eum_rule                                                   # noqa: E402

SPATIAL = "data/tools/_spatial_ALL.json"
LEDGER = "data/raw/토지이용계획정보_서울/AL_D155_*.csv"
WAIT = 1.5


def ledger_codes(pnus):
    """PNU → (용도지역 코드들, 용도지구 코드들). 접함은 뺀다(토지이음도 뺀다)."""
    src = sorted(glob.glob(LEDGER))[-1]
    want, z, d = set(pnus), {}, {}
    with open(src, encoding="cp949", errors="replace", newline="") as f:
        rd = csv.reader(f); hdr = next(rd)
        ip, ij, ic = (hdr.index(x) for x in ("고유번호", "저촉여부", "용도지역지구코드"))
        for row in rd:
            if len(row) <= ic or row[ip] not in want:
                continue
            cd, jc = row[ic].strip(), row[ij].strip()
            if cd in eum_rule.TARGET_LOCAL and jc != "접함":
                z.setdefault(row[ip], set()).add(cd)
            elif cd in eum_rule.TARGET_DISTRICT:
                d.setdefault(row[ip], set()).add(cd)
    return z, d


async def main():
    args = sys.argv[1:]
    n = 30
    if "--n" in args:
        i = args.index("--n"); n = int(args[i + 1]); del args[i:i + 2]

    pnus = args
    if not pnus:
        sp = json.load(open(SPATIAL, encoding="utf-8"))
        rng = random.Random(20260902)
        multi = [p for p, v in sp.items() if len(v.get("용도지역") or []) >= 2]
        single = [p for p, v in sp.items() if len(v.get("용도지역") or []) == 1]
        rng.shuffle(multi); rng.shuffle(single)
        # 걸침이 어려우니 반반 — 단일도 안 재 본 적이 없다
        pnus = multi[:n // 2] + single[:n - n // 2]
    print("원장에서 용도지역 코드 읽는 중…", flush=True)
    zmap, dmap = ledger_codes(pnus)

    from playwright.async_api import async_playwright                 # noqa: PLC0415
    ok = bad = skip = zone_diff = 0
    print(f"\n대조 {len(pnus)}필지 — 저쪽 면적으로 저쪽 화면이 나오는가\n", flush=True)
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        for pnu in pnus:
            got = {}
            for _ in range(2):
                pg = await br.new_page()
                try:
                    def on_req(r, _g=got):
                        if "luLandDetUseGYAjax" in r.url:
                            q = urllib.parse.parse_qs(urllib.parse.urlparse(r.url).query)
                            _g["ucodes"] = q.get("ucodes", [""])[0].split(";")
                    pg.on("request", on_req)
                    await pg.goto("https://www.eum.go.kr/web/ar/lu/luLandDet.jsp"
                                  f"?pnu={pnu}&mode=search")
                    await pg.get_by_role("link", name="열람", exact=True).click()
                    await pg.wait_for_function(
                        "() => document.body.innerText.includes('지역지구등 지정여부')", timeout=25000)
                    await pg.evaluate("() => fn_focusTab('act_rusult', 1)")
                    await pg.wait_for_function(
                        r"() => /건폐율\s*\n?\s*약\s*[0-9.]+\s*%/.test(document.body.innerText)",
                        timeout=25000)
                    t = await pg.evaluate("() => document.body.innerText")
                    # 저쪽이 쓴 면적을 화면에서 직접 읽지 않는다 — MapPlan 원문을 쓴다
                    j = await pg.evaluate(
                        "async () => (await fetch('https://www.eum.ne.kr:9003/MapPlan/MapPlan"
                        f"?req=analysis&version=20260614&pnus={pnu}')).json()")
                    i = t.find("산출정보")
                    seg = t[i:i + 500]
                    b = re.search(r"건폐율\s*\n?\s*약\s*([0-9.]+)\s*%", seg)
                    f2 = re.search(r"용적률\s*\n?\s*약\s*([0-9.]+)\s*%", seg)
                    a = re.search(r"면적\s*\n?\s*([0-9,.]+)\s*㎡", t)
                    if b and f2 and a:
                        got.update(b=float(b.group(1)), f=float(f2.group(1)),
                                   tot=float(a.group(1).replace(",", "")), mp=j)
                except Exception:                                     # noqa: BLE001
                    pass
                finally:
                    await pg.close()
                if "b" in got:
                    break
            if "b" not in got:
                print(f"  ⏭ {pnu}: 화면을 못 읽음"); skip += 1; continue

            areas = {}
            for L in (got["mp"].get("layer") or []):
                for c in L["codes"]:
                    areas.setdefault(c["code"], c["area"])
            theirs_z = [c for c in (got.get("ucodes") or []) if c in eum_rule.TARGET_LOCAL]
            theirs_d = [c for c in (got.get("ucodes") or []) if c in eum_rule.TARGET_DISTRICT]
            ours_z = sorted(zmap.get(pnu) or [])
            if set(ours_z) != set(theirs_z):
                zone_diff += 1
                print(f"  ⚠ {pnu}: 용도지역 목록이 다름 — 우리 {ours_z} · 저쪽 {sorted(theirs_z)}")
            b, f2, how = eum_rule.calc(theirs_z, areas, got["tot"], theirs_d)
            eb, ef = f"{round(got['b'])}%", f"{round(got['f'])}%"
            if (b, f2) == (eb, ef):
                ok += 1
                print(f"  ✅ {pnu}  {eb}/{ef} [{how}]")
            else:
                bad += 1
                print(f"  ❌ {pnu}  화면 {eb}/{ef}  우리산식 {b}/{f2} [{how}]  "
                      f"지역 {sorted(theirs_z)} 면적 "
                      f"{ {c: round(areas.get(c, 0), 2) for c in theirs_z} } 전체 {got['tot']}")
            await asyncio.sleep(WAIT)
        await br.close()

    tot = ok + bad
    print(f"\n대조 {tot}필지 · 산식 일치 {ok} · 불일치 {bad} · 못읽음 {skip}")
    if tot:
        print(f"산식 일치율 {ok / tot * 100:.1f}%")
    print(f"우리 원장 목록이 저쪽과 다른 필지 {zone_diff}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
