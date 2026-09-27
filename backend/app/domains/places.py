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

**도로명을 먼저 묻고, 필지마다 지번으로도 묻는다**(2026-09-25 대표 발견).
대장 주소의 지번은 **대표지번 하나뿐**이다. 건물이 여러 필지에 걸치면 가게는 부속지번으로 등록돼
대표지번 검색에 안 나온다 — 연지동 275-1 로 물으면 3곳, 275-2 로 물어야 경희한의원·노래카페가 나온다.
도로명(대학로1길 10)은 두 필지를 한꺼번에 준다(5곳). 도로명 없이 지번으로만 등록된 가게도 있어 둘 다 묻는다.
예전엔 지번을 먼저 묻고 한 건이라도 나오면 도로명을 안 물었다 — 그래서 부속지번 가게가 통째로 빠졌다.

## 몇 건까지 오나

카카오는 **한 질의에** 한 쪽 15건, 최대 3쪽까지만 준다(`pageable_count`=45). 강남파이낸스센터처럼
186곳이 등록된 건물은 한 질의로 45곳까지만 볼 수 있다. 질의를 도로명·필지별로 나눠 합치면 조금 는다.
"""
from __future__ import annotations

import re
import time

import httpx
from fastapi import HTTPException

from ..core.config import settings
from ..core.db import pool

KAKAO_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
PAGE_SIZE = 15          # 카카오 상한
MAX_PAGES = 3           # 15 x 3 = 45. 카카오가 더는 안 준다
MAX_JIBUN = 6           # 필지가 많은 건물(수십 필지)에서 질의가 불어나지 않게. 도로명이 대부분을 덮는다
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


def _pick(docs: list[dict], jibuns: set[str], road: str) -> list[dict]:
    """**이 건물의 것만** 남긴다.

    카카오는 이름이 비슷한 곳도 같이 준다(질의가 주소여도 그렇다). 지번이 이 건물 **필지 중
    하나**와 같거나 도로명이 같은 것만 남긴다 — 옆 건물 간판을 이 건물 임차인으로 보이게 하면
    그 화면은 그날로 못 믿는 화면이 된다.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for d in docs:
        if _key(d.get("address_name")) not in jibuns and (not road or _key(d.get("road_address_name")) != road):
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


async def _jibuns(building_pk: str, addr: str | None, bjd: str | None) -> list[str]:
    """이 건물의 필지마다 카카오에 물을 지번 — 대표지번 먼저, 부속지번 뒤.
    대장 주소에서 「서울 종로구 연지동」 앞머리를 떼어 쓰고 번지는 pnu 에서 만든다
    (pnu = 법정동 10 · 산 1 · 본번 4 · 부번 4). 다른 법정동에 걸친 필지는 앞머리를 모르니 건너뛴다."""
    head = re.sub(r"\s+\S+$", "", _norm_addr(addr))           # 「서울 종로구 연지동 275-1」 → 앞머리
    out = [_norm_addr(addr)] if addr else []
    # **지적도에 있는 필지만** 묻는다. 대장 부속지번엔 이미 합쳐져 사라진 번지가 남아 있다 —
    # 연지동 이 건물은 대장이 275-2·275-3 을 적는데 지적도엔 275-3 이 없다(2026-09-25 대표 확인)
    rows = await pool().fetch(
        """SELECT bp.pnu FROM master.building_parcels bp
             JOIN master.parcels p ON p.pnu = bp.pnu
            WHERE bp.building_pk=$1
            ORDER BY (bp.role = '대표') DESC, bp.pnu""", building_pk)
    for r in rows:
        pnu = r["pnu"] or ""
        if len(pnu) != 19 or (bjd and not pnu.startswith(bjd)) or not head:
            continue
        bon, bu = int(pnu[11:15]), int(pnu[15:19])
        q = f"{head} {'산 ' if pnu[10] == '2' else ''}{bon}{f'-{bu}' if bu else ''}"
        if q not in out:
            out.append(q)
    return out[:MAX_JIBUN]


async def places_for(building_pk: str) -> dict:
    """이 건물 주소로 카카오에서 찾은 업체(전화·링크). GET /buildings/{pk}/floors 가 쓴다(2026-09-17).
    저장하지 않는다 — 프로세스 캐시만. 예전 /places 라우트는 여기로 흡수됐다."""
    hit = _cache.get(building_pk)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]

    b = await pool().fetchrow(
        "SELECT addr, road_addr, bjd_code FROM master.buildings WHERE building_pk=$1", building_pk)
    if b is None:
        raise HTTPException(404, "건물을 찾을 수 없습니다")
    if not settings.kakao_client_id:
        raise HTTPException(503, "카카오 키가 설정되지 않았습니다")

    road_q, road_k = _norm_addr(b["road_addr"]), _key(b["road_addr"])
    jibun_qs = await _jibuns(building_pk, b["addr"], b["bjd_code"])
    jibun_ks = {_key(q) for q in jibun_qs}

    docs: list[dict] = []
    full = False
    for q in ([road_q] if road_q else []) + jibun_qs:
        got = await _ask_kakao(q, want_more=True)
        full = full or len(got) >= MAX_PAGES * PAGE_SIZE
        docs.extend(got)
    items = _pick(docs, jibun_ks, road_k)

    # 45건에서 잘렸는지 알린다 — 「이게 전부」로 읽히면 안 된다
    out = {"items": items, "truncated": full, "source": "kakao"}
    if len(_cache) >= CACHE_MAX:
        for k in sorted(_cache, key=lambda k: _cache[k][0])[:CACHE_MAX // 5]:
            _cache.pop(k, None)
    _cache[building_pk] = (time.time(), out)
    return out
