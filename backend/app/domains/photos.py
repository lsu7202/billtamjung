"""매물 사진 업로드(사적·팀 공유). specs S02 §3.2. 저장=core.storage(GCS/로컬 자동)."""
import mimetypes
import os
import uuid
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import Response
from ..core import storage
from ..core.db import pool
from ..core.deps import current_user, CurrentUser

router = APIRouter(prefix="/buildings/{building_pk}/photos", tags=["photos"])


@router.get("")
async def list_photos(building_pk: str, user: CurrentUser = Depends(current_user)):
    rows = await pool().fetch(
        """SELECT id FROM app.photos
           WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL
           ORDER BY created_at""",
        building_pk, user.team_id,
    )
    return [{"id": r["id"], "url": f"/buildings/{building_pk}/photos/{r['id']}"} for r in rows]


@router.post("")
async def upload(building_pk: str, file: UploadFile = File(...), user: CurrentUser = Depends(current_user)):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(422, "이미지 파일만 업로드할 수 있습니다")
    ext = os.path.splitext(file.filename or "")[1][:8] or ".jpg"
    key = f"photos/{uuid.uuid4().hex}{ext}"
    await storage.save(key, await file.read(), file.content_type or "image/jpeg")
    path = key
    pid = await pool().fetchval(
        """INSERT INTO app.photos(building_pk,team_id,file_path,uploaded_by)
           VALUES($1,$2,$3,$4) RETURNING id""",
        building_pk, user.team_id, path, user.account_id,
    )
    return {"id": pid, "url": f"/buildings/{building_pk}/photos/{pid}"}


@router.get("/{photo_id}")
async def get_photo(building_pk: str, photo_id: int, user: CurrentUser = Depends(current_user)):
    path = await pool().fetchval(
        "SELECT file_path FROM app.photos WHERE id=$1 AND team_id=$2 AND deleted_at IS NULL",
        photo_id, user.team_id,
    )
    data = await storage.load(path) if path else None
    if data is None:
        raise HTTPException(404, "사진을 찾을 수 없습니다")
    media = mimetypes.guess_type(path)[0] or "image/jpeg"
    return Response(content=data, media_type=media)


@router.delete("/{photo_id}")
async def delete_photo(building_pk: str, photo_id: int, user: CurrentUser = Depends(current_user)):
    await pool().execute(
        "UPDATE app.photos SET deleted_at=now() WHERE id=$1 AND team_id=$2", photo_id, user.team_id
    )
    return {"ok": True}
