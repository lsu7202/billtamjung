#!/usr/bin/env bash
# API 배포 — 이미지 빌드(linux/amd64)→Artifact Registry 푸시→Cloud Run 배포.
# 사용: PROJECT=<id> DB_PASS=<pw> ./deploy_api.sh
set -euo pipefail
PROJECT="${PROJECT:?}"; DB_PASS="${DB_PASS:?}"
REGION="${REGION:-asia-northeast3}"
DB_INSTANCE="${DB_INSTANCE:-bt-pg}"
BUCKET="${BUCKET:-${PROJECT}-bt-artifacts}"
FRONTEND_BASE="${FRONTEND_BASE:?FRONTEND_BASE=https://<hosting도메인> 필요}"   # OAuth 콜백·CORS
SIGNUPS_OPEN="${SIGNUPS_OPEN:-true}"   # false면 신규 가입(이메일·소셜) 차단 — 기존 회원 로그인은 유지
IMG="$REGION-docker.pkg.dev/$PROJECT/bt/api:$(date +%Y%m%d-%H%M)"
CONN=$(gcloud sql instances describe "$DB_INSTANCE" --project="$PROJECT" --format='value(connectionName)')

cd "$(dirname "$0")/../../backend"

echo "── 빌드·푸시 ($IMG)"
gcloud auth configure-docker "$REGION-docker.pkg.dev" -q
docker build --platform linux/amd64 -t "$IMG" .
docker push "$IMG"

echo "── Cloud Run 배포"
# --no-cpu-throttling: BackgroundTasks(보고서 생성)가 응답 후에도 CPU 유지돼야 함
# DSN: asyncpg가 `@/db?host=/cloudsql/..` 형식을 오파싱(비번→포트) → 소켓경로 percent-인코딩해 host 위치에
# env 구분자: DSN에 @가 있어 ^@^ 불가 → ^##^
HOSTENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote('/cloudsql/${CONN}',safe=''))")
gcloud run deploy bt-api --project="$PROJECT" --region="$REGION" \
  --image="$IMG" --allow-unauthenticated \
  --min-instances=1 --max-instances=4 --memory=1Gi --cpu=1 --no-cpu-throttling \
  --add-cloudsql-instances="$CONN" \
  --update-secrets="BT_JWT_SECRET=bt-jwt-secret:latest" \
  --set-env-vars="^##^BT_DATABASE_URL=postgresql://postgres:${DB_PASS}@${HOSTENC}/billtamjung##BT_GCS_BUCKET=${BUCKET}##BT_FRONTEND_BASE=${FRONTEND_BASE}##BT_CORS_ORIGINS=${FRONTEND_BASE}##BT_SIGNUPS_OPEN=${SIGNUPS_OPEN}"

URL=$(gcloud run services describe bt-api --region="$REGION" --format='value(status.url)')
echo "── 헬스체크"; curl -s "$URL/health"; echo
echo "✅ API 배포 완료: $URL"
