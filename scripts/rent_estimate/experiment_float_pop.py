"""F-16 매력도의 float_pop 축을 바꿔 보고 실거래로 재는 실험(2026-08-26).

물음 셋:
  ① 지금 float_pop 은 (도로접면 + 역거리) ÷ 2 인데, 그 둘이 이미 각각 15.3점씩 별도 축이다.
     같은 정보를 두 번 세는 것 아닌가?
  ② 서울 생활인구 실측을 넣으면 나아지나?
  ③ 주야 비율(낮 인구 ÷ 밤 인구)은?

잣대 = **실거래 평당가**. 매력도가 「값이 나가는 자리냐」를 말하는 값이니,
매력도가 높은 건물이 실제로 비싸게 팔려야 쓸모가 있다.
스피어만(순위상관) — 값의 자릿수가 아니라 순서가 맞는지를 본다.

    data/.venv/bin/python scripts/rent_estimate/experiment_float_pop.py [--since 202101]
"""
import os
import sys
import argparse
import asyncio
import statistics

import asyncpg

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
from app.jobs import value_score as vs   # noqa: E402

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")
SECT = ('상업용', '업무용', '상업기타', '주상용', '주상기타')

SQL = """
SELECT b.building_pk, b.road_frontage, b.station_dist, b.use_zone, b.shape, b.slope,
       b.elevator, b.approval_ymd, b.remodel_ymd, b.total_area,
       p.day_avg, p.night_avg, l.dong_code,
       dp.work, dp.resid, ds.sales, b.gongsi_latest,
       sh.price
  FROM master.buildings b
  JOIN master.building_pop p USING (building_pk)
  JOIN master.living_pop l ON l.grid = p.grid
  LEFT JOIN tmp_dong_pop dp ON dp.dong = l.dong_code
  LEFT JOIN tmp_dong_sales ds ON ds.dong = l.dong_code
  JOIN LATERAL (SELECT price, contract_ym FROM master.sales_history s
                 WHERE s.building_pk = b.building_pk AND s.contract_ym >= $1
                 ORDER BY contract_ym DESC LIMIT 1) sh ON TRUE
 WHERE b.land_use = ANY($2) AND b.total_area > 0
   AND p.day_avg IS NOT NULL AND p.night_avg > 0
"""

# 주야 비율 컷 — 상업용 건물 분위수(p20/p40/p60/p80)
RATIO_CUTS = [(1.92, 100), (1.22, 78), (0.97, 50), (0.84, 22)]
# 행정동 직장/상주 · 매출/상주 분위수 컷(p80/p60/p40/p20)
WR_CUTS = [0.470, 0.154, 0.079, 0.042]
SR_CUTS = [3438609, 2062033, 1339872, 830830]


def q_score(v: float | None, cuts: list[float]) -> int:
    """분위수 컷(내림차순 4개) → 100/78/50/22/6"""
    if v is None:
        return 6
    for c, sc in zip(cuts, (100, 78, 50, 22)):
        if v >= c:
            return sc
    return 6


def ratio_score(r: float) -> int:
    for cut, sc in RATIO_CUTS:
        if r >= cut:
            return sc
    return 6


def spearman(xs: list[float], ys: list[float]) -> float:
    def rank(v: list[float]) -> list[float]:
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r
    rx, ry = rank(xs), rank(ys)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return num / den if den else 0.0


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="202101")
    a = ap.parse_args()

    conn = await asyncpg.connect(DSN)
    params = {r["param_key"]: float(r["value_num"]) for r in await conn.fetch(
        "SELECT param_key, value_num FROM ref.formula_params WHERE value_num IS NOT NULL")}
    rows = await conn.fetch(SQL, a.since, list(SECT))
    await conn.close()

    W = {k[len("weight."):]: v for k, v in params.items() if k.startswith("weight.")}
    price, variants = [], {k: [] for k in
        ("현행", "float_pop 뺌", "실측 주간인구", "주야 비율(격자)", "주야 비율(행정동)",
         "직장/상주", "매출/상주")}

    # 행정동 평균 주야비율 — 250m 격자는 칸이 작아 그날그날 흔들린다.
    # 동으로 뭉치면 잡음이 빠지고 「이 동네가 업무지냐 주거지냐」만 남는다(실측 0.411 → 0.456).
    dong: dict[str, list[float]] = {}
    for r in rows:
        dong.setdefault(r["dong_code"], []).append(float(r["day_avg"]) / float(r["night_avg"]))
    dong_avg = {k: sum(v) / len(v) for k, v in dong.items()}

    for r in rows:
        d = dict(r)
        # value_score 가 기대하는 파생 칸
        if d.get("approval_ymd"):
            d["age_years"] = 2026 - int(str(d["approval_ymd"])[:4])
        if d.get("remodel_ymd"):
            d["remodel_years"] = 2026 - int(str(d["remodel_ymd"])[:4])
        base = vs.item_scores(d)                      # float_pop = 지금의 proxy

        def total(scores: dict, skip: str | None = None) -> float:
            return sum(v * W.get(k, 0) / 100.0 for k, v in scores.items() if k != skip)

        ratio = float(d["day_avg"]) / float(d["night_avg"])
        pop_lbl = vs.FLOAT_POP_SCORES  # 등급표 재사용
        # 실측 주간인구 → 등급(상업용 분위수 컷)
        dv = float(d["day_avg"])
        pop_sc = 100 if dv >= 2657 else 78 if dv >= 1792 else 50 if dv >= 1215 else 22 if dv >= 596 else 6
        assert pop_lbl                                 # 표가 비면 컷이 뜻을 잃는다

        variants["현행"].append(total(base))
        variants["float_pop 뺌"].append(total(base, skip="float_pop"))
        variants["실측 주간인구"].append(total({**base, "float_pop": pop_sc}))
        variants["주야 비율(격자)"].append(total({**base, "float_pop": ratio_score(ratio)}))
        variants["주야 비율(행정동)"].append(
            total({**base, "float_pop": ratio_score(dong_avg.get(d["dong_code"], ratio))}))
        wr = (float(d["work"]) / float(d["resid"])) if (d["work"] and d["resid"]) else None
        sr = (float(d["sales"]) / float(d["resid"])) if (d["sales"] and d["resid"]) else None
        variants["직장/상주"].append(total({**base, "float_pop": q_score(wr, WR_CUTS)}))
        variants["매출/상주"].append(total({**base, "float_pop": q_score(sr, SR_CUTS)}))
        price.append(float(d["price"]) / (float(d["total_area"]) / 3.305785))

    # ── 가중치 쓸기 — float_pop(=유동인구) 축에 몇 점을 줄 때 가장 잘 맞나.
    # 나머지 여덟 축은 지금 비율 그대로 (100 - w) 안에서 다시 나눈다.
    rest = {k: v for k, v in W.items() if k != "float_pop"}
    rest_sum = sum(rest.values())
    sweep = {}
    for w in (0, 10, 15, 20, 25, 30, 40, 50, 60, 70, 85, 100):
        tw = {k: v / rest_sum * (100 - w) for k, v in rest.items()}
        tw["float_pop"] = w
        vals = []
        for r in rows:
            d = dict(r)
            if d.get("approval_ymd"):
                d["age_years"] = 2026 - int(str(d["approval_ymd"])[:4])
            if d.get("remodel_ymd"):
                d["remodel_years"] = 2026 - int(str(d["remodel_ymd"])[:4])
            sc = vs.item_scores(d)
            sc["float_pop"] = ratio_score(float(d["day_avg"]) / float(d["night_avg"]))
            vals.append(sum(v * tw.get(k, 0) / 100.0 for k, v in sc.items()))
        sweep[w] = spearman(vals, price)

    print(f"표본 {len(price):,}동 · {a.since}~ 실거래 · 잣대=연면적 평당가\n")
    print(f"{'변형':<16}{'스피어만':>10}   {'현행 대비':>10}")
    base_s = spearman(variants["현행"], price)
    for k, v in variants.items():
        s = spearman(v, price)
        gap = "" if k == "현행" else f"{s - base_s:+.3f}"
        print(f"{k:<16}{s:>10.3f}   {gap:>10}")
    # ── 축별 단독 설명력 — 어느 축이 실제로 값을 가리키나
    per: dict[str, list[float]] = {}
    for r in rows:
        d = dict(r)
        if d.get("approval_ymd"):
            d["age_years"] = 2026 - int(str(d["approval_ymd"])[:4])
        if d.get("remodel_ymd"):
            d["remodel_years"] = 2026 - int(str(d["remodel_ymd"])[:4])
        sc = vs.item_scores(d)
        sc["float_pop(주야비율)"] = ratio_score(float(d["day_avg"]) / float(d["night_avg"]))
        for k, v in sc.items():
            per.setdefault(k, []).append(v)
    gongsi = [float(r["gongsi_latest"] or 0) for r in rows]
    ok = [i for i, g in enumerate(gongsi) if g > 0]
    print("\n── 축별 단독 설명력 ──")
    print(f"  {'축':<22}{'배점':>6}   {'실거래':>8}{'공시지가':>10}")
    for k, v in sorted(per.items(), key=lambda kv: -abs(spearman(kv[1], price))):
        sg = spearman([v[i] for i in ok], [gongsi[i] for i in ok])
        print(f"  {k:<22}{W.get(k, 15):>6.2f}   {spearman(v, price):+8.3f}{sg:+10.3f}")

    print(f"\n── 유동인구 축을 주야 비율로 갈았을 때, 그 축 가중치별 ──")
    for w, s in sweep.items():
        print(f"  {w:>2}점   {s:.3f}" + ("   ← 지금 배점" if w == 15 else ""))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
