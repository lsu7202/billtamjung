#!/usr/bin/env python3
"""편집표를 녹화 마크에서 뽑는다.

핵심 규칙 두 가지 — 앞선 판이 여기서 무너졌다.
  ① 원본 시각은 **앞으로만** 간다. 뒤로 돌아가면 같은 화면이 두 번 나온다.
  ② 문장은 자기가 설명하는 조작보다 **먼저 시작하지 않는다**. 늦으면 장면을 씹는다.

각 문장에 '어느 조작을 설명하는지'만 적어두면, 커서를 앞으로 굴리며 자리를 잡는다.
"""
import json
import pathlib

MARKS = json.loads(pathlib.Path("src/quest_marks.json").read_text())
VO = json.loads(pathlib.Path("src/quest_vo.json").read_text())

GAP = 0.4      # 문장 사이 숨
LEAD = 0.3     # 조작 직전부터 보여준다
FAST = 3       # 생성 대기 배속


def at(kind: str, label: str) -> float:
    for m in MARKS:
        if m["kind"] == kind and m["label"] == label:
            return m["t"]
    raise SystemExit(f"마크를 못 찾음: {kind} / {label}")


def click_after(t0: float, t1: float):
    for m in MARKS:
        if m["kind"] == "click" and t0 <= m["t"] <= t1 and "x" in m:
            return {"zx": m["x"], "zy": m["y"], "zt": round(m["t"] - t0, 2)}
    return {}


# (퀘스트, 문장, 이 문장이 설명하는 조작[, 완료표시])
PLAN = [
    (0, "00",  ("ready", "로그인 완료")),
    (1, "1p",  ("point", "자유곡선 자리")),
    (1, "1m1", ("point", "필터 자리")),
    (1, "1ab", ("box",   "자유곡선 켜기")),
    (1, "1c",  ("draw",  "그리기 시작")),
    (1, "1d",  ("draw",  "그리기 끝")),
    (1, "1n",  ("box",   "필터 열기")),
    (1, "1e",  ("click", "필터 열기")),
    (1, "1f",  ("box",   "매매가")),
    (1, "1x",  ("type",  "60억")),
    (1, "1g",  ("box",   "토지이용상황")),
    (1, "1h",  ("box",   "주용도")),
    (1, "1i",  ("box",   "역과의거리")),
    (1, "1j",  ("box",   "적용"), True),

    (2, "2p",  ("done",  "퀘스트 1 완료")),
    (2, "2a",  ("box",   "매물 고르기")),
    (2, "2m",  ("point", "매물 분석하기 자리")),
    (2, "2b",  ("box",   "매물 분석하기")),
    (2, None,  ("gen",   "리포트 생성 시작")),
    (2, "2c",  ("gen",   "리포트 생성 끝")),
    (2, "2d",  ("box",   "리포트 실거래가 분석")),
    (2, "2e",  ("box",   "리포트 공시지가 분석")),
    (2, "2f",  ("box",   "리포트 임대수익 분석")),
    (2, "2g",  ("box",   "리포트 종합 결론"), True),

    (3, "3p",  ("done",  "퀘스트 2 완료")),
    (3, "3m",  ("box",   "업로드 사진")),
    (3, "3a",  ("box",   "브리핑 자료")),
    (3, None,  ("gen",   "브리핑 생성 시작")),
    (3, "3b",  ("gen",   "브리핑 생성 끝")),
    (3, "3c",  ("box",   "브리핑 입체 지적도")),
    (3, "3d",  ("box",   "브리핑 층별 임대정보"), True),
]

FAST_END = {"리포트 생성 시작": ("gen", "리포트 생성 끝"),
            "브리핑 생성 시작": ("gen", "브리핑 생성 끝")}

out, cur, total, warn = [], 0.0, 0.0, []
for row in PLAN:
    q, k, anc = row[0], row[1], row[2]
    clear = len(row) > 3 and row[3]
    a = at(*anc)

    if k is None:                                    # 생성 대기 — 통째로 빨리감기
        f1 = at(*FAST_END[anc[1]])
        f0 = max(cur, a)
        out.append({"quest": q, "from": round(f0, 2), "to": round(f1, 2), "fast": FAST})
        cur, total = f1, total + (f1 - f0) / FAST
        continue

    need = VO[k] + GAP
    f0 = max(cur, a - LEAD)                          # 앞으로만 · 조작보다 먼저 시작하지 않는다
    f1 = f0 + need
    if f0 > a + 0.6:
        warn.append(f"{k} 조작 {a:.1f}s → 시작 {f0:.1f}s (+{f0 - a:.1f})")
    out.append({"quest": q, "from": round(f0, 2), "to": round(f1, 2), "k": k,
                **click_after(f0, f1), **({"clearAtEnd": True} if clear else {})})
    cur, total = f1, total + need

pathlib.Path("src/quest_parts.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
print(f"조각 {len(out)}개 · 본편 {total:.1f}초 (+아웃트로 3.2 = {total + 3.2:.1f}초)")
print("겹침 없음 — 원본 시각이 앞으로만 진행")
print("조작보다 늦게 시작:", " | ".join(warn) if warn else "없음")
