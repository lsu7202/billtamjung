-- 0029 층별임대 구조 편집 — 층 숨김
--
-- 지금까지 층별임대 오버레이는 '대장 구조 안에서만' 가능했다.
-- 병합 규칙이 "그 층에 팀이 K개 입력하면 그 층 마스터 호실 앞 K개를 대체"라서
--   · 3층 마스터 2호실을 실제로 하나로 합쳐 쓰면, 1개 입력해도 나머지 1개가 계속 남고
--   · 층 자체를 없앨 방법이 없었다.
--
-- 규칙을 '층 단위 인수'로 바꾼다: 어떤 층에 팀 행이 하나라도 있으면 그 층의 마스터 호실은
-- 전부 팀 입력으로 대체된다. 층을 통째로 없애는 건 팀 행이 0개여야 하므로 이 표로 표시한다.
--
-- overlays에 담지 않는 이유: overlays는 필드 레지스트리 트리거가 검증하는 '건물 필드' 저장소이고,
-- 층 목록은 그 모델에 맞지 않는다.

CREATE TABLE IF NOT EXISTS app.floor_hidden (
  building_pk text        NOT NULL,
  team_id     bigint      NOT NULL REFERENCES app.teams(id),
  floor       text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (building_pk, team_id, floor)
);

COMMENT ON TABLE app.floor_hidden IS
  '팀이 없앤 층(대장에는 있지만 실제로는 없는 층). 층별임대 표·총액 집계에서 제외된다.';
