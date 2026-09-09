-- 0170 · 업종으로 건물 찾기 — 색인
--
-- 왜: 「성수동2가 병원 건물 찾아줘」가 안 됐다. 대장 주용도가 「의료시설」인 건물은 통째로 병원인
--     건물이라 드물고(성수동2가 2동), 중개인이 찾는 건 병원이 층으로 든 건물이다(같은 동 42지번).
--     업체는 master.localdata_permit(영업 인허가 315만)에 있고 좌표로 잇는다.
--
-- 함정: geom 은 geometry(4326) 이라 ST_DWithin(a,b,25) 의 25가 미터가 아니라 **도**다.
--     ::geography 를 붙이면 미터가 되는데, 그러면 geometry GIST 색인을 못 쓴다.
--     동 하나(1.4초)는 버텨도 구 하나는 5분을 넘겼다. **캐스트한 꼴 그대로 색인을 만든다.**

CREATE INDEX IF NOT EXISTS localdata_permit_geog_idx
    ON master.localdata_permit USING gist ((geom::geography));

-- 영업 중 + 업종은 거의 늘 같이 걸린다. 폐업한 것은 안 본다
CREATE INDEX IF NOT EXISTS localdata_permit_open_biz_idx
    ON master.localdata_permit (biz1) WHERE close_on IS NULL;

CREATE INDEX IF NOT EXISTS sbiz_store_geog_idx
    ON master.sbiz_store USING gist ((geom::geography));

ANALYZE master.localdata_permit;
ANALYZE master.sbiz_store;
