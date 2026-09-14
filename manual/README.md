# 베타 테스터 자료

| 산출물 | 파일 | 웹 경로 |
|---|---|---|
| 사용 매뉴얼 (10p) | `빌탐정-사용매뉴얼.pdf` ← `manual.html` | `/guide` · PDF `/beta/manual.pdf` |
| 베타 주간 설문 (4p·주차별) | `빌탐정-베타설문지.pdf` ← `survey.html` | `/survey?w=1`~`w=4` (온라인 제출) · PDF `/beta/survey.pdf` |
| 광고 영상 15s | `../ad/빌탐정-광고-15s-B컷편집.mp4` | `/beta/ad.mp4` |
| 화면 캡처 | `img/*.png` (실제 조작 캡처, 예시=강남구 신사동 561-9) | `/beta/img/*` |

## 다시 만들기
```bash
# 캡처 갱신 후 PDF 재렌더 (플레이라이트)
#  manual.html / survey.html 수정 → 브라우저 인쇄(A4·배경 포함) 또는 아래 스크립트
# 웹 배포용 자산 동기화
cp ad/빌탐정-광고-15s-B컷편집.mp4 frontend/public/beta/ad.mp4
cp manual/빌탐정-사용매뉴얼.pdf     frontend/public/beta/manual.pdf
cp manual/빌탐정-베타설문지.pdf     frontend/public/beta/survey.pdf
cp manual/img/*.png                frontend/public/beta/img/
```

## 설문 응답 보기
- 저장: `app.survey_responses` — 주차별로 `survey_key`가 `beta-w1`~`beta-w4`로 구분 (익명 허용)
- 조회 API: `GET /survey/responses?survey_key=beta-w1` — **is_admin 계정만**
- 배포 후 테스터에게 주차별 링크를 직접 전달: `/survey?w=2` 형태 (페이지 내 이동 버튼은 두지 않음)
