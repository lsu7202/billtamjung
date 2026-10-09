"""굽기 — 모델이 쓴 `src_html` 에 틀을 박아 완성 HTML 로 낸다. 정본 10-AI-어시스턴트 §11-1.

**원본과 구운 것을 나눈 게 뼈대다.** 원본이 있어야 부분 수정이 된다. 굳히는 건 내보낸 판 하나뿐이다.

틀은 둘로 나뉜다(2026-10-06 대표).
  · 템플릿을 안 고른 자료   artifact.css(slide 한 클래스)뿐. 부품 · 색 토큰이 없다 — 늘 있으면 모델이 늘 끼워 넣었다
  · 템플릿을 고른 자료      그 템플릿의 frame.css(토큰 · 지면)와 템플릿이 허락한 부품(render/parts.py)
"""
from __future__ import annotations

import html
from pathlib import Path

from . import parts, templates

_CSS = (Path(__file__).parent / "artifact.css").read_text(encoding="utf-8")


# ── 한 판 굽기 ────────────────────────────────────────────────────────────
async def bake(src_html: str, *, kind: str = "slides", title: str = "",
               template: str | None = None, team_id: int | None = None, account_id: int | None = None) -> str:
    """`src_html` → 완성 HTML. 템플릿이 있으면 그 틀과 부품을 쓴다(team_id = 사무소 부품의 주인)."""
    t = templates._load(template) if template else None     # 만든 뒤 준비 상태가 바뀌어도 그 판으로 굽는다
    css = _CSS + ("\n" + t["frame"] if t else "") + "\n.bt-upload{width:100%; height:100%; object-fit:cover; display:block}"
    # 템플릿 부품은 고른 템플릿에서만, 올린 이미지(bt-upload)는 늘(사용자가 직접 올린 것이다)
    body = await parts.fill(src_html or "", set(t.get("parts") or []) if t else set(), team_id, account_id)
    cls = {"doc": "doc", "promo": "promo"}.get(kind, "slides")
    script = f"<script>{t['script']}</script>" if t and t.get("script") else ""
    # 인쇄 — 자료는 샌드박스 iframe(다른 출처)이라 바깥이 print() 를 직접 못 부른다(SecurityError).
    # 바깥은 「bt-print」 메시지만 보내고 안쪽이 스스로 인쇄한다(10-06 「PDF 저장 동작 안 함」)
    script += '<script>addEventListener("message",function(e){if(e.data==="bt-print")print()})</script>'
    return (f'<!doctype html><html lang="ko"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">'
            f"<title>{html.escape(title or '자료')}</title><style>{css}</style></head>"
            f'<body class="{cls}">{body}{script}</body></html>')
