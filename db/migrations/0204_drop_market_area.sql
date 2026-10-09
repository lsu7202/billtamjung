-- 0204 「주변 반경」 폐지(대표 10-01)
--
-- 상세보기에서 팀이 그려 저장하던 주변 상권(오버레이 field='market_area')을 뺐다. 흐름을 자꾸 막았다.
-- 주변 실거래 · 보고서 비교 범위는 건물 중심 반경 500m 고정. 저장 API 는 이 이름을 422 로 거절한다.
BEGIN;
DELETE FROM app.overlays WHERE field = 'market_area';
COMMIT;
