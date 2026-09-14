#!/usr/bin/env bash
# 1회성 인프라 셋업 — 프로젝트·리전은 env로. 실행 전 gcloud auth login + 결제 연결 필수.
# 사용: PROJECT=<id> ./setup_infra.sh
set -euo pipefail
PROJECT="${PROJECT:?PROJECT=<gcp-project-id> 필요}"
REGION="${REGION:-asia-northeast3}"            # 서울
DB_INSTANCE="${DB_INSTANCE:-bt-pg}"
DB_TIER="${DB_TIER:-db-custom-1-3840}"         # 베타 10~20명. 축소: db-g1-small
DB_PASS="${DB_PASS:?DB_PASS=<postgres 비밀번호> 필요}"
BUCKET="${BUCKET:-${PROJECT}-bt-artifacts}"

gcloud config set project "$PROJECT"

echo "── API 활성화"
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  storage.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

exists(){ "$@" >/dev/null 2>&1; }   # 존재 검사 전용 — 생성 에러는 절대 삼키지 않는다(무음 실패 방지)

echo "── Artifact Registry(컨테이너 저장소)"
if exists gcloud artifacts repositories describe bt --location="$REGION"; then echo "  (이미 존재)"
else gcloud artifacts repositories create bt --repository-format=docker --location="$REGION"; fi

echo "── Cloud SQL: PostgreSQL 16 (PostGIS는 DB에서 CREATE EXTENSION)"
# --edition=enterprise 필수: 기본 ENTERPRISE_PLUS는 db-custom 티어 거부(400)
if exists gcloud sql instances describe "$DB_INSTANCE"; then echo "  (이미 존재)"
else gcloud sql instances create "$DB_INSTANCE" --edition=enterprise \
  --database-version=POSTGRES_16 --tier="$DB_TIER" --region="$REGION" \
  --storage-size=20GB --storage-auto-increase --root-password="$DB_PASS"; fi
if exists gcloud sql databases describe billtamjung --instance="$DB_INSTANCE"; then echo "  (DB 이미 존재)"
else gcloud sql databases create billtamjung --instance="$DB_INSTANCE"; fi

echo "── GCS 버킷(사진·PPT — 비공개)"
if exists gcloud storage buckets describe "gs://$BUCKET"; then echo "  (이미 존재)"
else gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access; fi

echo "── JWT 시크릿(Secret Manager)"
if ! gcloud secrets describe bt-jwt-secret >/dev/null 2>&1; then
  python3 -c "import secrets;print(secrets.token_urlsafe(48))" | \
    gcloud secrets create bt-jwt-secret --data-file=-
fi

echo "✅ 인프라 준비 완료"
echo "   Cloud SQL 연결명: $(gcloud sql instances describe "$DB_INSTANCE" --format='value(connectionName)')"
