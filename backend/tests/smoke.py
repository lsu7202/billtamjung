"""standalone 통합 스모크(pytest 불필요). 실행: .venv/bin/python tests/smoke.py"""
import os, asyncio, sys
os.environ.setdefault("BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import httpx
from app.main import app
from app.core import db


async def main():
    await db.connect()
    ok = True
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            h = await c.get("/health")
            print("health:", h.status_code, h.json())

            r = await c.post("/auth/signup", json={
                "email": "new@t.com", "password": "pw123456",
                "name": "김대리", "office_name": "테스트공인중개사"})
            print("signup:", r.status_code)
            assert r.status_code == 200, r.text
            hdr = {"Authorization": f"Bearer {r.json()['access_token']}"}

            cr = await c.get("/credits", headers=hdr)
            print("credits:", cr.json())
            assert cr.json()["total"] == 60

            s = await c.get("/search/suggest", params={"q": "역삼"}, headers=hdr)
            print("suggest:", s.json())

            b = await c.get("/buildings/11718", headers=hdr)
            print("building far:", b.json().get("far"))

            o = await c.put("/overlays", json={
                "target_id": "11718", "field": "far", "value": "400"}, headers=hdr)
            print("overlay put:", o.status_code, o.json())

            b2 = await c.get("/buildings/11718", headers=hdr)
            print("building far after overlay:", b2.json().get("far"))

            # 401 without token
            u = await c.get("/credits")
            print("no-token credits status:", u.status_code)
            assert u.status_code in (401, 403)
        print("\n✅ ALL SMOKE CHECKS PASSED")
    except Exception as e:
        ok = False
        print("❌ FAIL:", repr(e))
    finally:
        await db.disconnect()
    sys.exit(0 if ok else 1)


asyncio.run(main())
