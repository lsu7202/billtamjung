"""카카오 로컬 API — 키워드로 장소 검색. 검색 필터 biz 계열이 쓴다(2026-09-16).

왜 카카오인가: 우리 원천(인허가 원장·상가정보)은 「의원」「기타 교육」처럼 뭉뚱그려져 있어
「유앤아이의원」이 피부과라는 사실이 어디에도 없다. 카카오는 그걸 `category_name` 으로 갖고 있고
(「의료,건강 > 병원 > 피부과」), 키워드 검색 자체가 그 분류를 타므로 「피부과」로 물으면 상호에
피부과가 없는 의원까지 나온다. 실측(성수동2가 1km): 피부과 14건 중 상호에 낱말 없는 곳 다수.

약관: 응답을 **저장하지 않는다.** 요청 처리 중에만 메모리에 두고 좌표를 우리 건물과 맞춘 뒤 버린다.
한도: **한 질의당 45건**(`pageable_count` 최대 45 문서). 문서엔 「45쪽」이라 적혀 있지만 실측(2026-09-16)은
  총 55건 타일도 45건만 주고 그 뒤 쪽은 같은 문서를 되풀이한다. 그래서 `total_count` > 45 면 rect 를
  넷으로 쪼개 다시 부른다. 서울 전역 「피부과」(2,079건)는 이렇게 백여 타일이 된다.
쿼터: 키워드 검색 일 10만 건 무료, 초과 2원/건.
"""
import asyncio
import httpx
from fastapi import HTTPException
from .config import settings

_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
_SIZE = 15
_CAP = 45                      # 한 질의가 실제로 주는 최대 문서 수(실측)
_MAX_DEPTH = 9                 # 4^9 까지 — 서울(0.43°)을 9번 반으로 접으면 한 변 ~75m. 그 안에 45곳 넘는
                               # 건 메디컬타워 한 동 정도라 거기서 멈춰도 그 건물은 이미 잡힌다
_MIN_SIDE = 0.0005             # 이보다 작은 타일(~50m)은 더 안 쪼갠다
_sem = asyncio.Semaphore(8)    # 동시 요청 상한
_client: httpx.AsyncClient | None = None

Rect = tuple[float, float, float, float]   # (x1, y1, x2, y2) = (좌측 경도, 좌측 위도, 우측 경도, 우측 위도)


def _key() -> str:
    k = settings.kakao_rest_key or settings.kakao_client_id
    if not k:
        raise HTTPException(503, "카카오 REST API 키가 없다(BT_KAKAO_REST_KEY 또는 BT_KAKAO_CLIENT_ID)")
    return k


def _cli() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=10)
    return _client


async def _page(q: str, rect: Rect, page: int) -> dict:
    async with _sem:
        r = await _cli().get(_URL, headers={"Authorization": f"KakaoAK {_key()}"},
                             params={"query": q, "rect": ",".join(f"{v:.7f}" for v in rect),
                                     "page": page, "size": _SIZE})
    if r.status_code != 200:
        # **조용히 빈 결과로 넘기지 않는다.** 필터가 빠진 채 전체가 나가면 그게 거짓말이다.
        raise HTTPException(502, f"카카오 검색 실패 {r.status_code}: {r.text[:200]}")
    return r.json()


def _split(rect: Rect) -> list[Rect]:
    x1, y1, x2, y2 = rect
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    return [(x1, y1, mx, my), (mx, y1, x2, my), (x1, my, mx, y2), (mx, my, x2, y2)]


async def _tile(q: str, rect: Rect, depth: int, out: dict[str, dict],
                cut: list[int] | None = None) -> None:
    first = await _page(q, rect, 1)
    meta = first["meta"]
    small = (rect[2] - rect[0]) < _MIN_SIDE or (rect[3] - rect[1]) < _MIN_SIDE
    if meta["total_count"] > _CAP:
        if depth < _MAX_DEPTH and not small:
            await asyncio.gather(*(_tile(q, r, depth + 1, out, cut) for r in _split(rect)))
            return
        # 더 못 쪼갠다. 45건만 가져가고 나머지는 **버린다.** 조용히 넘기지 않고 세어 둔다 —
        # 「피부과 42곳」이 진짜 42곳인지 상한에 걸린 것인지 답이 갈린다(2026-09-19).
        if cut is not None:
            cut.append(meta["total_count"] - _CAP)
    for d in first["documents"]:
        out[d["id"]] = d
    if meta["is_end"]:
        return
    last = -(-min(meta["pageable_count"], _CAP) // _SIZE)     # 45건이면 3쪽
    pages = await asyncio.gather(*(_page(q, rect, p) for p in range(2, last + 1)))
    for j in pages:
        for d in j["documents"]:
            out[d["id"]] = d


async def keyword_search(q: str, rect: Rect, cut: list[int] | None = None) -> list[dict]:
    """rect 안에서 q 로 장소 검색. 45건 한도를 넘는 타일은 넷으로 쪼개 전부 받는다.
    반환: 카카오 문서 그대로(id · place_name · category_name · x · y …). 겹치는 타일 경계는 id 로 합친다.

    `cut` 을 주면 **버린 건수**가 거기 쌓인다. 더 못 쪼개는 타일에서 45건만 가져갈 때다.
    부르는 쪽이 「결과가 전부가 아닐 수 있다」를 말할 근거다."""
    out: dict[str, dict] = {}
    await _tile(q, rect, 0, out, cut)
    return list(out.values())
