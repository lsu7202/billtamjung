"""Anthropic 호출 한 곳. 벤더가 여기 말고 어디에도 안 나온다.

## 왜 벤더 하나인가

둘이면 프롬프트도 둘, 장애 대응도 둘, 출력 결이 달라 화면에 두 목소리가 선다.
가용성 때문에 두 번째를 둘 이유도 없다 — 모델이 죽으면 그 문단이 안 그려질 뿐
숫자 화면은 그대로 살기 때문이다(조용한 실패).

## 키

`BT_ANTHROPIC_API_KEY`. **서버에만 있고 프론트로 절대 안 간다.**
비어 있으면 `AiUnavailable("AI_NOT_CONFIGURED")` 를 던진다. 소셜 로그인 키가
없을 때 503 을 내는 것과 같은 어법이다.

## 오류

문구를 여기서 짓지 않는다. 코드만 던지고 문구는 `ref.error_msg` 에서 온다.
그래야 문구를 고칠 때 배포를 안 한다(§21-1).
"""
from __future__ import annotations

import anthropic

from ..core.config import settings

# 모델이 죽거나 늦을 때 던지는 코드. ref.error_msg 의 열쇠와 같은 말이어야 한다
NOT_CONFIGURED = "AI_NOT_CONFIGURED"
UPSTREAM_DOWN = "AI_UPSTREAM_DOWN"
TIMEOUT = "AI_TIMEOUT"
TOO_LONG = "AI_TOO_LONG"


class AiUnavailable(Exception):
    """모델 쪽 사정으로 못 답한다. `code` 는 ref.error_msg 의 열쇠다."""

    def __init__(self, code: str, detail: str | None = None):
        super().__init__(code)
        self.code = code
        self.detail = detail


_client: anthropic.AsyncAnthropic | None = None


def configured() -> bool:
    return bool(settings.anthropic_api_key)


def client() -> anthropic.AsyncAnthropic:
    global _client
    if not configured():
        raise AiUnavailable(NOT_CONFIGURED)
    if _client is None:
        _client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            # 늦은 것과 죽은 것을 가른다. 스트림은 첫 글자만 빨리 오면 되므로 넉넉하게
            timeout=120.0,
            max_retries=2,
        )
    return _client


def as_code(e: Exception) -> str:
    """SDK 예외를 우리 오류 코드로. 모르는 것은 전부 UPSTREAM_DOWN 이다."""
    if isinstance(e, AiUnavailable):
        return e.code
    if isinstance(e, anthropic.APITimeoutError):
        return TIMEOUT
    if isinstance(e, anthropic.BadRequestError):
        # 지금은 대화가 너무 긴 것 말고 사용자 잘못으로 400 이 날 일이 없다
        return TOO_LONG
    return UPSTREAM_DOWN
