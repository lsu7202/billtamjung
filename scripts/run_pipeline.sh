#!/bin/bash
# 엔드투엔드 파이프라인 러너: 크롤 → 활성화 → 빌드 → Postgres 적재.
#   crawl_all.py → activate.py → build_all.py → loader.py(소스별)
# 로컬 실행용(검증 후 Cloud Run Job 이관). 각 단계 실패 시 중단(set -e).
#
# 사용:
#   scripts/run_pipeline.sh                      # 전체(all cadence)
#   STEP=build scripts/run_pipeline.sh           # crawl·activate 건너뛰고 build부터
#   GROUP=monthly scripts/run_pipeline.sh        # 크롤 주기 그룹 지정
# 자격증명·접속: scripts/.pipeline.env (gitignore) 에 VW_ID/VW_PW/BT_DATABASE_URL.
# 근거: specs/07-architecture/04·05.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# --- 환경 로드 --- (backend/.env = BT_DATABASE_URL 단일출처, .env.pipeline = V-World 크레덴셜)
[ -f backend/.env ] && { set -a; . backend/.env; set +a; }
ENV_FILE="${BT_ENV:-scripts/.env.pipeline}"
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }
PY="data/.venv/bin/python"; [ -x "$PY" ] || PY="python3"              # 크롤·빌드(pyshp·shapely)
LOADER_PY="backend/.venv/bin/python"; [ -x "$LOADER_PY" ] || LOADER_PY="$PY"   # 적재(asyncpg)
export DATABASE_URL="${DATABASE_URL:-${BT_DATABASE_URL:-}}"
STAGING="${STAGING:-data/raw/_dl}"
EXPORT_DIR="${EXPORT_DIR:-data/exports/_load}"
GROUP="${GROUP:-all}"
STEP="${STEP:-crawl}"     # crawl | activate | build | load  (지정 단계부터 시작)

rank() { case "$1" in crawl) echo 0;; activate) echo 1;; build) echo 2;; load) echo 3;; *) echo 9;; esac; }
step_ge() { [ "$(rank "$1")" -ge "$(rank "$STEP")" ]; }   # 단계 $1이 시작STEP 이상이면 실행

echo "== 빌탐정 파이프라인 (STEP=$STEP GROUP=$GROUP) =="

# 1) 크롤
if step_ge crawl; then
  echo "[1/4] 크롤 → $STAGING"
  "$PY" scripts/crawl_all.py --group "$GROUP" --out "$STAGING"
fi

# 2) 활성화(스테이징 → 정규 raw)
if step_ge activate; then
  echo "[2/4] 활성화(activate.py)"
  "$PY" scripts/activate.py --staging "$STAGING"
fi

# 3) 빌드(→ 빌탐정.db → export CSV)
if step_ge build; then
  echo "[3/4] 빌드(build_all.py) → $EXPORT_DIR"
  "$PY" pipeline/build_all.py --export-dir "$EXPORT_DIR"
fi

# 4) Postgres 적재(loader: 검증게이트→원자스왑→version++)
if step_ge load; then
  [ -n "${DATABASE_URL:-}" ] || { echo "✗ DATABASE_URL 미설정(scripts/.pipeline.env 확인)"; exit 1; }
  echo "[4/4] Postgres 적재 → $DATABASE_URL"
  declare -a MAP=(
    "buildings:buildings.csv" "parcels:parcels.csv"
    "building_parcels:building_parcels.csv" "gongsi_series:gongsi_series.csv"
    "sales_history:sales_history.csv"
  )
  for m in "${MAP[@]}"; do
    src="${m%%:*}"; csv="$EXPORT_DIR/${m##*:}"
    [ -f "$csv" ] || { echo "  ⏭ $src: $csv 없음, 건너뜀"; continue; }
    echo "  → $src ($csv)"
    "$LOADER_PY" pipeline/loader.py --source "$src" --csv "$csv"
  done
fi

echo "== 완료 =="
