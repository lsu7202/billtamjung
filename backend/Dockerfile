# api·worker 공용 이미지(엔트리만 다름 · 01-상세설계 §1·7)
FROM python:3.12-slim

WORKDIR /srv
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# 의존은 pyproject.toml **한 곳**에서 읽는다(2026-09-21). 전엔 여기 손으로 다시 적어
# 둘이 어긋났고, pyproject 에만 있던 google-genai 가 이미지에서 빠져 컨테이너를 다시
# 만들면 AI 층이 안 떴다. app 을 복사하기 전에 깔아야 코드만 바뀔 땐 이 층이 캐시된다.
COPY pyproject.toml ./
RUN pip install --upgrade pip \
 && python -c "import tomllib; print('\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" > /tmp/req.txt \
 && pip install -r /tmp/req.txt && rm /tmp/req.txt

COPY app ./app

# APP_MODULE=app.main(api) | app.worker(worker). PORT는 Cloud Run이 주입.
ENV APP_MODULE=app.main
CMD ["sh", "-c", "uvicorn ${APP_MODULE}:app --host 0.0.0.0 --port ${PORT:-8000}"]
