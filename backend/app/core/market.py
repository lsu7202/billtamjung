"""상권 갈래 — **업체 하나가 한 표**다. 대장 층별 용도가 아니다(2026-09-06, 항목 M).

왜 갈았나: 대장 용도는 지을 때 신고한 것이라 「제2종근린생활시설」 한 낱말에 미용실·학원·
  의원·사무실이 다 들어간다. 서울 98만 층 중 절반(50.8%)이 「기타」였다. 소상공인 상가정보의
  업종 중분류로 가르면 기타가 2.7% 다(실측 2026-09-06 · 55.4만 업체).

사전은 `ref.biz_category` **한 곳**이다(0157). 갈래를 늘리거나 옮기려면 사전에 한 줄이지
  코드가 아니다. 예전엔 같은 정규식이 buildings.py 와 generate_report.py 에 따로 박혀 있었다.

일곱 갈래: 업무 · 먹자 · 판매 · 생활서비스 · 교육 · 유흥 · 의료. 「기타」(숙박·도서관)는 세지 않는다.
"""

# 갈래 붙은 업체 점. 서브쿼리로 끼운다 — `FROM ({STORES}) st`.
STORES = """SELECT s.geom, c.cat
              FROM master.sbiz_store s
              JOIN ref.biz_category c ON c.source = 'sbiz' AND c.key = s.cat2
             WHERE c.cat <> '기타' AND s.geom IS NOT NULL"""
