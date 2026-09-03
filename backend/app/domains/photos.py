"""매물 사진 업로드(사적·팀 공유). specs S02 §3.2. 저장=core.storage(GCS/로컬 자동)."""
import json
import mimetypes
import os
import uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from fastapi.responses import Response
from ..core import storage
from ..core.db import pool
from ..core.deps import current_user, CurrentUser

# 브리핑 슬롯이 찾는 서류 종류(0032). 원본 브리핑 7장에서 실제로 쓰인 것들.
KINDS = ("exterior", "interior", "land_use", "building_ledger", "cadastral", "etc")

router = APIRouter(prefix="/buildings/{building_pk}/photos", tags=["photos"])


@router.get("")
async def list_photos(building_pk: str, user: CurrentUser = Depends(current_user)):
    """종류별 정렬(0032). 브리핑이 서류 슬롯을 종류로 찾는다.

    ORDER BY 는 `photos.kind` 로 못박는다. 그냥 `kind` 라고 쓰면 SELECT 의 출력 컬럼
    `kind::text` 가 먼저 잡혀 **글자순**으로 선다 — building_ledger 가 exterior 앞에 오고,
    표지에 건축물대장이 박힌다(실제로 그랬다). 테이블 컬럼을 가리켜야 enum 선언 순서
    (exterior · interior · land_use · building_ledger · cadastral · etc)로 선다.
    """
    rows = await pool().fetch(
        """SELECT id, kind::text, caption, sort_order, transform
           FROM app.photos
           WHERE building_pk=$1 AND team_id=$2 AND deleted_at IS NULL
           ORDER BY photos.kind, sort_order, id""",
        building_pk, user.team_id)
    return [{**dict(r), "url": f"/buildings/{building_pk}/photos/{r['id']}"} for r in rows]


@router.post("")
async def upload(building_pk: str, file: UploadFile = File(...), kind: str = Form("exterior"),
                 caption: str | None = Form(None), user: CurrentUser = Depends(current_user)):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(422, "이미지 파일만 업로드할 수 있습니다")
    if kind not in KINDS:
        raise HTTPException(422, f"알 수 없는 종류: {kind}")
    # 아이폰 기본 포맷 — 서버엔 올라가지만 브라우저가 못 그려서 "올렸는데 안 보인다"가 된다.
    name = (file.filename or "").lower()
    if name.endswith((".heic", ".heif")) or "heic" in (file.content_type or "") or "heif" in (file.content_type or ""):
        raise HTTPException(422, "아이폰 HEIC 형식은 지원하지 않습니다 — JPG·PNG로 바꿔 올려주세요")
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, f"20MB가 넘습니다 ({len(data) / 1048576:.1f}MB)")
    ext = os.path.splitext(file.filename or "")[1][:8] or ".jpg"
    key = f"photos/{uuid.uuid4().hex}{ext}"
    await storage.save(key, data, file.content_type or "image/jpeg")
    path = key
    seq = await pool().fetchval(
        """SELECT COALESCE(max(sort_order), -1) + 1 FROM app.photos
           WHERE building_pk=$1 AND team_id=$2 AND kind=$3::app.photo_kind AND deleted_at IS NULL""",
        building_pk, user.team_id, kind)
    pid = await pool().fetchval(
        """INSERT INTO app.photos(building_pk,team_id,file_path,uploaded_by,kind,caption,sort_order)
           VALUES($1,$2,$3,$4,$5::app.photo_kind,$6,$7) RETURNING id""",
        building_pk, user.team_id, path, user.account_id, kind, (caption or "").strip() or None, seq,
    )
    return {"id": pid, "kind": kind, "sort_order": seq, "url": f"/buildings/{building_pk}/photos/{pid}"}


class PhotoPatch(BaseModel):
    kind: str | None = None
    caption: str | None = None
    sort_order: int | None = None
    transform: dict | None = None      # {zoom,x,y} — 슬롯 배치. 원본은 건드리지 않는다.


@router.patch("/{photo_id}")
async def patch_photo(building_pk: str, photo_id: int, body: PhotoPatch,
                      user: CurrentUser = Depends(current_user)):
    if body.kind is not None and body.kind not in KINDS:
        raise HTTPException(422, f"알 수 없는 종류: {body.kind}")
    sets, args = [], [photo_id, user.team_id]
    for col, val, cast in (("kind", body.kind, "::app.photo_kind"), ("caption", body.caption, ""),
                           ("sort_order", body.sort_order, ""), ("transform", body.transform, "::jsonb")):
        if val is not None:
            args.append(json.dumps(val) if col == "transform" else val)
            sets.append(f"{col}=${len(args)}{cast}")
    if not sets:
        return {"ok": True}
    await pool().execute(
        f"UPDATE app.photos SET {', '.join(sets)} WHERE id=$1 AND team_id=$2 AND deleted_at IS NULL", *args)
    return {"ok": True}


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
