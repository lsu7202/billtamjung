#!/usr/bin/env bash
# UI 어법 검사 — 문서는 안 읽혀도 이건 실패한다(CLAUDE.md 「UI 어법」).
#
# 왜 이렇게 만들었나: 「네모칸 금지」를 스펙에 적어 뒀는데도 인라인 화면에 네모버튼이
#   다시 들어갔다. 규칙을 지키게 하려면 읽으러 가야 하는 문서가 아니라 기계가 잡아야 한다.
#
# 방식은 **래칫**이다. 이미 있는 것(모달 폼·명함 뒷면·클릭편집 안쪽 등 허용된 자리)은
#   기준선에 박아 두고, **새로 늘어난 것만** 실패시킨다. 전부 잡으면 소음이 되어
#   결국 아무도 안 본다 — 늘어나지 않게 막는 것이 목적이다.
#
#   새 위반이 나오면: 칩·슬라이딩 토글·클릭편집·아이콘 컨트롤 중 하나로 바꾼다.
#   정말 허용해야 하면 기준선을 갱신한다:  qa/ui/check_ui.sh --accept
set -u
# qa/ui/ 에서 저장소 뿌리까지 **두 단계**다. scripts/ 시절의 한 단계를 그대로 두는 바람에
# qa/ 에서 프론트를 찾다가 빈 기준선을 만들고 「위반 없음」이라 했다(2026-09-02).
cd "$(dirname "$0")/../.." || exit 1
BASE="$(cd "$(dirname "$0")" && pwd)/ui_baseline.txt"   # 스크립트 옆. 어디서 불러도 같은 파일(2026-09-02)
FEAT=frontend/src/features

scan() {
  { grep -rn "<select" $FEAT --include=*.tsx
    # 클릭-편집(autoFocus 로 열리고 onBlur 로 닫히는 입력)은 허용 어법이라 뺀다.
    # pill 입력줄(tb-in·memo-in)도 규칙이 권장하는 「한 줄 기록」 어법이라 뺀다.
    # 검색 pill(mo-q)도 마찬가지다 — 규칙이 「목록 상단 검색 pill」을 쓰라고 못박은 자리다.
    # 「항상 떠 있는 네모칸」만 잡는 것이 목적이다.
    grep -rn "<input" $FEAT --include=*.tsx \
      | grep -v 'type="file"\|type="checkbox"\|type="radio"' \
      | grep -v 'autoFocus' \
      | grep -v 'tb-in' \
      | grep -v 'memo-in' \
      | grep -v 'mp-pill' \
      | grep -v '주소 또는 지명' \
      | grep -v 'q-pill'   # 목록 상단 검색 pill(소식 탭). 규칙이 허용한 자리라 이름을 박아 뺀다(2026-09-06)
    # 모달 파일(*Modal.tsx)은 폼이 허용된 자리다 — 「폼은 모달 안에서만」이 규칙이다.
    # 인라인 화면에 네모칸이 새로 서는 것만 잡는 것이 이 검사의 목적이다.
  } 2>/dev/null | grep -v 'Modal\.tsx' | sed 's/:[0-9]*:/:/' | sed 's/^[[:space:]]*//' | sort -u
}

now=$(scan)
if [ "${1:-}" = "--accept" ]; then
  printf '%s\n' "$now" > "$BASE"
  echo "기준선 갱신 — $(printf '%s\n' "$now" | wc -l | tr -d ' ')줄"
  exit 0
fi
[ -f "$BASE" ] || { printf '%s\n' "$now" > "$BASE"; echo "기준선 생성"; exit 0; }

new=$(comm -13 <(sort -u "$BASE") <(printf '%s\n' "$now"))
if [ -n "$new" ]; then
  echo "❌ 새 네모 컨트롤이 들어왔습니다 — 칩·토글·클릭편집·아이콘으로 바꾸세요"
  printf '%s\n' "$new" | sed 's/^/   /'
  echo
  echo "   규칙: CLAUDE.md 「UI 어법」 · 정본 specs/02-screens/네비게이션-규칙.md"
  echo "   정말 허용해야 하면: qa/ui/check_ui.sh --accept"
  exit 1
fi
echo "✅ 새 위반 없음"
