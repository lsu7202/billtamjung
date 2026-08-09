"""S04 전체 QA — API 레벨 계약 검증. 화면 QA는 브라우저로 별도.

사용: 로컬 API를 띄운 뒤  backend/.venv/bin/python tests/qa_s04.py
시작할 때 팀의 매수자를 전부 지운다(테스트 계정 전용).
"""
import asyncio, httpx
PK="1002117536"   # 종로2가 71-6 · 140억 · 수익률 2.52% · 대지 32.6평
OK=[]; NG=[]
def chk(name, cond, detail=""):
    (OK if cond else NG).append(f"{name}{' — '+detail if detail else ''}")

async def main():
    async with httpx.AsyncClient(base_url="http://localhost:8000", timeout=60) as c:
        r=await c.post("/auth/login", json={"email":"demo9@example.com","password":"testpw12345"})
        H={"Authorization":f"Bearer {r.json()['access_token']}"}
        # 남은 데이터를 먼저 치운다 — 안 그러면 이전 실행/화면 테스트가 남긴 매수자 때문에
        # "전원 노출"·"걸린 사람 먼저" 같은 단정이 엉뚱하게 깨진다.
        for x in (await c.get("/buyers", headers=H)).json():
            await c.delete(f"/buyers/{x['id']}", headers=H)

        # 1) 매수자 생성 · 칩 값
        a=(await c.post("/buyers", headers=H, json={"name":"김투자","grade":"A","source":"소개","is_corp":True,"memo":"식당 임차X"})).json()["id"]
        b=(await c.post("/buyers", headers=H, json={"name":"박수익","grade":"B","source":"광고"})).json()["id"]
        lst=(await c.get("/buyers", headers=H)).json()
        chk("매수자 생성", len(lst)==2)
        chk("등급 enum 값 저장", {x["name"]:x["grade"] for x in lst}=={"김투자":"A","박수익":"B"})
        chk("조건 배열로 반환", all(isinstance(x["conditions"],list) for x in lst))

        # 2) 조건 세트 여러 개
        c1=(await c.post(f"/buyers/{a}/conditions", headers=H, json={"name":"종로 100~200억",
          "conditions":{"values":{},"regions":[{"bjd_code":"1111013800","label":"종로2가"}],"polygon":None,
            "filters":{"bjd_code":"1111013800","price_min":10000000000,"price_max":20000000000}}})).json()["id"]
        await c.post(f"/buyers/{a}/conditions", headers=H, json={"name":"강남",
          "conditions":{"values":{},"regions":[{"bjd_code":"1168010100","label":"역삼동"}],"polygon":None,"filters":{"bjd_code":"1168010100"}}})
        await c.post(f"/buyers/{b}/conditions", headers=H, json={"name":"수익 3%↑",
          "conditions":{"values":{},"regions":[{"bjd_code":"1111013800","label":"종로2가"}],"polygon":None,
            "filters":{"bjd_code":"1111013800","roi_min":3.0}}})
        lst=(await c.get("/buyers", headers=H)).json()
        kim=[x for x in lst if x["name"]=="김투자"][0]
        chk("조건 세트 2개", len(kim["conditions"])==2, str([x["name"] for x in kim["conditions"]]))

        # 3) 조건 수정(검색 화면 되저장 경로)
        await c.patch(f"/conditions/{c1}", headers=H, json={"name":"종로 100~200억 (수정)",
          "conditions":{"values":{},"regions":[{"bjd_code":"1111013800","label":"종로2가"}],"polygon":None,
            "filters":{"bjd_code":"1111013800","price_min":10000000000,"price_max":20000000000}}})
        kim=[x for x in (await c.get("/buyers", headers=H)).json() if x["name"]=="김투자"][0]
        chk("조건 이름 수정", any(x["name"].endswith("(수정)") for x in kim["conditions"]))

        # 4) 추천 — 항목별 근거 · 조건 밖 포함 · 정렬
        m=(await c.get(f"/buildings/{PK}/matching-buyers", headers=H)).json()
        names=[x["name"] for x in m]
        chk("전원 노출(조건 밖 포함)", set(names)=={"김투자","박수익"}, str(names))
        chk("걸린 사람 먼저", m[0]["name"]=="김투자" and m[0]["matched"])
        chk("조건 밖 표시", not [x for x in m if x["name"]=="박수익"][0]["matched"])
        kc=[x for x in m if x["name"]=="김투자"][0]["checks"]
        chk("항목별 충족 O", any(k["label"]=="매매가" and k["ok"] for k in kc), str(kc))
        pc=[x for x in m if x["name"]=="박수익"][0]["checks"]
        chk("항목별 미충족 X", any(k["label"]=="수익률" and not k["ok"] for k in pc), str(pc))

        # 5) null 범벅 조건이 전부에 걸리지 않는다
        z=(await c.post("/buyers", headers=H, json={"name":"빈조건"})).json()["id"]
        await c.post(f"/buyers/{z}/conditions", headers=H, json={"name":"빈",
          "conditions":{"values":{},"regions":[],"polygon":None,"filters":{"bjd_code":None,"price_min":None}}})
        m=(await c.get(f"/buildings/{PK}/matching-buyers", headers=H)).json()
        chk("null 조건은 매칭 안 됨", not [x for x in m if x["name"]=="빈조건"][0]["matched"])

        # 6) 제안 — 중복 방지 · 재제안 카운트
        p1=(await c.post("/proposals", headers=H, json={"buyer_id":a,"building_pk":PK})).json()["id"]
        p2=(await c.post("/proposals", headers=H, json={"buyer_id":a,"building_pk":PK,"status":"제안"})).json()["id"]
        chk("중복 제안 차단(같은 id)", p1==p2)
        rows=(await c.get("/proposals", headers=H, params={"buyer_id":a})).json()
        chk("매물값 자동 조인", rows[0]["addr"] is not None and rows[0]["price"] is not None,
            f"{rows[0]['addr']} {rows[0]['price']}")
        chk("재제안 카운트", rows[0]["propose_count"]==1)

        # 7) 거절 — 사유 필수 · 저장
        bad=await c.patch(f"/proposals/{p1}", headers=H, json={"status":"거절"})
        chk("사유 없는 거절 차단", bad.status_code==422)
        badcode=await c.patch(f"/proposals/{p1}", headers=H, json={"status":"거절","reject_reason":"없는코드"})
        chk("잘못된 사유코드 차단", badcode.status_code==422)
        okr=await c.patch(f"/proposals/{p1}", headers=H, json={"status":"거절","reject_reason":"price","reject_price":11000000000})
        chk("거절+사유 저장", okr.status_code==200)
        m=(await c.get(f"/buildings/{PK}/matching-buyers", headers=H)).json()
        chk("거절 패턴 노출", any(x["rejects"] for x in m), str([(x["name"],x["rejects"]) for x in m]))
        chk("제안 상태 표시", [x for x in m if x["name"]=="김투자"][0]["proposal_status"]=="거절")

        # 8) 접촉 이력 — 지난 날짜도 적을 수 있어야 한다(오늘 고정이면 어제 통화를 못 적는다)
        await c.post("/contacts", headers=H, json={"target_type":"buyer","target_id":str(a),"kind":"전화","note":"1차"})
        past=await c.post("/contacts", headers=H,
                          json={"target_type":"buyer","target_id":str(a),"kind":"방문",
                                "occurred_on":"2026-08-01","note":"지난주"})
        chk("접촉 이력 · 지난 날짜 기록", past.status_code==201, f"status={past.status_code} {past.text[:80]}")
        ct=(await c.get("/contacts", headers=H, params={"target_type":"buyer","target_id":str(a)})).json()
        chk("접촉 이력", len(ct)==2)
        chk("지난 날짜 그대로 저장", any(str(x["occurred_on"]).startswith("2026-08-01") for x in ct),
            str([x["occurred_on"] for x in ct]))
        badd=await c.post("/contacts", headers=H,
                          json={"target_type":"buyer","target_id":str(a),"occurred_on":"2026"})
        chk("잘못된 날짜 차단", badd.status_code==422, f"status={badd.status_code}")
        badt=await c.post("/contacts", headers=H, json={"target_type":"xxx","target_id":"1"})
        chk("target_type 검증", badt.status_code==422)

        # 9) 소프트 삭제 — 목록·조건·보드에서 함께 사라진다
        await c.post("/proposals", headers=H, json={"buyer_id":z,"building_pk":PK,"status":"제안"})
        await c.delete(f"/buyers/{z}", headers=H)
        left=(await c.get("/buyers", headers=H)).json()
        chk("삭제 후 목록에서 빠짐", all(x["name"]!="빈조건" for x in left))
        # 사람은 사라졌는데 그 사람 카드만 보드에 남으면 눌러도 갈 곳이 없다
        board=(await c.get("/proposals", headers=H)).json()
        chk("삭제 후 보드에 유령 카드 없음", all(x["buyer_id"]!=z for x in board),
            str([x["buyer_name"] for x in board]))

        for i in (a,b): await c.delete(f"/buyers/{i}", headers=H)

    print(f"\n통과 {len(OK)} / 실패 {len(NG)}")
    for x in OK: print("  OK   " + x)
    for x in NG: print("  FAIL " + x)
asyncio.run(main())
