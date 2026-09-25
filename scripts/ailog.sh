#!/usr/bin/env bash
# 모델 로그를 실시간으로 본다. 컨테이너가 다시 떠도 알아서 다시 붙는다.
#
#   scripts/ailog.sh            물음·도구·요청·응답 전부
#   scripts/ailog.sh 짧게       요청까지만(응답 본문은 빼고)
#   scripts/ailog.sh 전부       AI 아닌 줄까지(uvicorn 포함)
#
# `docker logs -f` 는 컨테이너가 재시작하면 그 자리에서 끝난다. 코드를 고칠 때마다
# 컨테이너를 다시 올리므로 그때마다 창이 닫혔다. 여기서는 루프가 다시 붙는다.
# 멈추려면 Ctrl-C 를 두어 번 누른다.
set -u
C="${BT_API_CONTAINER:-docker-api-1}"
case "${1:-}" in
  전부)  PAT='.' ;;
  짧게)  PAT='^AI.*(물음|도구|←|끝)' ;;
  *)     PAT='^AI' ;;
esac
trap 'echo; echo "— 그만"; exit 0' INT
while true; do
  if ! docker inspect -f '{{.State.Running}}' "$C" >/dev/null 2>&1; then
    echo "— $C 가 없다. 5초 뒤 다시 본다"; sleep 5; continue
  fi
  echo "— $C 에 붙었다 ($(date +%H:%M:%S))"
  docker logs -f --tail 0 "$C" 2>&1 | grep --line-buffered -E "$PAT"
  echo "— 끊겼다. 2초 뒤 다시 붙는다"; sleep 2
done
