"""빌탐정 API 엔트리(Cloud Run: api). 01-상세설계 §1."""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .core import db, ratelimit
from .core.config import settings
from .domains import auth, social, search, buildings, overlays, credits, listings, floor_rents, market, reports, extras, photos, series, team, survey, buyers, stops, places, news, tenants, assistant


# **AI 한 바퀴를 터미널로 본다**(2026-09-09 대표). uvicorn 은 제 로거만 켜므로
# 우리 것을 따로 켠다. `docker logs -f docker-api-1` 로 흐른다 —
# 물음(■) · 도구마다 보낸 것과 받은 것 · 답(✔) 이 차례로 찍힌다.
logging.getLogger("app.ai").setLevel(logging.INFO)
if not logging.getLogger("app.ai").handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(message)s"))
    logging.getLogger("app.ai").addHandler(_h)
    logging.getLogger("app.ai").propagate = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    from .domains.search import check_permit   # 업체 표가 있는 판인지 한 번 본다
    await check_permit()
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
for m in (auth, social, search, buildings, overlays, credits, listings, floor_rents, market, reports, extras, photos, series, team, survey, buyers, stops, places, news, tenants, assistant):
    app.include_router(m.router)
    app.include_router(m.router, prefix="/api")


@app.get("/health")
@app.get("/api/health")
async def health():
    ok = await db.pool().fetchval("SELECT 1")
    return {"status": "ok", "db": ok == 1}
