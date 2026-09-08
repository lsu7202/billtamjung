"""나가는 문 — 고유식별정보를 지운다. 경계 ② (10-AI-어시스턴트 §3 · §22)

## 무엇을 지우나

B 경로(처리방침 공개)로 가므로 **이름·전화는 나간다.** 지우는 것은 국외이전과 별개로
처리 자체가 제한되는 것들이다.

    주민등록번호 · 외국인등록번호     제24조의2. 동의를 받아도 안 된다
    여권 · 운전면허                   고유식별정보
    카드번호                          결제 정보
    계좌번호(추정)                    전화번호 꼴이 아닌 11~14자리 하이픈 묶음

## 어디서

두 군데 다 지난다(§7). 사용자 입력만 막으면 **도구가 퍼 온 값으로 새어 나간다.**

    ③e  사용자 입력 → scrub → 모델
    ④   도구 결과   → scrub → 모델

## 규칙으로 한다

파서를 34%에서 0%로 내린 그 방식이다. 못 잡는 것이 있으면 `qa/ai/scrub_cases.py` 에
문장을 넣고 규칙을 늘린다. **의심스러우면 지운다.** 전화번호·날짜·지번·면적은 살아야 한다.

## 못 하는 것

글자에만 먹는다. 스캔 이미지 속 주민번호는 그림이라 못 본다(§15-1).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# 앞 6자리(YYMMDD) + 뒤 7자리. 뒤 첫 자리 1~8(내·외국인). 뒤가 별표로 가려진 것도 잡는다
_RRN = re.compile(r"(?<!\d)(\d{6})\s?[-–]?\s?([1-8](?:\d{6}|[\d*]{6}))(?!\d)")
# 여권: 옛 꼴 M12345678 · 새 꼴 M123A4567 (두 번째 글자 자리에 영문 허용)
_PASSPORT = re.compile(r"(?<![A-Z0-9])[A-Z](?:\d{8}|\d{3}[A-Z]\d{4})(?![A-Z0-9])")
# 운전면허 12-34-567890-12
_LICENSE = re.compile(r"(?<!\d)\d{2}[-–]\d{2}[-–]\d{6}[-–]\d{2}(?!\d)")
# 카드 4-4-4-4
_CARD = re.compile(r"(?<!\d)\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}(?!\d)")
# 전화 꼴 — 이건 지우면 안 된다. 계좌 추정에서 제외하려고 둔다
_PHONE = re.compile(r"(?<!\d)(?:01[016789]|02|0[3-6][1-5]|070|050\d?)[-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)")
# 계좌 추정: 하이픈 2~3개로 묶인 11~14자리. 전화 꼴은 위에서 먼저 보호한다
_ACCOUNT = re.compile(r"(?<!\d)\d{2,6}[-–]\d{2,6}[-–]\d{2,8}(?:[-–]\d{1,4})?(?!\d)")

_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("주민번호", _RRN),
    ("운전면허", _LICENSE),
    ("카드번호", _CARD),
    ("여권번호", _PASSPORT),
]


@dataclass
class Scrubbed:
    text: str
    hits: list[str] = field(default_factory=list)   # 지운 갈래. 화면이 「가린 게 있다」를 말할 근거

    @property
    def dirty(self) -> bool:
        return bool(self.hits)


def scrub(text: str) -> Scrubbed:
    """고유식별정보를 `[갈래]` 로 바꾼다. 원문은 건드리지 않고 사본을 낸다."""
    if not text:
        return Scrubbed(text)
    hits: list[str] = []

    def _mark(kind: str):
        def _f(m: re.Match[str]) -> str:
            hits.append(kind)
            return f"[{kind}]"
        return _f

    out = text
    for kind, pat in _RULES:
        out = pat.sub(_mark(kind), out)

    # 계좌는 전화를 먼저 지켜 둔 뒤 잰다. 전화를 자리표시로 빼고, 계좌를 지우고, 전화를 되돌린다.
    # 하이픈 묶음이라고 다 계좌가 아니다 — 날짜(8자리)·사업자번호(10자리)가 걸렸다(회귀 2건).
    # **숫자가 11자리 이상**일 때만 계좌로 본다. 국내 계좌는 11~14자리다.
    phones: list[str] = []
    def _keep(m: re.Match[str]) -> str:
        phones.append(m.group(0))
        return f"\x00{len(phones) - 1}\x00"
    def _acct(m: re.Match[str]) -> str:
        if sum(ch.isdigit() for ch in m.group(0)) < 11:
            return m.group(0)
        hits.append("계좌번호")
        return "[계좌번호]"
    tmp = _PHONE.sub(_keep, out)
    tmp = _ACCOUNT.sub(_acct, tmp)
    out = re.sub(r"\x00(\d+)\x00", lambda m: phones[int(m.group(1))], tmp)

    return Scrubbed(out, hits)


def scrub_obj(obj):
    """dict·list 안의 문자열을 전부 지운다. 도구 결과에 쓴다(④). 숫자·None 은 그대로."""
    if isinstance(obj, str):
        return scrub(obj).text
    if isinstance(obj, list):
        return [scrub_obj(x) for x in obj]
    if isinstance(obj, dict):
        return {k: scrub_obj(v) for k, v in obj.items()}
    return obj
