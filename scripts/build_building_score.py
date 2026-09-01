#!/usr/bin/env python3
"""매력도(F-16) · 활용유형(F-20) · 매도가능성을 배치로 산출 → master.building_score.

왜:
  이 값들은 지금 리포트를 만들 때만 계산된다(30크레딧). 순수 계산 함수라 미리 돌려두면
  검색·영업·오늘 화면 어디서나 쓸 수 있다. 리포트 안에 갇혀 있던 것을 꺼낸다.

매도 가능성(propensity to sell) — Reonomy 벤치마크를 우리 데이터로.
  부채 정보는 없으므로 다섯 축만 쓴다. **예측이 아니라 "이런 신호가 있다"** 로 표기한다.
  검증은 실제 거래가 쌓여야 가능하므로(몇 달), 그때까지 축을 펴서 보여준다.

사옥 적합도(office_fit)는 상권 프로필(반경 300m 층별용도)이 필요해 배치에서 뺐다 —
560,016동 × 공간조인은 과하고, 대표유형 판정에는 안 쓰인다. 리포트에서만 낸다.

사용:
  BT_DATABASE_URL=... backend/.venv/bin/python scripts/build_building_score.py [--limit N]
"""
import argparse
import asyncio
import datetime as dt
import json
import os
import re
import sys

import asyncpg

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
from app.jobs import use_type, value_score  # noqa: E402

DSN = os.environ.get("BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
P = 3.305785
CHUNK = 20_000


def _legal_far(v) -> float | None:
    """'800%' · '1,000% (도심 800%)' → 800.0. generate_report._legal_far와 같은 규칙."""
    if v is None:
        return None
    m = re.search(r"[\d,.]+", str(v))
    return float(m.group().replace(",", "")) if m else None


def _years(d: dt.date | None, today: dt.date) -> float | None:
    return round((today - d).days / 365.25, 1) if d else None


# ── 매도 가능성 ────────────────────────────────────────────
# 가중치 합 = 100. 근거 없이 정밀한 척하지 않으려고 축마다 상한을 크게 잡고 단순 선형으로 둔다.
W_HOLD, W_AGE, W_GONGSI, W_HEADROOM, W_REDEVEL = 30, 25, 20, 15, 10


def _sell(row, today: dt.date) -> tuple[float, dict]:
    axes: dict = {}
    pt = 0.0

    # 보유 기간 — 마지막 거래 이후. 오래 들고 있을수록 차익 실현 시점에 가까워진다.
    # 거래 이력이 없으면(대다수) '20년 이상 보유'로 보지 않는다 — 모르는 것을 신호로 쓰면 안 된다.
    hold = None
    if row["last_sale_ym"]:
        y, m = int(str(row["last_sale_ym"])[:4]), int(str(row["last_sale_ym"])[4:6] or 1)
        hold = round((today - dt.date(y, m, 1)).days / 365.25, 1)
        p = min(hold / 20.0, 1.0) * W_HOLD          # 20년이면 만점
        pt += p
        axes["hold"] = {"years": hold, "pt": round(p)}
    else:
        axes["hold"] = {"years": None, "pt": 0, "note": "거래 이력 없음"}

    age = _years(row["approval_ymd"], today)
    if age is not None:
        p = min(max(age - 10, 0) / 40.0, 1.0) * W_AGE   # 10년부터 오르고 50년이면 만점
        pt += p
        axes["age"] = {"years": age, "pt": round(p)}

    up5 = row["gongsi_up5"]
    if up5 is not None:
        p = min(max(float(up5), 0) / 50.0, 1.0) * W_GONGSI   # 5년 +50%면 만점
        pt += p
        axes["gongsi_up5"] = {"pct": round(float(up5), 1), "pt": round(p)}

    far, lfar = row["far"], _legal_far(row["legal_far"])
    if far is not None and lfar:
        slack = max(float(lfar) - float(far), 0)
        p = min(slack / 200.0, 1.0) * W_HEADROOM        # 여유 200%p면 만점
        pt += p
        axes["headroom"] = {"pp": round(slack), "pt": round(p)}

    if row["redevel"]:
        pt += W_REDEVEL
        axes["redevel"] = {"zone": row["redevel"], "pt": W_REDEVEL}

    return round(pt, 1), axes


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="일부만(개발용)")
    args = ap.parse_args()

    today = dt.date.today()
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=1800)
    try:
        params = {r["param_key"]: float(r["value_num"]) for r in await c.fetch(
            "SELECT param_key, value_num FROM ref.formula_params WHERE value_num IS NOT NULL")}

        total = await c.fetchval("SELECT count(*) FROM master.buildings")
        print(f"대상 {total:,}동 · 청크 {CHUNK:,}", flush=True)

        done = 0
        last_pk = ""
        while True:
            rows = await c.fetch(
                f"""SELECT b.building_pk, b.road_frontage, b.station_dist, b.use_zone, b.shape, b.slope,
                           b.elevator, b.approval_ymd, b.remodel_ymd, b.land_use, b.floors_above,
                           b.land_area,
                           -- 활용 유형·매력도는 **분석값**이라 계산 용적률을 얹는다(0144).
                           -- 화면·서류로 나가는 대장값(master.buildings.far)과는 다른 길이다.
                           COALESCE(b.far, bcx.far_calc) AS far,
                           (SELECT max(pr.legal_far) FROM master.building_parcels bp
                              JOIN master.parcels pr ON pr.pnu = bp.pnu
                             WHERE bp.building_pk = b.building_pk) AS legal_far,
                           sa.p_last_ym AS last_sale_ym,
                           CASE WHEN g5.price > 0
                                THEN (b.gongsi_latest - g5.price) / g5.price::numeric * 100 END AS gongsi_up5,
                           rd.name AS redevel
                    FROM master.buildings b
                    LEFT JOIN master.building_calc bcx ON bcx.building_pk = b.building_pk
                    LEFT JOIN LATERAL (SELECT max(contract_ym) AS p_last_ym
                                         FROM master.sales_history sh
                                        WHERE sh.building_pk = b.building_pk) sa ON TRUE
                    LEFT JOIN master.gongsi_series g5
                           ON g5.pnu = b.pnu AND g5.year = EXTRACT(YEAR FROM CURRENT_DATE)::int - 5
                    -- 한 건물이 정비구역 여러 건에 걸릴 수 있다 → 하나만(행 증식 방지)
                    LEFT JOIN LATERAL (SELECT r.name FROM master.building_redevel r
                                        WHERE r.building_pk = b.building_pk LIMIT 1) rd ON TRUE
                    WHERE b.building_pk > $1
                    ORDER BY b.building_pk
                    LIMIT {CHUNK}""", last_pk)
            if not rows:
                break
            last_pk = rows[-1]["building_pk"]

            out = []
            for r in rows:
                d = dict(r)
                d["age_years"] = _years(d["approval_ymd"], today)
                d["remodel_years"] = _years(d["remodel_ymd"], today)

                vs = value_score.compute(d, params)
                items = vs["items"]
                lfar = _legal_far(d["legal_far"])
                la_py = (float(d["land_area"]) / P) if d["land_area"] else None
                ut = use_type.classify({
                    "far": float(d["far"]) if d["far"] is not None else None,
                    "legal_far": lfar, "land_use": d["land_use"],
                    "floors_above": d["floors_above"], "age_years": d["age_years"],
                    "remodel_years": d["remodel_years"], "land_area_py": la_py,
                    "shape": d["shape"], "road_frontage": d["road_frontage"],
                    "road_score": items.get("road_access", 0),
                    "station_score": items.get("station_dist", 0),
                    "use_zone": d["use_zone"], "market": {},   # 상권 프로필은 리포트에서만
                })
                sell, axes = _sell(d, today)
                out.append((d["building_pk"], vs["score"], vs["grade"], json.dumps(items),
                            ut.get("primary"), json.dumps(ut.get("scores")),
                            ut.get("util"), sell, json.dumps(axes, ensure_ascii=False)))

            async with c.transaction():
                await c.execute("""CREATE TEMP TABLE _s(
                        building_pk text, score numeric, grade text, items jsonb,
                        use_type text, use_scores jsonb, util_ratio numeric,
                        sell_score numeric, sell_axes jsonb) ON COMMIT DROP""")
                await c.copy_records_to_table("_s", records=out)
                await c.execute("""
                    INSERT INTO master.building_score
                      (building_pk, score, grade, items, use_type, use_scores, util_ratio, sell_score, sell_axes, updated)
                    SELECT building_pk, score, grade, items, use_type, use_scores, util_ratio,
                           sell_score, sell_axes, now() FROM _s
                    ON CONFLICT (building_pk) DO UPDATE SET
                      score=EXCLUDED.score, grade=EXCLUDED.grade, items=EXCLUDED.items,
                      use_type=EXCLUDED.use_type, use_scores=EXCLUDED.use_scores,
                      util_ratio=EXCLUDED.util_ratio, sell_score=EXCLUDED.sell_score,
                      sell_axes=EXCLUDED.sell_axes, updated=now()""")

            done += len(rows)
            print(f"  {done:,} / {total:,}", flush=True)
            if args.limit and done >= args.limit:
                break

        print(await c.fetchval(
            """SELECT '완료 '||count(*)||'동 · 매력도 '||count(score)||' · 활용유형 '||count(use_type)
                      ||' · 매도가능성 '||count(sell_score) FROM master.building_score"""), flush=True)
    finally:
        await c.close()


asyncio.run(main())
