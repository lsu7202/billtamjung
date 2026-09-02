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
STEP="${STEP:-crawl}"     # crawl | activate | build | load | derive  (지정 단계부터 시작)
                          # derive = 적재는 건너뛰고 파생 배치·검증만. **산식만 고쳤을 때 쓴다** —
                          #          원천은 그대로고 계산값만 다시 내면 되는 경우다.

# derive 는 load 와 같은 순위다 — 같은 블록 안에서 돌고, 적재만 안 한다.
# 4를 주면 `step_ge load` 가 거짓이 되어 블록째로 건너뛴다(2026-08-30에 그렇게 짰다가 잡음).
rank() { case "$1" in crawl) echo 0;; activate) echo 1;; build) echo 2;; load|derive) echo 3;; *) echo 9;; esac; }
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
 if [ "$STEP" != "derive" ]; then
  echo "[4/4] Postgres 적재 → $DATABASE_URL"
  declare -a MAP=(
    "buildings:buildings.csv" "parcels:parcels.csv"
    "building_parcels:building_parcels.csv" "gongsi_series:gongsi_series.csv"
    "sales_history:sales_history.csv" "complex:complex.csv"
    "unit:unit.csv" "energy:energy.csv" "zone:zone.csv" "closed:closed.csv"
    "basic:basic.csv" "septic:septic.csv"
    # aptprice 는 뺐다(2026-09-02) — 읽는 화면·API 가 없다. 되살리려면 build_all 의
    # aptprice 단계와 여기 "aptprice:aptprice.csv" 를 같이 켠다.
  )
  for m in "${MAP[@]}"; do
    src="${m%%:*}"; csv="$EXPORT_DIR/${m##*:}"
    [ -f "$csv" ] || { echo "  ⏭ $src: $csv 없음, 건너뜀"; continue; }
    echo "  → $src ($csv)"
    "$LOADER_PY" pipeline/loader.py --source "$src" --csv "$csv"
  done

  # 필지 규제·용도지역 — **적재가 지우고 가는 칸**이라 바로 뒤에서 되붙인다(2026-08-30).
  # parcels 는 세대 스왑(v1↔v2 통째 교체)인데 use_zone·legal_bcr·legal_far·regulations 네 칸은
  # parcels.csv 에 없다. 국토부 토지이용계획정보 원장에서 따로 온 값이라서다.
  # 2026-08-28 에 손으로 채워 넣고 배선을 안 해서, 적재 한 번이면 89.7만 필지가 빌 참이었다.
  # 건물 상세의 용도지역·건폐율·용적률·「규제·특례」가 전부 이 칸을 읽는다.
  if [ -f data/exports/luris/parcel_luris.csv.gz ]; then
    echo "  → parcel_luris (용도지역 · 법정건폐/용적 · 규제)"
    BT_DATABASE_URL="$DATABASE_URL" "$LOADER_PY" scripts/load_parcel_luris.py
  else
    echo "  ⏭ parcel_luris: data/exports/luris/parcel_luris.csv.gz 없음, 건너뜀"
  fi

  # 도로폭 — build_all.py는 만드는데 여기서 안 실어서 프로덕션에 road_segment가 비어 있었다(2026-08-09).
  # loader의 세대 스왑(v1→v2) 구조는 검색이 붙는 대형 테이블용이고, 이건 파생 계산의 입력이라
  # TRUNCATE+INSERT인 전용 스크립트를 쓴다. 대신 파이프라인 안에서 돌게 한다.
  if [ -f data/tools/_road_width.csv ]; then
    echo "  → road_width (road_segment · building_road)"
    "$LOADER_PY" scripts/load_road_width.py "$DATABASE_URL"
  else
    echo "  ⏭ road_width: data/tools/_road_width.csv 없음, 건너뜀"
  fi

  # 층별개요 — 빌더는 CSV 를 만드는데 **적재하는 코드가 없었다**(2026-08-30 신설).
  # 그래서 298만 행이 손으로 들어갔고, 8/02 판 옛 CSV 로 덮이면서 층 표기 정규화가
  # 되돌아가 지하 21만 층이 두 달간 지상 요율로 계산됐다. 로더가 컬럼과 정규화를 검사한다.
  if [ -f data/tools/_floor_outline.csv ]; then
    echo "  → floor_outline (층별개요)"
    BT_DATABASE_URL="$DATABASE_URL" "$LOADER_PY" scripts/load_floor_outline.py
  else
    echo "  ⏭ floor_outline: data/tools/_floor_outline.csv 없음, 건너뜀"
  fi

 else
  echo "[4/4] 적재·되붙이기 건너뜀(STEP=derive) — 파생 배치부터 돕니다"
 fi

  # ── 5) 파생 배치 ────────────────────────────────────────────────
  # 원천이 바뀌면 **같이** 다시 돌아야 하는 계산값이다. 따로 돌리게 두면 옛 값이 남는데,
  # 화면은 그걸 새 값처럼 보여준다(2026-08-09 road_width 와 같은 사고).
  #
  # **순서가 의존이다.** 참조표(상권·지가·cap·지수) → 층 임대 → 건물 임대 → 적정가 → 점수.
  # 뒤엣것이 앞엣것을 읽으므로 뒤집으면 옛 값 위에서 계산한다.
  RENT="scripts/rent_estimate"
  # 인터프리터가 둘이다. **SHP 를 읽는 스크립트는 data/.venv 라야 한다**(shapefile·shapely·pyproj).
  # DB 만 만지는 것은 backend/.venv(asyncpg). 섞으면 ModuleNotFoundError 로 조용히 건너뛴다.
  derive() {   # 라벨 · 스크립트 · (없으면 건너뛸 파일) · (인터프리터: gis 면 data/.venv)
    if [ -n "${3:-}" ] && [ ! -e "$3" ]; then echo "  ⏭ $1: $3 없음, 건너뜀"; return 0; fi
    local py="$LOADER_PY"; [ "${4:-}" = "gis" ] && py="$PY"
    local tag; tag="$(basename "$2" .py)"
    echo "  → $1"
    # **돌았다는 사실을 남긴다.** master_loads 에 기록이 없어서 「언제 덮였나」를 못 답했다
    # (층 표기가 두 달간 뒤집혀 있던 것을 그래서 늦게 알았다). 성공·실패 둘 다 적는다.
    local t0; t0="$(date -u +%FT%TZ)"
    if RENT_DSN="$DATABASE_URL" BT_DATABASE_URL="$DATABASE_URL" DATABASE_URL="$DATABASE_URL" "$py" "$2"; then
      _mark "$tag" "$t0" success ""
    else
      _mark "$tag" "$t0" failed "스크립트 실패"
      echo "  ⚠️ $1 실패 — 계속 진행(옛 값이 남습니다)"
    fi
  }
  _mark() {   # 태그 · 시작시각 · 상태 · 사유 — 못 남겨도 파이프라인은 계속 간다
    BT_DATABASE_URL="$DATABASE_URL" "$LOADER_PY" scripts/mark_load.py "$1" "$2" "$3" "$4" 2>/dev/null || true
  }

  # ① 참조표 — 건물마다 계산할 때 읽는 상수들
  # 상권 72칸 — 원본 SHP 이 있으면 그걸로, 없으면 DB 에서 떠 둔 CSV 로(2026-08-30).
  # 원본은 공공데이터포털 15086933 인데 자동 다운로드가 없고 폴더가 유실됐다.
  if [ -e "data/raw/상권구획도(업로드용)" ]; then
    derive "sanggwon (부동산원 상권 72칸 · SHP)" scripts/sanggwon/load_sanggwon.py "" gis
  else
    derive "sanggwon (부동산원 상권 72칸 · 보존 CSV)" scripts/sanggwon/load_sanggwon_csv.py \
           "data/exports/sanggwon/sanggwon.csv.gz"
  fi
  derive "trade_area (서울시 상권 1,650칸)"     scripts/sanggwon/load_seoul_trade_area.py \
         "data/raw/서울시 상권분석서비스(영역-상권)" gis
  derive "subway_stations (역 위치)"            scripts/transit/load_stations.py \
         "data/raw/서울시 역사마스터 정보.json"
  derive "building_redevel (정비구역·재정비)"    scripts/vworld/load_redevel_zones.py \
         "data/raw/LSMD_CONT_UD602_서울" gis
  derive "land_adjust (지가변동률)"             "$RENT/build_land_adjust.py" \
         "data/raw/(연) 지역별 지가변동률.json"
  derive "sanggwon_rent_series (임대 시계열)"    "$RENT/build_series.py"
  derive "sale_price_index (분기 가격지수)"      "$RENT/build_price_index.py"

  # ② 검색·분석 전용 계산값 — 대장이 비운 용적률·건폐율·면적(0143·0144).
  #    **화면·서류에는 안 나간다.** 활용 유형(building_score)과 검색 필터가 이 표를 읽으므로
  #    점수보다 먼저 와야 한다. buildings 를 다시 실으면 이것도 같이 다시 낸다.
  derive "building_calc (검색·분석 전용 용적률·건폐율)" scripts/build_building_calc.py

  # ③ 임대 추정 — 층이 먼저, 건물 총액이 그 합
  #    산식은 v4(공시지가 주축). 계수는 scripts/rent_estimate/_rent_v4_coef.json 에 **박혀 있다** —
  #    파이프라인이 다시 굽지 않는다. 크롤 잣대로 한 번 굽는 것이고(fit_rent_v4.py),
  #    매번 다시 구우면 남의 사이트를 긁어야 파이프라인이 도는 꼴이 된다. 잣대는 잣대로만 쓴다.
  derive "floor_rent_est (층별 임대추정)"        "$RENT/build_floor.py"
  derive "building_rent_est (건물 임대추정)"     "$RENT/build_bldg.py"

  # ③-2 구별 cap rate — **임대추정 ÷ 실거래**라 임대가 나온 뒤여야 한다.
  #     예전엔 참조표 묶음에 있어 임대 빌더보다 앞에서 돌았다. 그래서 임대 산식을 고쳐도
  #     cap 은 지난번 임대로 계산된 값이 남았고, 그 cap 이 적정가의 수익환원 축으로 들어갔다.
  derive "income_cap (구별 cap rate)"           "$RENT/build_income_cap.py"

  # ④ 적정가 — 임대(수익환원)와 참조표를 둘 다 읽는다
  derive "building_sale_est (적정가)"           "$RENT/build_sale_est.py"

  # ⑤ 점수 — 매력도·활용유형·매도가능성. 읽는 것은 **계산 용적률(building_calc)**·정비구역·
  #    공시 추세·최근 거래연월이다. 적정가·임대는 안 읽는다(예전 주석이 틀렸다).
  derive "building_score (매력도·활용유형·매도가능성)" scripts/build_building_score.py

  # ── 6) 검증 ───────────────────────────────────────────────────
  # 돌고 나서 **데이터가 성한지** 본다. 층 표기가 뒤집혔는지·파생 배치가 비었는지·
  # 적재가 지우고 간 칸이 되붙었는지. 조용히 틀린 채로 끝나는 것을 막는 마지막 문이다.
  #
  # **실패하면 여기서 멈춘다**(2026-08-30). 예전엔 경고만 내고 넘어갔는데, 그건
  # 「틀린 걸 알면서 그대로 두는」 모양이다 — 화면·보고서·계약서로 그대로 나간다.
  # 멈춰야 사람이 본다. 값을 되돌리는 건 파생 배치를 다시 돌리면 되고(원천은 안 건드린다),
  # 적재까지 끝난 상태이므로 --from 으로 그 단계만 다시 돌 수 있다.
  # 빌더 처리결과 — 원본 줄이 어디로 갔는지. **읽은줄 = 낸줄 + 버림 + 합침** 이 안 맞으면
  # 어딘가에서 줄이 조용히 사라진 것이다. 문서는 예전부터 쓰고 있었는데 파일로만 남아
  # 아무도 안 봤다 — 전유공용 1,982만 줄이 한 줄도 안 잡힌 채 두 달을 갔다(2026-09-01).
  echo "  → 빌더 처리결과(누락·버림·합침)"
  if ! "$PY" scripts/build_report_summary.py; then
    echo ""
    echo "  ❌ 처리결과 셈이 안 맞습니다 — 어느 빌더에서 줄이 사라졌는지 위를 보세요."
    exit 1
  fi

  echo "  → qa_data (데이터 불변식)"
  if ! BT_DATABASE_URL="$DATABASE_URL" "$LOADER_PY" backend/tests/qa_data.py; then
    echo ""
    echo "  ❌ qa_data 실패 — 위에 ✗ 로 뜬 항목을 고치기 전에는 이 데이터를 쓰지 마세요."
    echo "     적재·파생은 이미 끝났습니다. 산식을 고쳤으면 해당 파생 배치만 다시 돌리면 됩니다:"
    echo "       scripts/rent_estimate/build_floor.py · build_bldg.py · build_income_cap.py"
    echo "       scripts/rent_estimate/build_sale_est.py · scripts/build_building_score.py"
    exit 1
  fi

  # ── 7) 원본 압축 보관 ──────────────────────────────────────────
  # 건축HUB 서울본 원본 CSV 가 22GB 다. 다 쓰고 나면 디스크에 그대로 둘 이유가 없지만
  # 지우면 안 된다 — 다시 받는 데 한 시간 반이고, 그 사이 HUB 가 다음 달 판으로 넘어가면
  # **같은 스냅샷을 두 번 다시 못 만든다.** 압축해 두면 둘 다 된다(실측 22GB → 0.6GB).
  #
  # 안전장치는 스크립트 안에 있다: master_loads 의 성공 기록이 **원본 CSV 보다 나중**인
  # 마트만 압축한다. 기록이 있는지만 보면 안 된다 — 실제로 표제부의 07-21 기록(전국본
  # 시절)이 남아 있어서, 아직 안 실은 서울본 원본을 지울 뻔했다(2026-09-01).
  #
  # 되돌리기: python scripts/hub/archive_seoul.py --restore [--only 대장_표제부]
  if [ -d data/raw/hub_seoul ]; then
    echo "  → 원본 압축 보관(archive_seoul)"
    DATABASE_URL="$DATABASE_URL" "$PY" scripts/hub/archive_seoul.py ||       echo "  ⚠️ 압축 실패(무시) — 적재·파생은 끝났습니다"
  fi
fi

echo "== 완료 =="
