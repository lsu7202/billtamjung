#!/usr/bin/env bash
# 내레이션 재생성 — 타입캐스트 API. 사용: ./gen_vo.sh [voice_id]
# 카피 바뀌면 아래 배열 수정. 키는 .env.local(git 제외).
set -euo pipefail
source "$(dirname "$0")/.env.local"
VOICE="${1:-tc_694395d43f2c8d9d43e9a897}"   # Byunghun(차분 저음)
LINES=("좋은 건물은," "매물로 나오지 않습니다." "그래서, 직접 찾아냅니다." "빌탐정")
i=1
for t in "${LINES[@]}"; do
  curl -s -X POST "https://api.typecast.ai/v1/text-to-speech" \
    -H "X-API-KEY: $TYPECAST_API_KEY" -H "Content-Type: application/json" \
    -d "{\"voice_id\":\"$VOICE\",\"text\":\"$t\",\"model\":\"ssfm-v30\",\"language\":\"kor\",\"prompt\":{\"emotion_preset\":\"tonedown\"},\"output\":{\"audio_format\":\"wav\"}}" \
    -o "public/vo$i.wav" -w "vo$i: %{http_code}\n"
  i=$((i+1))
done
