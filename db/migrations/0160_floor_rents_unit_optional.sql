-- 호실 번호는 모르면 비워 둔다(2026-09-06 대표 지적 「호실번호는 모르는 건데 왜 채우는겨」).
--
-- 지금까지 (건물, 팀, 층, 호실) 이 유일키라 한 층에 줄을 여럿 두려면 호실에 순번(1·2·3)을
-- 지어 넣어야 했다. 원장에서 업체마다 한 줄을 세우면 그 순번이 「501호·502호」로 화면에 서서
-- 대장에 없는 값을 우리가 만든 꼴이 된다. 이제 호실이 빈 줄은 여럿이어도 되고, 줄은 id 로 고친다.
-- 호실을 적은 줄끼리만 유일하다.
ALTER TABLE app.floor_rents DROP CONSTRAINT IF EXISTS floor_rents_building_pk_team_id_floor_unit_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS floor_rents_unit_uk
  ON app.floor_rents(building_pk, team_id, floor, unit_no) WHERE unit_no <> '';
