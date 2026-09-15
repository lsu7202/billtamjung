# 빌탐정

서울 상업용 건물 60만 채의 스펙 · 실거래 · 임대 정보를 한 화면에서 보고,
AI 어시스턴트가 DB 를 근거로 답하는 부동산 투자 분석 서비스입니다.

![AI 어시스턴트](docs/img/ai-assistant.png)

## 기간 · 역할

2026.07 ~ 진행 중 · 단독 개발. 기획 · 프론트엔드 · 백엔드 · 데이터 파이프라인 · 배포를 혼자 맡았습니다.

| 날짜 | 커밋 | |
|---|---|---|
| 07.05 | [초기 커밋: 와이어프레임 스펙 + 목업](../../commit/0ad5ac1) | 코드보다 스펙으로 시작 |
| 08.02 | [data.go.kr 자동 다운로더](../../commit/39ecf54) · [V-World 크롤러](../../commit/d03f125) | 원천 수집 자동화 |
| 08.04 | [GCP 배포 스크립트 · 런북](../../commit/309519c) | 배포 |
| 08.06 | [자동완성 4.6s → 0.15s](../../commit/786f042) · [검색 0.66 → 0.24s](../../commit/11d0678) | 성능 |
| 08.09 | [영역을 여러 개 그린다](../../commit/78b0606) | 고유 기능 |
| 09.01 | [대장 전국본을 버리고 서울본 55장으로](../../commit/df99903) | 데이터 재편 |
| 09.02 | [흩어진 검사를 qa/ 한 폴더로 · run.sh 한 문](../../commit/41a80ae) | 검사 자동화 |
| 09.08 | [AI 어시스턴트 1단계](../../commit/c166257) → [2단계](../../commit/cfe7335) | AI |

## 왜 만들었나

상업용 부동산 시장의 가장 큰 리스크는 가격 불확실성임. 이 리스크는 정보 비대칭성과 낮은 거래 빈도라는
시장 특성에 의해 발생함. 이는 시장의 투자 심리를 저하시키며, 정보력이 부족한 개인은 리스크에 노출되기
더욱 쉬움. 실제로 이를 악용해 부당 이득을 취득하는 사례는 빈번하며, 건강한 시장을 위해선 이를 해결해야 함.

따라서 이 가격 불확실성 리스크를 해소할 수 있는 부동산 전문 AI 「빌탐정」을 시장에 공급하고자 함.
이는 부동산에 특화된 AI로 해당 분야에서 일반 AI보다 뛰어난 정보력과 문제 해결 능력을 가지고 있음.
그 근거는 서울 빌딩 60만 채의 모든 스펙을 실시간으로 분석하고 답하기 때문임. 빌탐정은 원하는 조건의
건물이 무엇인지, 구체적 건물 스펙, 장점과 단점, 합리적인 가격 범위 그리고 미래 수익성을 분석하고 답할 수
있음. 따라서 중개사는 건물의 합리적인 가격과 근거를 쉽게 제시할 수 있게 됨. 나아가 개인은 더 이상
정보력에 뒤처지지 않으며 리스크로부터 벗어날 수 있음.

## 주요 기능

| | |
|---|---|
| ![검색](frontend/public/beta/img/01-검색.png) | ![검색 결과](frontend/public/beta/img/10-검색결과.png) |
| 조건으로 서울 전 건물을 거르는 검색 | 목록과 지도가 같은 조건을 공유 |
| ![리포트](frontend/public/beta/img/02-리포트요약.png) | ![상권](frontend/public/beta/img/03-상권정의.png) |
| 건물 하나의 가치 분석 보고서 | 지도에 직접 그려 상권을 정의 |

## 구조

```
frontend/   React + Vite + TypeScript · TanStack Query · Zustand
backend/    FastAPI · asyncpg · JWT
db/         PostgreSQL + PostGIS 마이그레이션
pipeline/   공공 데이터 수집 → 정제 → 적재 → 검증
infra/      Docker · Firebase Hosting · Cloud Run · Terraform
qa/         목적별 검사 (data · screen · mirror · build · ui) · run.sh 한 문
specs/      제품 · 데이터 · 아키텍처 명세 (정본)
```

## 볼 만한 코드

문제를 만나 고친 지점입니다. 링크가 실제 코드입니다.

- **필터 요구의 진짜 목적** — 중개사가 필터를 요구한 이유는 필터가 없어서가 아니라 원하는 건물을 찾고
  가격을 가늠하기 위해서였습니다. 실거래와 공시지가로 건물마다 적정가 · 임대료를 미리 계산해 두고
  그 값으로 찾게 했습니다. → [`pipeline/`](pipeline/)
- **지도 마커 수만 개** — 마커마다 DOM 을 만들자 화면이 멈춰, 캔버스 한 장에 그리고 `requestAnimationFrame`
  으로 프레임당 한 번만 갱신했습니다. 클릭 판정은 좌표 계산으로 대신합니다.
  → [`shared/map/mapCanvasLayer.ts`](frontend/src/shared/map/mapCanvasLayer.ts)
- **토큰 만료 때 동시 401** — 화면의 요청들이 같은 순간 재발급을 각자 불러 10여 건이 나갔습니다.
  진행 중인 재발급 하나를 공유해 한 건으로 줄였습니다.
  → [`shared/api/client.ts`](frontend/src/shared/api/client.ts)
- **잘려서 오는 AI 답변** — 서버가 SSE 로 보낸 조각을 네트워크가 임의로 잘라, 그대로 해석하면 답변 일부가
  사라졌습니다. 빈 줄을 만날 때까지 버퍼에 모아 온전해진 뒤 해석합니다.
  → [`features/assistant/api.ts`](frontend/src/features/assistant/api.ts)
- **첫 화면 번들 584KB 감소** — 3D 를 열지 않는 유저까지 three.js 를 받고 있어 `React.lazy` 로 별도 청크로
  뗐습니다. → [`features/building/LandScene.tsx`](frontend/src/features/building/LandScene.tsx)
- **필요한 검사만 돌리는 QA** — 검사가 일곱 갈래로 늘어 전부 돌리면 몇십 분이라 고칠 때마다 돌리지 못하게
  됐습니다. git diff 로 바뀐 경로를 읽어 그 경로를 맡는 갈래만 돌리고, 화면 검사는 Playwright 로 실제 화면을
  열어 화면값과 DB 값을 대조합니다. → [`qa/run.sh`](qa/run.sh) · [`qa/screen/qa_screen.py`](qa/screen/qa_screen.py)

## AI 어시스턴트

유저 질문을 의도와 조건으로 나눠 필요한 스킬을 고르고, 스킬이 읽기 API 를 부르거나 읽기 전용 계정으로
DB 에 직접 질의합니다. 결과는 값 · 출처 · 단위가 붙은 한 형식으로 정규화되어 돌아오므로 모델이 지어낼
자리가 없습니다. 찾지 못한 값은 비웁니다.
→ [`specs/07-architecture/10-AI-어시스턴트.md`](specs/07-architecture/10-AI-어시스턴트.md)

## 실행

```bash
docker compose -f infra/docker/docker-compose.yml up --build   # db:55432 · api:8000
cd frontend && npm install && npm run dev                        # http://localhost:5173
qa/run.sh                                                        # 바뀐 파일에 맞는 검사만
```

## 운영 기록

2026.08 중개사 베타 운영 (계정 34 · 매물 36 · 보고서 112). 2026.09 클라우드 정리, 지금은 로컬 실행으로 확인합니다.
