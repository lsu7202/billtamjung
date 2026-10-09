-- 0207 · building_use 이름 정리(10-02 대표) — 화면 이름은 「소분류」(실사용 · 투자용 · 신축용, 0184).
-- 0011 때 붙인 「건물용도」가 사전에 남아 있었다. 건물용도는 대장 주용도와 헷갈리고 뜻도 다르다.
UPDATE ref.enum_groups SET label = '소분류' WHERE enum_key = 'building_use';
UPDATE ref.fields      SET label = '소분류' WHERE field_key = 'building_use';
