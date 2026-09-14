#!/usr/bin/env bash
# 로컬 덤프 → Cloud SQL 적재. cloud-sql-proxy 경유(공인IP 개방 불필요).
# 사용: PROJECT=<id> DB_PASS=<pw> ./load_db.sh
set -euo pipefail
PROJECT="${PROJECT:?}"; DB_PASS="${DB_PASS:?}"
DB_INSTANCE="${DB_INSTANCE:-bt-pg}"
DUMP="${DUMP:-backups/billtamjung.dump}"
CONN=$(gcloud sql instances describe "$DB_INSTANCE" --project="$PROJECT" --format='value(connectionName)')

# cloud-sql-proxy 설치 확인
if ! command -v cloud-sql-proxy >/dev/null; then
  echo "cloud-sql-proxy 설치: brew install cloud-sql-proxy"; exit 1
fi

cloud-sql-proxy "$CONN" --port 15432 & PROXY=$!
trap "kill $PROXY" EXIT
sleep 3

echo "── PostGIS 확장"
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p 15432 -U postgres -d billtamjung \
  -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm;"

echo "── 복원(수십 분 소요 — 7.4GB)"
PGPASSWORD="$DB_PASS" pg_restore -h 127.0.0.1 -p 15432 -U postgres -d billtamjung \
  --no-owner --no-privileges -j 2 "$DUMP"

echo "── 검증"
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p 15432 -U postgres -d billtamjung -t \
  -c "SELECT 'buildings '||count(*) FROM master.buildings UNION ALL SELECT 'accounts '||count(*) FROM app.accounts;"
echo "✅ DB 적재 완료"
