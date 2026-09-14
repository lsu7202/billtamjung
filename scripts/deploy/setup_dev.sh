#!/usr/bin/env bash
# 개발 서버 1회 셋업 — 같은 인스턴스(bt-pg)에 dev DB·유저·시크릿을 만들고 master 를 복사한다.
# 운영서버와의 접점은 DB 머신뿐이다: dev 유저는 billtamjung_dev 에만 접속 가능(권한 격리).
# 사용: bash scripts/deploy/setup_dev.sh   (Cloud SQL 프록시가 55433 에 떠 있어야 함)
set -euo pipefail
PROJECT=billtamjung; INSTANCE=bt-pg; PORT=55433
DEVDB=billtamjung_dev; DEVUSER=btdev
PGPASS=$(gcloud secrets versions access latest --secret=bt-db-url | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')
DEVPASS=$(openssl rand -hex 16)

echo "── dev DB·유저"
gcloud sql databases create "$DEVDB" --instance="$INSTANCE" --project="$PROJECT" 2>/dev/null || echo "  (이미 있음)"
gcloud sql users create "$DEVUSER" --instance="$INSTANCE" --project="$PROJECT" --password="$DEVPASS" 2>/dev/null \
  || gcloud sql users set-password "$DEVUSER" --instance="$INSTANCE" --project="$PROJECT" --password="$DEVPASS"

echo "── 권한 격리: dev 유저는 dev DB만"
# Cloud SQL 은 새 유저에 cloudsqlsuperuser 를 붙인다 — 그대로 두면 REVOKE 가 **무의미**하고
# dev 유저가 운영 DB 를 그냥 읽는다(2026-08-15 실측). 반드시 벗긴 뒤에 권한을 준다.
PGPASSWORD="$PGPASS" psql -h localhost -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
REVOKE cloudsqlsuperuser FROM $DEVUSER;
ALTER ROLE $DEVUSER NOCREATEDB NOCREATEROLE;
REVOKE ALL ON DATABASE billtamjung FROM $DEVUSER, PUBLIC;
GRANT CONNECT ON DATABASE $DEVDB TO $DEVUSER;
SQL
PGPASSWORD="$PGPASS" psql -h localhost -p $PORT -U postgres -d "$DEVDB" -v ON_ERROR_STOP=1 <<SQL
GRANT ALL ON SCHEMA public TO $DEVUSER;
SQL

echo "── 시크릿 bt-db-url-dev (Cloud Run 소켓 경로는 운영과 동일 형식)"
PROD_DSN=$(gcloud secrets versions access latest --secret=bt-db-url)
DEV_DSN=$(echo "$PROD_DSN" | sed -E "s|://[^:]+:[^@]+@|://$DEVUSER:$DEVPASS@|; s|/billtamjung|/$DEVDB|")
gcloud secrets create bt-db-url-dev --project="$PROJECT" --replication-policy=automatic 2>/dev/null || true
printf '%s' "$DEV_DSN" | gcloud secrets versions add bt-db-url-dev --project="$PROJECT" --data-file=-
# Cloud Run 기본 서비스 계정이 이 시크릿을 읽어야 한다 — 안 주면 첫 배포가 Permission denied 로 죽는다
gcloud secrets add-iam-policy-binding bt-db-url-dev --project="$PROJECT" \
  --member="serviceAccount:$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" >/dev/null

echo "── dev 확장(PostGIS — master 의 geometry 가 이것 없이는 못 선다)"
PGPASSWORD="$PGPASS" psql -h localhost -p $PORT -U postgres -d "$DEVDB" -v ON_ERROR_STOP=1 \
  -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# 상호 의존을 가른다: 마이그레이션(0030)은 master 테이블을, master 인덱스는 app 함수를 본다.
# 그래서 3단계: ①master 테이블+데이터(--section=pre-data,data) ②app 마이그레이션 ③master 인덱스·MV(post-data)
echo "── ① master·ref 테이블+데이터(도커 pg16 클라이언트 — 로컬은 14라 안 맞는다)"
docker exec -e PGPASSWORD="$PGPASS" docker-db-1 pg_dump -h host.docker.internal -p $PORT -U postgres -d billtamjung -n master -n ref --section=pre-data --section=data \
  | docker exec -i -e PGPASSWORD="$PGPASS" docker-db-1 psql -v ON_ERROR_STOP=1 -h host.docker.internal -p $PORT -U postgres -d "$DEVDB" -q
echo "── ② app 마이그레이션"
DATABASE_URL="postgresql://postgres:$PGPASS@localhost:$PORT/$DEVDB" bash db/apply.sh
echo "── ③ master 인덱스·MV"
docker exec -e PGPASSWORD="$PGPASS" docker-db-1 pg_dump -h host.docker.internal -p $PORT -U postgres -d billtamjung -n master -n ref --section=post-data \
  | docker exec -i -e PGPASSWORD="$PGPASS" docker-db-1 psql -v ON_ERROR_STOP=1 -h host.docker.internal -p $PORT -U postgres -d "$DEVDB" -q
PGPASSWORD="$PGPASS" psql -h localhost -p $PORT -U postgres -d "$DEVDB" -v ON_ERROR_STOP=1 <<SQL
GRANT USAGE ON SCHEMA app, master, ref TO $DEVUSER;
GRANT ALL ON ALL TABLES IN SCHEMA app TO $DEVUSER;
GRANT SELECT ON ALL TABLES IN SCHEMA master, ref TO $DEVUSER;
GRANT ALL ON ALL SEQUENCES IN SCHEMA app TO $DEVUSER;
-- 마이그레이션이 나중에 만드는 객체(MV·새 테이블)까지 덮는다 — 권한을 먼저 주면 그것들이 빠진다
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON TABLES TO $DEVUSER;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON SEQUENCES TO $DEVUSER;
ALTER DEFAULT PRIVILEGES IN SCHEMA master GRANT SELECT ON TABLES TO $DEVUSER;
ALTER DEFAULT PRIVILEGES IN SCHEMA ref GRANT SELECT ON TABLES TO $DEVUSER;
SQL
echo "✅ dev DB 준비 끝 — 다음: bash scripts/deploy/deploy_dev.sh"
