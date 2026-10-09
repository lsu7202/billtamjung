"""자료 부품 — **템플릿 안에서만** 쓴다(2026-10-06 대표). 정본 specs/07-architecture/10-AI-어시스턴트.md §11.

부품은 템플릿의 `meta.json` 「parts」에 적힌 것만 산다. 템플릿을 안 고른 자료에서는 `<bt-*>` 를 그대로 두고
아무것도 안 그린다 — 부품이 늘 있으면 모델이 물음과 상관없이 끼워 넣었다(10-06 「부품 API 지워줘」).

  bt-map           지적도. 필지 도형이 PostGIS 에 있고 좌표계 변환이 필요하다 · 지번 단위(0230)
  bt-photo         그 땅의 매물에 올린 사진(지번 단위 · 0229)
  bt-office        사무소 이름 · 중개사 · 연락처 · 주소 · 로고(app.teams). 모델이 옮겨 적지 않는다
  bt-promo         사무소 홍보 사진(app.team_promo_photos) · n="1" 번째
  bt-upload        대화에 올린 이미지(app.ai_uploads, 0237) · id="N". **템플릿이 없어도 산다** — 사용자가 직접 올린 것이라
                   모델이 스스로 끼워 넣을 일이 없다(그 말에 올렸을 때만 번호를 안다). 올린 사람 본인 것만 그린다

**숫자 · 좌표 · 연락처를 모델이 안 만진다.** 모델은 부품 이름과 주소만 쓰고 값은 여기서 붙는다.
"""
from __future__ import annotations

import base64
import html
import json
import mimetypes
import re
from typing import Any

from ..core import storage
from ..core.db import pool

TAG = re.compile(r"<bt-(map|photo|office|promo|upload)\b([^>]*?)/?>(?:\s*</bt-\1>)?", re.I | re.S)
_ATTR = re.compile(r"([a-z-]+)\s*=\s*\"([^\"]*)\"", re.I)


def attrs(raw: str) -> dict[str, str]:
    return {m.group(1).lower(): m.group(2) for m in _ATTR.finditer(raw or "")}


def none(why: str) -> str:
    """못 그리면 **자리를 남기고 왜인지 적는다.** 조용히 비우면 자료에 구멍이 난 줄 모른다."""
    return f'<div class="bt-none">{html.escape(why)}</div>'


async def _img(path: str, cls: str) -> str | None:
    """파일을 구울 때 안에 박는다 — 판 안(iframe)엔 토큰이 없어 우리 API 를 못 부른다"""
    data = await storage.load(path)
    if data is None:
        return None
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    return f'<img class="{cls}" src="data:{mime};base64,{base64.b64encode(data).decode()}" alt=""/>'


async def _rep(a: dict[str, str]) -> str:
    """부품이 가리키는 땅의 지번 — 모델은 **주소**로 쓴다. 건물 주소면 그 건물의 지번, 나대지면 그 필지(0255)"""
    addr = (a.get("addr") or "").strip()
    if not addr:
        return ""
    from ..domains.search import pks_by_addr
    got = await pks_by_addr(addr)
    if not got:
        return ""
    pk = got[0]
    if len(pk) == 19 and pk.isdigit():        # 나대지 필지번호
        return pk
    return await pool().fetchval("SELECT pnu FROM master.buildings WHERE building_pk = $1", pk) or ""


# ── bt-map · 지적도 ─────────────────────────────────────────────────────────
# 네이버 지도를 안 쓰고 **지적도를 직접 그린다.** 열쇠가 필요 없고, 인쇄에 그대로 찍힌다.
_MAP_SQL = """
WITH me AS (
  SELECT ST_Union(geom) AS g FROM master.parcels WHERE pnu = $1
), box AS (
  SELECT ST_Expand(ST_Envelope(g), GREATEST(ST_XMax(ST_Envelope(g)) - ST_XMin(ST_Envelope(g)),
                                            ST_YMax(ST_Envelope(g)) - ST_YMin(ST_Envelope(g))) * $2) AS b
    FROM me
)
SELECT ST_XMin(b) x0, ST_YMin(b) y0, ST_XMax(b) x1, ST_YMax(b) y1,
       ST_AsGeoJSON((SELECT g FROM me)) AS mine,
       (SELECT json_agg(json_build_object('g', ST_AsGeoJSON(p.geom), 'road', p.jimok = '도로'))
          FROM master.parcels p, box
         WHERE p.geom && box.b AND p.pnu IS DISTINCT FROM $1) AS around,
       ST_Distance(ST_Point(ST_XMin(b), ST_YMin(b))::geography,
                   ST_Point(ST_XMax(b), ST_YMin(b))::geography) AS width_m
  FROM box
"""


def _ring_path(coords: list, x0: float, y0: float, sx: float, sy: float) -> str:
    out = []
    for ring in coords:
        pts = [f"{(p[0] - x0) * sx:.1f},{(y0 - p[1]) * sy:.1f}" for p in ring]
        if pts:
            out.append("M" + "L".join(pts) + "Z")
    return "".join(out)


def _rings(geo: dict) -> list:
    if not geo:
        return []
    if geo.get("type") == "Polygon":
        return [geo["coordinates"]]
    if geo.get("type") == "MultiPolygon":
        return geo["coordinates"]
    return []


async def bt_map(a: dict[str, str], _team: int | None) -> str:
    pk = await _rep(a)
    if not pk:
        return none("bt-map 에 주소가 없거나 그 주소를 못 찾았습니다")
    pad = 0.6 if "wide" in (a.get("draw") or "") else 0.25
    row = await pool().fetchrow(_MAP_SQL, pk, pad)
    if not row or not row["mine"]:
        return none("이 땅의 필지 도형이 없습니다")
    W, H = 1000.0, 700.0
    x0, y0, x1, y1 = row["x0"], row["y0"], row["x1"], row["y1"]
    bw, bh = max(x1 - x0, 1e-9), max(y1 - y0, 1e-9)      # 가로세로 비를 맞춘다 · 안 맞추면 땅이 찌그러진다
    if bw / bh > W / H:
        grow = bw * H / W - bh
        y0, y1, bh = y0 - grow / 2, y1 + grow / 2, bw * H / W
    else:
        grow = bh * W / H - bw
        x0, x1, bw = x0 - grow / 2, x1 + grow / 2, bh * W / H
    sx, sy = W / bw, H / bh
    parts = [f'<svg viewBox="0 0 {W:.0f} {H:.0f}" xmlns="http://www.w3.org/2000/svg">',
             f'<defs><clipPath id="c"><rect width="{W:.0f}" height="{H:.0f}"/></clipPath></defs>',
             f'<rect width="{W:.0f}" height="{H:.0f}" fill="#F1F3F6"/><g clip-path="url(#c)">']
    for item in json.loads(row["around"] or "[]"):
        fill, stroke = ("#E8EBEF", "#D9DDE3") if item["road"] else ("#FFFFFF", "#DFE3E8")
        for rings in _rings(json.loads(item["g"])):
            if d := _ring_path(rings, x0, y1, sx, sy):
                parts.append(f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="1"/>')
    for rings in _rings(json.loads(row["mine"])):
        if d := _ring_path(rings, x0, y1, sx, sy):
            parts.append(f'<path d="{d}" fill="#2563C7" fill-opacity=".18" stroke="#2563C7" stroke-width="2.5"/>')
    parts.append("</g>")
    if (mw := row["width_m"]) and mw > 0:                 # 축척 막대 — 인쇄물에 이게 없으면 크기를 못 읽는다
        nice = next((v for v in (10, 20, 30, 50, 100, 200, 300, 500, 1000) if v >= mw / 5), 1000)
        px = nice / mw * W
        parts.append(f'<g transform="translate(28,{H - 46:.0f})">'
                     f'<rect x="-10" y="-6" width="{px + 20:.0f}" height="42" rx="6" fill="#FFFFFF" fill-opacity=".85"/>'
                     f'<text x="0" y="16" font-size="20" fill="#262320" font-family="monospace">{nice}m</text>'
                     f'<rect y="25" width="{px:.0f}" height="4" fill="#262320"/></g>')
    parts.append("</svg>")
    return f'<div class="bt-map">{"".join(parts)}</div>'


# ── bt-photo · 그 땅의 매물 사진 ─────────────────────────────────────────────
async def bt_photo(a: dict[str, str], team: int | None) -> str:
    pk = await _rep(a)
    if not pk:
        return none("bt-photo 에 주소가 없거나 그 주소를 못 찾았습니다")
    path = await pool().fetchval(
        """SELECT ph.file_path FROM app.photos ph JOIN app.listing_parcels lp ON lp.listing_id = ph.listing_id
            WHERE lp.pnu = $1 AND ph.team_id = $2 AND ph.deleted_at IS NULL
            ORDER BY ph.sort_order, ph.id LIMIT 1""", pk, team)
    if not path:
        return none("이 땅의 매물에 올린 사진이 없습니다")
    return await _img(path, "bt-photo") or none("사진 파일을 못 찾았습니다")


# ── bt-office · 사무소 ──────────────────────────────────────────────────────
async def bt_office(_a: dict[str, str], team: int | None, account: int | None = None) -> str:
    """사무소 이름 · 중개사 이름 + 직급 · 연락처 · 로고. 중개사는 **자료를 만든 사람**(자료는 개인 것이라 보는 사람 = 만든 사람)
    — 이름과 직급은 계정(accounts.name · job_title, 0219 「직함 = 계정 직급」). 계정에 없으면 사무소 정보의 중개사 칸"""
    r = await pool().fetchrow(
        """SELECT COALESCE(t.office_name, t.name) AS office, t.agent_name, t.agent_title, t.phone, t.office_addr, t.reg_no,
                  t.logo_path, a.name AS acc_name, a.job_title AS acc_title, a.phone AS acc_phone
             FROM app.teams t LEFT JOIN app.accounts a ON a.id = $2 WHERE t.id = $1""", team, account)
    if not r:
        return none("사무소 정보가 없습니다")
    logo = (await _img(r["logo_path"], "bt-logo")) if r["logo_path"] else None
    name = r["acc_name"] or r["agent_name"]
    title = r["acc_title"] if r["acc_name"] else r["agent_title"]
    who = " ".join(x for x in (name, title) if x)                     # 「이승욱 실장」
    phone = r["phone"] or r["acc_phone"]
    rows = "".join(f"<span>{html.escape(str(v))}</span>" for v in (who, phone, r["office_addr"]) if v)
    reg = f'<small>등록번호 {html.escape(r["reg_no"])}</small>' if r["reg_no"] else ""
    return (f'<div class="bt-office">{logo or ""}<div class="bt-office-t">'
            f'<b>{html.escape(r["office"] or "")}</b>{rows}{reg}</div></div>')


# ── bt-promo · 사무소 홍보 사진 ─────────────────────────────────────────────
async def bt_promo(a: dict[str, str], team: int | None) -> str:
    try:
        n = max(1, int(a.get("n") or 1))
    except ValueError:
        n = 1
    path = await pool().fetchval(
        "SELECT path FROM app.team_promo_photos WHERE team_id = $1 ORDER BY sort_order, id OFFSET $2 LIMIT 1", team, n - 1)
    if not path:
        return none(f"사무소 홍보 사진 {n}번이 없습니다(사무소 화면에서 올립니다)")
    return await _img(path, "bt-promo") or none("사진 파일을 못 찾았습니다")


# ── bt-upload · 대화에 올린 이미지 ─────────────────────────────────────────
async def bt_upload(a: dict[str, str], account: int | None) -> str:
    try:
        uid = int(a.get("id") or 0)
    except ValueError:
        uid = 0
    path = await pool().fetchval("SELECT path FROM app.ai_uploads WHERE id = $1 AND account_id = $2", uid, account)
    if not path:
        return none("올린 이미지를 찾을 수 없습니다")
    return await _img(path, "bt-upload") or none("사진 파일을 못 찾았습니다")


RENDER: dict[str, Any] = {"map": bt_map, "photo": bt_photo, "office": bt_office, "promo": bt_promo}


async def fill(src_html: str, allowed: set[str], team: int | None, account: int | None = None) -> str:
    """`<bt-*>` 를 값으로 바꾼다. 템플릿이 허락한 부품 + 올린 이미지(bt-upload) — 나머지 태그는 그대로 둔다."""
    out, last = [], 0
    for m in TAG.finditer(src_html or ""):
        name = m.group(1).lower()
        if name != "upload" and name not in allowed:
            continue
        out.append(src_html[last:m.start()])
        a_ = attrs(m.group(2))
        out.append(await (bt_upload(a_, account) if name == "upload"
                          else bt_office(a_, team, account) if name == "office"
                          else RENDER[name](a_, team)))
        last = m.end()
    out.append((src_html or "")[last:])
    return "".join(out)
