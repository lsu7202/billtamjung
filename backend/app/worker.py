"""워커 엔트리(Cloud Run: worker, 비공개). Cloud Tasks OIDC만 수신. 01-상세설계 §1·3.2.

같은 코드베이스, 다른 엔트리. 보고서 생성 잡은 없앴다(2026-10-07, 분석보고서 폐지) — 지금은 헬스만 있다.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from .core import db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()


app = FastAPI(title="빌탐정 Worker", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}
