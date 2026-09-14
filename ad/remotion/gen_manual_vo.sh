#!/usr/bin/env bash
# 매뉴얼 영상 내레이션 생성 — 타입캐스트 ssfm-v30. 문장 단위(타이밍 정밀도).
set -euo pipefail
cd "$(dirname "$0")"
source .env.local
VOICE="${1:-tc_69f2e455ea79fd197aa0476f}"   # Seohyeon
mkdir -p public/vo
i=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  i=$((i+1))
  n=$(printf "%02d" $i)
  curl -s -X POST "https://api.typecast.ai/v1/text-to-speech" \
    -H "X-API-KEY: $TYPECAST_API_KEY" -H "Content-Type: application/json" \
    -d "$(python3 -c "import json,sys;print(json.dumps({'voice_id':'$VOICE','text':sys.argv[1],'model':'ssfm-v30','language':'kor','prompt':{'emotion_preset':'normal'},'output':{'audio_format':'wav'}}))" "$line")" \
    -o "public/vo/m$n.wav" -w "m$n %{http_code}  $line\n"
done < manual_lines.txt
