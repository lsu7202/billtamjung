#!/usr/bin/env bash
# 베타 실시간 로그 — 누가 지금 무엇을 누르고 있는지 한 줄씩 흘려본다.
#
#   scripts/beta_tail.sh          # 전부
#   scripts/beta_tail.sh 검색     # 자동완성 검색어만
#   scripts/beta_tail.sh 오류     # 4xx·5xx만
#
# 포맷은 beta_tail.py 가 맡는다(gcloud --format 을 쓰면 스트리밍이 막힌다 — 그쪽 주석 참고).
set -euo pipefail

MODE="${1:-전부}"
FILTER='resource.type="cloud_run_revision" AND resource.labels.service_name="bt-api" AND httpRequest.requestMethod!=""'
case "$MODE" in
  검색) FILTER="$FILTER"' AND httpRequest.requestUrl:"suggest"' ;;
  오류) FILTER="$FILTER"' AND httpRequest.status>=400' ;;
esac

echo "▶ 실시간 로그 · ${MODE} — 끊으려면 Ctrl+C"
gcloud beta logging tail "$FILTER" --project=billtamjung 2>/dev/null \
  | python3 -u "$(dirname "$0")/beta_tail.py"
