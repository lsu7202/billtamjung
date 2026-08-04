"""산출물(PPT)·사진 스토리지 — BT_GCS_BUCKET 설정 시 GCS, 미설정 시 로컬(개발).
Cloud Run은 디스크 비영속(tmpfs)·다중 인스턴스라 로컬 저장 불가(00-아키텍처 §5).
키 예: photos/<uuid>.jpg · reports/report_12.pptx. 레거시 절대경로(file_path)는 load()가 로컬 폴백.
"""
import asyncio
import os

_BUCKET = os.environ.get("BT_GCS_BUCKET", "")
_LOCAL_BASE = os.environ.get("BT_STORAGE_DIR", "/tmp/bt-storage")
_client = None


def _bucket():
    global _client
    if _client is None:
        from google.cloud import storage as gcs   # 지연 임포트 — 로컬 개발은 미설치여도 동작
        _client = gcs.Client()
    return _client.bucket(_BUCKET)


def _save_sync(key: str, data: bytes, content_type: str) -> None:
    if _BUCKET:
        _bucket().blob(key).upload_from_string(data, content_type=content_type)
    else:
        path = os.path.join(_LOCAL_BASE, key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)


def _load_sync(key: str) -> bytes | None:
    if _BUCKET and not os.path.isabs(key):
        blob = _bucket().blob(key)
        if not blob.exists():
            return None
        return blob.download_as_bytes()
    path = key if os.path.isabs(key) else os.path.join(_LOCAL_BASE, key)   # 레거시 절대경로 지원
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return f.read()


async def save(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    """저장 후 키 반환(DB file_path에 키를 저장). GCS 클라이언트는 동기라 스레드로 우회."""
    await asyncio.to_thread(_save_sync, key, data, content_type)
    return key


async def load(key: str) -> bytes | None:
    return await asyncio.to_thread(_load_sync, key)
