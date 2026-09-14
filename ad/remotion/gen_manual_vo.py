#!/usr/bin/env python3
"""매뉴얼 영상 내레이션 — 타입캐스트 ssfm-v30. 문장 단위(카메라 이동 1구간 = 1파일)."""
import contextlib, json, os, sys, urllib.request, wave

LINES = [
    ("00", "빌탐정으로 건물을 찾고, 분석하고, 리포트까지 만드는 과정을 보여드리겠습니다."),
    ("01a", "주소를 알고 있다면 검색창에 입력합니다. 동 이름이나 역 이름으로도 찾습니다."),
    ("01b", "고르면 왼쪽에 요약 카드가 뜹니다."),
    ("01c", "상세보기를 누르면 건물의 모든 정보가 열립니다."),
    ("02a", "주소를 모를 때는 필터를 씁니다. 먼저 지역을 정하고,"),
    ("02b", "왼쪽에서 분야를 고른 뒤,"),
    ("02c", "원하는 조건을 누릅니다."),
    ("02d", "값은 슬라이더로 끌거나 숫자를 직접 입력합니다."),
    ("02e", "지정한 조건은 위에 쌓이고,"),
    ("02f", "적용을 누르면 결과가 나옵니다."),
    ("02g", "매매가와 수익률은 물론, 용적률 여유분이나 오래 거래가 없던 건물처럼 남들이 안 보는 조건도 걸 수 있습니다."),
    ("03a", "행정동으로 자를 수 없는 범위는 지도에 직접 그립니다."),
    ("03b", "자유곡선으로 그리거나, 자석 올가미를 쓰면 필지 경계에 자동으로 붙습니다."),
    ("03c", "그린 영역 안쪽만 결과에 남습니다."),
    ("04a", "건물을 열면 결론이 먼저 보입니다. 빌탐정 적정가는 주변 실거래를 토지와 건물 가치로 나눠 비교하고, 연식과 거래 시점을 보정한 값입니다."),
    ("04b", "실거래가, 공시지가와 나란히 비교되고,"),
    ("04c", "예상수익률과,"),
    ("04d", "매력도 등급이 이어집니다."),
    ("05a", "정보가 실제와 다르면 값을 클릭해 바로 고칩니다. 자동 저장되고 원본은 보존됩니다."),
    ("05b", "층을 누르면 호실이 펼쳐지고,"),
    ("05c", "아는 계약만 입력하면 수익률이 추정이 아닌 실측 기준으로 바뀝니다."),
    ("06a", "마지막은 리포트입니다. 계산에 쓰인 주변 거래가 모두 나열됩니다."),
    ("06b", "맞지 않는 사례는 체크를 해제해 뺍니다."),
    ("06c", "조정할 때마다 적정가가 다시 계산되고, 여기까지는 크레딧이 들지 않습니다."),
    ("06d", "생성을 누르면 리포트가 만들어집니다."),
    ("r1",  "표지부터 핵심 요약, 가격 근거, 주변 거래, 수익 분석까지 열 장이 순서대로 채워집니다."),
    ("r2",  "적정가와 예상수익률, 매력도 등급은 첫 장에 정리되고,"),
    ("r3",  "전체화면으로 열어 고객 앞에서 그대로 발표할 수 있습니다."),
    ("07", "검색과 상세 조회는 무료입니다. 써보시고 불편한 점을 알려주세요."),
]
VOICE = sys.argv[1] if len(sys.argv) > 1 else "tc_69f2e455ea79fd197aa0476f"  # Seohyeon
KEY = next(l.split("=", 1)[1].strip() for l in open(".env.local") if l.startswith("TYPECAST_API_KEY"))
os.makedirs("public/vo", exist_ok=True)
out = {}
for key, text in LINES:
    path = f"public/vo/m{key}.wav"
    req = urllib.request.Request(
        "https://api.typecast.ai/v1/text-to-speech",
        data=json.dumps({"voice_id": VOICE, "text": text, "model": "ssfm-v30", "language": "kor",
                         "prompt": {"emotion_preset": "normal"},
                         "output": {"audio_format": "wav"}}).encode(),
        headers={"X-API-KEY": KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r, open(path, "wb") as f:
        f.write(r.read())
    with contextlib.closing(wave.open(path)) as w:
        dur = w.getnframes() / w.getframerate()
    out[key] = round(dur, 3)
    print(f"m{key}  {dur:6.2f}s  {text[:40]}")
json.dump(out, open("src/manual_vo.json", "w"), indent=1)
print(f"\n합계 {sum(out.values()):.1f}s")
