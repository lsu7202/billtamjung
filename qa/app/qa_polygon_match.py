import asyncio, httpx
PK="1002117536"   # 126.98701, 37.56995
def box(cx, cy, d=0.002):
    return {"type":"Polygon","coordinates":[[[cx-d,cy-d],[cx+d,cy-d],[cx+d,cy+d],[cx-d,cy+d],[cx-d,cy-d]]]}
INSIDE  = box(126.98701, 37.56995)      # 이 매물을 감싸는 영역
OUTSIDE = box(127.05000, 37.50000)      # 강남 쪽 — 이 매물 없음
async def main():
    async with httpx.AsyncClient(base_url="http://localhost:8000", timeout=60) as c:
        r=await c.post("/auth/login", json={"email":"demo9@example.com","password":"testpw12345"})
        H={"Authorization":f"Bearer {r.json()['access_token']}"}
        for x in (await c.get("/buyers", headers=H)).json(): await c.delete(f"/buyers/{x['id']}", headers=H)
        a=(await c.post("/buyers", headers=H, json={"name":"영역안","grade":"A"})).json()["id"]
        b=(await c.post("/buyers", headers=H, json={"name":"영역밖","grade":"B"})).json()["id"]
        await c.post(f"/buyers/{a}/conditions", headers=H, json={"name":"그린영역(포함)",
            "conditions":{"values":{},"regions":[],"polygon":INSIDE,"filters":{}}})
        await c.post(f"/buyers/{b}/conditions", headers=H, json={"name":"그린영역(제외)",
            "conditions":{"values":{},"regions":[],"polygon":OUTSIDE,"filters":{}}})
        m=(await c.get(f"/buildings/{PK}/matching-buyers", headers=H)).json()
        for x in m: print(f"  {x['name']}: matched={x['matched']} [{x['matched_condition']}]")
        ok = [x for x in m if x["name"]=="영역안"][0]["matched"] and not [x for x in m if x["name"]=="영역밖"][0]["matched"]
        print("폴리곤 매칭:", "OK" if ok else "FAIL")
        for i in (a,b): await c.delete(f"/buyers/{i}", headers=H)
asyncio.run(main())
