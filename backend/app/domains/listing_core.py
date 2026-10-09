"""매물 한 곳(0226 · 0255 · specs/04-data/매물-중심.md §5-0).

매물 = app.listings(주인 · 매매가) + 사람 사무소면 app.listing_office(관리 칸, 1:1). 위치는 app.listing_parcels(지번) 뿐.
**부르는 열쇠는 매물 번호(listing_id) 하나다.** 새로 등록할 때만 지번(pnu)으로 찾는다 — 한 사무소 · 한 지번에 매물은
하나라(listing_parcels_team_pnu) (사무소, 지번)으로 그 매물이 정해진다. 건물 번호로 매물을 찾지 않는다.
"""
from fastapi import HTTPException

from ..core.db import pool


async def listing_of_pnu(team_id: int | None, pnu: str, con=None) -> int | None:
    """내 사무소의 그 지번 매물 번호(관리 줄이 있는 사무소 매물). 없으면 None"""
    if team_id is None:
        return None
    return await (con or pool()).fetchval(
        """SELECT l.id FROM app.listings l JOIN app.listing_office o ON o.listing_id = l.id
             JOIN app.listing_parcels lp ON lp.listing_id = l.id
            WHERE l.team_id = $1 AND lp.pnu = $2""", team_id, pnu)


async def need_listing(team_id: int | None, listing_id: int, con=None) -> int:
    """그 매물이 내 사무소 매물인가 — 매물관리 칸 · 사진 · 임대 · 광고를 쓰려면 등록한 내 매물이어야 한다(0226)"""
    ok = await (con or pool()).fetchval(
        "SELECT 1 FROM app.listings l JOIN app.listing_office o ON o.listing_id = l.id WHERE l.id = $1 AND l.team_id = $2",
        listing_id, team_id) if team_id is not None else None
    if not ok:
        raise HTTPException(404, "우리 사무소 매물이 아닙니다 — 매물 등록부터 하세요")
    return listing_id


async def create_office_listing(team_id: int, pnu: str, con=None) -> int:
    """매물 등록 — 매물 + 지번 + 관리 줄. 이미 있으면 그 번호(다시 받으면 같은 매물을 다시 연다).
    다른 건물에 딸린 필지(부속 지번)면 그 건물의 지번으로 등록한다 — 지도 클릭과 같은 규칙(app.main_pnu · 0259).
    안 그러면 주소도 없고 검색에도 안 서는 매물이 생긴다."""
    c = con or pool()
    if not await c.fetchval("SELECT 1 FROM master.parcels WHERE pnu = $1", pnu):
        raise HTTPException(404, "그런 지번이 없습니다")
    pnu = await c.fetchval("SELECT app.main_pnu($1)", pnu)
    lid = await listing_of_pnu(team_id, pnu, c)
    if lid is None:
        lid = await c.fetchval("INSERT INTO app.listings(team_id) VALUES ($1) RETURNING id", team_id)
        await c.execute("INSERT INTO app.listing_parcels(listing_id, pnu, main) VALUES ($1, $2, true)", lid, pnu)
    await c.execute("INSERT INTO app.listing_office(listing_id) VALUES ($1) ON CONFLICT DO NOTHING", lid)
    return lid


async def listing_pnu(listing_id: int, con=None) -> str | None:
    """매물의 대표 지번"""
    return await (con or pool()).fetchval(
        "SELECT pnu FROM app.listing_parcels WHERE listing_id = $1 AND main", listing_id)
