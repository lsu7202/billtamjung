# 빌탐정 (Billtamjung)

서울 상업용 건물 중개사를 위한 부동산 가치분석 SaaS. 건물·토지·공시지가·매각 데이터부터 **가치점수·적정매매가 분석·매물분석보고서(PPT)**까지 하나의 화면에서.

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
