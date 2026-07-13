#!/bin/bash
# 국토부 실거래가 공개시스템 — 서울(11) 전체, 연도별 CSV.
# 유형: F=상업업무용, C=단독다가구(주상 통건물 거래가 여기 들어감 — 역삼동 601-5로 실증).
# 흐름: gis.do(세션 유형 설정) → xls.do → ptXlsDownDataCheck.do(프라이밍) → ptXlsCSVDown.do
# 통제 파라미터 = srhThingNo. jsessionid 경로파라미터 필수. 인증키 불필요.
set -u
OUT="data/raw/실거래가"; mkdir -p "$OUT"
UA="Mozilla/5.0"
B="https://rt.molit.go.kr/pt"
TYPES="${TYPES:-F C}"
YEARS="${1:-2006 2007 2008 2009 2010 2011 2012 2013 2014 2015 2016 2017 2018 2019 2020 2021 2022 2023 2024 2025 2026}"
name_of(){ [ "$1" = "F" ] && echo "상업업무용" || echo "단독다가구"; }

dl() { # $1=유형 $2=연도
  local T="$1" Y="$2" TO="$2-12-31"; [ "$Y" = "2026" ] && TO="2026-07-13"
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
  local code; code=$(curl -sS -m 180 -b "$CJ" -c "$CJ" -o "$FILE" \
    -w "%{http_code}:%{size_download}" "$B/xls/ptXlsCSVDown.do;jsessionid=$JSID" \
    -H "User-Agent: $UA" -H "Referer: $B/xls/xls.do" "${F[@]}")
  local kind; kind=$(sed -n '9p' "$FILE" | iconv -f euc-kr -t utf-8 2>/dev/null)
  local rows; rows=$(wc -l < "$FILE")
  echo "$NM $Y → $code · ${rows}행 · [$kind]"
}

for T in $TYPES; do
  for Y in $YEARS; do dl "$T" "$Y"; sleep 4; done
done
echo "완료: $OUT"