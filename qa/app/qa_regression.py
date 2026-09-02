import asyncio, httpx
async def main():
    async with httpx.AsyncClient(base_url="http://localhost:8000", timeout=60) as c:
        r=await c.post("/auth/login", json={"email":"demo9@example.com","password":"testpw12345"})
        H={"Authorization":f"Bearer {r.json()['access_token']}"}
        t=[]
        s=await c.post("/search", headers=H, json={"filters":{"bjd_code":"1111013800"},"page_mine":1,"page_normal":1})
        t.append(("검색(지역)", s.status_code==200 and s.json()["normal"]["total"]>0, s.json()["normal"]["total"]))
        s2=await c.post("/search", headers=H, json={"mine_only":True,"filters":{},"page_mine":1,"page_normal":1})
        t.append(("검색(내매물)", s2.status_code==200, s2.json()["mine"]["total"]))
        p=await c.post("/search/pins", headers=H, json={"filters":{"bjd_code":"1111013800"}})
        t.append(("지도 핀", p.status_code==200 and len(p.json())>0, len(p.json())))
        b=await c.get("/buildings/1002117536", headers=H); t.append(("매물 상세", b.status_code==200, ""))
        n=await c.get("/market/nearby-sales/1002117536", headers=H)
        t.append(("주변 실거래", n.status_code==200 and n.json()["total"]>0, n.json()["total"]))
        fo=await c.get("/buildings/1002117536/floor-outline", headers=H)
        t.append(("층별개요(floor_area)", fo.status_code==200 and "floor_area" in (fo.json()[0] if fo.json() else {}), ""))
        for name, ok, extra in t: print(f"  {'OK  ' if ok else 'FAIL'} {name} {extra}")
asyncio.run(main())
