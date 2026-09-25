"""응답 다듬기 — 화면이 읽는 칸만 내보낸다(2026-09-17).

왜: 화면 감사에서 응답 키의 절반 이상이 아무 데도 안 그려졌다(검색 72키 중 70 · 제안 82키 중 47 ·
오늘 56키 중 32). SELECT 가 넓고 `dict(r)` 로 그대로 나가서다. 모델은 그 키를 전부 읽으니
「팀 값이 없다」「추정을 못 쓴다」 같은 잡음이 거기서 났다. 여기서 한 번 걷는다.

쓰는 법: 핸들러 끝에서 `drop(d, DROP_XXX)` 또는 `[drop(x, ...) for x in rows]`.
빼는 키 목록은 핸들러 옆에 두고 왜 빼는지 한 줄 적는다 — 그 목록이 곧 응답 스키마다.
"""
from collections.abc import Iterable


def drop(d: dict, keys: Iterable[str]) -> dict:
    """키를 걷어낸 새 dict. 없는 키는 무시한다."""
    ks = set(keys)
    return {k: v for k, v in d.items() if k not in ks}


def keep(d: dict, keys: Iterable[str]) -> dict:
    """그 키만 남긴 새 dict(순서는 keys 순). 없는 키는 안 만든다."""
    return {k: d[k] for k in keys if k in d}
