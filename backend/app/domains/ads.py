"""광고 보기 · 크롤링 매물 — S05(2026-09-28).

광고 카드는 **누구나** 본다(any_user). 크롤링 매물은 **중개사만**(current_user) — 광고가 아니라 참고 자료다.
광고를 올리고 고치는 폼은 2묶음이다. 여기선 읽기만.
"""
import datetime as dt
import mimetypes

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

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
                   a.use_type, a.title, a.body, a.posted_on, a.closed_on,
                   COALESCE(a.contact_phone, t.phone) AS phone,
                   ac.name AS agent_name, COALESCE(t.office_name, t.name) AS office_name, t.reg_no,
                   -- 중개 등록정보 카드(디스코식) — 소재지 · 대표 · 대표연락처 · 올린 시각
                   t.office_addr, t.agent_name AS rep_name, t.phone AS office_phone, a.created_at,
                   (a.team_id = $2) AS mine,
                   (SELECT ap.photo_id FROM app.ad_photos ap WHERE ap.ad_id = a.id
                     ORDER BY ap.sort, ap.photo_id LIMIT 1) AS photo_id,
                   -- 사이드바에 광고 전체가 바로 선다(대표 09-28) — 사진 전부 · 주소 · 수정일
                   (SELECT array_agg(ap.photo_id ORDER BY ap.sort, ap.photo_id) FROM app.ad_photos ap
                     WHERE ap.ad_id = a.id) AS photo_ids,
                   (SELECT b.addr FROM master.buildings b WHERE b.building_pk = a.building_pk) AS addr,
                   a.updated_at::date AS updated_on,
                   -- 기본정보(0196) — 대장에 없는, 광고한 중개사만 아는 값. 융자금 「표시 안 함」이면 null
                   a.deposit, a.monthly_rent, CASE WHEN a.loan_open THEN a.loan END AS loan, a.loan_open,
                   a.move_in, a.move_in_on
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


class CardsIn(BaseModel):
    pks: list[str]


@router.post("/ads/cards")
async def ad_cards(body: CardsIn, user: CurrentUser = Depends(any_user)):
    """탐색 사이드 판 목록 카드(S05, 09-28) — 건물마다 한 장.

    어떤 건물을 낼지는 핀(/search/pins, 매매 보기)이 이미 골랐다(필터 · 범위). 여기선 카드 재료만 모은다.
    · 광고가 여럿이면 한 장으로 묶는다(디스코 「동일매물 N개」) — 가격은 최저~최고, 대표는 가장 최근 광고
    · 내 매물(중개사)은 팀 매매가 · 팀 사진 · 접수일. 광고도 있으면 광고가 카드의 얼굴이다
    """
    pks = list(dict.fromkeys(body.pks))[:200]
    if not pks:
        return []
    rows = await pool().fetch(
        f"""WITH k AS (SELECT unnest($1::text[]) AS building_pk),
           ad AS (
             SELECT a.building_pk,
                    count(*) FILTER (WHERE a.state = '노출') AS ad_n,
                    min(a.price) FILTER (WHERE a.state = '노출' AND a.price_open) AS price_min,
                    max(a.price) FILTER (WHERE a.state = '노출' AND a.price_open) AS price_max,
                    bool_or(a.state = '거래완료') AS sold,
                    (array_agg(a.id ORDER BY (a.state = '노출') DESC, a.posted_on DESC, a.id DESC))[1] AS lead_id
               FROM app.ads a JOIN k USING (building_pk)
              WHERE {_VISIBLE} GROUP BY a.building_pk)
           SELECT k.building_pk, b.addr, b.land_area::float, b.total_area::float,
                  b.floors_above, b.floors_below, b.main_use_name, ST_X(b.geom) AS lng, ST_Y(b.geom) AS lat,
                  ad.ad_n, ad.price_min, ad.price_max, COALESCE(ad.sold, false) AS sold,
                  la.id AS ad_id, la.title, la.brokerage, la.posted_on, la.created_at AS ad_created_at, COALESCE(la.use_type, l.building_major) AS use_type,
                  am.name AS assignee_name, COALESCE(tm.office_name, tm.name) AS my_office,
                  COALESCE(t.office_name, t.name) AS office_name, ac.name AS agent_name,
                  (SELECT ap.photo_id FROM app.ad_photos ap WHERE ap.ad_id = la.id
                    ORDER BY ap.sort, ap.photo_id LIMIT 1) AS ad_photo_id,
                  -- 내 매물(중개사만 — 고객은 team_id 가 없어 조인이 비는다)
                  (l.id IS NOT NULL AND l.assignee_account_id IS NOT NULL) AS mine,
                  l.sale_price AS my_price, l.received_on,
                  (SELECT f.id FROM app.photos f WHERE f.building_pk = k.building_pk AND f.team_id = $2
                     AND f.deleted_at IS NULL ORDER BY (f.kind = 'exterior') DESC, f.sort_order, f.id LIMIT 1) AS my_photo_id
             FROM k
             JOIN master.buildings b ON b.building_pk = k.building_pk
             LEFT JOIN ad ON ad.building_pk = k.building_pk
             LEFT JOIN app.ads la ON la.id = ad.lead_id
             LEFT JOIN app.teams t ON t.id = la.team_id
             LEFT JOIN app.accounts ac ON ac.id = COALESCE(la.contact_account_id, la.created_by)
             LEFT JOIN app.listings l ON l.building_pk = k.building_pk AND l.team_id = $2
             LEFT JOIN app.accounts am ON am.id = l.assignee_account_id
             LEFT JOIN app.teams tm ON tm.id = l.team_id""",
        pks, user.team_id)
    order = {pk: i for i, pk in enumerate(pks)}
    return sorted((dict(r) for r in rows), key=lambda r: order.get(r["building_pk"], 0))


# ── 광고 올리기 · 고치기(중개사, S05 §3 · 2묶음) ─────────────────────────────
# 광고는 매물 모달의 광고 폼으로만 생긴다(자동으로 켜지지 않는다). 값은 복사본이라 매물을 고쳐도 그대로다.
# 소유자를 못 잡은 매물도 올릴 수 있다(대표 09-28). 매물 하나에 살아 있는(노출 · 비노출) 광고는 하나(0191 인덱스).

USE_TYPES = ("빌딩", "상가주택", "공장·창고", "숙박", "기타")
_AD_COLS = ("use_type, brokerage, price, price_open, title, body, contact_phone, state, review, review_note, "
            "posted_on, expires_on, closed_on, deposit, monthly_rent, loan, loan_open, move_in, move_in_on")


async def _listing_of(pk: str, team_id: int):
    row = await pool().fetchrow(
        # 계약됐나 = 사람이 「완료」 상태를 골랐나(0199 — 자동 판정 엔진 삭제)
        "SELECT l.id, l.sale_price, l.exclusive, l.building_major, l.assignee_account_id, l.total_deposit, l.total_rent, "
        "(st.name = '완료') AS done "
        "FROM app.listings l LEFT JOIN app.statuses st ON st.id = l.status_id "
        "WHERE l.building_pk = $1 AND l.team_id = $2", pk, team_id)
    if not row:
        raise HTTPException(404, "매물관리에 담긴 매물이 아닙니다")
    return row


@router.get("/listings/{building_pk}/ad")
async def listing_ad(building_pk: str, user: CurrentUser = Depends(current_user)):
    """광고 탭 — 이 매물의 광고(삭제 뺀 가장 최근 하나)와, 광고 폼을 미리 채울 값."""
    l = await _listing_of(building_pk, user.team_id)
    ad = await pool().fetchrow(
        f"""SELECT id, {_AD_COLS},
                   (state = '노출' AND expires_on < current_date) AS expired,
                   (SELECT array_agg(photo_id ORDER BY sort, photo_id) FROM app.ad_photos WHERE ad_id = a.id) AS photo_ids
              FROM app.ads a WHERE listing_id = $1 AND state <> '삭제'
             ORDER BY (state IN ('노출','비노출')) DESC, (state = '임시') DESC, id DESC LIMIT 1""", l["id"])
    kind = await pool().fetchval("SELECT use_kind FROM master.building_derived WHERE building_pk = $1", building_pk)
    phone = await pool().fetchval("SELECT phone FROM app.accounts WHERE id = $1",
                                  l["assignee_account_id"] or user.account_id)
    # 건물 스펙은 광고에 안 싣는다(0195) — 카드 옆에 대장 값이 그대로 뜬다
    draft = {"use_type": l["building_major"] or kind, "brokerage": "전속" if l["exclusive"] else "일반",
             "price": l["sale_price"], "price_open": True, "title": "", "body": "", "contact_phone": phone,
             # 현 보증금 · 월세는 매물의 총보증금 · 총월세로(0196). 고칠 수 있다
             "deposit": l["total_deposit"], "monthly_rent": l["total_rent"], "loan": None, "loan_open": True,
             "move_in": None, "move_in_on": None}
    return {"ad": dict(ad) if ad else None, "draft": draft, "contracted": bool(l["done"])}


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


async def _set_photos(con, ad_id: int, pk: str, team_id: int, ids: list[int], need: int = 3) -> None:
    ok = await con.fetch("SELECT id FROM app.photos WHERE id = ANY($1::bigint[]) AND building_pk = $2 "
                         "AND team_id = $3 AND deleted_at IS NULL", ids, pk, team_id)
    have = {r["id"] for r in ok}
    if len(have) < need:
        raise HTTPException(422, "이 매물의 사진을 3장 이상 고르세요")
    await con.execute("DELETE FROM app.ad_photos WHERE ad_id = $1", ad_id)
    await con.executemany("INSERT INTO app.ad_photos(ad_id, photo_id, sort) VALUES($1,$2,$3)",
                          [(ad_id, pid, i) for i, pid in enumerate(dict.fromkeys(ids)) if pid in have])


def _basic(body: AdIn) -> tuple:
    """기본정보(0196) 값 — 날짜가 아니면 move_in_on 은 버린다."""
    if body.move_in not in (None, "즉시입주", "협의", "날짜"):
        raise HTTPException(422, "입주가능일은 즉시입주 · 협의 · 날짜")
    on = body.move_in_on if body.move_in == "날짜" else None
    return (body.deposit, body.monthly_rent, body.loan, body.loan_open,
            None if body.move_in == "날짜" and on is None else body.move_in, on)


def _loose(body: AdIn) -> None:
    if body.use_type is not None and body.use_type not in USE_TYPES:
        raise HTTPException(422, "매물 유형이 이상합니다")
    if body.brokerage not in ("일반", "전속"):
        raise HTTPException(422, "중개유형은 일반 · 전속")


@router.post("/listings/{building_pk}/ad", status_code=201)
async def create_ad(building_pk: str, body: AdIn, user: CurrentUser = Depends(current_user)):
    """새 광고 — publish 면 올리기(노출 · 오늘부터 30일), 아니면 임시저장(매물 하나에 하나, 있으면 덮는다)."""
    _check_ad(body) if body.publish else _loose(body)
    l = await _listing_of(building_pk, user.team_id)
    from ..core.db import tx
    async with tx() as con:
        live = await con.fetchval("SELECT id FROM app.ads WHERE listing_id = $1 AND state IN ('노출','비노출')", l["id"])
        if live:
            raise HTTPException(409, "이미 올린 광고가 있습니다")
        draft = await con.fetchval("SELECT id FROM app.ads WHERE listing_id = $1 AND state = '임시'", l["id"])
        state = "노출" if body.publish else "임시"
        vals = (body.use_type, body.brokerage, body.price, body.price_open, (body.title or "").strip() or None,
                (body.body or "").strip() or None, body.contact_phone)
        if draft:
            await con.execute(
                """UPDATE app.ads SET use_type=$2, brokerage=$3, price=$4, price_open=$5, title=$6, body=$7,
                       contact_phone=$8, state=$9, posted_on=current_date, expires_on=current_date + 30, updated_at=now(),
                       deposit=$10, monthly_rent=$11, loan=$12, loan_open=$13, move_in=$14, move_in_on=$15
                   WHERE id=$1""", draft, *vals, state, *_basic(body))
            aid = draft
        else:
            aid = await con.fetchval(
                """INSERT INTO app.ads(team_id, listing_id, building_pk, use_type, brokerage, price, price_open,
                       title, body, contact_phone, state, contact_account_id, created_by,
                       deposit, monthly_rent, loan, loan_open, move_in, move_in_on)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id""",
                user.team_id, l["id"], building_pk, *vals, state,
                l["assignee_account_id"] or user.account_id, user.account_id, *_basic(body))
        await _set_photos(con, aid, building_pk, user.team_id, body.photo_ids, 3 if body.publish else 0)
    return {"id": aid, "state": state}


async def _own_ad(ad_id: int, team_id: int):
    row = await pool().fetchrow("SELECT id, building_pk, state FROM app.ads WHERE id = $1 AND team_id = $2", ad_id, team_id)
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
            """UPDATE app.ads SET use_type=$2, brokerage=$3, price=$4, price_open=$5, title=$6, body=$7,
                   contact_phone=$8, updated_at=now(),
                   state = CASE WHEN $9 THEN '노출' ELSE state END,
                   posted_on = CASE WHEN $9 THEN current_date ELSE posted_on END,
                   expires_on = CASE WHEN $9 THEN current_date + 30 ELSE expires_on END,
                   deposit=$10, monthly_rent=$11, loan=$12, loan_open=$13, move_in=$14, move_in_on=$15
               WHERE id=$1""",
            ad_id, body.use_type, body.brokerage, body.price, body.price_open,
            (body.title or "").strip() or None, (body.body or "").strip() or None, body.contact_phone, go_live,
            *_basic(body))
        await _set_photos(con, ad_id, a["building_pk"], user.team_id, body.photo_ids, 3 if strict else 0)
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
