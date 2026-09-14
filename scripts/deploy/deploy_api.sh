#!/usr/bin/env bash
# API 배포 — 이미지 빌드(linux/amd64)→Artifact Registry 푸시→Cloud Run 배포.
# 사용: PROJECT=<id> ./deploy_api.sh
# DB DSN은 Secret Manager(bt-db-url)에서 온다 — 평문 비밀번호를 인자로 받지 않는다.
set -euo pipefail
PROJECT="${PROJECT:?}"
REGION="${REGION:-asia-northeast3}"
DB_INSTANCE="${DB_INSTANCE:-bt-pg}"
BUCKET="${BUCKET:-${PROJECT}-bt-artifacts}"
FRONTEND_BASE="${FRONTEND_BASE:?FRONTEND_BASE=https://<hosting도메인> 필요}"   # OAuth 콜백·CORS
# 기본 false — 켜는 건 의도가 있을 때만. 기본 true로 두면 재배포 한 번에 가입이 조용히 열린다(2026-08-09 함정).
SIGNUPS_OPEN="${SIGNUPS_OPEN:-true}"    # 베타 개시(2026-08-11)로 개방. 다시 닫으려면 SIGNUPS_OPEN=false
IMG="$REGION-docker.pkg.dev/$PROJECT/bt/api:$(date +%Y%m%d-%H%M)"
CONN=$(gcloud sql instances describe "$DB_INSTANCE" --project="$PROJECT" --format='value(connectionName)')

cd "$(dirname "$0")/../../backend"

echo "── 빌드·푸시 ($IMG)"
gcloud auth configure-docker "$REGION-docker.pkg.dev" -q
docker build --platform linux/amd64 -t "$IMG" .
docker push "$IMG"

echo "── Cloud Run 배포"
# --no-cpu-throttling: BackgroundTasks(보고서 생성)가 응답 후에도 CPU 유지돼야 함
# DSN은 시크릿(bt-db-url)에 있다. 예전엔 평문 env로 박았는데, 재배포마다 비밀번호가 인자로 돌아다니고
# 시크릿 참조가 평문으로 덮여 보안이 뒷걸음쳤다(2026-08-09 함정).
# --update-env-vars: 나열한 것만 갱신하고 나머지(다른 시크릿 참조 포함)는 건드리지 않는다.
#   --set-env-vars를 쓰면 나열 안 한 값이 날아간다.
gcloud run deploy bt-api --project="$PROJECT" --region="$REGION" \
  --image="$IMG" --allow-unauthenticated \
  --min-instances=1 --max-instances=4 --memory=1Gi --cpu=1 --no-cpu-throttling \
  --add-cloudsql-instances="$CONN" \
  --update-secrets="BT_JWT_SECRET=bt-jwt-secret:latest,BT_DATABASE_URL=bt-db-url:latest" \
  --update-env-vars="^##^BT_GCS_BUCKET=${BUCKET}##BT_FRONTEND_BASE=${FRONTEND_BASE}##BT_CORS_ORIGINS=${FRONTEND_BASE}##BT_SIGNUPS_OPEN=${SIGNUPS_OPEN}"

URL=$(gcloud run services describe bt-api --region="$REGION" --format='value(status.url)')
echo "── 헬스체크"; curl -s "$URL/health"; echo
echo "✅ API 배포 완료: $URL"
