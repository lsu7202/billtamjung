"""광고 보기 · 크롤링 매물 — S05(2026-09-28).

광고 카드는 **누구나** 본다(any_user). 크롤링 매물은 **중개사만**(current_user) — 광고가 아니라 참고 자료다.
광고를 올리고 고치는 폼은 2묶음이다. 여기선 읽기만.
"""
import mimetypes

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from ..core.db import pool
from ..core.deps import current_user, any_user, CurrentUser
from ..core import storage

router = APIRouter(tags=["ads"])

# 고객에게 보이는 광고 = 노출(기한 안) · 거래완료. 비노출 · 삭제 · 지난 광고는 올린 팀만 매물관리에서 본다.
_VISIBLE = "(a.state = '거래완료' OR (a.state = '노출' AND a.expires_on >= current_date))"


@router.get("/buildings/{building_pk}/ads")
async def building_ads(building_pk: str, user: CurrentUser = Depends(any_user)):
    """사이드 판 광고 카드 — 노출 중이 위, 거래완료는 아래(회색). 가격 비공개면 price 는 null."""
    rows = await pool().fetch(
        f"""SELECT a.id, a.state, a.brokerage, a.price_open,
                   CASE WHEN a.price_open THEN a.price END AS price,
                   a.land_area::float, a.total_area::float, a.floors_above, a.floors_below,
                   a.violation, a.title, a.posted_on, a.closed_on, a.address_open,
                   COALESCE(a.contact_phone, t.phone) AS phone,
                   ac.name AS agent_name, COALESCE(t.office_name, t.name) AS office_name, t.reg_no,
                   (a.team_id = $2) AS mine,
                   (SELECT ap.photo_id FROM app.ad_photos ap WHERE ap.ad_id = a.id
                     ORDER BY ap.sort, ap.photo_id LIMIT 1) AS photo_id
              FROM app.ads a
              JOIN app.teams t ON t.id = a.team_id
              LEFT JOIN app.accounts ac ON ac.id = COALESCE(a.contact_account_id, a.created_by)
             WHERE a.building_pk = $1 AND {_VISIBLE}
             ORDER BY (a.state = '노출') DESC, a.posted_on DESC, a.id DESC""",
        building_pk, user.team_id)
    return [dict(r) for r in rows]


@router.get("/ads/{ad_id}/photos/{photo_id}")
async def ad_photo(ad_id: int, photo_id: int, _: CurrentUser = Depends(any_user)):
    """광고에 고른 사진만 누구나 받는다. 매물 사진 전체(팀 것)는 여전히 팀만."""
    row = await pool().fetchrow(
        f"""SELECT f.file_path FROM app.ad_photos ap
              JOIN app.ads a ON a.id = ap.ad_id
              JOIN app.photos f ON f.id = ap.photo_id AND f.deleted_at IS NULL
             WHERE ap.ad_id = $1 AND ap.photo_id = $2 AND {_VISIBLE}""",
        ad_id, photo_id)
    data = await storage.load(row["file_path"]) if row else None
    if data is None:
        raise HTTPException(404, "사진이 없습니다")
    return Response(content=data, media_type=mimetypes.guess_type(row["file_path"])[0] or "image/jpeg")


@router.get("/buildings/{building_pk}/crawl")
async def building_crawl(building_pk: str, _: CurrentUser = Depends(current_user)):
    """크롤링 매물(중개사만) — 이 건물에 시장에 나온 매매 · 임대 호가. 사라진 것은 뺀다.
    날짜 · 게시자를 모르는 줄(첫 적재분)은 null 그대로 낸다."""
    rows = await pool().fetch(
        """SELECT id, deal, price, deposit, rent, mgmt, floor,
                  contract_area::float, excl_area::float,
                  office_name, agent_name, phone, last_seen
             FROM master.crawl_listing
            WHERE building_pk = $1 AND gone_on IS NULL
            ORDER BY deal, NULLIF(regexp_replace(floor, '\\D', '', 'g'), '')::int NULLS LAST, id""",
        building_pk)
    return [dict(r) for r in rows]
