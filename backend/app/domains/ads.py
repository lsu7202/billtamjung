"""광고 보기 · 크롤링 매물 — S05(2026-09-28).

광고 카드는 **누구나** 본다(any_user). 크롤링 매물은 **중개사만**(current_user) — 광고가 아니라 참고 자료다.
광고를 올리고 고치는 폼은 2묶음이다. 여기선 읽기만.
"""
import datetime as dt
import mimetypes

import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from ..core.db import pool
from ..core.deps import current_user, any_user, CurrentUser, viewer
from .mirror import listing_values_write
from ..core import storage

router = APIRouter(tags=["ads"])

# 고객에게 보이는 광고 = 노출(기한 안) · 거래완료. 비노출 · 삭제 · 지난 광고는 올린 팀만 매물관리에서 본다.
_VISIBLE = "(a.state = '거래완료' OR (a.state = '노출' AND a.expires_on >= current_date))"
# 광고는 매물의 노출 기록이다(0226). 매매가 · 유형 · 중개유형 · 기본정보는 매물(listings · listing_office)에서 읽는다


@router.get("/parcels/{pnu}/ads")
async def parcel_ads(pnu: str, user: CurrentUser = Depends(viewer)):
    """사이드 판 광고 카드 — 그 지번 매물들의 광고(나대지 포함). 노출 중이 위, 거래완료는 아래(회색). 가격 비공개면 price 는 null."""
    rows = await pool().fetch(
        f"""SELECT a.id, a.state, a.listing_id,   -- 판은 고른 매물의 광고를 집는다(매물 번호 · 10-08)
                   -- 매물 유형 · 중개 · 기본정보는 매물 줄이 정본(0209). 광고 칸은 매물이 비었을 때만
                   CASE WHEN l.exclusive THEN '전속' WHEN l.exclusive IS FALSE THEN '일반' END AS brokerage,
                   a.price_open,
                   CASE WHEN a.price_open THEN l.price END AS price,
                   l.building_major AS use_type, a.title, a.body, a.posted_on, a.closed_on,
                   COALESCE(a.contact_phone, t.phone) AS phone,
                   ac.name AS agent_name, NULLIF(ac.job_title, '') AS agent_title,
                   CASE WHEN ac.photo_path IS NOT NULL THEN '/api/auth/photo/' || ac.id || '?v=' || left(split_part(split_part(ac.photo_path, '_', 2), '.', 1), 8) END AS agent_photo,
                   COALESCE(t.office_name, t.name) AS office_name, t.reg_no,
                   -- 중개 등록정보 카드(디스코식) — 소재지 · 대표 · 대표연락처 · 올린 시각
                   t.office_addr, t.agent_name AS rep_name, t.phone AS office_phone, a.created_at,
                   (l.team_id = $2) AS mine,
                   (SELECT ap.photo_id FROM app.ad_photos ap WHERE ap.ad_id = a.id
                     ORDER BY ap.sort, ap.photo_id LIMIT 1) AS photo_id,
                   -- 사이드바에 광고 전체가 바로 선다(대표 09-28) — 사진 전부 · 주소 · 수정일
                   (SELECT array_agg(ap.photo_id ORDER BY ap.sort, ap.photo_id) FROM app.ad_photos ap
                     WHERE ap.ad_id = a.id) AS photo_ids,
                   (SELECT COALESCE(b.addr, v.addr) FROM (SELECT 1) x
                      LEFT JOIN master.parcel_rep r ON r.pnu = lp.pnu LEFT JOIN master.buildings b ON b.building_pk = r.rep_pk
                      LEFT JOIN master.vacant_parcels v ON v.pnu = lp.pnu) AS addr,
                   a.updated_at::date AS updated_on,
                   -- 기본정보(0196) — 대장에 없는, 광고한 중개사만 아는 값. 융자금 「표시 안 함」이면 null
                   l.total_deposit AS deposit, l.total_rent AS monthly_rent,
                   CASE WHEN COALESCE(l.loan_open, true) THEN l.loan END AS loan, COALESCE(l.loan_open, true) AS loan_open,
                   l.move_in, l.move_in_on
              FROM app.ads a
              JOIN app.office_listings l ON l.id = a.listing_id
              JOIN app.listing_parcels lp ON lp.listing_id = l.id AND lp.main
              JOIN app.teams t ON t.id = l.team_id
              LEFT JOIN app.accounts ac ON ac.id = COALESCE(a.contact_account_id, a.created_by)
             WHERE lp.pnu = $1 AND {_VISIBLE}
             ORDER BY (a.state = '노출') DESC, a.posted_on DESC, a.id DESC""",
        pnu, user.team_id)
    return [dict(r) for r in rows]


@router.get("/ads/{ad_id}/photos/{photo_id}")
async def ad_photo(ad_id: int, photo_id: int, _: CurrentUser = Depends(viewer)):
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


# 매매시세 · 임대시세(건물별)는 GET /parcels/{pnu}/market 으로 옮겼다(10-08 · 지번 열쇠)


class CardsIn(BaseModel):
    ids: list[int]          # 매물 번호(핀 /search/pins 의 listing_id) — 카드 한 장 = 매물 하나(0226)


@router.post("/ads/cards")
async def ad_cards(body: CardsIn, user: CurrentUser = Depends(viewer)):
    """탐색 · 매물 찾기 목록 카드 — **매물 하나에 한 장**(0226). 어떤 매물을 낼지는 핀이 이미 골랐다(필터 · 범위).
    볼 수 있는지는 app.listings_now 가 다시 가린다(번호만 들고 와서 남의 매물을 보는 길을 막는다).
      내 매물    담당 · 사무소 · 상태 · 접수일 · 사진(팀) · 광고가 있으면 광고 얼굴
      광고 매물  광고 얼굴(제목 · 중개사 · 사진 · 올린 시각) · 가격 공개일 때만 매매가
      수집 매물  수집일 · 광고 수"""
    ids = list(dict.fromkeys(body.ids))[:300]
    if not ids:
        return []
    broker = user.kind == "중개사" and user.team_id is not None
    rows = await pool().fetch(
        """SELECT n.listing_id, n.pnu, n.owner, n.office, n.price, n.rank,
                  -- 땅 · 지번 값(나대지 포함) — 대장 칸은 대표 동, 연면적 · 층수는 지번 동 합 · 최고층
                  COALESCE(b.addr, v.addr) AS addr, COALESCE(b.land_area, v.area)::float AS land_area,
                  r.total_area::float AS total_area, r.floors_above, r.floors_below, b.main_use_name,
                  COALESCE(ST_X(b.geom), ST_X(ST_PointOnSurface(v.geom))) AS lng,
                  COALESCE(ST_Y(b.geom), ST_Y(ST_PointOnSurface(v.geom))) AS lat,
                  lo.building_major AS use_type,
                  a.id AS ad_id, a.title, a.posted_on, a.created_at AS ad_created_at, a.price_open,
                  ac.name AS agent_name, NULLIF(ac.job_title, '') AS agent_title,
                  CASE WHEN ac.photo_path IS NOT NULL THEN '/api/auth/photo/' || ac.id || '?v=' || left(split_part(split_part(ac.photo_path, '_', 2), '.', 1), 8) END AS agent_photo,
                  (SELECT ap.photo_id FROM app.ad_photos ap WHERE ap.ad_id = a.id ORDER BY ap.sort, ap.photo_id LIMIT 1) AS ad_photo_id,
                  (n.owner = 'mine') AS mine,
                  CASE WHEN n.owner = 'mine' THEN am.name END AS assignee_name,
                  CASE WHEN n.owner = 'mine' THEN st.name END AS my_status,
                  CASE WHEN n.owner = 'mine' THEN st.color END AS my_status_color,
                  CASE WHEN n.owner = 'mine' THEN lo.hold_reason END AS my_hold,
                  CASE WHEN n.owner = 'mine' THEN lo.received_on END AS received_on,
                  CASE WHEN n.owner = 'mine' THEN (SELECT f.id FROM app.photos f WHERE f.listing_id = n.listing_id AND f.team_id = $2
                     AND f.deleted_at IS NULL ORDER BY (f.kind = 'exterior') DESC, f.sort_order, f.id LIMIT 1) END AS my_photo_id,
                  lc.seen_on AS mk_on, lc.n_ads AS mk_n
             FROM app.listings_now($2, $3) n
             LEFT JOIN master.parcel_rep r ON r.pnu = n.pnu
             LEFT JOIN master.buildings b ON b.building_pk = r.rep_pk
             LEFT JOIN master.vacant_parcels v ON r.pnu IS NULL AND v.pnu = n.pnu
             LEFT JOIN app.listing_office lo ON lo.listing_id = n.listing_id
             LEFT JOIN app.listing_crawl lc ON lc.listing_id = n.listing_id
             LEFT JOIN app.ads a ON a.id = n.ad_id
             LEFT JOIN app.accounts ac ON ac.id = COALESCE(a.contact_account_id, a.created_by)
             LEFT JOIN app.accounts am ON am.id = lo.assignee_account_id
             LEFT JOIN app.statuses st ON st.id = lo.status_id
            WHERE n.listing_id = ANY($1::bigint[])""",
        ids, user.team_id, broker)
    order = {lid: i for i, lid in enumerate(ids)}
    return sorted((dict(r) for r in rows), key=lambda r: order.get(r["listing_id"], 0))


# ── 광고 올리기 · 고치기(중개사, S05 §3 · 2묶음) ─────────────────────────────
# 광고는 매물 모달의 광고 폼으로만 생긴다(자동으로 켜지지 않는다). 광고는 노출 기록이고, 폼의 값(매매가 · 유형 · 중개유형 ·
# 보증금 · 월세 · 융자 · 입주)은 **매물에 쓴다**(0226) — 광고에 따로 들고 있지 않아 매물과 광고 값이 갈릴 수 없다.
# 소유자를 못 잡은 매물도 올릴 수 있다(대표 09-28). 매물 하나에 살아 있는(노출 · 비노출) 광고는 하나(0191 인덱스).

# 매물유형(0246) — ref.enums building_major 와 같은 아홉 칸
USE_TYPES = ("상업용건물", "상가/사무실", "단독/다가구", "연립/다세대", "오피스텔", "토지", "공장/창고", "숙박시설", "기타건물")
_AD_COLS = "price_open, title, body, contact_phone, state, review, review_note, posted_on, expires_on, closed_on"


async def _listing_of(listing_id: int, team_id: int):
    row = await pool().fetchrow(
        # 계약됐나 = 사람이 「완료」 상태를 골랐나(0199 — 자동 판정 엔진 삭제)
        "SELECT l.id, l.price AS sale_price, l.exclusive, l.building_major, l.assignee_account_id, l.total_deposit, l.total_rent, "
        "l.loan, l.loan_open, l.move_in, l.move_in_on, "
        "(st.name = '완료') AS done "
        "FROM app.office_listings l LEFT JOIN app.statuses st ON st.id = l.status_id "
        "WHERE l.id = $1 AND l.team_id = $2", listing_id, team_id)
    if not row:
        raise HTTPException(404, "매물관리에 담긴 매물이 아닙니다")
    return row


@router.get("/listings/{listing_id}/ad")
async def listing_ad(listing_id: int, user: CurrentUser = Depends(current_user)):
    """광고 탭 — 이 매물의 광고(삭제 뺀 가장 최근 하나)와, 광고 폼을 미리 채울 값."""
    l = await _listing_of(listing_id, user.team_id)
    ad = await pool().fetchrow(
        f"""SELECT id, {_AD_COLS},
                   (state = '노출' AND expires_on < current_date) AS expired,
                   (SELECT array_agg(photo_id ORDER BY sort, photo_id) FROM app.ad_photos WHERE ad_id = a.id) AS photo_ids
              FROM app.ads a WHERE listing_id = $1 AND state <> '삭제'
             ORDER BY (state IN ('노출','비노출')) DESC, (state = '임시') DESC, id DESC LIMIT 1""", l["id"])
    phone = await pool().fetchval("SELECT phone FROM app.accounts WHERE id = $1",
                                  l["assignee_account_id"] or user.account_id)
    # 건물 스펙은 광고에 안 싣는다(0195) — 카드 옆에 대장 값이 그대로 뜬다
    # 유형은 팀이 고른 대분류만(0246) — 안 골랐으면 비운다. 대장으로 채우지 않는다
    draft = {"use_type": l["building_major"], "brokerage": "전속" if l["exclusive"] else "일반",
             "price": l["sale_price"], "price_open": True, "title": "", "body": "", "contact_phone": phone,
             # 현 보증금 · 월세 · 융자금 · 입주가능일은 매물 값(0209) — 광고는 읽기만
             "deposit": l["total_deposit"], "monthly_rent": l["total_rent"], "loan": l["loan"], "loan_open": l["loan_open"],
             "move_in": l["move_in"], "move_in_on": l["move_in_on"]}
    out = dict(ad) if ad else None
    if out:
        # 광고는 노출 칸만 든다 — 매물 값(매매가 · 유형 · 중개유형 · 기본정보)을 얹어 폼이 같은 값을 본다(0226)
        out.update({k: draft[k] for k in ("price", "use_type", "brokerage", "deposit", "monthly_rent", "loan",
                                          "loan_open", "move_in", "move_in_on")})
    return {"ad": out, "draft": draft, "contracted": bool(l["done"])}


class AdIn(BaseModel):
    use_type: str | None = None
    brokerage: str = "일반"
    price: int | None = None
    price_open: bool = True
    title: str | None = None
    body: str | None = None
    contact_phone: str | None = None
    photo_ids: list[int] = []
    deposit: int | None = None
    monthly_rent: int | None = None
    loan: int | None = None
    loan_open: bool = True
    move_in: str | None = None        # 즉시입주 · 협의 · 날짜
    move_in_on: dt.date | None = None
    publish: bool = True          # False = 임시저장(필수 칸을 다 안 채워도 된다 · 고객에게 안 보인다)


def _check_ad(body: AdIn) -> None:
    """올리기 때만 부른다. 임시저장은 유형 · 중개유형 값이 맞는지만 본다."""
    if body.use_type not in USE_TYPES:
        raise HTTPException(422, "매물 유형을 고르세요")
    if body.brokerage not in ("일반", "전속"):
        raise HTTPException(422, "중개유형은 일반 · 전속")
    if not (body.title or "").strip() or not (body.body or "").strip():
        raise HTTPException(422, "제목과 설명을 적으세요")
    if body.price is None or body.price <= 0:
        raise HTTPException(422, "매매가를 적으세요")
    if len(set(body.photo_ids)) < 3:
        raise HTTPException(422, "사진은 3장 이상 고르세요")


async def _set_photos(con, ad_id: int, listing_id: int, team_id: int, ids: list[int], need: int = 3) -> None:
    ok = await con.fetch("SELECT id FROM app.photos WHERE id = ANY($1::bigint[]) AND listing_id = $2 "
                         "AND team_id = $3 AND deleted_at IS NULL", ids, listing_id, team_id)
    have = {r["id"] for r in ok}
    if len(have) < need:
        raise HTTPException(422, "이 매물의 사진을 3장 이상 고르세요")
    await con.execute("DELETE FROM app.ad_photos WHERE ad_id = $1", ad_id)
    await con.executemany("INSERT INTO app.ad_photos(ad_id, photo_id, sort) VALUES($1,$2,$3)",
                          [(ad_id, pid, i) for i, pid in enumerate(dict.fromkeys(ids)) if pid in have])


async def _write_listing_values(con, lid: int, body: AdIn) -> None:
    """광고 폼의 매물 값 → 매물(0226). 매매가는 매물 줄, 나머지는 관리 줄. 매매가 이력은 mirror 가 남긴다(아래)."""
    if body.move_in not in (None, "즉시입주", "협의", "날짜"):
        raise HTTPException(422, "입주가능일은 즉시입주 · 협의 · 날짜")
    on = body.move_in_on if body.move_in == "날짜" else None
    move_in = None if body.move_in == "날짜" and on is None else body.move_in
    await con.execute(
        """UPDATE app.listing_office SET building_major = COALESCE($2, building_major),
                  exclusive = CASE WHEN $3 = '전속' THEN true WHEN $3 = '일반' THEN false ELSE exclusive END,
                  total_deposit = $4, total_rent = $5, loan = $6, loan_open = $7, move_in = $8, move_in_on = $9
            WHERE listing_id = $1""",
        lid, body.use_type, body.brokerage, body.deposit, body.monthly_rent, body.loan, body.loan_open, move_in, on)


def _loose(body: AdIn) -> None:
    if body.use_type is not None and body.use_type not in USE_TYPES:
        raise HTTPException(422, "매물 유형이 이상합니다")
    if body.brokerage not in ("일반", "전속"):
        raise HTTPException(422, "중개유형은 일반 · 전속")


@router.post("/listings/{listing_id}/ad", status_code=201)
async def create_ad(listing_id: int, body: AdIn, user: CurrentUser = Depends(current_user)):
    """새 광고 — publish 면 올리기(노출 · 오늘부터 30일), 아니면 임시저장(매물 하나에 하나, 있으면 덮는다)."""
    _check_ad(body) if body.publish else _loose(body)
    l = await _listing_of(listing_id, user.team_id)
    from ..core.db import tx
    async with tx() as con:
        live = await con.fetchval("SELECT id FROM app.ads WHERE listing_id = $1 AND state IN ('노출','비노출')", l["id"])
        if live:
            raise HTTPException(409, "이미 올린 광고가 있습니다")
        draft = await con.fetchval("SELECT id FROM app.ads WHERE listing_id = $1 AND state = '임시'", l["id"])
        state = "노출" if body.publish else "임시"
        vals = (body.price_open, (body.title or "").strip() or None, (body.body or "").strip() or None, body.contact_phone)
        if draft:
            await con.execute(
                """UPDATE app.ads SET price_open=$2, title=$3, body=$4, contact_phone=$5, state=$6,
                       posted_on=current_date, expires_on=current_date + 30, updated_at=now()
                   WHERE id=$1""", draft, *vals, state)
            aid = draft
        else:
            aid = await con.fetchval(
                """INSERT INTO app.ads(listing_id, price_open, title, body, contact_phone, state, contact_account_id, created_by)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id""",
                l["id"], *vals, state, l["assignee_account_id"] or user.account_id, user.account_id)
        await _write_listing_values(con, l["id"], body)
        await _set_photos(con, aid, listing_id, user.team_id, body.photo_ids, 3 if body.publish else 0)
    if body.price != l["sale_price"]:
        await listing_values_write(user.team_id, listing_id, {"sale_price": body.price}, user.account_id)
    return {"id": aid, "state": state}


async def _own_ad(ad_id: int, team_id: int):
    row = await pool().fetchrow(
        """SELECT a.id, a.listing_id, a.state, l.price FROM app.ads a JOIN app.listings l ON l.id = a.listing_id
            WHERE a.id = $1 AND l.team_id = $2""", ad_id, team_id)
    if not row:
        raise HTTPException(404, "광고가 없습니다")
    return row


@router.put("/ads/{ad_id}")
async def update_ad(ad_id: int, body: AdIn, user: CurrentUser = Depends(current_user)):
    """고치기 — 폼 전체를 다시 받는다. 임시면 publish 로 올린다(그때 필수 칸 확인 · 오늘부터 30일).
    올라간 광고는 늘 필수 칸을 확인한다. 거래완료 · 삭제된 광고는 못 고친다."""
    a = await _own_ad(ad_id, user.team_id)
    if a["state"] in ("거래완료", "삭제"):
        raise HTTPException(409, "끝난 광고는 고칠 수 없습니다")
    strict = a["state"] != "임시" or body.publish
    _check_ad(body) if strict else _loose(body)
    from ..core.db import tx
    async with tx() as con:
        go_live = a["state"] == "임시" and body.publish
        await con.execute(
            """UPDATE app.ads SET price_open=$2, title=$3, body=$4, contact_phone=$5, updated_at=now(),
                   state = CASE WHEN $6 THEN '노출' ELSE state END,
                   posted_on = CASE WHEN $6 THEN current_date ELSE posted_on END,
                   expires_on = CASE WHEN $6 THEN current_date + 30 ELSE expires_on END
               WHERE id=$1""",
            ad_id, body.price_open, (body.title or "").strip() or None, (body.body or "").strip() or None,
            body.contact_phone, go_live)
        await _write_listing_values(con, a["listing_id"], body)
        await _set_photos(con, ad_id, a["listing_id"], user.team_id, body.photo_ids, 3 if strict else 0)
    if body.price != a["price"]:
        await listing_values_write(user.team_id, a["listing_id"], {"sale_price": body.price}, user.account_id)
    return {"ok": True}


class AdStateIn(BaseModel):
    state: str   # 노출 · 비노출 · 거래완료 · 삭제


@router.patch("/ads/{ad_id}/state")
async def ad_state(ad_id: int, body: AdStateIn, user: CurrentUser = Depends(current_user)):
    """노출 ↔ 비노출 · 거래완료(한 방향) · 삭제."""
    a = await _own_ad(ad_id, user.team_id)
    if body.state not in ("노출", "비노출", "거래완료", "삭제"):
        raise HTTPException(422, "상태는 노출 · 비노출 · 거래완료 · 삭제")
    if a["state"] == "거래완료" and body.state != "삭제":
        raise HTTPException(409, "거래완료는 되돌리지 않습니다")
    if a["state"] == "삭제":
        raise HTTPException(409, "지운 광고입니다")
    if a["state"] == "임시" and body.state != "삭제":
        raise HTTPException(409, "임시 광고는 올리기로만 노출합니다")
    await pool().execute(
        "UPDATE app.ads SET state=$2, closed_on = CASE WHEN $2 IN ('거래완료','삭제') THEN current_date ELSE closed_on END, "
        "updated_at=now() WHERE id=$1", ad_id, body.state)
    return {"ok": True}


@router.post("/ads/{ad_id}/extend")
async def ad_extend(ad_id: int, user: CurrentUser = Depends(current_user)):
    """연장 — 오늘부터 30일. 기한이 지난 광고도 이걸로 다시 산다(무료 · 손으로 갱신, 대표 09-28)."""
    a = await _own_ad(ad_id, user.team_id)
    if a["state"] not in ("노출", "비노출"):
        raise HTTPException(409, "끝난 광고는 연장할 수 없습니다")
    await pool().execute("UPDATE app.ads SET expires_on = current_date + 30, updated_at=now() WHERE id=$1", ad_id)
    return {"ok": True}
