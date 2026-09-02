#!/usr/bin/env python3
"""법정 건폐율·용적률을 토지이음과 대조한다 (2026-09-02).

## 왜

걸친 필지(용도지역 둘 이상)의 법정 건폐/용적을 우리가 계산해 싣는데, 토지이음과 같은지
재 본 적이 없었다. `load_parcel_luris.py` 의 「100%」는 **용도지역 이름**을 잰 것이지
건폐율·용적률이 아니다(표본 2,857필지 · 0136).

## 무엇을 대조하나

토지이음 「행위제한내용설명 → 건폐율·용적률」 화면의 산출정보(약 N% / 약 M%)와
**우리 계산**을 견준다. 우리 계산 = 원장(AL_D155)이 준 용도지역 목록 × 공간조인이 낸
면적 비중 × 서울시 조례표(build_legal.LEGAL) → 가중평균.

화면의 「산출면적 정보 표」는 **용도지역을 다 안 보여준다**(2026-09-02 실측:
세 지역이 걸린 필지인데 표엔 둘만). 그래서 면적은 화면에서 읽지 않는다. 화면에서 읽는
것은 결과값(건폐·용적)과 전체면적뿐이고, 전체면적은 **우리 토지면적과 맞는지 보는 용도**다.

면적 비중만 있으면 가중평균은 나온다(전체면적이 약분된다). 전체면적이 쓰이는 곳은
걸침 문턱(330㎡·상업 660㎡) 판정 하나뿐이고, 그 면적은 토지특성 원장에 있다.

## 어떻게

공공 사이트라 표본만 본다(요청 간 2초). 전수 크롤이 목적이 아니다.

    backend/.venv/bin/python scripts/verify_legal_vs_eum.py [--n 30] [PNU ...]
"""
import asyncio
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "tools"))
from build_legal import LEGAL, luris  # noqa: E402

SPATIAL = "data/tools/_spatial_ALL.json"
LAND = "data/tools/_land_master.jsonl"
WAIT = 2.0


def parse(text: str):
    """산출정보 → (건폐%, 용적%, 전체면적). 없으면 None."""
    i = text.find("산출정보")
    if i < 0:
        return None
    t = text[i:i + 1200]
    b = re.search(r"건폐율\s*\n?\s*약\s*([0-9.]+)\s*%", t)
    f = re.search(r"용적률\s*\n?\s*약\s*([0-9.]+)\s*%", t)
    a = re.search(r"전체면적\s*\t?\s*([0-9,.]+)\s*㎡", t)
    if not (b and f and a):
        return None
    return float(b.group(1)), float(f.group(1)), float(a.group(1).replace(",", ""))


async def main():
    args = sys.argv[1:]
    n = 30
    if "--n" in args:
        i = args.index("--n"); n = int(args[i + 1]); del args[i:i + 2]
    if not os.path.exists(SPATIAL):
        sys.exit(f"✗ {SPATIAL} 없음 — data/tools/spatial_join.py ALL 을 먼저 돌리세요")
    print("공간조인 로드…", flush=True)
    sp = json.load(open(SPATIAL))
    print("토지면적 로드…", flush=True)
    area = {}
    for line in open(LAND, encoding="utf-8"):
        r = json.loads(line)
        if r.get("면적"):
            area[r["PNU"]] = float(r["면적"])

    pnus = args
    if not pnus:   # 안 주면 걸침 필지에서 무작위로 뽑는다
        cand = [p for p, v in sp.items()
                if len([z for z in (v.get("용도지역") or []) if z["명"] in LEGAL]) >= 2]
        import random
        random.shuffle(cand)
        pnus = cand[:n]
    print(f"대조 대상 {len(pnus)}필지\n", flush=True)

    from playwright.async_api import async_playwright   # noqa: PLC0415
    ok = bad = skip = n_area = 0
    diffs = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        pg = await br.new_page()
        for pnu in pnus:
            try:
                await pg.goto(f"https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?pnu={pnu}&mode=search")
                await pg.get_by_role("link", name="열람", exact=True).click()
                await pg.wait_for_timeout(1400)
                await pg.evaluate("() => fn_focusTab('act_rusult', 1)")
                await pg.wait_for_timeout(1100)
                got = parse(await pg.evaluate("() => document.body.innerText"))
            except Exception as e:                                   # noqa: BLE001
                print(f"  ⏭ {pnu}: 못 읽음({type(e).__name__})"); skip += 1; continue
            if not got:
                print(f"  ⏭ {pnu}: 산출정보 없음"); skip += 1; continue

            eb, ef, etot = got
            z = sp.get(pnu, {}).get("용도지역") or []
            # 파이프라인이 갈 길 그대로 — 면적은 토지특성 원장에서 온다
            ours_area = area.get(pnu)
            if not ours_area:
                print(f"  ⏭ {pnu}: 토지면적 없음"); skip += 1; continue
            if abs(ours_area - etot) > 0.55:
                n_area += 1
                print(f"  ⚠ {pnu}: 면적이 다름 — 토지이음 {etot}㎡ · 우리 {ours_area}㎡")
            b, f, how = luris(z, ours_area, sp.get(pnu, {}).get("개발제한비중"))
            if b is None:
                print(f"  ⏭ {pnu}: 우리가 계산 못 함({how})"); skip += 1; continue
            db = int(b.rstrip("%")) - round(eb)
            df = int(f.rstrip("%")) - round(ef)
            if db == 0 and df == 0:
                ok += 1
                print(f"  ✅ {pnu}  {round(eb)}%/{round(ef)}%  [{how}]")
            else:
                bad += 1
                diffs.append((pnu, round(eb), round(ef), b, f, how, db, df,
                              {x['명']: round(x['비중'] * ours_area, 1) for x in z}))
                print(f"  ❌ {pnu}  토지이음 {round(eb)}%/{round(ef)}%  우리 {b}/{f} "
                      f"(건폐 {db:+d} 용적 {df:+d}) [{how}]")
            await pg.wait_for_timeout(int(WAIT * 1000))
        await br.close()

    tot = ok + bad
    print(f"\n대조 {tot}필지 · 일치 {ok} · 불일치 {bad} · 건너뜀 {skip} · 면적 다름 {n_area}")
    if tot:
        print(f"일치율 {ok / tot * 100:.1f}%")
    if diffs:
        print("\n불일치 자세히(우리 면적):")
        for d in diffs[:12]:
            print(f"  {d[0]}  토지이음 {d[1]}/{d[2]} · 우리 {d[3]}/{d[4]} [{d[5]}] {d[8]}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
