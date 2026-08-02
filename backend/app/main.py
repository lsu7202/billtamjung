"""빌탐정 API 엔트리(Cloud Run: api). 01-상세설계 §1."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .core import db
from .core.config import settings
from .domains import auth, social, search, buildings, overlays, credits, listings, floor_rents, market, reports, extras, photos, series, team


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()


app = FastAPI(title="빌탐정 API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for m in (auth, social, search, buildings, overlays, credits, listings, floor_rents, market, reports, extras, photos, series, team):
    app.include_router(m.router)


@app.get("/health")
async def health():
    ok = await db.pool().fetchval("SELECT 1")
    return {"status": "ok", "db": ok == 1}
