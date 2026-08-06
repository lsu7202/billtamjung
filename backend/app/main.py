"""빌탐정 API 엔트리(Cloud Run: api). 01-상세설계 §1."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .core import db, ratelimit
from .core.config import settings
from .domains import auth, social, search, buildings, overlays, credits, listings, floor_rents, market, reports, extras, photos, series, team, survey


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()


app = FastAPI(title="빌탐정 API", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def no_cdn_cache(request, call_next):
    """API 응답은 CDN 캐시 금지 — Firebase Hosting 엣지가 응답(404 포함)을 캐시해
    배포 후에도 스테일 404가 서빙되는 문제 실측(2026-08-03). 인증 JSON 캐시 방지 겸용."""
    resp = await call_next(request)
    resp.headers.setdefault("Cache-Control", "private, no-store")
    return resp


@app.middleware("http")
async def auth_rate_limit(request, call_next):
    """인증 엔드포인트 per-IP 제한 — 무차별 대입·봇 가입 방어(core.ratelimit)."""
    ip = ratelimit.client_ip(request.headers, request.client.host if request.client else "?")
    retry = ratelimit.check(request.url.path, ip)
    if retry is not None:
        return JSONResponse({"detail": "요청이 너무 잦습니다 — 잠시 후 다시 시도해 주세요"},
                            status_code=429, headers={"Retry-After": str(retry)})
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터를 맨몸 + /api 프리픽스로 이중 등록 — 로컬(vite가 /api 스트립)과
# Firebase Hosting(run 리라이트는 경로 그대로 전달) 양쪽 호환.
for m in (auth, social, search, buildings, overlays, credits, listings, floor_rents, market, reports, extras, photos, series, team, survey):
    app.include_router(m.router)
    app.include_router(m.router, prefix="/api")


@app.get("/health")
@app.get("/api/health")
async def health():
    ok = await db.pool().fetchval("SELECT 1")
    return {"status": "ok", "db": ok == 1}
