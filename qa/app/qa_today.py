"""오늘 카드 QA — **발동 조건을 하나씩 재현해서** 뜨는지/안 뜨는지 묻는다.

기능이 도는지가 아니라 **경계**를 본다. 카드가 뜨는 조건은 넷이 겹쳐 있고
(살아 있나 · 보류인가 · 사실이 있나 · 며칠 됐나) 하나만 어긋나도 조용히 틀린다.
실제로 그렇게 틀려 있었다: 「제안 10일째 답 없음」이 흥정 내내 떴고(0141),
일정을 만들면 서는 자동 거울 줄이 재통화 시계를 되돌렸다(2026-08-29).

**시험 팀을 스스로 만들고 끝나면 지운다.** 남의 팀 데이터에 섞이면 LIMIT 에 밀려
내 픽스처가 안 보이는 일이 생기고, 그러면 통과·실패가 둘 다 못 믿을 것이 된다.

    backend/.venv/bin/python backend/tests/qa_today.py
"""
import asyncio
import os
import sys
import uuid

import asyncpg
import httpx

BASE = os.environ.get("BT_API", "http://localhost:8000")
DSN = os.environ.get("BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")

# 아무 팀에도 안 담긴 건물 — 픽스처 전용
PKS = ["1002127173", "10021100221826", "100211052", "100211053", "1002127174"]

ok = fail = 0
rows: list[tuple] = []


def chk(case, cond, expect, got=""):
    """case = 무엇을 시험했나 · expect = 이렇게 돼야 한다"""
    global ok, fail
    if cond:
        ok += 1
        print(f"  ✓ {case}")
    else:
        fail += 1
        print(f"  ✗ {case}   {got}")
    rows.append((case, expect, "✓" if cond else f"✗ {got}"))


async def main():
    db = await asyncpg.connect(DSN)
    email = f"qa-today-{uuid.uuid4().hex[:8]}@qa-today.example.com"
    async with httpx.AsyncClient(base_url=BASE, timeout=60) as c:
        r = await c.post("/auth/signup", json={
            "email": email, "password": "qatest12345", "name": "QA오늘",
            "terms_agreed": True, "privacy_agreed": True})
        if r.status_code != 200:
            print(f"✗ 시험 계정을 못 만들었습니다: {r.status_code} {r.text[:120]}")
            print("  (BT_SIGNUPS_OPEN=false 면 잠깐 열어야 합니다)")
            sys.exit(1)
        H = {"Authorization": f"Bearer {r.json()['access_token']}"}
        team = (await c.get("/auth/me", headers=H)).json()["team_id"]
        print(f"시험 팀 {team} · {email}\n")

        async def cards(kind=None, pk=None, bid=None, pid=None):
            """오늘 카드에서 내 픽스처에 걸린 것만. 팀 전체로 본다(담당 필터 배제)."""
            t = (await c.get("/sales/today?mine=false", headers=H)).json()
            out = []
            for lane in ("my_turn", "waiting"):
                for x in t[lane]:
                    if kind and x["kind"] != kind:
                        continue
                    if pk and x.get("building_pk") != pk:
                        continue
                    if bid and x.get("buyer_id") != bid:
                        continue
                    if pid and x.get("id") != pid:
                        continue
                    out.append({**x, "_lane": lane})
            return out

        async def age_proposal(pid, days):
            """짝을 N일 전에 담은 것으로. updated_at 트리거를 잠깐 끈다 —
            안 끄면 created_at 만 고쳐도 updated_at 이 오늘로 튄다."""
            await db.execute("ALTER TABLE app.proposals DISABLE TRIGGER USER")
            await db.execute(
                f"UPDATE app.proposals SET created_at = now() - interval '{days} days' WHERE id=$1", pid)
            await db.execute("ALTER TABLE app.proposals ENABLE TRIGGER USER")

        # ══════════════════ 매도 — 첫전화 · 재통화 ══════════════════
        print("[매도] 첫전화 — 담아두고 접촉이 한 줄도 없을 때")
        PK = PKS[0]
        await c.patch("/listings/biz", headers=H,
                      json={"building_pk": PK, "fields": {"intent": "원함"}})
        chk("담기만 하고 접촉 0건 → 첫전화",
            bool(await cards("첫전화", pk=PK)), "첫전화가 내 차례에")

        print("\n[매도] 재통화 — 사람이 남긴 마지막 접촉이 7일 넘었을 때")
        cid = (await c.post("/contacts", headers=H, json={
            "target_type": "listing", "target_id": PK, "kind": "전화"})).json()["id"]
        chk("오늘 통화하면 아무 카드도 없다",
            not await cards(pk=PK), "카드 없음", [x["kind"] for x in await cards(pk=PK)])
        await db.execute("UPDATE app.contacts SET occurred_on = current_date - 6 WHERE id=$1", cid)
        chk("6일 전 통화 → 아직 아니다(기준 7일)",
            not await cards("재통화", pk=PK), "재통화 없음")
        await db.execute("UPDATE app.contacts SET occurred_on = current_date - 8 WHERE id=$1", cid)
        chk("8일 전 통화 → 재통화",
            bool(await cards("재통화", pk=PK)), "재통화가 내 차례에")

        print("\n[매도] 시계는 **사람이 남긴 줄**만 센다(2026-08-29)")
        auto_id = await db.fetchval(
            """INSERT INTO app.contacts(team_id, target_type, target_id, note, auto)
               VALUES($1,'listing',$2,'QA 자동 거울 줄', true) RETURNING id""", team, PK)
        chk("자동 거울 줄은 시계를 안 되돌린다",
            bool(await cards("재통화", pk=PK)), "재통화 그대로",
            "일정만 만들어도 재통화가 사라진다")
        await db.execute("DELETE FROM app.contacts WHERE id=$1", auto_id)
        memo_id = (await c.post("/contacts", headers=H, json={
            "target_type": "listing", "target_id": PK, "kind": "메모", "note": "QA 메모"})).json()["id"]
        chk("사람이 쓴 메모는 시계를 되돌린다",
            not await cards("재통화", pk=PK), "재통화 사라짐")
        await db.execute("DELETE FROM app.contacts WHERE id=$1", memo_id)

        print("\n[매도] 빠지는 조건")
        await c.post("/stops", headers=H, json={
            "target_type": "listing", "target_id": PK, "stage": "intent", "reason": "안판다"})
        chk("보류 중이면 재촉하지 않는다",
            not await cards(pk=PK), "카드 없음", [x["kind"] for x in await cards(pk=PK)])
        sid = (await c.get("/stops", headers=H)).json()[0]["id"]
        await c.delete(f"/stops/{sid}", headers=H)
        chk("보류를 풀면 다시 뜬다",
            bool(await cards("재통화", pk=PK)), "재통화 복귀")

        # ══════════════════ 매수 — 브리핑하기 · 살건지묻기 ══════════════════
        print("\n[매수] 브리핑하기 — 담아만 두고 안 보여준 지 14일")
        A = (await c.post("/buyers", headers=H, json={"name": "QA매수자", "phone": "010-0000-0001"})).json()["id"]
        PK2 = PKS[1]
        p = (await c.post("/proposals", headers=H, json={"buyer_id": A, "building_pk": PK2})).json()["id"]
        chk("방금 담은 짝은 카드가 없다", not await cards(pid=p), "카드 없음")
        await age_proposal(p, 13)
        chk("13일 → 아직 아니다(기준 14일)", not await cards("브리핑하기", pid=p), "브리핑하기 없음")
        await age_proposal(p, 20)
        chk("20일 → 브리핑하기", bool(await cards("브리핑하기", pid=p)), "브리핑하기가 내 차례에")

        print("\n[매수] 그 시계는 **값을 고쳐도** 안 돌아간다(2026-08-29)")
        await c.patch(f"/proposals/{p}", headers=H, json={"note": "QA 메모 한 줄"})
        upd = await db.fetchval("SELECT updated_at::date = current_date FROM app.proposals WHERE id=$1", p)
        got = await cards("브리핑하기", pid=p)
        chk("값을 고쳐 updated_at 이 오늘로 튀어도 20일 유지",
            bool(upd) and bool(got) and "20일" in got[0]["why"],
            "담은 날(created_at) 기준", f"updated_at 오늘={upd} · {got[0]['why'] if got else '카드 없음'}")

        print("\n[매수] 브리핑 방식을 고르면 **그 날이 브리핑 날**이 된다(2026-08-29)")
        await c.patch(f"/proposals/{p}/deal", headers=H, json={"brief_how": ["전화"]})
        bo = await db.fetchval("SELECT briefed_on FROM app.proposals WHERE id=$1", p)
        chk("brief_how 를 채우면 briefed_on 도 오늘로",
            bo is not None, "briefed_on = 오늘", f"={bo}")

        print("\n[매수] 살건지묻기 — 브리핑했는데 매수희망가를 못 들은 지 3일")
        chk("브리핑한 날은 기다리는 중(검토중)",
            any(x["_lane"] == "waiting" for x in await cards(pid=p)), "waiting 에")
        await db.execute("UPDATE app.proposals SET briefed_on = current_date - 4 WHERE id=$1", p)
        chk("4일 → 살건지묻기", bool(await cards("살건지묻기", pid=p)), "살건지묻기가 내 차례에")

        print("\n[매수] 매수희망가를 들으면 카드가 사라진다 — 재촉의 기준(0141)")
        await c.patch(f"/proposals/{p}", headers=H, json={"hope_price": 12000000000})
        chk("희망가가 있으면 아무 카드도 없다",
            not await cards(pid=p), "카드 없음", [x["kind"] for x in await cards(pid=p)])
        await db.execute("UPDATE app.proposals SET hope_price = NULL WHERE id=$1", p)

        print("\n[매수] 빠지는 조건 셋")
        await c.post("/stops", headers=H, json={
            "target_type": "proposal", "target_id": str(p), "stage": "deal", "reason": "가격"})
        chk("짝 보류면 재촉하지 않는다", not await cards(pid=p), "카드 없음")
        sid = [x for x in (await c.get("/stops", headers=H)).json() if x["target_type"] == "proposal"][0]["id"]
        await c.delete(f"/stops/{sid}", headers=H)
        await c.patch(f"/proposals/{p}", headers=H, json={"dropped": True})
        chk("죽은 짝은 안 뜬다", not await cards(pid=p), "카드 없음")
        await c.patch(f"/proposals/{p}", headers=H, json={"dropped": False})
        await c.patch(f"/proposals/{p}/deal", headers=H, json={"picked": True})
        chk("상대가 정해진 짝은 안 뜬다", not await cards(pid=p), "카드 없음")
        await c.patch(f"/proposals/{p}/deal", headers=H, json={"picked": False})

        # ══════════════════ 매수자 — 식은매수자 ══════════════════
        print("\n[매수자] 식은매수자 — 사람 접촉이 30일 넘었을 때")
        B = (await c.post("/buyers", headers=H, json={"name": "QA식은", "phone": "010-0000-0002"})).json()["id"]
        chk("방금 등록한 사람은 식은 게 아니다",
            not await cards("식은매수자", bid=B), "식은매수자 없음")
        await db.execute("UPDATE app.buyers SET created_at = now() - interval '40 days' WHERE id=$1", B)
        chk("등록 40일 · 접촉 0건 → 식은매수자",
            bool(await cards("식은매수자", bid=B)), "식은매수자가 내 차례에")
        bc = (await c.post("/contacts", headers=H, json={
            "target_type": "buyer", "target_id": str(B), "kind": "전화"})).json()["id"]
        chk("통화하면 사라진다", not await cards("식은매수자", bid=B), "식은매수자 없음")
        await db.execute("UPDATE app.contacts SET occurred_on = current_date - 35 WHERE id=$1", bc)
        chk("35일 전 통화 → 다시 식은매수자",
            bool(await cards("식은매수자", bid=B)), "식은매수자 복귀")
        await c.post("/stops", headers=H, json={
            "target_type": "buyer", "target_id": str(B), "stage": "touch", "reason": "연락두절"})
        chk("매수자 보류면 안 뜬다", not await cards("식은매수자", bid=B), "카드 없음")

        # ══════════════════ 정리 ══════════════════
        print("\n[정리]")
    await db.execute("DELETE FROM app.stops WHERE team_id=$1", team)
    await db.execute("DELETE FROM app.contacts WHERE team_id=$1", team)
    await db.execute("DELETE FROM app.schedules WHERE team_id=$1", team)
    await db.execute("DELETE FROM app.field_events WHERE team_id=$1", team)
    await db.execute("DELETE FROM app.proposals WHERE team_id=$1", team)
    await db.execute("DELETE FROM app.listings WHERE team_id=$1", team)
    await db.execute("DELETE FROM app.buyers WHERE team_id=$1", team)
    # 크레딧은 팀이 아니라 **계정**에 붙는다
    acc = await db.fetchval("SELECT id FROM app.accounts WHERE email=$1", email)
    if acc:
        await db.execute("DELETE FROM app.credit_entries WHERE account_id=$1", acc)
        await db.execute("DELETE FROM app.credit_balances WHERE account_id=$1", acc)
    await db.execute("DELETE FROM app.team_members WHERE team_id=$1", team)
    await db.execute("DELETE FROM app.teams WHERE id=$1", team)
    await db.execute("DELETE FROM app.accounts WHERE email=$1", email)
    left = await db.fetchval("SELECT count(*) FROM app.teams WHERE id=$1", team)
    print(f"  {'✓' if left == 0 else '✗'} 시험 팀 제거")

    print(f"\n{'=' * 56}\n통과 {ok} · 실패 {fail}")
    await db.close()
    sys.exit(1 if fail else 0)


asyncio.run(main())
