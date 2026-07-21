#!/usr/bin/env bash
# 마이그레이션 순차 적용. 사용: DATABASE_URL=... ./db/apply.sh  (또는 psql 접속정보 env)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/migrations"
PSQL=${PSQL:-"psql ${DATABASE_URL:-}"}

for f in "$DIR"/[0-9]*.sql; do
  echo "▶ applying $(basename "$f")"
  $PSQL -v ON_ERROR_STOP=1 -f "$f"
done
echo "✅ 모든 마이그레이션 적용 완료"
