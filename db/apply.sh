#!/usr/bin/env bash
# 마이그레이션 적용 — **안 들어간 것만** 돌린다(app.schema_migrations, 0039).
#
# 예전엔 매번 전부 재실행했다. 그래서 프로덕션에 못 돌렸고(0011의 DELETE가 팀 오버레이를 지운다),
# 못 돌리니 손으로 골라 적용했고, 손으로 고르니 0032를 빠뜨려 브리핑이 사흘간 죽어 있었다.
# 이제는 프로덕션에도 이 스크립트를 그대로 쓴다. 그게 이 파일의 목적이다.
#
# 사용:
#   DATABASE_URL=... db/apply.sh              # 안 들어간 것만 적용
#   DATABASE_URL=... db/apply.sh --dry-run    # 무엇이 돌지만 보기
#   DATABASE_URL=... db/apply.sh --baseline   # 실행 없이 "이미 적용됨"으로 기록(도입 1회)
#   DATABASE_URL=... db/apply.sh --baseline-until 0035_floor_area.sql
#
# --baseline은 **이미 스키마에 반영돼 있음을 확인한 뒤에만** 쓴다. 확인 없이 쓰면
# 안 들어간 마이그레이션을 들어갔다고 거짓 기록하는 것이고, 그건 이력이 없는 것보다 나쁘다.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/migrations"
PSQL=${PSQL:-"psql ${DATABASE_URL:-}"}
LEDGER="0039_schema_migrations.sql"

MODE=apply; UNTIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)        MODE=dry ;;
    --baseline)       MODE=baseline ;;
    --baseline-until) MODE=baseline; UNTIL="$2"; shift ;;
    *) echo "알 수 없는 인자: $1"; exit 2 ;;
  esac
  shift
done

sum() { shasum -a 256 "$1" | cut -d' ' -f1; }
q()   { $PSQL -tAq -v ON_ERROR_STOP=1 -c "$1"; }

# 이력 테이블 자체는 항상 먼저(멱등). 이게 없으면 아무것도 못 센다.
$PSQL -q -v ON_ERROR_STOP=1 -f "$DIR/$LEDGER"

applied="$(q "SELECT version FROM app.schema_migrations")"
has() { printf '%s\n' "$applied" | grep -qxF "$1"; }

ran=0; skipped=0; drift=0
for f in "$DIR"/[0-9]*.sql; do
  v="$(basename "$f")"; c="$(sum "$f")"
  [ "$v" = "$LEDGER" ] && continue

  if has "$v"; then
    rec="$(q "SELECT COALESCE(checksum,'') FROM app.schema_migrations WHERE version='$v'")"
    if [ -n "$rec" ] && [ "$rec" != "$c" ]; then
      # 이미 적용된 파일이 나중에 바뀌었다. 대상 DB에는 **옛 내용**이 들어가 있다.
      echo "⚠ $v — 파일이 적용 후 변경됨(체크섬 불일치). 대상 DB는 옛 버전 상태다."
      drift=$((drift+1))
    fi
    skipped=$((skipped+1)); continue
  fi

  case "$MODE" in
    dry)      echo "  (dry) $v" ;;
    baseline) echo "  (baseline) $v"
              q "INSERT INTO app.schema_migrations(version,checksum,baselined) VALUES('$v','$c',true)
                 ON CONFLICT (version) DO NOTHING" >/dev/null ;;
    apply)    echo "▶ $v"
              # 파일 + 기록을 한 트랜잭션에. 중간에 죽으면 둘 다 안 남는다.
              #
              # 단 파일이 스스로 BEGIN/COMMIT을 쓰면 --single-transaction을 겹칠 수 없다 —
              # 파일의 COMMIT이 바깥 트랜잭션을 먼저 닫아버려 이력 기록만 밖으로 빠진다
              # ("there is already a transaction in progress" 경고가 그 신호였다).
              # 그런 파일은 자기 트랜잭션을 믿고, 기록만 뒤에 붙인다.
              # 모든 마이그레이션은 멱등이 규칙이라(런북) 재실행으로 복구된다.
              if grep -qiE '^[[:space:]]*BEGIN[[:space:]]*;' "$f"; then
                $PSQL -q -v ON_ERROR_STOP=1 -f "$f"
                # 파일이 스스로 이력을 남겼을 수 있다(0127식) — 그 줄엔 체크섬이 없으니 채워 준다.
                q "INSERT INTO app.schema_migrations(version,checksum) VALUES('$v','$c')
                   ON CONFLICT (version) DO UPDATE SET checksum=EXCLUDED.checksum" >/dev/null
              else
                $PSQL -q -v ON_ERROR_STOP=1 --single-transaction \
                  -f "$f" \
                  -c "INSERT INTO app.schema_migrations(version,checksum) VALUES('$v','$c')"
              fi ;;
  esac
  ran=$((ran+1))
  [ -n "$UNTIL" ] && [ "$v" = "$UNTIL" ] && break
done

echo "✅ 적용 $ran · 건너뜀 $skipped${drift:+ · 체크섬 불일치 $drift}"
[ "$drift" -gt 0 ] && echo "   불일치는 자동으로 안 고친다 — 무엇이 바뀌었는지 보고 사람이 판단할 일이다."
exit 0
