# api·worker 공용 이미지(엔트리만 다름 · 01-상세설계 §1·7)
FROM python:3.12-slim

WORKDIR /srv
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install \
    "fastapi>=0.110" "uvicorn[standard]>=0.29" "asyncpg>=0.29" \
    "pydantic>=2.6" "pydantic-settings>=2.2" "argon2-cffi>=23.1" \
    "pyjwt>=2.8" "python-multipart>=0.0.9" "email-validator>=2.1" \
    "httpx>=0.27" "google-cloud-storage>=2.16" "anthropic>=0.40"

COPY app ./app

# APP_MODULE=app.main(api) | app.worker(worker). PORT는 Cloud Run이 주입.
ENV APP_MODULE=app.main
CMD ["sh", "-c", "uvicorn ${APP_MODULE}:app --host 0.0.0.0 --port ${PORT:-8000}"]
