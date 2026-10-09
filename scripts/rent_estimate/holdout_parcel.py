"""적정가 지번 단위 — 본매물 면적을 어디서 가져올지 잰다(2026-10-08 · 스펙 12 §2-2).

holdout_sale_prod 의 프로덕션 미러(PROD) 그대로, **본매물의 면적 · 공시만** 바꿔 검증 8구(타깃 2025~)로 잰다.
comp 는 그대로(실거래가 신고한 면적 · 대표 동 공시).

    S0 실거래 신고값      연면적 · 대지 = 그 거래가 신고한 값(지금까지의 백테스트. 화면은 이 값을 모른다)
    S1 지금 화면          연면적 · 대지 = 대표 동 대장(buildings) — 지금 building_sale_est 가 쓰는 값
    S2 지번 · 필지        연면적 = 지번 동 합(parcel_rep) · 대지 = 그 지번 필지 면적 · 공시 = 그 필지
    S3 지번 · 딸린 필지   연면적 = 지번 동 합 · 대지 = 대표 동에 딸린 필지(building_parcels) 면적 합 · 공시 = 면적 가중

    backend/.venv/bin/python scripts/rent_estimate/holdout_parcel.py
"""
import asyncio

import asyncpg

import backtest_sale_est as B
import holdout_sale_prod as H


async def extra(pnus: list[str]) -> dict:
    c = await asyncpg.connect(B.DSN)
    rows = await c.fetch("""
        WITH t AS (SELECT unnest($1::text[]) pnu)
        SELECT t.pnu, pr.total_area::float AS p_ta, b.total_area::float AS b_ta, b.land_area::float AS b_la,
               b.gongsi_latest::float AS b_g,
               p.area::float AS p_la, p.gongsi_latest::float AS p_g,
               (SELECT sum(pp.area) FROM master.building_parcels bp JOIN master.parcels pp ON pp.pnu = bp.pnu
                 WHERE bp.building_pk = pr.rep_pk)::float AS s_la,
               (SELECT sum(pp.area * pp.gongsi_latest) FROM master.building_parcels bp JOIN master.parcels pp ON pp.pnu = bp.pnu
                 WHERE bp.building_pk = pr.rep_pk AND pp.gongsi_latest > 0)::float AS s_gt
          FROM t JOIN master.parcel_rep pr ON pr.pnu = t.pnu
          JOIN master.buildings b ON b.building_pk = pr.rep_pk
          LEFT JOIN master.parcels p ON p.pnu = t.pnu""", pnus)
    await c.close()
    return {r["pnu"]: dict(r) for r in rows}


def main():
    hold = H.load_set(H.HOLD, "202501")
    # load() 는 building_pk 만 준다 — 대표 동 → 지번
    pks = sorted({t["building_pk"] for _, _, ts, _ in hold for t in ts})

    async def pmap():
        cc = await asyncpg.connect(B.DSN)
        r = await cc.fetch("SELECT rep_pk, pnu FROM master.parcel_rep WHERE rep_pk = ANY($1::text[])", pks)
        await cc.close()
        return {x["rep_pk"]: x["pnu"] for x in r}
    pnu_of = asyncio.run(pmap())
    ex = asyncio.run(extra(sorted(set(pnu_of.values()))))

    def subj(t, how):
        e = ex.get(pnu_of.get(t["building_pk"]))
        if how == "S0":
            return t
        if not e:
            return None
        if how == "S1":
            ta, la, g = e["b_ta"], e["b_la"], e["b_g"]
        elif how == "S2":
            ta, la, g = e["p_ta"], e["p_la"], e["p_g"]
        else:
            ta, la = e["p_ta"], e["s_la"]
            g = (e["s_gt"] / la) if (e["s_gt"] and la) else None
        if not (ta and la and g):
            return None
        return {**t, "total_area": ta, "land_area": la, "gongsi_latest": g}

    # 네 안이 같은 거래를 보도록 — 넷 다 면적이 있는 거래만
    def common(ts):
        return [t for t in ts if all(subj(t, h) for h in ("S0", "S1", "S2", "S3"))]

    print(f"{'안':22s} {'n':>5s} {'MdAPE':>7s} {'±15%':>6s}")
    for how, name in (("S0", "S0 실거래 신고값"), ("S1", "S1 지금 화면(대장)"),
                      ("S2", "S2 지번 · 필지"), ("S3", "S3 지번 · 딸린 필지")):
        data = [(gu, sales, [subj(t, how) for t in common(ts)], tj) for gu, sales, ts, tj in hold]
        r = H.run(data, **H.PROD)
        print(f"{name:22s} {r['n']:5d} {r['MdAPE']:6.2f}% {r['hit15']:5.1f}%")
    # 여러 동 지번만 따로 — 지번으로 바꿀 때 값이 바뀌는 곳
    multi = [(gu, sales, [t for t in common(ts) if ex[pnu_of[t["building_pk"]]]["p_ta"] != ex[pnu_of[t["building_pk"]]]["b_ta"]], tj)
             for gu, sales, ts, tj in hold]
    print(f"\n여러 동 지번만 ({sum(len(t) for _, _, t, _ in multi)}건)")
    for how, name in (("S1", "S1 지금 화면(대장)"), ("S2", "S2 지번 · 필지"), ("S3", "S3 지번 · 딸린 필지")):
        data = [(gu, sales, [subj(t, how) for t in ts], tj) for gu, sales, ts, tj in multi]
        r = H.run(data, **H.PROD)
        if r:
            print(f"{name:22s} {r['n']:5d} {r['MdAPE']:6.2f}% {r['hit15']:5.1f}%")


if __name__ == "__main__":
    main()


def coverage():
    """안마다 혼자서 값을 낼 수 있는 거래 수 · 그 거래로 잰 오차(겹치지 않는 표본)"""
    hold = H.load_set(H.HOLD, "202501")
    pks = sorted({t["building_pk"] for _, _, ts, _ in hold for t in ts})

    async def pmap():
        cc = await asyncpg.connect(B.DSN)
        r = await cc.fetch("SELECT rep_pk, pnu FROM master.parcel_rep WHERE rep_pk = ANY($1::text[])", pks)
        await cc.close()
        return {x["rep_pk"]: x["pnu"] for x in r}
    pnu_of = asyncio.run(pmap())
    ex = asyncio.run(extra(sorted(set(pnu_of.values()))))
    tot = sum(len(ts) for _, _, ts, _ in hold)
    print(f"\n검증 거래 {tot}건 중 혼자 낼 수 있는 것")
    for how, name, f in (("S1", "S1 지금 화면(대장)", lambda e: (e["b_ta"], e["b_la"], e["b_g"])),
                         ("S2", "S2 지번 · 필지", lambda e: (e["p_ta"], e["p_la"], e["p_g"])),
                         ("S3", "S3 지번 · 딸린 필지", lambda e: (e["p_ta"], e["s_la"], (e["s_gt"] / e["s_la"]) if (e["s_gt"] and e["s_la"]) else None))):
        data = []
        for gu, sales, ts, tj in hold:
            out = []
            for t in ts:
                e = ex.get(pnu_of.get(t["building_pk"]))
                if not e:
                    continue
                ta, la, g = f(e)
                if ta and la and g:
                    out.append({**t, "total_area": ta, "land_area": la, "gongsi_latest": g})
            data.append((gu, sales, out, tj))
        r = H.run(data, **H.PROD)
        print(f"{name:22s} 대상 {sum(len(o) for _, _, o, _ in data):4d} · 값 {r['n']:4d} · MdAPE {r['MdAPE']:6.2f}% · ±15% {r['hit15']:5.1f}%")


if __name__ == "__main__":
    coverage()
