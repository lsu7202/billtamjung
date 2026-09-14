"""이 주소에 등록된 업체 — 카카오 로컬(키워드로 장소 검색) 중계.

## 무엇이고 무엇이 아닌가

**참고 자료다. 우리 원장이 아니다.** 업체가 스스로 카카오에 등록한 것이라 빠진 곳도
있고 이사 간 곳이 남아 있기도 한다. 임대 추정·수익률·적정가 어디에도 안 들어간다 —
화면에 「이 주소에 이런 간판이 있다」를 보여주는 것까지가 전부다.

## 저장하지 않는다

카카오 약관이 결과를 우리 DB 로 옮기는 것을 막는다. 그래서 표를 만들지 않고 화면이
열릴 때 그 자리에서 받아 넘긴다. 다만 같은 건물을 몇 번 열 때마다 카카오를 부르면
쿼터가 헛돈다 — **프로세스 메모리에만 6시간 캐시**를 둔다(껐다 켜면 사라진다).

## 주소를 어떻게 넘기나 (2026-09-03 실측)

대장 주소를 그대로 넣으면 안 된다. 세 가지를 손봐야 한 자리에서 답이 온다.

    서울특별시 강남구 신사동 656-2번지        → 서울 강남구 신사동 656-2      7건
    서울특별시 강남구 선릉로155길 25 (신사동)  → 서울 강남구 선릉로155길 25    7건
    (괄호를 안 떼면)                                                        0건

지번과 도로명은 같은 곳을 가리키므로 결과도 같다. 지번을 먼저 묻고, 한 건도 없으면
도로명으로 한 번 더 묻는다. 큰 건물은 한 쪽에만 걸리는 경우가 있다.

## 몇 건까지 오나

카카오는 한 쪽 15건, 최대 3쪽까지만 준다(`pageable_count`=45). 강남파이낸스센터처럼
186곳이 등록된 건물은 45곳까지만 볼 수 있다. 그 이상은 API 로 못 가져온다.
"""
from __future__ import annotations

import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException

from ..core.config import settings
from ..core.db import pool
from ..core.deps import CurrentUser, current_user

router = APIRouter(prefix="/buildings/{building_pk}/places", tags=["places"])

KAKAO_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
PAGE_SIZE = 15          # 카카오 상한
MAX_PAGES = 3           # 15 x 3 = 45. 카카오가 더는 안 준다
CACHE_TTL = 6 * 3600    # 초. 간판은 하루 만에 안 바뀐다
CACHE_MAX = 500         # 건물 수. 넘으면 오래된 것부터 버린다

# building_pk → (받은 시각, 결과)
_cache: dict[str, tuple[float, dict]] = {}


def _norm_addr(s: str | None) -> str:
    """대장 주소를 카카오가 알아듣는 모양으로.

    「서울특별시」는 「서울」로(카카오 표기), 「번지」와 도로명 뒤 「(신사동)」은 뗀다.
    괄호를 남기면 검색이 0건이 된다 — 실측(2026-09-03).
    """
    if not s:
        return ""
    s = s.strip()
    s = re.sub(r"^서울특별시\s+", "서울 ", s)
    s = re.sub(r"\s*\([^)]*\)\s*$", "", s)
    s = re.sub(r"번지$", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _key(s: str | None) -> str:
    """주소 비교용 — 띄어쓰기와 시 이름 표기 차이를 지운다."""
    return re.sub(r"\s+", "", _norm_addr(s))


async def _ask_kakao(query: str, want_more: bool) -> list[dict]:
    """한 질의어로 카카오에 묻는다. 1쪽을 받고, 더 있으면 3쪽까지."""
    out: list[dict] = []
    headers = {"Authorization": f"KakaoAK {settings.kakao_client_id}"}
    async with httpx.AsyncClient(timeout=6) as client:
        for page in range(1, MAX_PAGES + 1):
            r = await client.get(KAKAO_URL, headers=headers,
                                 params={"query": query, "size": PAGE_SIZE, "page": page})
            if r.status_code == 429:
                raise HTTPException(429, "카카오 호출 한도를 넘었습니다")
            if r.status_code != 200:
                # 키가 안 걸렸거나(403) 카카오가 아플 때. 화면은 「없음」으로 보이면 된다.
                raise HTTPException(502, "카카오 응답을 받지 못했습니다")
            body = r.json()
            out.extend(body.get("documents", []))
            meta = body.get("meta", {})
            if meta.get("is_end") or not want_more or len(out) >= meta.get("pageable_count", 0):
                break
    return out


def _pick(docs: list[dict], jibun: str, road: str) -> list[dict]:
    """**이 주소의 것만** 남긴다.

    카카오는 이름이 비슷한 곳도 같이 준다(질의가 주소여도 그렇다). 지번이나 도로명이
    우리 것과 정확히 같은 것만 남긴다 — 옆 건물 간판을 이 건물 임차인으로 보이게 하면
    그 화면은 그날로 못 믿는 화면이 된다.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for d in docs:
        if _key(d.get("address_name")) != jibun and _key(d.get("road_address_name")) != road:
            continue
        pid = str(d.get("id") or d.get("place_name"))
        if pid in seen:
            continue
        seen.add(pid)
        # 분류는 「음식점 > 술집 > 호프,요리주점」 꼴이다. 앞머리(대분류)로 묶고 끝만 보여준다.
        # category_group_name 은 쓰지 않는다 — 실측(2026-09-03) 사무실·병원·부동산은
        # 그 칸이 비어 있다(테헤란로 152 는 15곳 중 9곳이 빈칸). 대분류는 항상 차 있다.
        parts = [c.strip() for c in (d.get("category_name") or "").split(">") if c.strip()]
        out.append({
            "name": d.get("place_name"),
            "group": parts[0] if parts else "기타",
            "detail": parts[-1] if len(parts) > 1 else "",
            "phone": d.get("phone") or None,
            "url": d.get("place_url"),
            "road_addr": d.get("road_address_name") or None,
        })
    out.sort(key=lambda x: (x["group"], x["detail"], x["name"] or ""))
    return out


@router.get("")
async def building_places(building_pk: str, user: CurrentUser = Depends(current_user)):
    """이 건물 주소에 등록된 업체. 없으면 빈 목록이고 오류가 아니다."""
    _ = user
    hit = _cache.get(building_pk)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]

    b = await pool().fetchrow(
        "SELECT addr, road_addr FROM master.buildings WHERE building_pk=$1", building_pk)
    if b is None:
        raise HTTPException(404, "건물을 찾을 수 없습니다")
    if not settings.kakao_client_id:
        raise HTTPException(503, "카카오 키가 설정되지 않았습니다")

    jibun_q, road_q = _norm_addr(b["addr"]), _norm_addr(b["road_addr"])
    jibun_k, road_k = _key(b["addr"]), _key(b["road_addr"])

    docs: list[dict] = []
    if jibun_q:
        docs = await _ask_kakao(jibun_q, want_more=True)
    items = _pick(docs, jibun_k, road_k)
    # 지번으로 한 건도 못 찾으면 도로명으로 한 번 더. 큰 건물은 한쪽에만 걸리기도 한다
    if not items and road_q:
        items = _pick(await _ask_kakao(road_q, want_more=True), jibun_k, road_k)

    # 45건에서 잘렸는지 알린다 — 「이게 전부」로 읽히면 안 된다
    out = {"items": items, "truncated": len(items) >= MAX_PAGES * PAGE_SIZE, "source": "kakao"}
    if len(_cache) >= CACHE_MAX:
        for k in sorted(_cache, key=lambda k: _cache[k][0])[:CACHE_MAX // 5]:
            _cache.pop(k, None)
    _cache[building_pk] = (time.time(), out)
    return out
