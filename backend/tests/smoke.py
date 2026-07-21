"""베타 전 흐름 통합 스모크(standalone). 실행: .venv/bin/python tests/smoke.py

가입→검색→선점→층별임대→주변시세→오버레이→위키→메모→광고가→즐겨찾기
→저장검색→보고서 생성(가치점수+pptx)→크레딧 차감→내 산출물(stale)
"""
import os, asyncio, sys, time
os.environ.setdefault("BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import httpx
from app.main import app
from app.core import db

PASS, FAIL = [], []


def check(name: str, cond: bool, detail: str = ""):
    (PASS if cond else FAIL).append(name)
    print(("  ✓" if cond else "  ✗ FAIL"), name, detail)


async def main():
    await db.connect()
    try:
        t = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=t, base_url="http://t", timeout=30) as c:
            r = await c.get("/health")
            check("health", r.status_code == 200 and r.json()["db"])

            # ── 가입 → 토큰 ──
            r = await c.post("/auth/signup", json={
                "email": "beta@t.com", "password": "pw123456", "name": "이승욱",
                "office_name": "빌탐정공인중개사"})
            check("signup", r.status_code == 200, r.text[:80])
            h = {"Authorization": f"Bearer {r.json()['access_token']}"}
            me_id = None

            r = await c.get("/credits", headers=h)
            check("trial credits 60", r.json()["total"] == 60)

            # ── 검색 ──
            r = await c.get("/search/suggest", params={"q": "역삼동 735"}, headers=h)
            check("suggest prefix", any("735-29" in s["addr"] for s in r.json()))
            poly = {"type": "Polygon", "coordinates": [[
                [127.030, 37.495], [127.042, 37.495], [127.042, 37.505],
                [127.030, 37.505], [127.030, 37.495]]]}
            r = await c.post("/search", json={"polygon": poly}, headers=h)
            check("polygon search hits", len(r.json()) >= 2, f"{len(r.json())} hits")

            # ── 매물 선점 ──
            r = await c.get("/listings/11718", headers=h)
            check("listing empty", r.json()["registered"] is False)
            # 자기 자신 지정: account_id 알아내기(팀멤버 1명 = 본인)
            me_id_row = await db.pool().fetchrow("SELECT id FROM app.accounts WHERE email='beta@t.com'")
            me_id = me_id_row["id"]
            r = await c.put("/listings/claim", json={"building_pk": "11718", "assignee_account_id": me_id}, headers=h)
            check("claim", r.status_code == 200 and r.json()["registered"])
            r = await c.patch("/listings/biz", json={
                "building_pk": "11718",
                "fields": {"status": "ongoing", "owner_name": "홍길동", "owner_phone": "010-1234-5678"}}, headers=h)
            check("biz patch", r.status_code == 200)
            r = await c.get("/listings/11718", headers=h)
            check("phone unmasked for assignee", r.json()["owner_phone"] == "010-1234-5678")
            r = await c.get("/listings", headers=h)
            check("my listings 1", len(r.json()) == 1)

            # ── 층별임대 ──
            for fl, unit, dep, rent in [("1F", "101", 300_000_000, 4_500_000),
                                        ("2F", "201", 150_000_000, 2_800_000)]:
                r = await c.put(f"/buildings/11718/floor-rents", json={
                    "floor": fl, "unit_no": unit, "contract_area": 37,
                    "deposit": dep, "rent": rent, "maintenance": 900_000}, headers=h)
            r = await c.get("/buildings/11718/floor-rents", headers=h)
            check("floor rents total", r.json()["total"]["rent"] == 7_300_000)

            # ── 주변시세(반경 comps) ──
            r = await c.post("/market/nearby", json={
                "center_lat": 37.5006, "center_lng": 127.0362, "radius_m": 500}, headers=h)
            check("market comps", r.json()["count"] >= 2, f"{r.json()['count']} comps")
            check("floor avg", len(r.json()["floor_avg"]) >= 1)

            # ── 오버레이 ──
            r = await c.put("/overlays", json={"target_id": "11718", "field": "far", "value": "350"}, headers=h)
            check("overlay put", r.status_code == 200)
            r = await c.get("/buildings/11718", headers=h)
            check("merged far", r.json().get("far") == "350")

            # ── 위키·메모·광고가 ──
            r = await c.post("/buildings/11718/wiki", json={"category": "명도", "body": "1층 명도 협의 중"}, headers=h)
            wiki_id = r.json()["id"]
            await c.put(f"/wiki/{wiki_id}/vote", headers=h)
            r = await c.get("/buildings/11718/wiki", headers=h)
            check("wiki + vote", r.json()[0]["votes"] == 1)
            await c.put("/buildings/11718/memos", json={"kind": "secret", "body": "소유자 급매 의사"}, headers=h)
            r = await c.get("/buildings/11718/memos", headers=h)
            check("secret memo visible to assignee", any(m["kind"] == "secret" for m in r.json()))
            await c.post("/buildings/11718/ad-prices", json={"observed_on": "2026-07-01", "price": 11_000_000_000, "is_mine": True}, headers=h)
            r = await c.get("/buildings/11718/ad-prices", headers=h)
            check("ad price", r.json()[0]["price"] == 11_000_000_000)

            # ── 즐겨찾기·저장검색 ──
            r = await c.put("/favorites/11718", headers=h)
            check("favorite on", r.json()["favorited"])
            r = await c.post("/saved-searches", json={"name": "역삼 상업지", "conditions": {"polygon": poly}}, headers=h)
            check("saved search", r.status_code == 200)

            # ── 보고서 생성(가치점수+pptx+차감) ──
            r = await c.post("/reports", json={"building_pk": "11718", "kind": "analysis"}, headers=h)
            check("report 202", r.status_code == 202)
            rid = r.json()["report_id"]
            for _ in range(20):  # BackgroundTasks 완료 폴링
                r = await c.get(f"/reports/{rid}", headers=h)
                if r.json()["status"] in ("done", "failed"):
                    break
                await asyncio.sleep(0.3)
            rep = r.json()
            check("report done", rep["status"] == "done", rep.get("failed_reason", ""))
            check("pptx exists", rep.get("file_path") and os.path.exists(rep["file_path"]))
            r = await c.get("/credits", headers=h)
            check("credits 60-30=30", r.json()["total"] == 30, f"got {r.json()['total']}")
            r = await c.get("/reports", headers=h)
            check("my reports fresh", r.json()[0]["is_stale"] is False)

            # 오버레이 수정 → stale 전환
            await c.put("/overlays", json={"target_id": "11718", "field": "far", "value": "360"}, headers=h)
            r = await c.get("/reports", headers=h)
            check("stale after edit", r.json()[0]["is_stale"] is True)

            # 브리핑도
            r = await c.post("/reports", json={"building_pk": "11718", "kind": "briefing"}, headers=h)
            rid2 = r.json()["report_id"]
            for _ in range(20):
                rr = await c.get(f"/reports/{rid2}", headers=h)
                if rr.json()["status"] in ("done", "failed"):
                    break
                await asyncio.sleep(0.3)
            check("briefing done", rr.json()["status"] == "done")
            r = await c.get("/credits", headers=h)
            check("credits 30-10=20", r.json()["total"] == 20)

            # 인증 가드
            r = await c.get("/credits")
            check("401 guard", r.status_code in (401, 403))

    finally:
        await db.disconnect()

    print(f"\n{'✅' if not FAIL else '❌'} PASS {len(PASS)} / FAIL {len(FAIL)}")
    if FAIL:
        print("failed:", FAIL)
    sys.exit(1 if FAIL else 0)


asyncio.run(main())
