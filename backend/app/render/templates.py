"""자료 템플릿 — **사용자가 고른 요청에만** 실리는 작성 규격(2026-10-06 대표).

템플릿은 「채울 칸」이 아니라 규격이다: 말투 · 구성 · 표와 그림 쓰는 법 · 지면 · 색 토큰 · 부품.
네이처셀 보고서처럼 규격만 잡아 주고 내용과 배치는 모델이 그 안에서 쓴다.

파일 하나가 정본이다(`templates/{key}/`):
  meta.json   이름 · 설명 · 지면 · 판 · 준비 여부 · 쓸 수 있는 부품
  guide.md    모델에게 주는 작성 규격(make 도구 설명에 그대로 붙는다)
  frame.css   굽는 HTML 머리에 박히는 틀 · 토큰
  sample.html 고르는 창의 미리보기
  fit.js      (있으면) 굽는 HTML 끝에 박히는 틀 스크립트 — 지시 대신 틀이 모양을 맞춘다(예: 제목 한 줄)
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

DIR = Path(__file__).parent / "templates"


@lru_cache(maxsize=None)
def _load(key: str) -> dict | None:
    d = DIR / key
    meta = d / "meta.json"
    if not meta.exists():
        return None
    m = json.loads(meta.read_text(encoding="utf-8"))
    read = lambda n: (d / n).read_text(encoding="utf-8") if (d / n).exists() else ""   # noqa: E731
    return {**m, "guide": read("guide.md"), "frame": read("frame.css"), "sample": read("sample.html"),
            "script": read("fit.js")}


def get(key: str | None) -> dict | None:
    """고른 템플릿. 없는 이름 · 준비 안 된 것은 None"""
    if not key:
        return None
    t = _load(key)
    return t if t and t.get("ready") else None


def listing() -> list[dict]:
    """고르는 창의 목록 — 준비 중인 것도 싣는다(화면이 「준비 중」으로 그린다)"""
    out = []
    for d in sorted(DIR.iterdir()):
        if (t := _load(d.name)):
            out.append({k: t.get(k) for k in ("key", "name", "desc", "kind", "size", "version", "ready")})
    order = {"promo": 0, "report": 1, "image": 2}
    return sorted(out, key=lambda t: order.get(t["key"], 9))
