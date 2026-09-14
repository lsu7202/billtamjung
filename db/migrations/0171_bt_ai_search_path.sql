-- 0171 · bt_ai 가 PostGIS 를 찾게 한다 (2026-09-09)
--
-- 왜: 「종로2가에 병원 업체가 많은 건물」에 모델이 SQL 로 세려 했는데 네 번 다 죽었다.
--       type "geography" does not exist
--       function st_dwithin(public.geometry, public.geometry, integer) does not exist
--     bt_ai 의 search_path 가 master, ref 뿐이라 public 에 사는 PostGIS 타입·함수를 못 찾는다.
--     화면 API 는 postgres 로 돌아 public 이 기본 경로에 있으니 멀쩡했다 — 롤만의 문제였다.
--
-- 안전: search_path 는 이름을 찾는 순서일 뿐 권한이 아니다. public 의 표 다섯 중 bt_ai 가 읽는 것은
--     PostGIS 메타 셋(geography_columns · geometry_columns · spatial_ref_sys)뿐이고,
--     tmp_ 로 시작하는 작업 표 둘은 그대로 닫혀 있다.

ALTER ROLE bt_ai SET search_path = master, ref, public;
