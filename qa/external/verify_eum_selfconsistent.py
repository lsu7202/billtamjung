#!/usr/bin/env python3
"""토지이음 화면이 자기 안에서 앞뒤가 맞는지 잰다 (2026-09-02).

## 왜

걸친 필지의 법정 건폐/용적을 토지이음과 맞추려는데, 값이 어긋난다. 원인이 우리 면적인지
토지이음 쪽인지를 가르려면 **우리 데이터를 아예 빼고** 재야 한다.

토지이음 한 화면에 셋이 같이 있다.

    산출정보     건폐율 약 N% · 용적률 약 M%      ← 결과
    산출면적 표  전체면적 · 용도지역별 면적        ← 입력(면적)
    규제 법령 표 용도지역별 건폐율·용적률(조례)     ← 입력(조례값)

입력 둘로 결과가 나오면 산식이 확정된다. 안 나오면 화면에 없는 값을 쓴다는 뜻이고,
그러면 우리가 아무리 잘 맞춰도 100%가 될 수 없다. 그때는 그 사실을 근거로 보고한다.

## 어떻게

    backend/.venv/bin/python scripts/verify_eum_selfconsistent.py [--n 40] [PNU ...]
"""
import asyncio
import json
import math
import os
import re
import sys

SPATIAL = "data/tools/_spatial_ALL.json"
WAIT = 1.5


def parse(t: str):
    """화면 → (건폐, 용적, 전체면적, {지역: 면적}, {지역: (건폐조례, 용적조례)})"""
    i = t.find("산출정보")
    if i < 0:
        return None
    seg = t[i:i + 2500]
    b = re.search(r"건폐율\s*\n?\s*약\s*([0-9.]+)\s*%", seg)
    f = re.search(r"용적률\s*\n?\s*약\s*([0-9.]+)\s*%", seg)
    if not (b and f):
        return None

    # 산출면적 표 — 「전체면적\t2,042 ㎡\t제1종일반주거지역\t95.0㎡」 뒤로 줄마다 지역·면적
    j = seg.find("산출면적 정보 표")
    areas, tot = {}, None
    if j >= 0:
        blk = seg[j:seg.find("규제 법령", j) if seg.find("규제 법령", j) > 0 else j + 900]
        m = re.search(r"전체면적\s*\t?\s*([0-9,.]+)\s*㎡", blk)
        if m:
            tot = float(m.group(1).replace(",", ""))
        for nm, a in re.findall(r"([가-힣0-9()·]+지역)\s*\t?\s*([0-9,.]+)\s*㎡", blk):
            areas[nm] = float(a.replace(",", ""))

    # 규제 법령 확인 표 — 「제1종일반주거지역\t60%\t150%」
    k = seg.find("규제 법령 확인 표")
    law = {}
    if k >= 0:
        blk = seg[k:k + 800]
        for nm, bb, ff in re.findall(r"([가-힣0-9()·]+지역)\s*\t?\s*([0-9]+)\s*%\s*\t?\s*([0-9]+)\s*%", blk):
            law[nm] = (int(bb), int(ff))
    return float(b.group(1)), float(f.group(1)), tot, areas, law


def wavg(areas, law):
    """화면의 면적 + 화면의 조례값 → 가중평균. 못 내면 None."""
    common = [n for n in areas if n in law]
    if not common:
        return None
    tot = sum(areas[n] for n in common)
    if tot <= 0:
        return None
    b = sum(law[n][0] * areas[n] for n in common) / tot
    f = sum(law[n][1] * areas[n] for n in common) / tot
    return b, f, tot, common


async def main():
    args = sys.argv[1:]
    n = 40
    if "--n" in args:
        i = args.index("--n"); n = int(args[i + 1]); del args[i:i + 2]

    pnus = args
    if not pnus:
        sp = json.load(open(SPATIAL))
        cand = [p for p, v in sp.items() if len(v.get("용도지역") or []) >= 2]
        import random
        random.seed(20260902)
        random.shuffle(cand)
        pnus = cand[:n]
    print(f"대조 {len(pnus)}필지 — 토지이음 화면만으로 재현되는지\n", flush=True)

    from playwright.async_api import async_playwright   # noqa: PLC0415
    ok = bad = skip = 0
    rows = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        for pnu in pnus:
            got = None
            for _ in range(2):                      # 한 번은 다시 해 본다
                # 창을 재사용하면 앞 필지의 탭 상태가 남아 두 번째부터 못 읽는다
                # (2026-09-02: 3필지 중 1필지만 읽힘). 필지마다 새 창을 연다.
                pg = await br.new_page()
                try:
                    await pg.goto(f"https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?pnu={pnu}&mode=search")
                    await pg.get_by_role("link", name="열람", exact=True).click()
                    # 정해진 시간을 쉬지 않고 **글자가 나타날 때까지** 기다린다.
                    # 2.2초로 끊었더니 40필지 중 37을 못 읽었다(2026-09-02).
                    await pg.wait_for_function(
                        "() => document.body.innerText.includes('지역지구등 지정여부')", timeout=20000)
                    await pg.evaluate("() => fn_focusTab('act_rusult', 1)")
                    await pg.wait_for_function(
                        "() => /건폐율\\s*\\n?\\s*약\\s*[0-9.]+\\s*%/.test(document.body.innerText)",
                        timeout=20000)
                    got = parse(await pg.evaluate("() => document.body.innerText"))
                except Exception:                    # noqa: BLE001
                    got = None
                finally:
                    await pg.close()
                if got:
                    break
            if not got:
                print(f"  ⏭ {pnu}: 산출정보 못 읽음"); skip += 1; continue
            eb, ef, tot, areas, law = got
            w = wavg(areas, law)
            if not w:
                print(f"  ⏭ {pnu}: 화면에 면적·조례값이 다 없음 (면적 {len(areas)} · 조례 {len(law)})")
                skip += 1; continue
            cb, cf, atot, common = w
            db, df = round(cb) - round(eb), round(cf) - round(ef)
            hit = (db == 0 and df == 0)
            # 조례값 범위를 벗어난 결과인가 — 가중평균으로는 절대 못 내는 값
            over = (eb > max(law[n2][0] for n2 in common) + 0.5
                    or ef > max(law[n2][1] for n2 in common) + 0.5)
            rows.append((pnu, eb, ef, cb, cf, tot, atot, areas, law, over))
            if hit:
                ok += 1
                print(f"  ✅ {pnu}  화면 {eb:g}%/{ef:g}%  = 화면면적·조례 재현 {cb:.2f}/{cf:.2f}")
            else:
                bad += 1
                flag = " ⛔조례 최대치 초과" if over else ""
                print(f"  ❌ {pnu}  화면 {eb:g}%/{ef:g}%  ≠ 재현 {cb:.2f}/{cf:.2f}"
                      f"  (면적합 {atot:g} / 전체 {tot:g}){flag}")
            await asyncio.sleep(WAIT)
        await br.close()

    t = ok + bad
    print(f"\n읽은 {t}필지 · 자기재현 {ok} · 재현안됨 {bad} · 못읽음 {skip}")
    if t:
        print(f"토지이음 화면의 자기 일치율 {ok / t * 100:.1f}%")
    over = [r for r in rows if r[9]]
    if over:
        print(f"\n⛔ 조례 최대치를 넘는 값 {len(over)}건 — 가중평균으로는 나올 수 없다")
        for r in over[:8]:
            print(f"   {r[0]}  화면 {r[1]:g}%/{r[2]:g}%  조례 {r[8]}")
    json.dump([{"pnu": r[0], "화면건폐": r[1], "화면용적": r[2], "재현건폐": r[3],
                "재현용적": r[4], "전체면적": r[5], "면적합": r[6], "면적": r[7],
                "조례": r[8], "조례초과": r[9]} for r in rows],
              open("/tmp/eum_selfcheck.json", "w"), ensure_ascii=False, indent=1)
    print("\n자세한 결과 → /tmp/eum_selfcheck.json")


if __name__ == "__main__":
    asyncio.run(main())
