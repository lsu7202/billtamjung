"""굽기 — 모델이 쓴 `src_html` 의 `<bt-*>` 를 값으로 바꾼다. 정본 10-AI-어시스턴트 §11-1.

**원본과 구운 것을 나눈 게 뼈대다.** 원본이 있어야 부분 수정이 되고, 굽기를 열 때로 미뤄야
데이터가 살아 있다. 굳히는 건 내보낸 판 하나뿐이다(「데이터 변경됨」 판정은 안 만든다).

부품은 **둘뿐**이다(2026-09-24 대표). 차트·표는 모델이 SVG·HTML 로 직접 그린다. 우리는
그릴 재료(토큰·틀)만 주고, 모델이 **못 그리는 것**만 부품으로 남긴다.

  bt-map    지적도. 필지 도형이 PostGIS 에 있고 좌표계 변환이 필요하다
  bt-photo  올린 사진. 파일이 우리 쪽에 있다

**숫자와 좌표를 모델이 안 만진다**(§3-1). 모델은 이름과 대상만 쓰고 값은 여기서 붙는다.
"""
from __future__ import annotations

import base64
import html
import json
import mimetypes
import re
from pathlib import Path
from typing import Any

from ..core import storage
from ..core.db import pool

_CSS = (Path(__file__).parent / "artifact.css").read_text(encoding="utf-8")

# `<bt-map pk="…" draw="parcel"></bt-map>` · `<bt-map pk="…"/>` 둘 다 받는다.
# 모델이 닫는 태그를 빠뜨리는 일이 잦아 자기닫음도 열어 둔다.
_TAG = re.compile(r"<bt-(map|photo)\b([^>]*?)/?>(?:\s*</bt-\1>)?", re.I | re.S)
_ATTR = re.compile(r"([a-z-]+)\s*=\s*\"([^\"]*)\"", re.I)


def _attrs(raw: str) -> dict[str, str]:
    return {m.group(1).lower(): m.group(2) for m in _ATTR.finditer(raw or "")}


def _none(why: str) -> str:
    """못 그리면 **자리를 남기고 왜인지 적는다.** 조용히 비우면 자료에 구멍이 난 줄 모른다."""
    return f'<div class="bt-none">{html.escape(why)}</div>'


# ── bt-map ────────────────────────────────────────────────────────────────
#
# 네이버 지도를 안 쓰고 **지적도를 직접 그린다.** 샌드박스 안에서 열쇠가 필요 없고, 인쇄에
# 그대로 찍히고, 오프라인에서도 산다. 중개인이 실제로 손님에게 보여 주는 것도 지적도다.
_MAP_SQL = """
WITH me AS (
  SELECT ST_Union(geom) AS g FROM master.parcels WHERE building_pk = $1
), box AS (
  SELECT ST_Expand(ST_Envelope(g), GREATEST(ST_XMax(ST_Envelope(g)) - ST_XMin(ST_Envelope(g)),
                                            ST_YMax(ST_Envelope(g)) - ST_YMin(ST_Envelope(g))) * $2) AS b
    FROM me
)
SELECT ST_XMin(b) x0, ST_YMin(b) y0, ST_XMax(b) x1, ST_YMax(b) y1,
       ST_AsGeoJSON((SELECT g FROM me)) AS mine,
       (SELECT json_agg(json_build_object('g', ST_AsGeoJSON(p.geom), 'road', p.jimok = '도로'))
          FROM master.parcels p, box
         WHERE p.geom && box.b AND p.building_pk IS DISTINCT FROM $1) AS around,
       ST_Distance(ST_Point(ST_XMin(b), ST_YMin(b))::geography,
                   ST_Point(ST_XMax(b), ST_YMin(b))::geography) AS width_m
  FROM box
"""


def _ring_path(coords: list, x0: float, y0: float, sx: float, sy: float) -> str:
    """GeoJSON 고리 → SVG path. y 는 뒤집는다(화면 좌표는 아래로 자란다)."""
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


async def _map(a: dict[str, str]) -> str:
    pk = (a.get("pk") or "").strip()
    if not pk:
        return _none("bt-map 에 pk 가 없습니다")
    pad = 0.6 if "wide" in (a.get("draw") or "") else 0.25
    row = await pool().fetchrow(_MAP_SQL, pk, pad)
    if not row or not row["mine"]:
        return _none("이 건물의 필지 도형이 없습니다")

    W, H = 1000.0, 700.0
    x0, y0, x1, y1 = row["x0"], row["y0"], row["x1"], row["y1"]
    # 가로세로 비를 맞춘다. 안 맞추면 땅이 찌그러진다
    bw, bh = max(x1 - x0, 1e-9), max(y1 - y0, 1e-9)
    if bw / bh > W / H:
        grow = bw * H / W - bh
        y0, y1, bh = y0 - grow / 2, y1 + grow / 2, bw * H / W
    else:
        grow = bh * W / H - bw
        x0, x1, bw = x0 - grow / 2, x1 + grow / 2, bh * W / H
    sx, sy = W / bw, H / bh

    # 이웃 필지는 상자와 **겹치기만** 해도 잡히니 밖으로 삐져나간다. 상자로 잘라 둔다
    # `slice` 로 그릇을 채웠더니 **왼쪽이 잘려 축척 막대가 사라졌다**(2026-09-24 화면 확인).
    # 기본값 `meet` 로 두고 그릇 배경을 상자 색과 같게 둔다 — 여백이 생겨도 이어 보인다.
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
            parts.append(f'<path d="{d}" fill="#2563C7" fill-opacity=".18" '
                         f'stroke="#2563C7" stroke-width="2.5"/>')
    parts.append("</g>")
    # 축척 막대 — 인쇄물에 이게 없으면 크기를 못 읽는다
    if (mw := row["width_m"]) and mw > 0:
        nice = next((v for v in (10, 20, 30, 50, 100, 200, 300, 500, 1000) if v >= mw / 5), 1000)
        px = nice / mw * W
        # 흰 바탕 위에 얹는다. 필지가 흰색이라 그냥 쓰면 안 읽힌다(화면 확인 2026-09-24)
        parts.append(f'<g transform="translate(28,{H - 46:.0f})">'
                     f'<rect x="-10" y="-6" width="{px + 20:.0f}" height="42" rx="6" '
                     f'fill="#FFFFFF" fill-opacity=".85"/>'
                     f'<text x="0" y="16" font-size="20" fill="#262320" '
                     f'font-family="monospace">{nice}m</text>'
                     f'<rect y="25" width="{px:.0f}" height="4" fill="#262320"/></g>')
    parts.append("</svg>")
    return f'<div class="bt-map">{"".join(parts)}</div>'


# ── bt-photo ──────────────────────────────────────────────────────────────
async def _photo(a: dict[str, str]) -> str:
    """올린 사진. **구울 때 안에 박는다**(§11-2-1) — 샌드박스엔 토큰이 없어 우리 API 를 못 부른다."""
    pk = (a.get("pk") or "").strip()
    if not pk:
        return _none("bt-photo 에 pk 가 없습니다")
    row = await pool().fetchrow(
        "SELECT file_path FROM app.photos WHERE building_pk=$1 AND deleted_at IS NULL"
        " ORDER BY sort_order, id LIMIT 1", pk)
    if not row:
        return _none("올린 사진이 없습니다")
    # 파일은 storage 가 안다(베타=로컬 · 프로덕션=GCS). 직접 열지 않는다
    data = await storage.load(row["file_path"])
    if data is None:
        return _none("사진 파일을 못 찾았습니다")
    mime = mimetypes.guess_type(row["file_path"])[0] or "image/jpeg"
    b64 = base64.b64encode(data).decode()
    return f'<img class="bt-photo" src="data:{mime};base64,{b64}" alt=""/>' 


# ── 한 판 굽기 ────────────────────────────────────────────────────────────
async def bake(src_html: str, *, kind: str = "slides", title: str = "") -> str:
    """`src_html` → 완성 HTML. 토큰·틀을 머리에 박고 `<bt-*>` 를 값으로 바꾼다."""
    out, last = [], 0
    for m in _TAG.finditer(src_html or ""):
        out.append(src_html[last:m.start()])
        a = _attrs(m.group(2))
        out.append(await (_map(a) if m.group(1).lower() == "map" else _photo(a)))
        last = m.end()
    out.append(src_html[last:])
    body = "".join(out)
    cls = "doc" if kind == "doc" else "slides"
    return (f'<!doctype html><html lang="ko"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">'
            f"<title>{html.escape(title or '자료')}</title><style>{_CSS}</style></head>"
            f'<body class="{cls}">{body}</body></html>')


def tags_used(src_html: str) -> dict[str, Any]:
    """어떤 부품을 몇 번 썼나. 도구가 모델에게 돌려주는 값(무엇이 그려졌는지 알아야 고친다)."""
    got: dict[str, int] = {}
    for m in _TAG.finditer(src_html or ""):
        got[m.group(1).lower()] = got.get(m.group(1).lower(), 0) + 1
    return got
