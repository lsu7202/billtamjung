# SQL예제 — 우리 표를 SQL 로 짜는 법

화면이 쓰는 길(읽기 API)이 없는 질문에만 `query` 를 쓴다. 집계 · 복합 조건 · 상대 비교.

## 표

| 표 | 무엇 | 열쇠 |
|---|---|---|
| `master.buildings` | 건물 58만 동. **뷰다.** `buildings_v9` 같은 세대 표를 직접 보지 않는다 | `building_pk` · `pnu` |
| `master.parcels` | 필지 90만. 용도지역 · 규제 · 법정 건폐·용적 | `pnu` |
| `master.gongsi_series` | 개별공시지가 1990~2026. `year` · `price`(원/㎡) | `pnu` |
| `master.sales_history` | 실거래. `contract_ym` · `price`(원) · `total_area` · `land_area` | `building_pk` |
| `master.area_event` | 주변 소식. `kind` · `name` · `on_date` · `distance_m` | 좌표 |
| `master.region_index` | 구·동 · `bjd_code` · `sgg_code` | |
| `ref.enums` · `ref.biz_category` | 코드 사전. `codes(그룹)` 이 더 빠르다 | `enum_key` · `code` |

칸이 확실치 않으면 `describe(표)` 를 먼저 본다. 주석에 뜻과 **인덱스 여부**가 있다.

## 인덱스 — 여기로 거른다

`buildings` 에서 빠른 칸: `pnu` · `bjd_code`(접두 `LIKE '1120011400%'` 됨) · `sgg_code` · `main_use` · `use_zone` · `addr`(부분 일치) · `geom`.
**없는 칸**: `total_area` · `floors_above` · `approval_ymd` · `bcr` · `far`. 이걸로만 거르면 58만 줄을 훑는다.
그러니 **먼저 동·구로 좁히고** 그 안에서 면적·층을 건다.

## 단위

값은 전부 **㎡ · 원**이다. 사람에게 말할 때는 평 · 억 · 만원으로 바꾼다.
평 = ㎡ / 3.3058.  200평 = 661.16㎡.  억 = 원 / 1e8.  만원/㎡ = 원 / 1e4.

## 예제

**「몇 개」와 「큰 순 셋」은 다른 물음이다 — 둘 다 물었으면 둘 다 센다**

`LIMIT` 은 보여 줄 줄만 자른다. **개수가 아니다.**
`LIMIT 10` 을 붙여 놓고 돌아온 열 줄을 세면 415동짜리 동네가 10동이 된다(2026-09-09 실제).

```sql
-- ① 몇 동인가 — 세는 쿼리. LIMIT 을 안 쓴다
SELECT count(*) AS n
  FROM master.buildings
 WHERE bjd_code LIKE '1120011400%'      -- 성수동1가. region_index 에서 찾는다
   AND total_area >= 661.16
```
```sql
-- ② 큰 순 셋 — 보여 줄 줄만 자른다
SELECT addr, total_area, floors_above
  FROM master.buildings
 WHERE bjd_code LIKE '1120011400%'
   AND total_area >= 661.16
 ORDER BY total_area DESC LIMIT 3
```

한 번에 하려면 창 함수를 쓴다.
```sql
SELECT addr, total_area, count(*) OVER () AS 전체
  FROM master.buildings
 WHERE bjd_code LIKE '1120011400%' AND total_area >= 661.16
 ORDER BY total_area DESC LIMIT 3
```

**구별 평균 연면적**
```sql
SELECT r.gu, round(avg(b.total_area)/3.3058) AS avg_py, count(*) AS n
  FROM master.buildings b JOIN master.region_index r ON r.bjd_code = b.bjd_code
 GROUP BY r.gu ORDER BY avg_py DESC
```

**2000년 이후 준공 · 승강기 있음 · 용적 여유 100% 넘는 곳**
```sql
SELECT b.addr, b.far, p.legal_far, b.approval_ymd
  FROM master.buildings b JOIN master.parcels p ON p.pnu = b.pnu
 WHERE b.bjd_code LIKE '1120011400%'
   AND b.approval_ymd >= '2000-01-01' AND b.elevator > 0
   AND p.legal_far - b.far >= 100
 ORDER BY p.legal_far - b.far DESC LIMIT 20
```

**한 필지의 공시지가 10년 추이**
```sql
SELECT year, price FROM master.gongsi_series
 WHERE pnu = '1120011400100140053' AND year >= 2016 ORDER BY year
```

**반경 500m 최근 3년 실거래 (좌표는 buildings.geom)**
```sql
SELECT b.addr, s.contract_ym, s.price, s.total_area
  FROM master.sales_history s JOIN master.buildings b USING (building_pk)
 WHERE ST_DWithin(b.geom::geography,
                  (SELECT geom FROM master.buildings WHERE building_pk = '10051100198132')::geography, 500)
   AND s.contract_ym >= '2023'
 ORDER BY s.contract_ym DESC LIMIT 20
```
반경 실거래는 읽기 API `/market/nearby-sales/{pk}` 가 이미 낸다. 그 길이 먼저다. 조건이 다를 때만 SQL.

## 결과

`query` 는 개수와 앞 다섯 줄만 돌려주고 나머지는 `result_id` 로 넘긴다.
표로 보이려면 `ui("table", {"source": "result#N"})`. 줄을 글로 옮겨 적지 않는다.
