#!/bin/bash
# 국토부 실거래가 공개시스템 — 서울(11) 전체, 연도별 CSV.
# 유형(srhThingSecd) 여덟 갈래(2026-10-08 전부 받기):
#   A 아파트 · B 연립다세대 · C 단독다가구(주상 통건물 거래가 여기 들어감 — 역삼동 601-5로 실증)
#   D 오피스텔 · E 분양입주권 · F 상업업무용 · G 토지 · H 공장창고
# 흐름: gis.do(세션 유형 설정) → xls.do → ptXlsDownDataCheck.do(프라이밍) → ptXlsCSVDown.do
# 통제 파라미터 = srhThingNo. jsessionid 경로파라미터 필수. 인증키 불필요.
set -u
OUT="data/raw/실거래가"; mkdir -p "$OUT"
UA="Mozilla/5.0"
B="https://rt.molit.go.kr/pt"
TYPES="${TYPES:-A B C D E F G H}"
YEARS="${1:-2006 2007 2008 2009 2010 2011 2012 2013 2014 2015 2016 2017 2018 2019 2020 2021 2022 2023 2024 2025 2026}"
name_of(){ case "$1" in
  A) echo 아파트;; B) echo 연립다세대;; C) echo 단독다가구;; D) echo 오피스텔;;
  E) echo 분양입주권;; F) echo 상업업무용;; G) echo 토지;; H) echo 공장창고;; esac; }
THIS_YEAR=$(date +%Y); TODAY=$(date +%Y-%m-%d)

dl() { # $1=유형 $2=연도
  local T="$1" Y="$2" TO="$2-12-31"; [ "$Y" = "$THIS_YEAR" ] && TO="$TODAY"   # 올해는 오늘까지
  local NM; NM=$(name_of "$T")
  local FILE="$OUT/${NM}_매매_서울_$Y.csv"
  local CJ="/tmp/rt_cj_${T}_$Y.txt"; rm -f "$CJ"
  curl -sS -m 30 -c "$CJ" -b "$CJ" -o /dev/null "$B/gis/gis.do?srhThingSecd=$T&mobileAt=" -H "User-Agent: $UA"
  curl -sS -m 30 -c "$CJ" -b "$CJ" -o /dev/null "$B/xls/xls.do?srhThingSecd=$T&mobileAt=" -H "User-Agent: $UA"
  local JSID; JSID=$(grep -i JSESSIONID "$CJ" | awk '{print $7}')
  local F=(--data-urlencode "srhThingSecd=$T" --data-urlencode "srhThingNo=$T"
    --data-urlencode "srhDelngSecd=1" --data-urlencode "srhAddrGbn=1"
    --data-urlencode "srhLfstsSecd=1" --data-urlencode "srhSidoCd=11"
    --data-urlencode "srhSggCd=" --data-urlencode "srhEmdCd="
    --data-urlencode "srhFromDt=$Y-01-01" --data-urlencode "srhToDt=$TO"
    --data-urlencode "sidoNm=서울특별시" --data-urlencode "mobileAt=")
  curl -sS -m 60 -b "$CJ" -c "$CJ" -o /dev/null "$B/xls/ptXlsDownDataCheck.do;jsessionid=$JSID" \
    -H "User-Agent: $UA" -H "Referer: $B/xls/xls.do" "${F[@]}"
  # **임시 파일로 받아 확인한 뒤에만 바꿔 끼운다**(2026-10-08 사고). 국토부는 하루 100건을 넘기면
  # HTTP 200 에 {"error":"일일 다운로드 횟수는 최대 100건 입니다."} 66바이트를 준다. 예전엔 그걸로
  # 멀쩡한 파일을 덮어써서 단독다가구 · 상업업무용 2026 이 날아갔다.
  local TMP="$FILE.part"
  local code; code=$(curl -sS -m 180 -b "$CJ" -c "$CJ" -o "$TMP" \
    -w "%{http_code}:%{size_download}" "$B/xls/ptXlsCSVDown.do;jsessionid=$JSID" \
    -H "User-Agent: $UA" -H "Referer: $B/xls/xls.do" "${F[@]}")
  local kind; kind=$(sed -n '9p' "$TMP" | iconv -f euc-kr -t utf-8 2>/dev/null)
  local rows; rows=$(wc -l < "$TMP")
  if [[ "$kind" != *실거래구분* ]]; then
    local err; err=$(head -c 300 "$TMP" | iconv -f utf-8 -t utf-8 2>/dev/null)
    rm -f "$TMP"
    echo "✗ $NM $Y → $code · 받지 못함(옛 파일 그대로) · $err"
    FAILED=$((FAILED + 1))
    return
  fi
  mv -f "$TMP" "$FILE"
  echo "$NM $Y → $code · ${rows}행 · [$kind]"
}

FAILED=0
for T in $TYPES; do
  for Y in $YEARS; do dl "$T" "$Y"; sleep 4; done
done
echo "완료: $OUT · 실패 $FAILED"
[ "$FAILED" -eq 0 ]          # 하나라도 못 받으면 0 이 아닌 값으로 끝낸다 — 단위 실행기가 멈춘다