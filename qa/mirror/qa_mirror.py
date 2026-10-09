"""거울 QA — 커밋↔일정↔참석자↔가격이 함께 서고 함께 걷히는지(2026-08-14 밤).

이 배터리가 잡는 구멍(전부 실제로 났던 것):
  H1  원본 커밋을 지워도 참석자 거울(auto 줄)이 남는다
  H2  완료를 예정으로 되돌려도 「완료」 로그가 남는다
  H3  사람 장부의 약속이 그 사람 본인 장부에 거울 줄을 또 세운다(중복)
  H4  제안을 지워도 그 제안의 일정이 유령으로 남는다
  H5  캘린더에서 참석자를 편집하면 거울이 안 선다/안 걷힌다
  H6  캘린더에서 일정을 지워도 참석자 거울·근거 커밋이 남는다
  H7  계약의 캘린더 표가 근거 커밋 삭제에도 남는다(0222 이후 계약은 표를 안 만든다)
  C1~C6  일정 ↔ 매물 선이 끊겼나(0222) — 짝 · 매물 장부에서 일정이 안 서고, 일정 완료가 매물로 안 넘어간다

수치는 200 OK 가 아니라 **DB 행 수**로 확인한다 — 거울은 화면이 아니라 장부의 사실이다.
실행: python3 backend/tests/qa_mirror.py   (api·db 컨테이너 떠 있어야 함)
"""
import asyncio
import datetime as dt
import os
import sys

import asyncpg
import httpx

BASE = os.environ.get("BT_API", "http://localhost:8000")
DSN = os.environ.get("BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
MARK = "QA거울"          # 이 배터리가 만든 행의 표식 — 시작·끝에 이 이름만 청소한다

ok = fail = 0


def chk(name, cond, got=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  ✓ {name}")
    else:
        fail += 1
        print(f"  ✗ {name}  {got}")


async def cleanup(db, team):
    """표식 붙은 QA 행 전부 — 사람 → (FK 순서) 일정 → 커밋 → 제안 → 매물."""
    bids = [r["id"] for r in await db.fetch(
        "SELECT id FROM app.buyers WHERE team_id=$1 AND name LIKE $2", team, f"{MARK}%")]
    oids = [r["id"] for r in await db.fetch(
        "SELECT id FROM app.owners WHERE team_id=$1 AND name LIKE $2", team, f"{MARK}%")]
    if bids:
        await db.execute("DELETE FROM app.schedules WHERE team_id=$1 AND proposal_id IN "
                         "(SELECT id FROM app.proposals WHERE buyer_id = ANY($2::bigint[]))", team, bids)
        await db.execute("DELETE FROM app.proposals WHERE team_id=$1 AND buyer_id = ANY($2::bigint[])", team, bids)
        await db.execute("DELETE FROM app.contacts WHERE team_id=$1 AND target_type='buyer' "
                         "AND target_id::bigint = ANY($2::bigint[])", team, bids)
    for kind, ids in (("buyer", bids), ("owner", oids)):
        if ids:
            await db.execute(f"DELETE FROM app.schedule_people WHERE ref_kind='{kind}' "
                             "AND ref_id = ANY($1::bigint[])", ids)
    await db.execute("DELETE FROM app.schedules s WHERE s.team_id=$1 AND s.contact_id IN "
                     "(SELECT id FROM app.contacts WHERE team_id=$1 AND target_type IN ('buyer','owner') "
                     " AND note LIKE $2)", team, f"%{MARK}%")
    if oids:
        await db.execute("DELETE FROM app.contacts WHERE team_id=$1 AND target_type='owner' "
                         "AND target_id::bigint = ANY($2::bigint[])", team, oids)
    if bids:
        await db.execute("DELETE FROM app.buyers WHERE team_id=$1 AND id = ANY($2::bigint[])", team, bids)
    if oids:
        await db.execute("DELETE FROM app.owners WHERE team_id=$1 AND id = ANY($2::bigint[])", team, oids)


async def main():
    db = await asyncpg.connect(DSN)
    async with httpx.AsyncClient(base_url=BASE, timeout=60) as c:
        r = await c.post("/auth/login", json={"email": os.environ.get("BT_QA_EMAIL", "qa-screen@qa.example.com"), "password": os.environ.get("BT_QA_PW", "qascreen12345")})
        H = {"Authorization": f"Bearer {r.json()['access_token']}"}
        me = (await c.get("/auth/me", headers=H)).json()
        team = me["team_id"]
        await cleanup(db, team)
        tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()

        # 등장인물 — 매수자 둘. 철수의 장부에서 약속이 나고, 영희는 참석자로 불려온다.
        bid_a = (await c.post("/buyers", json={"name": f"{MARK}철수"}, headers=H)).json()["id"]
        bid_b = (await c.post("/buyers", json={"name": f"{MARK}영희"}, headers=H)).json()["id"]

        async def mirrors(bid):
            return await db.fetchval(
                "SELECT count(*) FROM app.contacts WHERE team_id=$1 AND target_type='buyer' "
                "AND target_id=$2::text AND auto AND src_schedule_id IS NOT NULL", team, str(bid))

        print("\n[H1·H3] 커밋의 약속 — 참석자 거울이 서고, 본인은 안 서고, 원본 삭제에 걷힌다")
        r = await c.post("/contacts", headers=H, json={
            "target_type": "buyer", "target_id": str(bid_a), "note": f"{MARK} 내일 2시 미팅",
            "schedule": {"title": "미팅", "on": tomorrow, "at": "14:00",
                         "people": [
                             {"kind": "buyer", "ref_id": bid_a, "label": f"{MARK}철수"},
                             {"kind": "buyer", "ref_id": bid_b, "label": f"{MARK}영희"},
                             {"kind": "guest", "label": "법무사"}]}})
        cid = r.json()["id"]
        sid = await db.fetchval("SELECT id FROM app.schedules WHERE team_id=$1 AND contact_id=$2", team, cid)
        chk("일정이 섰다", sid is not None)
        chk("참석자 3명", 3 == await db.fetchval(
            "SELECT count(*) FROM app.schedule_people WHERE schedule_id=$1", sid))
        chk("영희 장부에 거울 1", 1 == await mirrors(bid_b))
        chk("철수 본인 장부엔 거울 0 (H3 — 문장이 이미 있다)", 0 == await mirrors(bid_a))
        await c.delete(f"/contacts/{cid}", headers=H)
        chk("원본 삭제 → 일정 0", 0 == await db.fetchval(
            "SELECT count(*) FROM app.schedules WHERE team_id=$1 AND id=$2", team, sid))
        chk("원본 삭제 → 영희 거울 0 (H1)", 0 == await mirrors(bid_b))

        print("\n[H2] 완료 → 예정 복귀 — 「완료」 로그가 걷힌다")
        cid = (await c.post("/contacts", headers=H, json={
            "target_type": "buyer", "target_id": str(bid_a), "note": f"{MARK} 내일 브리핑",
            "schedule": {"title": "브리핑", "on": tomorrow}})).json()["id"]
        sid = await db.fetchval("SELECT id FROM app.schedules WHERE team_id=$1 AND contact_id=$2", team, cid)

        async def done_logs():
            return await db.fetchval(
                "SELECT count(*) FROM app.contacts WHERE team_id=$1 AND src_schedule_id=$2 "
                "AND auto AND note LIKE '%완료'", team, sid)
        await c.patch(f"/schedules/{sid}", json={"state": "완료"}, headers=H)
        chk("완료 로그 1 (철수 장부)", 1 == await done_logs())
        await c.patch(f"/schedules/{sid}", json={"state": "예정"}, headers=H)
        chk("예정 복귀 → 완료 로그 0 (H2)", 0 == await done_logs())
        chk("일정은 예정으로 서 있다", "예정" == await db.fetchval(
            "SELECT state FROM app.schedules WHERE id=$1", sid))

        print("\n[H5·H6] 캘린더에서 참석자 편집·일정 삭제 — 생성과 같은 거울")
        await c.patch(f"/schedules/{sid}", headers=H, json={"people": [
            {"kind": "buyer", "ref_id": bid_a, "label": f"{MARK}철수"},
            {"kind": "buyer", "ref_id": bid_b, "label": f"{MARK}영희"}]})
        chk("영희를 불러오면 거울 1 (H5)", 1 == await mirrors(bid_b))
        chk("본인(철수)은 여전히 0", 0 == await mirrors(bid_a))
        await c.patch(f"/schedules/{sid}", headers=H, json={"people": [
            {"kind": "buyer", "ref_id": bid_a, "label": f"{MARK}철수"}]})
        chk("영희를 빼면 거울 0 (H5)", 0 == await mirrors(bid_b))
        await c.patch(f"/schedules/{sid}", headers=H, json={"people": [
            {"kind": "buyer", "ref_id": bid_b, "label": f"{MARK}영희"}]})
        r = await c.delete(f"/schedules/{sid}", headers=H)
        chk("캘린더 삭제 → 근거 커밋도 삭제(약속만 담은 문장)", 0 == await db.fetchval(
            "SELECT count(*) FROM app.contacts WHERE team_id=$1 AND id=$2", team, cid))
        chk("캘린더 삭제 → 영희 거울 0 (H6)", 0 == await mirrors(bid_b))

        # ── 일정 ↔ 매물 선은 끊겼다(0222) ── 일정은 매물 · 짝에 아무것도 쓰지 않는다.
        # 매물은 지번으로 등록하고(0255) 그 뒤로는 매물 번호로만 부른다
        pnu = await db.fetchval(
            "SELECT pr.pnu FROM master.parcel_rep pr WHERE pr.pnu IS NOT NULL AND NOT EXISTS "
            "(SELECT 1 FROM app.listing_parcels lp WHERE lp.team_id=$1 AND lp.pnu=pr.pnu) LIMIT 1", team)

        async def listing_auto(lid):
            return await db.fetchval(
                "SELECT count(*) FROM app.contacts WHERE team_id=$1 AND listing_id=$2 "
                "AND auto AND src_schedule_id IS NOT NULL", team, lid)

        # 짝은 매물에 담는다(0226 · 0227) — 매물은 등록으로만 생긴다
        me_id = (await c.get("/auth/me", headers=H)).json()["account_id"]
        lid = (await c.put("/listings/claim", headers=H, json={"pnu": pnu, "assignee_account_id": me_id})).json()["listing_id"]

        print("\n[C1] 짝을 고쳐도 일정이 안 선다 — 약속을 실어 보내도 무시")
        pid = (await c.post("/proposals", headers=H, json={
            "buyer_id": bid_a, "listing_id": lid, "note": MARK})).json()["id"]
        r = await c.patch(f"/proposals/{pid}", headers=H, json={
            "note": f"{MARK} 내일 3시 현장", "schedule": {"title": "현장", "on": tomorrow, "at": "15:00"}})
        chk("저장 200", r.status_code == 200, f"={r.status_code} {r.text[:80]}")
        chk("짝 일정 0", 0 == await db.fetchval(
            "SELECT count(*) FROM app.schedules WHERE team_id=$1 AND proposal_id=$2", team, pid))

        print("\n[C2] 매물 장부의 계약 — 일정은 안 서고, 계약 거울(매물 ↔ 짝 장부)은 그대로")
        cid = (await c.post("/contacts", headers=H, json={
            "target_type": "listing", "listing_id": lid, "note": f"{MARK} 계약 체결", "status": "계약",
            "schedule": {"title": "계약일", "on": tomorrow}})).json()["id"]
        chk("일정 0(계약 사건 표 · 약속 둘 다)", 0 == await db.fetchval(
            "SELECT count(*) FROM app.schedules WHERE team_id=$1 AND contact_id=$2", team, cid))
        chk("짝 장부에 계약 거울 1", 1 == await db.fetchval(
            "SELECT count(*) FROM app.contacts WHERE team_id=$1 AND target_type='buyer' "
            "AND target_id=$2::text AND auto AND status='계약'", team, str(bid_a)))
        tl = (await c.get(f"/sales/timeline?listing_id={lid}", headers=H)).json()
        chk("합본엔 계약이 **한 줄**", 1 == sum(1 for r in tl if r["status"] == "계약"),
            f"={[(r['side'], r['note']) for r in tl if r['status'] == '계약']}")
        chk("계약 기록은 채택을 켜지 않는다(0199)", None is await db.fetchval(
            "SELECT picked_at FROM app.proposals WHERE id=$1", pid))
        await c.delete(f"/contacts/{cid}", headers=H)

        print("\n[C3] 사람 장부의 약속 — 참석자로 매물을 추론하지 않는다")
        oid = (await c.post("/owners", json={"name": f"{MARK}매도자"}, headers=H)).json()["id"]
        await c.put(f"/owners/{oid}/listings", json={"pnu": pnu}, headers=H)
        cidp = (await c.post("/contacts", headers=H, json={
            "target_type": "buyer", "target_id": str(bid_a), "note": f"{MARK} 계약서 쓰기로함",
            "schedule": {"title": "계약일", "on": tomorrow, "at": "10:00",
                         "people": [
                             {"kind": "buyer", "ref_id": bid_a, "label": f"{MARK}철수"},
                             {"kind": "owner", "ref_id": oid, "label": f"{MARK}매도자"}]}})).json()["id"]
        sch = await db.fetchrow(
            "SELECT id, proposal_id FROM app.schedules WHERE contact_id=$1", cidp)
        chk("일정은 선다 · 짝 없음(일정엔 매물 칸이 없다)", sch is not None and sch["proposal_id"] is None,
            f"={dict(sch) if sch else None}")
        chk("매물 장부 자동 줄 0", 0 == await listing_auto(lid))
        chk("매도자 참석자 장부엔 거울 1(사람 장부는 남는다)", 1 == await db.fetchval(
            "SELECT count(*) FROM app.contacts WHERE team_id=$1 AND target_type='owner' "
            "AND target_id=$2::text AND auto AND src_schedule_id=$3", team, str(oid), sch["id"]))
        await c.delete(f"/contacts/{cidp}", headers=H)

        print("\n[C4] 창에서 붙인 매물 — 매도자만 앉히고 매물에는 아무것도 안 쓴다(0222 · 0255)")
        cid = (await c.post("/contacts", headers=H, json={
            "target_type": "buyer", "target_id": str(bid_a), "note": f"{MARK} 내일 보기로",
            "schedule": {"title": "미팅", "on": tomorrow, "listing_id": lid,
                         "people": [{"kind": "buyer", "ref_id": bid_a, "label": f"{MARK}철수"}]}})).json()["id"]
        sch = await db.fetchrow("SELECT id, proposal_id FROM app.schedules WHERE contact_id=$1", cid)
        chk("일정은 선다 · 짝 없음", sch is not None and sch["proposal_id"] is None, f"={dict(sch) if sch else None}")
        chk("매물 장부 자동 줄 0", 0 == await listing_auto(lid))
        await c.delete(f"/contacts/{cid}", headers=H)

        print("\n[C5] 매물 이름표가 붙은 계약 일정 ✓ — 매물 장부 · 짝으로 안 넘어간다")
        r = await c.post("/schedules", headers=H, json={
            "title": "도장 찍는 날", "on": tomorrow, "category": "계약", "listing_id": lid})
        sid = r.json().get("id")
        chk("종류 저장", "계약" == await db.fetchval("SELECT category FROM app.schedules WHERE id=$1", sid))
        await c.patch(f"/schedules/{sid}", json={"state": "완료"}, headers=H)
        chk("매물 장부 줄 0", 0 == await db.fetchval(
            "SELECT count(*) FROM app.contacts WHERE team_id=$1 AND listing_id=$2", team, lid))
        chk("짝 장부 계약 거울 0", 0 == await db.fetchval(
            "SELECT count(*) FROM app.contacts WHERE team_id=$1 AND target_type='buyer' "
            "AND target_id=$2::text AND src_schedule_id=$3", team, str(bid_a), sid))
        chk("채택 안 켜짐", None is await db.fetchval("SELECT picked_at FROM app.proposals WHERE id=$1", pid))
        await c.delete(f"/schedules/{sid}", headers=H)

        print("\n[C6] 계약 날짜는 짝 칸 — 저장 · 지우기, 일정은 그대로")
        n0 = await db.fetchval("SELECT count(*) FROM app.schedules WHERE team_id=$1", team)
        day2 = (dt.date.today() + dt.timedelta(days=2)).isoformat()
        r = await c.patch(f"/proposals/{pid}/deal", headers=H, json={
            "contract_on": tomorrow, "mid_on": day2, "mid_amount": 300000000, "balance_on": day2})
        chk("저장 200", r.status_code == 200, f"={r.status_code} {r.text[:80]}")
        row = await db.fetchrow(
            "SELECT contract_on::text c, mid_on::text m, mid_amount a, balance_on::text b FROM app.proposals WHERE id=$1", pid)
        chk("네 칸이 선다", (row["c"], row["m"], row["a"], row["b"]) == (tomorrow, day2, 300000000, day2), f"={dict(row)}")
        await c.patch(f"/proposals/{pid}/deal", headers=H, json={"clear": ["mid_on", "mid_amount"]})
        chk("중도금 지우기", (None, None) == tuple(await db.fetchrow(
            "SELECT mid_on, mid_amount FROM app.proposals WHERE id=$1", pid)))
        chk("일정 수 그대로", n0 == await db.fetchval("SELECT count(*) FROM app.schedules WHERE team_id=$1", team))
        await c.delete(f"/proposals/{pid}", headers=H)
        await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND id=$2", team, lid)

        print("\n[H19] 안 산다 = 사람이 누른다(dropped_at) · 되살릴 수 있다(0199)")
        lid = (await c.put("/listings/claim", headers=H, json={"pnu": pnu, "assignee_account_id": me_id})).json()["listing_id"]
        pid = (await c.post("/proposals", headers=H, json={
            "buyer_id": bid_a, "listing_id": lid, "note": MARK})).json()["id"]
        await c.patch(f"/proposals/{pid}/deal", headers=H, json={"brief_how": ["전화"]})
        r = await c.patch(f"/proposals/{pid}", headers=H, json={"dropped": True})
        chk("안 산다 저장 200", r.status_code == 200, f"={r.status_code} {r.text[:80]}")
        chk("짝에 안 산다가 선다", None is not await db.fetchval(
            "SELECT dropped_at FROM app.proposals WHERE id=$1", pid))
        await c.patch(f"/proposals/{pid}", headers=H, json={"dropped": False})
        chk("되살리면 풀린다", None is await db.fetchval(
            "SELECT dropped_at FROM app.proposals WHERE id=$1", pid))

        print("\n[H19b] 매수희망가 — 값 이력이 남는다")
        await c.patch(f"/proposals/{pid}", headers=H, json={"hope_price": 12000000000})
        chk("값 이력이 남는다(호가판)", 1 == await db.fetchval(
            "SELECT count(*) FROM app.field_events WHERE team_id=$1 AND target_type='proposal' "
            "AND target_id=$2 AND field='hope_price'", team, str(pid)))
        await c.delete(f"/proposals/{pid}", headers=H)
        await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND id=$2", team, lid)

        print("\n[불변식] 팀 전체 — 고아 거울·유령 일정이 없다")
        audits = {
            "고아 참석자 거울(contacts)":
                "SELECT count(*) FROM app.contacts c WHERE c.team_id=$1 AND c.auto "
                "AND c.src_schedule_id IS NOT NULL "
                "AND NOT EXISTS (SELECT 1 FROM app.schedules s WHERE s.id=c.src_schedule_id)",
            "유령 일정(짝 없음)":
                "SELECT count(*) FROM app.schedules s WHERE s.team_id=$1 AND s.proposal_id IS NOT NULL "
                "AND NOT EXISTS (SELECT 1 FROM app.proposals p WHERE p.id=s.proposal_id)",
            "유령 일정(커밋 없음)":
                "SELECT count(*) FROM app.schedules s WHERE s.team_id=$1 AND s.contact_id IS NOT NULL "
                "AND NOT EXISTS (SELECT 1 FROM app.contacts c WHERE c.id=s.contact_id)",
            "예정인데 완료 로그":
                "SELECT count(*) FROM app.schedules s JOIN app.contacts c ON c.src_schedule_id=s.id "
                "AND c.auto AND c.note LIKE '%완료' WHERE s.team_id=$1 AND s.state='예정'",
        }
        for name, q in audits.items():
            n = await db.fetchval(q, team)
            chk(name + " = 0", n == 0, f"={n}")

        await cleanup(db, team)
    await db.close()
    print(f"\n{ok} ✓ · {fail} ✗")
    sys.exit(1 if fail else 0)


asyncio.run(main())
