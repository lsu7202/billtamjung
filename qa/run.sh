#!/usr/bin/env bash
# QA 한 문 — 무엇이 바뀌었는지 보고 **필요한 것만** 돌린다.
#
# ## 왜 골라서 도나
#
# 전부 돌리면 몇십 분이라 아무도 안 돌린다. 안 돌리는 검사는 없는 것과 같다.
# 그래서 바뀐 파일을 보고 그것이 깨뜨릴 수 있는 것만 돈다.
#
# ## 쓰는 법
#
#   qa/run.sh                 바뀐 것만 (기본, 작업 트리 + 스테이징)
#   qa/run.sh --all           전부
#   qa/run.sh data screen     골라서
#   qa/run.sh --list          무엇이 있는지만 보기
#
# ## 없으면 건너뛴다 — 다만 **조용히 넘어가지 않는다**
#
# 화면 검사는 프론트(5173)·API(8000)가 떠 있어야 한다. 안 떠 있으면 건너뛰되
# 「건너뜀」이라고 말한다. 조용히 통과시키면 검사가 있으나 마나다.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PY_BE="backend/.venv/bin/python"; [ -x "$PY_BE" ] || PY_BE="python3"
PY_GIS="data/.venv/bin/python";   [ -x "$PY_GIS" ] || PY_GIS="python3"
[ -f backend/.env ] && { set -a; . backend/.env; set +a; }
: "${BT_DATABASE_URL:=postgresql://postgres:test@localhost:55432/billtamjung}"
export BT_DATABASE_URL

# ── 무엇이 무엇을 보는가 ─────────────────────────────────────
# 한 줄에 구분자로 몰아넣었더니 정규식의 | 와 부딪히고, § 로 바꿨더니 IFS 가 바이트
# 단위라 또 깨졌다(2026-09-02). **배열 넷을 자리로 맞춘다** — 구분자가 아예 없다.
NAMES=(  ui                     data                       units                        screen                        mirror                     build                      ai )
DESCS=(  "UI 규칙(네모버튼·설명글씨)"  "DB 값·불변식 26가지"          "단위·파생이 선언한 검증 60가지"    "화면이 DB 값을 맞게 읽는가"       "한 사실이 여러 표에서 같은가"   "빌드 산출물이 맞는가"      "AI 벽(bt_ai 롤)·scrub 회귀" )
# 무엇이 바뀌면 도는가
PATS=(   '^frontend/'
         '^(db/migrations|pipeline|data/tools|scripts/(load_|rent_estimate))'
         '^(pipeline/units.py|scripts/(run_unit|load_|build_)|data/tools)'
         '^(frontend/src|backend/app|db/migrations|pipeline|data/tools)'
         '^backend/app/domains/(mirror|buyers|listings)'
         '^(pipeline|data/tools)'
         '^(backend/app/ai|db/migrations/016[7-9]|qa/ai)' )
CMDS=(   "bash qa/ui/check_ui.sh"
         "$PY_BE qa/data/qa_data.py"
         "python3 qa/data/qa_units.py"
         "$PY_BE qa/screen/qa_screen.py"
         "$PY_BE qa/mirror/qa_mirror.py"
         "$PY_GIS qa/build/qa_build.py"
         "$PY_BE qa/ai/scrub_cases.py && $PY_BE qa/ai/walls.py" )
# external(토지이음 대조)은 **자동으로 안 돈다.** 공공 사이트에 요청을 보내는 것이라
# 사람이 정할 일이다. qa/external/README.md 참고.

need_db()     { "$PY_BE" -c "import asyncpg,asyncio,os;asyncio.run(asyncpg.connect(os.environ['BT_DATABASE_URL'],timeout=5))" 2>/dev/null; }
need_screen() { curl -sf -o /dev/null --max-time 3 http://localhost:5173/ && curl -sf -o /dev/null --max-time 3 http://localhost:8000/health; }

changed() {
  { git diff --name-only; git diff --name-only --cached; } 2>/dev/null | sort -u
}

if [ "${1:-}" = "--list" ]; then
  printf '%-8s %s\n' 이름 "보는 것"
  for i in "${!NAMES[@]}"; do printf '%-8s %s\n' "${NAMES[$i]}" "${DESCS[$i]}"; done
  exit 0
fi

WANT=""
if [ "${1:-}" = "--all" ]; then
  WANT="${NAMES[*]}"
  echo "== QA · 전부"
elif [ $# -gt 0 ]; then
  WANT="$*"
  echo "== QA · 고른 것: $WANT"
else
  FILES="$(changed)"
  if [ -z "$FILES" ]; then echo "== QA · 바뀐 파일이 없습니다"; exit 0; fi
  echo "== QA · 바뀐 파일 $(printf '%s\n' "$FILES" | wc -l | tr -d ' ')개를 보고 고릅니다"
  for i in "${!NAMES[@]}"; do
    printf '%s\n' "$FILES" | grep -Eq "${PATS[$i]}" && WANT="$WANT ${NAMES[$i]}"
  done
  [ -z "$WANT" ] && { echo "   해당하는 검사가 없습니다"; exit 0; }
fi

FAIL=0; SKIP=0; RAN=0
for i in "${!NAMES[@]}"; do
  name="${NAMES[$i]}"; desc="${DESCS[$i]}"; cmd="${CMDS[$i]}"
  case " $WANT " in *" $name "*) ;; *) continue;; esac
  echo; echo "── $name · $desc"
  case "$name" in
    data|units|mirror|build|ai) need_db || { echo "   ⏭ 건너뜀 — DB(55432)가 안 떠 있습니다"; SKIP=$((SKIP+1)); continue; };;
    screen) need_screen || { echo "   ⏭ 건너뜀 — 프론트(5173)·API(8000)가 안 떠 있습니다"; SKIP=$((SKIP+1)); continue; };;
  esac
  if eval "$cmd"; then RAN=$((RAN+1)); else echo "   ❌ $name 실패"; FAIL=$((FAIL+1)); fi
done

echo
echo "== 통과 $RAN · 실패 $FAIL · 건너뜀 $SKIP"
[ "$SKIP" -gt 0 ] && echo "   건너뛴 것은 **통과가 아니다.** 그 서버를 띄우고 다시 돌리세요."
exit $([ "$FAIL" -gt 0 ] && echo 1 || echo 0)
