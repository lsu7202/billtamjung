# 빌탐정

서울 상업용 건물 중개사를 위한 부동산 투자 분석 플랫폼. 건물 58만 동의 스펙과 실거래,
임대 정보를 한 화면에서 보고, 대화형 AI가 DB를 근거로 답합니다.

**2026.07 ~ 진행 중 · 단독 개발 · 커밋 539**
기획 · 프론트엔드 · 백엔드 · 데이터 파이프라인 · 배포까지 혼자 맡았습니다.

| | |
|---|---|
| ![검색](frontend/public/beta/img/01-검색.png) | ![검색 결과](frontend/public/beta/img/10-검색결과.png) |
| 조건으로 서울 전 건물을 거르는 검색 | 목록과 지도가 같은 조건을 공유 |
| ![리포트](frontend/public/beta/img/02-리포트요약.png) | ![상권](frontend/public/beta/img/03-상권정의.png) |
| 건물 하나의 가치 분석 보고서 | 지도에 직접 그려 상권을 정의 |

## 이 저장소에서 볼 만한 것

문제를 만나 고친 지점들입니다. 각 줄의 링크가 실제 코드입니다.

- **지도 핀 수만 개** — 마커마다 DOM 을 만들자 화면이 멈춰, 캔버스 한 장에 직접 그리고
  `requestAnimationFrame` 으로 프레임당 한 번만 갱신했습니다. 클릭 판정은 좌표 계산으로 대신합니다.
  → [`shared/map/mapCanvasLayer.ts`](frontend/src/shared/map/mapCanvasLayer.ts)
- **초기 번들 584KB 감소** — 3D 모달을 열지 않는 사용자까지 three.js 를 받고 있어 지연 로딩으로 분리했습니다.
  WebGL 자원은 화면을 닫을 때 순회하며 해제합니다.
  → [`features/building/ParcelScene3D.tsx`](frontend/src/features/building/ParcelScene3D.tsx)
- **동시 401 폭주** — 토큰이 만료되면 화면의 쿼리들이 같은 순간에 갱신을 각자 불러 10여 건이 나갔습니다.
  진행 중인 갱신 하나를 공유해 한 건으로 줄였습니다.
  → [`shared/api/client.ts`](frontend/src/shared/api/client.ts)
- **AI 응답 스트리밍** — 인증 헤더를 붙일 수 없어 EventSource 대신 `fetch` 스트림을 직접 파싱합니다.
  반쪽만 도착한 덩이는 버퍼에 남겨 다음 조각과 합치고, `AbortController` 로 중단을 처리합니다.
  → [`features/assistant/api.ts`](frontend/src/features/assistant/api.ts)
- **UI 규칙 린터** — 규칙을 도입하려면 기존 위반을 다 고쳐야 해서 아무도 쓰지 않습니다.
  기존 위반을 기준선에 박아 두고 새로 생긴 것만 실패시켰습니다.
  → [`qa/ui/check_ui.sh`](qa/ui/check_ui.sh)

## AI 어시스턴트 구조

유저 질문을 의도와 조건으로 나눠 필요한 스킬을 고르고, 스킬이 읽기 API 를 부르거나
읽기 전용 계정으로 DB 에 직접 질의합니다. 백엔드는 결과를 값·출처·단위가 붙은 한 형식으로
정규화해 돌려주므로 **모델이 지어낼 자리가 없습니다.** 찾지 못한 값은 비웁니다.
→ [`specs/07-architecture/10-AI-어시스턴트.md`](specs/07-architecture/10-AI-어시스턴트.md)

## 커밋 규칙

`feat` `fix` `docs` `refactor` `perf` 접두사를 쓰고, 무엇을 왜 고쳤는지 한 줄로 남깁니다.
작업은 목적 단위 브랜치에서 하고 PR 본문에 배경을 적습니다.

## 구성 (monorepo)
```
backend/    FastAPI (api + worker 공용 이미지) · asyncpg · JWT
frontend/   React + Vite + TS · TanStack Query · Zustand
db/         PostgreSQL(+PostGIS) 마이그레이션 · 함수 · 트리거
pipeline/   데이터 파이프라인(수집·정제 → Cloud SQL 적재)  ※ 기존 data/tools 승격 예정
infra/      Docker · docker-compose · Firebase Hosting · Terraform
specs/      제품·데이터·아키텍처 명세 (정본)
```

## 스택
FastAPI · React · **Cloud Run**(api·worker) · **Cloud SQL PostgreSQL+PostGIS** · Cloud Storage · Cloud Tasks · Cloud Scheduler · **Firebase Hosting**(프론트, `/api`→Cloud Run 프록시). 상세 = [specs/07-architecture](specs/07-architecture/).

## 로컬 실행
```bash
# 1) DB + 백엔드(도커)
docker compose -f infra/docker/docker-compose.yml up --build   # db:55432 / api:8000 / worker:8080
#    (DB는 최초 부팅 시 db/migrations 자동 적용)

# 2) 프론트
cd frontend && npm install && npm run dev                       # http://localhost:5173

# 백엔드만 별도로:
cd backend && python -m venv .venv && ./.venv/bin/pip install -e . && \
  BT_DATABASE_URL=postgresql://postgres:test@localhost:55432/billtamjung \
  ./.venv/bin/uvicorn app.main:app --reload
```
검증: `qa/app/smoke.py`(가입→크레딧→자동완성→건물병합→오버레이→401).

## 핵심 설계 포인트
- **데이터 3레이어**: 공공 마스터(불변) + 유저 오버레이(팀 공유·EAV) + 커뮤니티. 화면값 = master COALESCE overlay.
- **메타데이터 레지스트리**(`ref.fields`·`enums`·`formula_params`): 필드·enum·산식을 데이터로 → 추가·수정 시 한 곳만. ([specs/04-data/schema-ref.md](specs/04-data/schema-ref.md))
- **크레딧**: append-only 원장 + 버킷 잔액 캐시(트리거), 소멸 임박 버킷부터 차감.
- **영역 그리기 검색**(고유 기능): 지도에 폴리곤 → PostGIS `ST_Within`. ([specs/03-features/S01](specs/03-features/S01-매물통합검색.md) §3.6c)
- **신선도**: 보고서 `source_watermark`·`master_version` 비교 → "데이터 변경됨" 재생성.
- **베타/정식 경계**: [specs/기능목록-베타vs정식.md](specs/기능목록-베타vs정식.md)

## 상태 (베타 기능 완성 — 2026-07-21)
- ✅ **DB**: 마이그레이션 5종 + 함수/트리거, PostGIS 컨테이너 검증
- ✅ **백엔드**: 베타 전 도메인(인증·검색·선점·오버레이·임대·주변시세·위키·메모·광고가·즐겨찾기·저장검색·크레딧·**보고서 생성 pptx**) — 통합 스모크 **29/29**
- ✅ **프론트**: S00/S01/S02/S0M 실API 연결 + 정밀데이터랩 토큰 — 브라우저 E2E 통과
- ✅ **파이프라인 loader**: staging COPY→검증게이트→원자 스왑(뷰)→버전업→기존 보고서 stale 전환, 성공/차단 케이스 검증
- 🚧 다듬기: 네이버지도 연동(키 발급 후)·S01 3열 목록·S03 curation UI·R_example 서식 이식·GCS 업로드·Cloud Tasks 전환
