"""건축물대장 층 표기 정규화 — 층별개요(mart_djy_04 idx21)의 표기가 제각각이라 통일한다.

같은 3층인데 원본이 '3층'·'3'·'지상3층'·'삼층'으로 흩어져 있어서, 문자열로 층을 맞추는 곳이
전부 어긋났다(실측: 종로2가 71-6은 층이 '6'·'지1'이라 주변 임대시세가 층 매칭에 실패해
보증금·임대료가 통째로 비었다).

정규 표기
  지상  → 'N층'      · 지하 → '지하N층'
  옥탑  → '옥탑N층'  · 중층 → '중N층'

애매한 것은 억지로 맞추지 않고 원본을 그대로 둔다(kind='raw'). 층을 지어내면 면적·임대료가
엉뚱한 층에 붙어 더 나쁘다.
"""
from __future__ import annotations

import re

_HAN = {"일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "칠": 7, "팔": 8, "구": 9, "십": 10}

# 원본에 섞여 있는 잡음 — 층 판정에 영향이 없는 장식만 제거한다.
_NOISE = re.compile(r"[\s()（）\[\]]|제")


def normalize(raw: str | None) -> tuple[str | None, str]:
    """(정규 표기, 종류) 반환. 종류 = ground|basement|roof|mezzanine|raw|empty."""
    if raw is None:
        return None, "empty"
    s = _NOISE.sub("", str(raw)).strip()
    if not s:
        return None, "empty"

    # '내' 계열 — 같은 건물에 '1층'과 '내1층'이 함께 있는 경우가 99%(1,965건물 중 1,946).
    # 시장 건물의 내부 구획 같은 별개 공간이라 합치면 면적이 이중 계상된다 → 별도 라벨로 통일.
    m = re.fullmatch(r"내(.+)|(.+)내", s)
    if m and s != "내":
        inner = m.group(1) or m.group(2)
        lb, kind = normalize(inner)
        if kind not in ("raw", "empty"):
            return f"내{lb}", kind

    # 이미 정규 표기면 그대로
    m = re.fullmatch(r"(지하)?(\d+)층", s)
    if m:
        n = int(m.group(2))
        return (f"지하{n}층" if m.group(1) else f"{n}층"), ("basement" if m.group(1) else "ground")

    # 한글 수사(일층·이층…) — 한 자리만 취급
    m = re.fullmatch(r"([일이삼사오육칠팔구십])층", s)
    if m:
        return f"{_HAN[m.group(1)]}층", "ground"

    # 옥탑 — 옥탑N층 · 옥탑N · 옥N · 옥탑(번호 없음=1)
    m = re.fullmatch(r"옥(?:탑)?(\d*)층?", s)
    if m:
        n = int(m.group(1)) if m.group(1) else 1
        return f"옥탑{max(n, 1)}층", "roof"      # '옥탑0층'도 1층으로(0층은 없다)

    # 중층(메자닌) — 중N층 · 중층
    m = re.fullmatch(r"중(\d*)층", s)
    if m:
        n = int(m.group(1)) if m.group(1) else 1
        return f"중{n}층", "mezzanine"

    # 지하 — 지하N층 · 지하N · 지N층 · 지N · 지층 · 지하(번호 없음=1)
    m = re.fullmatch(r"지(?:하)?(\d*)층?", s)
    if m:
        n = int(m.group(1)) if m.group(1) else 1
        return f"지하{n}층", "basement"

    # 영문 표기 — 팀이 직접 칠 때 흔하다. B1·B1F=지하1층 · 3F=3층 · RF=옥탑1층
    m = re.fullmatch(r"[Bb](\d+)[Ff]?", s)
    if m:
        return f"지하{int(m.group(1))}층", "basement"
    m = re.fullmatch(r"(\d+)[Ff]", s)
    if m:
        return f"{int(m.group(1))}층", "ground"
    if re.fullmatch(r"[Rr][Ff]?(\d*)", s):
        n = re.sub(r"\D", "", s)
        return f"옥탑{int(n) if n else 1}층", "roof"

    # 지상 — 지상N층 · 지상N
    m = re.fullmatch(r"지상(\d+)층?", s)
    if m:
        return f"{int(m.group(1))}층", "ground"

    # 숫자만 — '3' → 3층
    m = re.fullmatch(r"(\d+)", s)
    if m:
        return f"{int(m.group(1))}층", "ground"

    # 그 밖(내1층·2층이상·지하1층.1층 등)은 판정하지 않고 원본 보존
    return str(raw).strip(), "raw"


def signed(label: str | None) -> int | None:
    """정렬·매칭용 서명 층수. 지하=음수 · 옥탑=지상 최상단 위(1000+n) · 중층=지상n."""
    if not label:
        return None
    lb, kind = normalize(label)
    if lb is None:
        return None
    n = int(re.sub(r"\D", "", lb) or 0)
    if kind == "basement":
        return -n
    if kind == "roof":
        return 1000 + n
    return n
