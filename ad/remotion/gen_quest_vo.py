#!/usr/bin/env python3
"""퀘스트 가이드 영상 내레이션 — 타입캐스트 ssfm-v30(Seohyeon).

문장 하나 = 파일 하나 = 카메라 1구간. 길이를 재서 src/quest_vo.json 에 적어두면
Remotion 이 그 길이대로 컷을 배치한다(gen_manual_vo.py 와 같은 방식).
방법만 말한다 — 이유·장점·비교는 넣지 않는다.
"""
import contextlib
import json
import os
import sys
import urllib.request
import wave

LINES = [
    # ── 인트로 · 오늘의 퀘스트 ──
    ("i1",  "오늘 풀 퀘스트는 세 개입니다."),
    ("i2",  "하나. 사대문 안에서 조건에 맞는 매물 찾기."),
    ("i3",  "둘. 그 건물이 얼마짜리인지 따져보기."),
    ("i4",  "셋. 고객에게 내놓을 자료 만들기."),
    ("i5",  "보시고 그대로 따라 하시면 됩니다."),

    # ── 퀘스트 1 · 찾기 ──
    ("1p",  "첫 번째 퀘스트입니다. 사대문 안쪽에서, 사십억에서 육십억 사이 매물을 찾습니다."),
    ("1m",  "사대문은 행정구역이 아닙니다. 종로구도 중구도 아니고 그 사이에 걸쳐 있어서, 구나 동 단위로는 딱 떨어지지 않습니다."),
    ("1a",  "자, 해보겠습니다. 지도 도구에서 자유곡선을 고릅니다."),
    ("1b",  "사대문을 감싸듯 그립니다. 반듯하지 않아도 됩니다. 손이 지나간 자리가 그대로 검색 범위가 됩니다."),
    ("1c",  "이제 조건을 하나씩 좁혀보겠습니다."),
    ("1d",  "매매가 사십억에서 육십억. 적정가에는 오차가 있으니, 실제로는 조금 여유 있게 잡으시는 편이 좋습니다."),
    ("1e",  "역에서 삼백 미터 이내. 대지 오십 평, 연면적 백 평 이상."),
    ("1f",  "엘리베이터와 주차 각각 한 대 이상."),
    ("1g",  "마지막으로 용도입니다. 근린생활시설부터 판매·의료·업무시설까지, 상업용으로 쓸 수 있는 것만 남깁니다."),
    ("1h",  "여덟 개 조건으로 열한 건이 남았습니다."),
    ("1i",  "파란 라벨이 제 매물입니다. 일반 매물과 한눈에 구분됩니다."),

    # ── 퀘스트 2 · 값 따져보기 ──
    ("2p",  "두 번째 퀘스트입니다. 이 중 하나를 골라, 얼마짜리인지 따져봅니다."),
    ("2a",  "지도에서 제 매물을 하나 엽니다. 중구 초동 오십삼의 오."),
    ("2b",  "매매가 오십육억, 예상수익률 삼 퍼센트. 주변 실거래와 임대시세로 추정한 값입니다."),
    ("2c",  "매력도는 씨등급, 오십칠점 육 점입니다. 점수만 주고 끝내지 않습니다."),
    ("2d",  "역까지 이백육십 미터로 접근성은 우수하고 용도지역도 좋지만, 도로가 세로한면이라 접근이 아쉽고 천구백구십팔년 준공이라 연식 부담이 있습니다."),
    ("2e",  "층별 임대정보와 주변 임대시세, 주변 실거래도 함께 봅니다. 이 값들을 바탕으로 적정가가 나옵니다. 실제와 다르면 직접 고치실 수 있습니다."),
    ("2f",  "업무 탭에는 제가 적어둔 기록이 남아 있습니다."),
    ("2g",  "이 매물은 소유자가 직접 팔아달라고 연락을 주신 건이었고, 그때 통화하면서 알게 된 것들을 그날 적어뒀습니다."),
    ("2h",  "협조적인 분인지, 얼마나 급한지, 매도 의사가 확실한지."),
    ("2i",  "몇 달 뒤에 매수자가 나타나도, 이 기록을 보면 어떻게 접근해야 할지 바로 떠오릅니다. 연락처도 여기 있으니 곧장 전화할 수 있습니다."),

    # ── 퀘스트 3 · 자료 만들기 ──
    ("3p",  "마지막입니다. 고객에게 내놓을 자료를 만듭니다."),
    ("3a",  "브리핑 자료를 누르기 전에 중개인 코멘트를 넣습니다. 충무로역 도보 삼 분, 대로변 코너."),
    ("3b",  "제가 쓴 이 문장이 자료 안에 그대로 들어갑니다."),
    ("3c",  "일곱 장이 만들어집니다. 건물 개요에 방금 쓴 코멘트가 있고,"),
    ("3d",  "입체 지적도로 땅 모양과 남은 용적률을 보여주고, 층별 임대정보와 올려둔 사진·서류까지 자동으로 채워집니다."),
    ("3e",  "빌탐정 리포트는 열 장입니다. 적정가, 매력도, 실거래, 공시지가, 임대수익, 미래가치까지."),
    ("3f",  "애니메이션 모드를 켜면 이대로 발표할 수 있습니다. 방향키로 한 장씩 넘기면 됩니다."),
    ("3g",  "여기까지 전부, 버튼 한 번으로 자동으로 만들어진 것입니다."),

    ("99",  "이제 직접 해보실 차례입니다."),
]


VOICE = sys.argv[1] if len(sys.argv) > 1 else "tc_69f2e455ea79fd197aa0476f"  # Seohyeon
ONLY = set(sys.argv[2:])          # 특정 줄만 다시 뽑을 때: gen_quest_vo.py <voice> 1c 2b
KEY = next(l.split("=", 1)[1].strip().strip('"')
           for l in open(".env.local") if l.startswith("TYPECAST_API_KEY"))

os.makedirs("public/vo", exist_ok=True)
out = json.load(open("src/quest_vo.json")) if os.path.exists("src/quest_vo.json") else {}

for key, text in LINES:
    path = f"public/vo/q{key}.wav"
    if ONLY and key not in ONLY:
        continue
    if not ONLY and os.path.exists(path):        # 이미 뽑은 건 건너뛴다 — 크레딧을 아낀다
        with contextlib.closing(wave.open(path)) as w:
            out[key] = round(w.getnframes() / w.getframerate(), 3)
        print(f"q{key}  {out[key]:6.2f}s  (있음)")
        continue
    req = urllib.request.Request(
        "https://api.typecast.ai/v1/text-to-speech",
        data=json.dumps({"voice_id": VOICE, "text": text, "model": "ssfm-v30",
                         "language": "kor", "prompt": {"emotion_preset": "normal"},
                         "output": {"audio_format": "wav"}}).encode(),
        headers={"X-API-KEY": KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r, open(path, "wb") as f:
        f.write(r.read())
    with contextlib.closing(wave.open(path)) as w:
        out[key] = round(w.getnframes() / w.getframerate(), 3)
    print(f"q{key}  {out[key]:6.2f}s  {text[:44]}")

json.dump(out, open("src/quest_vo.json", "w"), ensure_ascii=False, indent=1)
print(f"\n합계 {sum(out.values()):.1f}s")
