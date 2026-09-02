"""S04 2차 QA — 배치 점수 · 오늘 · 거절 집계 · 카드 판단재료.

앞선 qa_s04는 CRUD·권한을 봤다. 여기서는 **화면이 실제로 뭘 받는가**를 본다:
값이 붙었는지(200만 보면 놓친다), 기간 경계가 맞는지, 남의 것이 안 새는지.
"""
import asyncio
import datetime as dt
import os
import sys

import asyncpg
import httpx

BASE = os.environ.get("BT_API", "http://localhost:8000")
DSN = os.environ.get("BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
PK = "1002110700"          # 종로 · 배치 점수가 붙어 있는 건물
PK2 = "1002111949"

ok = fail = 0


def chk(name, cond, got=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  ✓ {name}")
    else:
        fail += 1
        print(f"  ✗ {name}  {got}")


async def main():
    db = await asyncpg.connect(DSN)
    async with httpx.AsyncClient(base_url=BASE, timeout=60) as c:
        r = await c.post("/auth/login", json={"email": "demo9@example.com", "password": "testpw12345"})
        H = {"Authorization": f"Bearer {r.json()['access_token']}"}
        me = (await c.get("/auth/me", headers=H)).json()
        team = me["team_id"]

        print("\n[1] 배치 점수 — master.building_score")
        n = await db.fetchval("SELECT count(*) FROM master.building_score")
        chk("전 건물 적재", n >= 560_000, f"{n}")
        gaps = await db.fetchrow(
            """SELECT count(*) FILTER (WHERE score IS NULL) s,
                      count(*) FILTER (WHERE use_type IS NULL) u,
                      count(*) FILTER (WHERE sell_score IS NULL) p FROM master.building_score""")
        chk("결측 없음", gaps["s"] == 0 and gaps["u"] == 0 and gaps["p"] == 0, dict(gaps))
        rng = await db.fetchrow("SELECT min(score) a, max(score) b, min(sell_score) c, max(sell_score) d FROM master.building_score")
        chk("점수 범위 0~100", 0 <= rng["a"] and rng["b"] <= 100 and 0 <= rng["c"] and rng["d"] <= 100, dict(rng))
        chk("등급은 S/A/B/C만", not await db.fetchval(
            "SELECT count(*) FROM master.building_score WHERE grade NOT IN ('S','A','B','C')"))
        # 거래 이력 없는 건물에 '보유 20년'을 만들어내지 않는다 — 모르는 것을 신호로 쓰면 안 된다.
        bad = await db.fetchval(
            """SELECT count(*) FROM master.building_score
                WHERE (sell_axes->'hold'->>'pt')::numeric > 0
                  AND building_pk NOT IN (SELECT building_pk FROM master.sales_history)""")
        chk("거래 이력 없으면 보유 점수 0", bad == 0, bad)

        print("\n[2] 상세 API에 배치값이 붙는가")
        b = (await c.get(f"/buildings/{PK}", headers=H)).json()
        chk("score", isinstance(b.get("score"), (int, float)), b.get("score"))
        chk("grade", b.get("grade") in ("S", "A", "B", "C"), b.get("grade"))
        chk("use_type", b.get("use_type") in ("신축용", "리모델링용", "수익형"), b.get("use_type"))
        chk("sell_score", isinstance(b.get("sell_score"), (int, float)), b.get("sell_score"))

        print("\n[3] 준비 — 매수자·제안 시드")
        for x in (await c.get("/buyers", headers=H)).json():
            await c.delete(f"/buyers/{x['id']}", headers=H)
        A = (await c.post("/buyers", headers=H, json={"name": "오늘테스트A", "grade": "A", "phone": "01048861767"})).json()["id"]
        B = (await c.post("/buyers", headers=H, json={"name": "오늘테스트B", "grade": "B"})).json()["id"]
        p1 = (await c.post("/proposals", headers=H, json={"buyer_id": A, "building_pk": PK, "status": "제안"})).json()["id"]
        (await c.post("/proposals", headers=H, json={"buyer_id": B, "building_pk": PK, "status": "후보"}))
        # 매매가를 적정가보다 20% 높게 넣어 vs_est가 계산되는지 본다
        est = await db.fetchval("SELECT sale_est FROM master.building_sale_est WHERE building_pk=$1", PK)
        chk("적정가 존재", est is not None, est)
        await c.put("/overlays", headers=H, json={"target_type": "building", "target_id": PK,
                                                  "field": "sale_price", "value": str(int(est * 1.2))})

        print("\n[4] 제안 카드 판단재료")
        rows = (await c.get("/proposals", headers=H)).json()
        card = next(x for x in rows if x["id"] == p1)
        chk("sale_est 동봉", card.get("sale_est") is not None, card.get("sale_est"))
        chk("vs_est_pct ≈ +20%", card.get("vs_est_pct") is not None and abs(card["vs_est_pct"] - 20) < 1.5, card.get("vs_est_pct"))
        chk("price_is_est=False(수기 입력했으므로)", card.get("price_is_est") is False, card.get("price_is_est"))
        chk("매력도 등급 동봉", card.get("score_grade") in ("S", "A", "B", "C"), card.get("score_grade"))
        chk("활용유형 동봉", card.get("use_type") is not None, card.get("use_type"))

        print("\n[4b] 매수자 → 매물 추천(사람→매물 방향)")
        await c.post(f"/buyers/{A}/conditions", headers=H, json={"name": "종로 소형",
            "conditions": {"filters": {"price_max": 10000000000},
                           "regions": [{"bjd_code": "11110", "name": "종로구"}]}})
        mt = (await c.get(f"/buyers/{A}/matches", headers=H)).json()
        chk("추천이 나옴", len(mt) > 0, len(mt))
        chk("이미 담은 매물은 제외", all(x["building_pk"] != PK for x in mt),
            "제안한 매물을 또 추천")
        chk("판단 재료 동봉(등급·유형·가격)", mt and "grade" in mt[0] and "price" in mt[0])
        # 판단 메모 — 제안에 남긴 근거가 저장되는가
        await c.patch(f"/proposals/{p1}", headers=H, json={"note": "대로변 · 취향 일치"})
        rows2 = (await c.get("/proposals", headers=H, params={"buyer_id": A})).json()
        chk("판단 메모 저장", any(x["id"] == p1 and x["note"] == "대로변 · 취향 일치" for x in rows2))

        print("\n[5] 오늘 — 턴 경계(제안 6일=기다림 · 8일=내 차례)")
        await db.execute("ALTER TABLE app.proposals DISABLE TRIGGER USER")
        await db.execute("UPDATE app.proposals SET proposed_on = current_date - 6 WHERE id=$1", p1)
        await db.execute("ALTER TABLE app.proposals ENABLE TRIGGER USER")
        t = (await c.get("/sales/today", headers=H)).json()
        chk("6일은 기다리는 중", any(x.get("id") == p1 for x in t["waiting"]))
        chk("6일은 내 차례 아님", not any(x.get("id") == p1 for x in t["my_turn"]))
        await db.execute("ALTER TABLE app.proposals DISABLE TRIGGER USER")
        await db.execute("UPDATE app.proposals SET proposed_on = current_date - 8 WHERE id=$1", p1)
        await db.execute("ALTER TABLE app.proposals ENABLE TRIGGER USER")
        t = (await c.get("/sales/today", headers=H)).json()
        mt = next((x for x in t["my_turn"] if x.get("id") == p1), None)
        chk("8일은 내 차례로 승격", mt is not None)
        chk("이유 문장 동봉", bool(mt and "9일" not in mt["why"] and "8일" in mt["why"]), mt and mt["why"])

        print("\n[6] 오늘 — 식은 매수자(내 차례)")
        # 방금 등록한 사람은 식은 게 아니다(T1) — 등록 30일 뒤부터 센다
        t = (await c.get("/sales/today", headers=H)).json()
        chk("신규 등록자는 유예", not any(x.get("buyer_id") == A and x["kind"] == "식은매수자" for x in t["my_turn"]))
        await db.execute("UPDATE app.buyers SET created_at = now() - interval '31 days' WHERE id=$1", A)
        t = (await c.get("/sales/today", headers=H)).json()
        chk("등록 31일 무접촉이면 내 차례", any(x.get("buyer_id") == A and x["kind"] == "식은매수자" for x in t["my_turn"]))
        today = dt.date.today().isoformat()
        await c.post("/contacts", headers=H, json={"target_type": "buyer", "target_id": str(A),
                                                   "kind": "전화", "occurred_on": today})
        t = (await c.get("/sales/today", headers=H)).json()
        chk("오늘 만났으면 빠짐", not any(x.get("buyer_id") == A and x["kind"] == "식은매수자" for x in t["my_turn"]))

        print("\n[7] 매도자 — 어휘 통일(jindo)·재통화·담기")
        await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND building_pk=$2", team, PK2)
        await db.execute("DELETE FROM app.contacts WHERE team_id=$1 AND target_type='listing' AND target_id=$2", team, PK2)
        await c.patch("/listings/biz", headers=H, json={"building_pk": PK2, "fields": {"status": "리드"}})
        sl = (await c.get("/sales/sellers", headers=H)).json()
        me_row = next((x for x in sl if x["building_pk"] == PK2), None)
        chk("담기면 매도자 목록에 뜸", me_row is not None)
        chk("상태 = 리드(jindo 그대로 · 가상 단계 없음)", me_row and me_row["status"] == "리드", me_row and me_row["status"])
        t = (await c.get("/sales/today", headers=H)).json()
        chk("접촉 전 리드 = 첫전화(내 차례)", any(
            x.get("building_pk") == PK2 and x["kind"] == "첫전화" for x in t["my_turn"]))
        await c.post("/contacts", headers=H, json={"target_type": "listing", "target_id": PK2,
                                                   "kind": "전화", "occurred_on": today, "note": "첫 통화"})
        # 업무탭 어휘로 협의 진행 — 영업이 같은 값을 읽는다
        await c.patch("/listings/biz", headers=H, json={"building_pk": PK2, "fields": {"status": "가격제시"}})
        sl = (await c.get("/sales/sellers", headers=H)).json()
        me_row = next(x for x in sl if x["building_pk"] == PK2)
        chk("업무탭 값(가격제시)이 그대로 보임", me_row["status"] == "가격제시", me_row["status"])
        chk("마지막 접촉 동봉", me_row["last_kind"] == "전화" and me_row["last_note"] == "첫 통화")
        await db.execute("UPDATE app.contacts SET occurred_on = current_date - 8 WHERE target_type='listing' AND target_id=$1", PK2)
        t = (await c.get("/sales/today", headers=H)).json()
        chk("가격제시 8일 무접촉 = 재통화", any(
            x.get("building_pk") == PK2 and x["kind"] == "재통화" for x in t["my_turn"]))
        await c.patch("/listings/biz", headers=H, json={"building_pk": PK2, "fields": {"status": "매각"}})
        t = (await c.get("/sales/today", headers=H)).json()
        chk("매각되면 오늘에서 빠짐", not any(x.get("building_pk") == PK2 for x in t["my_turn"]))
        chk("담은 건물은 시작해볼 곳에서 빠짐", not any(x.get("building_pk") == PK2 for x in t["starters"]))

        print("\n[8] 거절 집계")
        rs = (await c.get(f"/buildings/{PK}/reject-summary", headers=H)).json()
        chk("제안 1건 집계", rs["proposed"] == 1, rs)
        await c.patch(f"/proposals/{p1}", headers=H, json={
            "status": "거절", "reject_reason": "price", "reject_price": 100_00000000})
        rs = (await c.get(f"/buildings/{PK}/reject-summary", headers=H)).json()
        chk("거절 1건", rs["rejected"] == 1, rs)
        chk("사유 price", rs["reasons"] and rs["reasons"][0]["reason"] == "price", rs["reasons"])
        chk("상한 중앙값", rs["want_price"] == 100_00000000, rs["want_price"])
        # 매수자 사정 거절은 매물 탓이 아니라 사유 집계에서 빠진다
        p3 = (await c.post("/proposals", headers=H, json={"buyer_id": B, "building_pk": PK, "status": "제안"})).json()["id"]
        await c.patch(f"/proposals/{p3}", headers=H, json={"status": "거절", "reject_reason": "buyer_side"})
        rs = (await c.get(f"/buildings/{PK}/reject-summary", headers=H)).json()
        chk("buyer_side는 사유에서 제외", all(x["reason"] != "buyer_side" for x in rs["reasons"]), rs["reasons"])
        chk("거절 총계에는 포함", rs["rejected"] == 2, rs["rejected"])

        print("\n[9] 팀 경계 — 남의 팀 것이 안 샌다")
        other = await db.fetchval("SELECT id FROM app.teams WHERE id <> $1 LIMIT 1", team)
        if other:
            await db.execute("DELETE FROM app.proposals WHERE team_id=$1 AND building_pk=$2", other, PK)
            bid = await db.fetchval(
                "INSERT INTO app.buyers(team_id,name,status) VALUES($1,'남의팀매수자','활성') RETURNING id", other)
            await db.execute("""INSERT INTO app.proposals(team_id,buyer_id,building_pk,status,proposed_on,reject_reason)
                                VALUES($1,$2,$3,'거절',current_date,'roi')""", other, bid, PK)
            rs = (await c.get(f"/buildings/{PK}/reject-summary", headers=H)).json()
            chk("남의 팀 거절이 안 섞임", all(x["reason"] != "roi" for x in rs["reasons"]), rs["reasons"])
            await db.execute("DELETE FROM app.proposals WHERE team_id=$1", other)
            await db.execute("DELETE FROM app.buyers WHERE id=$1", bid)
        else:
            print("  ⏭ 다른 팀 없음")

        print("\n[10] 정리")
        await c.delete(f"/buyers/{A}", headers=H)
        await c.delete(f"/buyers/{B}", headers=H)
        await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND building_pk=$2", team, PK2)
        await db.execute("DELETE FROM app.contacts WHERE team_id=$1 AND target_type='listing' AND target_id=$2", team, PK2)
        await db.execute("DELETE FROM app.overlays WHERE team_id=$1 AND target_id=$2 AND field='sale_price'", team, PK)
        print("  ✓ 시드 제거")

    await db.close()
    print(f"\n{'='*40}\n통과 {ok} · 실패 {fail}")
    sys.exit(1 if fail else 0)


asyncio.run(main())
