import asyncio, httpx
PK="1002117536"
async def main():
    async with httpx.AsyncClient(base_url="http://localhost:8000", timeout=60) as c:
        r=await c.post("/auth/login", json={"email":"demo9@example.com","password":"testpw12345"})
        H={"Authorization":f"Bearer {r.json()['access_token']}"}
        for x in (await c.get("/buyers", headers=H)).json(): await c.delete(f"/buyers/{x['id']}", headers=H)
        # 업무탭 값 확인 · 설정
        L=(await c.get(f"/listings/{PK}", headers=H)).json()
        print("현재 업무탭 명도:", L.get("meongdo"))
        await c.patch("/listings/biz", headers=H, json={"building_pk":PK,"fields":{"meongdo":"가능"}})
        L2=(await c.get(f"/listings/{PK}", headers=H)).json()
        print("설정 후 명도:", L2.get("meongdo"))
        a=(await c.post("/buyers", headers=H, json={"name":"명도가능만","grade":"A"})).json()["id"]
        b=(await c.post("/buyers", headers=H, json={"name":"명도불가만","grade":"B"})).json()["id"]
        mk=lambda bid,mg: c.post(f"/buyers/{bid}/conditions", headers=H, json={"name":f"명도 {mg}",
            "conditions":{"values":{},"regions":[{"bjd_code":"1111013800","label":"종로2가"}],"polygon":None,
              "filters":{"bjd_code":"1111013800","meongdos":[mg]}}})
        await mk(a,"가능"); await mk(b,"불가")
        m=(await c.get(f"/buildings/{PK}/matching-buyers", headers=H)).json()
        for x in m: print(f"  {x['name']}: matched={x['matched']}")
        ok=[x for x in m if x['name']=='명도가능만'][0]['matched'] and not [x for x in m if x['name']=='명도불가만'][0]['matched']
        print("업무탭 값이 매칭에 반영:", "OK" if ok else "FAIL")
        for i in (a,b): await c.delete(f"/buyers/{i}", headers=H)
asyncio.run(main())
