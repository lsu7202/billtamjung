"""오늘 탭 구조 QA — 기능이 아니라 **구멍**을 찾는다.

각 케이스 = "현장에서 실제로 일어나는 상황"을 픽스처로 만들고,
그 건이 오늘 화면 어디에 떠야 하는지/떠서는 안 되는지를 묻는다.
데모 팀에서만 돈다. 끝나면 픽스처를 지운다.
"""
import asyncio
import os
import sys

import asyncpg
import httpx

BASE = os.environ.get("BT_API", "http://localhost:8000")
DSN = os.environ.get("BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
PK = "1002110700"
PK2 = "1002111949"
PK3 = "1002115103"

ok = fail = 0


def chk(name, cond, got=""):
    global ok, fail
    if cond:
        ok += 1; print(f"  ✓ {name}")
    else:
        fail += 1; print(f"  ✗ {name}  {got}")


async def main():
    db = await asyncpg.connect(DSN)
    async with httpx.AsyncClient(base_url=BASE, timeout=60) as c:
        r = await c.post("/auth/login", json={"email": "demo9@example.com", "password": "testpw12345"})
        H = {"Authorization": f"Bearer {r.json()['access_token']}"}
        me = (await c.get("/auth/me", headers=H)).json()
        team = me["account_id"] and me["team_id"]

        async def today():
            return (await c.get("/sales/today", headers=H)).json()

        async def clean():
            for x in (await c.get("/buyers", headers=H)).json():
                await c.delete(f"/buyers/{x['id']}", headers=H)
            await db.execute("DELETE FROM app.proposals WHERE team_id=$1", team)
            await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND building_pk = ANY($2::text[])",
                             team, [PK, PK2, PK3])
            await db.execute("DELETE FROM app.contacts WHERE team_id=$1", team)
        await clean()

        print("\n[T1] 방금 등록한 매수자가 '식은 매수자'로 뜨면 안 된다")
        A = (await c.post("/buyers", headers=H, json={"name": "T신규"})).json()["id"]
        t = await today()
        chk("신규 매수자는 내 차례에 없음",
            not any(x.get("buyer_id") == A and x["kind"] == "식은매수자" for x in t["my_turn"]),
            [x for x in t["my_turn"] if x.get("buyer_id") == A])

        print("\n[T2] 리드로 담기만 하고 접촉 전인 건 = 첫 전화가 내 차례여야 한다")
        await c.patch("/listings/biz", headers=H, json={"building_pk": PK2, "fields": {"status": "리드"}})
        t = await today()
        chk("접촉 전 리드가 내 차례에 있음",
            any(x.get("building_pk") == PK2 and x["side"] == "매도" for x in t["my_turn"]),
            "안 뜸 — 담기만 하고 잊으면 영영 사라진다")

        print("\n[T3] 업무탭 어휘(가격제시)로 협의 중인 건 — 오래 방치되면 재통화로 떠야 한다")
        await c.patch("/listings/biz", headers=H, json={"building_pk": PK3, "fields": {"status": "가격제시"}})
        await c.post("/contacts", headers=H, json={"target_type": "listing", "target_id": PK3, "kind": "전화"})
        await db.execute(
            "UPDATE app.contacts SET occurred_on = current_date - 10 WHERE team_id=$1 AND target_id=$2", team, PK3)
        t = await today()
        chk("가격제시 + 10일 무접촉 = 재통화",
            any(x.get("building_pk") == PK3 and x["kind"] == "재통화" for x in t["my_turn"]),
            "업무탭이 실제로 쓰는 상태값(jindo)을 오늘이 못 읽는다")

        print("\n[T4] 끝난 건(매각·철회)은 어디에도 뜨면 안 된다")
        await c.patch("/listings/biz", headers=H, json={"building_pk": PK3, "fields": {"status": "매각", "intent": "원함"}})
        t = await today()
        chk("매각된 매물은 재통화에 없음",
            not any(x.get("building_pk") == PK3 for x in t["my_turn"]),
            "팔린 매물에 전화하라고 시킨다")

        print("\n[T5] '관심'도 기다림이 길어지면 승격해야 한다")
        p1 = (await c.post("/proposals", headers=H, json={"buyer_id": A, "building_pk": PK, "status": "관심"})).json()["id"]
        await db.execute("ALTER TABLE app.proposals DISABLE TRIGGER USER")
        await db.execute("UPDATE app.proposals SET proposed_on = current_date - 20 WHERE id=$1", p1)
        await db.execute("ALTER TABLE app.proposals ENABLE TRIGGER USER")
        t = await today()
        chk("관심 20일 방치 = 내 차례",
            any(x.get("id") == p1 for x in t["my_turn"]),
            "관심 상태는 영원히 '기다리는 중'에 머문다")

        print("\n[T6] '후보'로 담아만 두고 잊은 건 — 어딘가에는 떠야 한다")
        p2 = (await c.post("/proposals", headers=H, json={"buyer_id": A, "building_pk": PK2, "status": "후보"})).json()["id"]
        await db.execute("ALTER TABLE app.proposals DISABLE TRIGGER USER")
        await db.execute("UPDATE app.proposals SET updated_at = now() - interval '14 days' WHERE id=$1", p2)
        await db.execute("ALTER TABLE app.proposals ENABLE TRIGGER USER")
        t = await today()
        allitems = t["my_turn"] + t["waiting"] + t["starters"]
        chk("후보 14일 방치가 어딘가에 보임",
            any(x.get("id") == p2 for x in allitems),
            "골라놓고 안 돌린 것이 조용히 사라진다")

        print("\n[T7] 같은 건물이 내 차례에 두 번 뜨면 안 된다(중복)")
        # 리드(PK2, T2에서 접촉 전) + 후보 제안(PK2) 등 — 항목 자체는 다르면 되지만 같은 kind 중복은 금지
        keys = [(x["kind"], x.get("building_pk"), x.get("buyer_id")) for x in t["my_turn"]]
        chk("kind+대상 중복 없음", len(keys) == len(set(keys)), keys)

        print("\n[정리]")
        await clean()
        print("  ✓ 픽스처 제거")

    await db.close()
    print(f"\n{'='*40}\n구조 통과 {ok} · 구멍 {fail}")


asyncio.run(main())
