"""워커 엔트리(Cloud Run: worker, 비공개). Cloud Tasks OIDC만 수신. 01-상세설계 §1·3.2.

같은 코드베이스, 다른 엔트리. 보고서 비동기 생성 잡을 처리한다(스텁).
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from .core import db
from .jobs import generate_report


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()


app = FastAPI(title="빌탐정 Worker", lifespan=lifespan)
app.include_router(generate_report.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
