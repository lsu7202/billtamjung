#!/usr/bin/env bash
# 개발 서버 배포 — bt-api-dev(Cloud Run·유휴 0원) + 프런트 프리뷰 채널(dev).
# 운영서버(bt-api)는 절대 안 건드린다 — 서비스 이름·시크릿·DB 전부 dev 전용.
set -euo pipefail
PROJECT=billtamjung; REGION=asia-northeast3; DB_INSTANCE=bt-pg
# 로그인 빗장(2026-08-20) — 설문 링크를 밖으로 뿌리는 동안 **이 이메일만** 들어온다.
# 비우면 아무나 로그인된다(운영과 같은 상태). 열려면: LOGIN_ALLOW= ./deploy_dev.sh
LOGIN_ALLOW="${LOGIN_ALLOW-coms1768@gmail.com}"
IMG="$REGION-docker.pkg.dev/$PROJECT/bt/api:dev-$(date +%Y%m%d-%H%M)"
CONN=$(gcloud sql instances describe "$DB_INSTANCE" --project="$PROJECT" --format='value(connectionName)')
cd "$(dirname "$0")/../../backend"
gcloud auth configure-docker "$REGION-docker.pkg.dev" -q
docker build --platform linux/amd64 -t "$IMG" . && docker push "$IMG"
gcloud run deploy bt-api-dev --project="$PROJECT" --region="$REGION" \
  --image="$IMG" --allow-unauthenticated \
  --add-cloudsql-instances="$CONN" \
  --min-instances=0 --max-instances=1 --memory=512Mi \
  --set-secrets=BT_DATABASE_URL=bt-db-url-dev:latest \
  --update-env-vars="^##^BT_SIGNUPS_OPEN=true##BT_LOGIN_ALLOW=${LOGIN_ALLOW}"
API_DEV=$(gcloud run services describe bt-api-dev --project="$PROJECT" --region="$REGION" --format='value(status.url)')
echo "── 프런트 프리뷰 채널(dev)"
# 프런트는 /api 리라이트로 API 를 부른다 — 그 리라이트 대상이 firebase.json 에 박혀 있어
# 기본 설정으로 채널을 올리면 **dev 화면이 운영 API 를 본다**(2026-08-15 함정).
# 그래서 dev 는 firebase.dev.json(= /api → bt-api-dev)으로 배포한다.
cd ../frontend && npx vite build && cd ..
npx firebase-tools hosting:channel:deploy dev --project "$PROJECT" --config firebase.dev.json --expires 30d
echo "✅ dev: API=$API_DEV · 웹 URL은 위 채널 출력 참고"
