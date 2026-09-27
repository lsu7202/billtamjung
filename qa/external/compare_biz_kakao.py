#!/usr/bin/env python3
"""입주 업종 검색 전환 대조 — 카카오 키워드 검색 vs 우리 업체 표(master.biz). 스펙 11 §10 · 손으로만 돌린다.

    backend/.venv/bin/python qa/external/compare_biz_kakao.py

세 동네 × 다섯 낱말로, **카카오가 짚은 건물 가운데 우리 DB 로도 찾은 비율**을 잰다. 기준 95%.
건물 붙이기는 검색과 같다 — 카카오 지번 → 필지번호 → 그 필지 건물 전부. 우리 쪽은 상호명 부분일치 또는
업종 마디(biz.cat_nodes). 「우리만」은 카카오 45건 상한에 잘렸거나 이름·업종으로만 걸린 것이다.

앱은 카카오 로컬 API 를 더 안 쓴다(2026-09-27). 이 대조에만 키워드 검색을 따로 둔다 — 45건을 넘는
사각형은 넷으로 쪼개 전부 받는다(앱이 쓰던 타일과 같다). 더 못 쪼개고 잘린 낱말은 「잘림」으로 표시한다.
열쇠는 BT_KAKAO_CLIENT_ID(로그인 앱 키와 같은 값).
"""
import asyncio
import os
import sys

import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "backend"))

REGIONS = ["강남구 역삼동", "마포구 서교동", "종로구 종로1가"]
WORDS = ["피부과", "병원", "카페", "스타벅스", "학원"]


async def kakao(q: str, rect: tuple[float, float, float, float], key: str,
                c: httpx.AsyncClient, depth: int = 0) -> tuple[list[dict], bool]:
    """사각형 안 전부. 카카오는 한 질의에 45건(15 × 3쪽)까지만 주므로, 넘는 칸은 넷으로 쪼갠다
    (앱이 쓰던 core/kakao 의 타일과 같다). 더 못 쪼개고도 넘으면 잘림으로 알린다."""
    x1, y1, x2, y2 = rect
    out: list[dict] = []
    for page in (1, 2, 3):
        r = await c.get("https://dapi.kakao.com/v2/local/search/keyword.json",
                        params={"query": q, "rect": f"{x1},{y1},{x2},{y2}", "page": page, "size": 15},
                        headers={"Authorization": f"KakaoAK {key}"})
        r.raise_for_status()
        d = r.json()
        total = d.get("meta", {}).get("total_count", 0)
        if page == 1 and total > 45 and depth < 6:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            got, cut = {}, False
            for sub in ((x1, y1, mx, my), (mx, y1, x2, my), (x1, my, mx, y2), (mx, my, x2, y2)):
                docs, c2 = await kakao(q, sub, key, c, depth + 1)
                got.update({x["id"]: x for x in docs}); cut = cut or c2
            return list(got.values()), cut
        out += d.get("documents") or []
        if d.get("meta", {}).get("is_end", True):
            break
    return out, depth >= 6 and len(out) >= 45


async def main() -> None:
    from app.core import db
    from app.core.config import settings
    from app.domains import search as S
    from app.domains.tenants import norm_name
    key = os.environ.get("BT_KAKAO_CLIENT_ID") or settings.kakao_client_id
    if not key:
        sys.exit("카카오 열쇠가 없다(BT_KAKAO_CLIENT_ID)")
    await db.connect()
    P = db.pool()
    await S.load_guards()
    tot_k = tot_hit = 0
    for region in REGIONS:
        code = S.resolve_region(region)[0]
        e = await P.fetchrow("SELECT ST_XMin(x) x1, ST_YMin(x) y1, ST_XMax(x) x2, ST_YMax(x) y2 FROM "
                             "(SELECT ST_Extent(geom) x FROM master.buildings WHERE bjd_code LIKE $1) s", code + "%")
        rect = (e["x1"], e["y1"], e["x2"], e["y2"])
        for w in WORDS:
            async with httpx.AsyncClient(timeout=10) as c:
                docs, cut = await kakao(w, rect, key, c)
            pnus = [p for p in (S._pnu_of(d.get("address_name")) for d in docs) if p]
            k = {r["building_pk"] for r in await P.fetch("""
                SELECT x.building_pk FROM unnest($1::text[]) k(pnu)
                JOIN LATERAL (SELECT b.building_pk FROM master.buildings b WHERE b.pnu = k.pnu
                              UNION SELECT p.building_pk FROM master.parcels p
                               WHERE p.pnu = k.pnu AND p.building_pk IS NOT NULL) x ON TRUE
                JOIN master.buildings bb ON bb.building_pk = x.building_pk
                WHERE bb.bjd_code LIKE $2""", pnus, code + "%")}
            d = {r["pk"] for r in await P.fetch("""
                SELECT DISTINCT b.pk FROM master.biz z CROSS JOIN LATERAL unnest(z.building_pks) b(pk)
                  JOIN master.buildings bb ON bb.building_pk = b.pk
                 WHERE bb.bjd_code LIKE $2 AND z.gone_on IS NULL
                   AND (z.name_norm LIKE '%' || $1 || '%' OR z.cat_nodes @> ARRAY[$3::text])""",
                norm_name(w), code + "%", w)}
            hit = len(k & d)
            tot_k += len(k); tot_hit += hit
            print(f"{region} {w:5} 카카오 건물 {len(k):4} · 우리도 {hit:4} ({100 * hit / max(len(k), 1):5.1f}%)"
                  f" · 우리만 {len(d - k):4}{' · 잘림' if cut else ''}")
    rate = 100 * tot_hit / max(tot_k, 1)
    print(f"합계 {tot_hit}/{tot_k} = {rate:.1f}% · 기준 95% {'통과' if rate >= 95 else '미달'}")
    await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
