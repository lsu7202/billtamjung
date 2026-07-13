#!/bin/bash
# 국토부 실거래가 공개시스템 — 상업업무용(F) 매매(1), 서울(11) 전체, 연도별 CSV.
# 흐름: GET xls.do(세션) → ptXlsDownDataCheck.do(폼으로 세션 프라이밍) → ptXlsCSVDown.do
# jsessionid 경로파라미터 필수(다운로드 노드 라우팅). 인증키 불필요.
set -u
OUT="data/raw/실거래가"; mkdir -p "$OUT"
UA="Mozilla/5.0"
BASE="https://rt.molit.go.kr/pt/xls"
YEARS="${1:-2016 2017 2018 2019 2020 2021 2022 2023 2024 2025 2026}"

dl() {
  local Y="$1" TO="$1-12-31"; [ "$Y" = "2026" ] && TO="2026-07-13"
  local CJ="/tmp/rt_cj_$Y.txt"; rm -f "$CJ"
  curl -sS -m 30 -c "$CJ" -b "$CJ" -o /dev/null "https://rt.molit.go.kr/pt/gis/gis.do?srhThingSecd=F&mobileAt=" -H "User-Agent: $UA"
  curl -sS -m 30 -c "$CJ" -b "$CJ" -o /dev/null "https://rt.molit.go.kr/pt/xls/xls.do?srhThingSecd=F&mobileAt=" -H "User-Agent: $UA"
  local JSID; JSID=$(grep -i JSESSIONID "$CJ" | awk '{print $7}')
  local F=(--data-urlencode "srhThingSecd=F" --data-urlencode "srhThingNo=F"
    --data-urlencode "srhDelngSecd=1" --data-urlencode "srhAddrGbn=1"
    --data-urlencode "srhLfstsSecd=1" --data-urlencode "srhSidoCd=11"
    --data-urlencode "srhSggCd=" --data-urlencode "srhEmdCd="
    --data-urlencode "srhFromDt=$Y-01-01" --data-urlencode "srhToDt=$TO"
    --data-urlencode "sidoNm=서울특별시" --data-urlencode "mobileAt=")
  # 프라이밍(세션에 쿼리 등록)
  curl -sS -m 60 -b "$CJ" -c "$CJ" -o /dev/null "$BASE/ptXlsDownDataCheck.do;jsessionid=$JSID" \
    -H "User-Agent: $UA" -H "Referer: https://rt.molit.go.kr/pt/xls/xls.do" "${F[@]}"
  # CSV 다운로드
  local code; code=$(curl -sS -m 180 -b "$CJ" -c "$CJ" -o "$OUT/상업업무용_매매_서울_$Y.csv" \
    -w "%{http_code}:%{size_download}" "$BASE/ptXlsCSVDown.do;jsessionid=$JSID" \
    -H "User-Agent: $UA" -H "Referer: https://rt.molit.go.kr/pt/xls/xls.do" "${F[@]}")
  local kind; kind=$(sed -n '9p' "$OUT/상업업무용_매매_서울_$Y.csv" | iconv -f euc-kr -t utf-8 2>/dev/null)
  local rows; rows=$(wc -l < "$OUT/상업업무용_매매_서울_$Y.csv")
  echo "$Y → $code · ${rows}행 · [$kind]"
}

for Y in $YEARS; do dl "$Y"; sleep 4; done
echo "완료: $OUT"