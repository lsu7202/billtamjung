-- 0157 상권 갈래 사전 — 업종을 일곱으로 가른다(2026-09-05)
--
-- 지금까지 상권은 **건축물대장의 층별 용도**를 정규식으로 넷(업무·먹자·판매·유흥)으로
-- 갈랐다. 그런데 대장 용도는 「지을 때 신고한 것」이라 지금 그 층에 뭐가 있는지를 안 말한다.
-- 「제2종근린생활시설」 한 낱말에 미용실·학원·의원·사무실이 다 들어가서, 서울 982,848개 층
-- 가운데 **499,001개(50.8%)가 기타**로 떨어졌다.
--
-- 실제 업체(소상공인 상권업종)로 가르면 그 넷으로도 기타가 36.1% 로 준다. 그런데 그 36% 를
-- 열어 보면 잡동사니가 아니라 **갈래가 모자란 것**이었다 — 이용·미용 24,218 · 기타 교육
-- 17,153 · 의원 12,514. 미용실·학원·의원이 갈 칸이 없었다.
--
-- 그래서 일곱으로 간다. 실측(층 있는 367,619건):
--   먹자 25.6 · 업무 25.5 · 판매 18.7 · 생활서비스 11.6 · 교육 8.3 · 유흥 4.8 · 의료 3.6
--   기타 **1.9%**  ← 50.8% → 36.1% → 1.9%
--
-- 규칙을 코드가 아니라 **표**로 둔다. 지금 같은 정규식이 buildings.py 와 generate_report.py
-- 두 곳에 따로 박혀 있어서, 한 곳만 고치면 지도와 보고서가 다른 상권을 그린다.

CREATE TABLE IF NOT EXISTS ref.biz_category(
  source text NOT NULL,          -- 'sbiz'(소상공인 중분류명) | 'localdata'(업종 slug)
  key    text NOT NULL,
  cat    text NOT NULL,
  PRIMARY KEY (source, key)
);

COMMENT ON TABLE ref.biz_category IS
  '업종 → 상권 갈래(먹자·판매·업무·유흥·생활서비스·교육·의료·기타). 0157';

-- 갈래 이름은 여기 적힌 여덟뿐이다. 새 낱말이 들어오면 화면 색이 조용히 사라진다.
ALTER TABLE ref.biz_category DROP CONSTRAINT IF EXISTS biz_category_cat_chk;
ALTER TABLE ref.biz_category ADD CONSTRAINT biz_category_cat_chk
  CHECK (cat IN ('먹자','판매','업무','유흥','생활서비스','교육','의료','기타'));
