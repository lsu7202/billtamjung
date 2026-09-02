"""거울 QA — 커밋↔일정↔참석자↔가격이 함께 서고 함께 걷히는지(2026-08-14 밤).

이 배터리가 잡는 구멍(전부 실제로 났던 것):
  H1  원본 커밋을 지워도 참석자 거울(auto 줄)이 남는다
  H2  완료를 예정으로 되돌려도 「완료」 로그가 남는다
  H3  사람 장부의 약속이 그 사람 본인 장부에 거울 줄을 또 세운다(중복)
  H4  제안을 지워도 그 제안의 일정이 유령으로 남는다
  H5  캘린더에서 참석자를 편집하면 거울이 안 선다/안 걷힌다
  H6  캘린더에서 일정을 지워도 참석자 거울·근거 커밋이 남는다
  H7  계약의 캘린더 표가 근거 커밋 삭제에도 남는다

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
        r = await c.post("/auth/login", json={"email": os.environ.get("BT_QA_EMAIL", "phototest@t.com"), "password": os.environ.get("BT_QA_PW", "test1234")})
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

        print("\n[H4] 제안 삭제 — 그 제안의 일정·거울이 함께 간다")
        pk = await db.fetchval(
            "SELECT building_pk FROM master.buildings WHERE building_pk NOT IN "
            "(SELECT building_pk FROM app.listings WHERE team_id=$1) LIMIT 1", team)
        pid = (await c.post("/proposals", headers=H, json={
            "buyer_id": bid_a, "building_pk": pk, "note": MARK})).json()["id"]
        await c.patch(f"/proposals/{pid}", headers=H, json={
            "note": f"{MARK} 내일 3시 현장", "schedule": {"title": "현장", "on": tomorrow, "at": "15:00"}})
        n_sched = await db.fetchval(
            "SELECT count(*) FROM app.schedules WHERE team_id=$1 AND proposal_id=$2", team, pid)
        chk("제안 일정 1", 1 == n_sched, f"={n_sched}")
        await c.delete(f"/proposals/{pid}", headers=H)
        chk("제안 삭제 → 일정 0 (H4)", 0 == await db.fetchval(
            "SELECT count(*) FROM app.schedules WHERE team_id=$1 AND proposal_id=$2", team, pid))

        print("\n[H7] 계약 거울 — 커밋과 함께 서고 함께 걷힌다")
        cid = (await c.post("/contacts", headers=H, json={
            "target_type": "listing", "target_id": pk, "note": f"{MARK} 계약 체결", "status": "계약"}))
        cid = cid.json()["id"]
        chk("계약·완료 일정이 캘린더에 섰다", 1 == await db.fetchval(
            "SELECT count(*) FROM app.schedules WHERE team_id=$1 AND contact_id=$2"
            "   AND category='계약' AND state='완료'", team, cid))
        await c.delete(f"/contacts/{cid}", headers=H)
        chk("커밋 삭제 → 표 0 (H7)", 0 == await db.fetchval(
            "SELECT count(*) FROM app.schedules WHERE team_id=$1 AND contact_id=$2", team, cid))
        chk("매물 쪽도 되감김 — 계약 상대가 없다(0142)", 0 == await db.fetchval(
            "SELECT count(*) FROM app.proposals WHERE team_id=$1 AND building_pk=$2 "
            "  AND picked_at IS NOT NULL", team, pk))

        print("\n[H8] 한 사건 = 한 표 — 「계약일」 약속과 계약이 표 하나로")
        # 문장 하나가 약속(계약일)과 계약을 같이 품는다 → 표는 하나, 이름은 사람이 붙인 것
        pid = (await c.post("/proposals", headers=H, json={
            "buyer_id": bid_a, "building_pk": pk, "note": MARK})).json()["id"]
        cid = (await c.post("/contacts", headers=H, json={
            "target_type": "listing", "target_id": pk, "note": f"{MARK} 내일 계약일에 계약 체결",
            "status": "계약", "occurred_on": tomorrow,
            "schedule": {"title": "계약일", "on": tomorrow, "at": "11:00"}})).json()["id"]
        scheds = await db.fetch(
            "SELECT id, title, state FROM app.schedules WHERE team_id=$1 AND building_pk=$2", team, pk)
        chk("표가 하나다", 1 == len(scheds), f"={[(r['title'], r['state']) for r in scheds]}")
        chk("이름은 「계약일」·상태는 완료", scheds and scheds[0]["title"] == "계약일"
            and scheds[0]["state"] == "완료")
        sid = scheds[0]["id"] if scheds else None
        ppl = await db.fetch(
            "SELECT ref_kind FROM app.schedule_people WHERE schedule_id=$1 ORDER BY ref_kind", sid)
        chk("매수자·매도자가 같은 표에 앉는다", ["buyer", "owner"] == [r["ref_kind"] for r in ppl]
            or ["buyer"] == [r["ref_kind"] for r in ppl])   # owner 없는 매물이면 buyer 만

        print("\n[H9] 거울 장부줄 — 장부는 하나다(0141), 합본엔 한 줄")
        tl = (await c.get(f"/sales/timeline?building_pk={pk}", headers=H)).json()
        chk("합본엔 계약이 **한 줄**", 1 == sum(1 for r in tl if r["status"] == "계약"),
            f"={[(r['side'], r['note']) for r in tl if r['status'] == '계약']}")

        print("\n[H10] 계약 줄 삭제 — 짝의 죽음도 풀리고, 완료시킨 일정은 예정으로")
        await c.delete(f"/contacts/{cid}", headers=H)
        left = await db.fetch(
            "SELECT title, state FROM app.schedules WHERE team_id=$1 AND building_pk=$2", team, pk)
        chk("표는 사라졌다(커밋이 낳은 표)", 0 == len(left), f"={[dict(r) for r in left]}")
        print("\n[H11] 두 단계 — 「계약일」을 먼저 잡고 나중에 계약을 적으면 완료, 되돌리면 예정")
        day2 = (dt.date.today() + dt.timedelta(days=2)).isoformat()
        cid1 = (await c.post("/contacts", headers=H, json={
            "target_type": "listing", "target_id": pk, "note": f"{MARK} 모레 계약일 잡음",
            "schedule": {"title": "계약일", "on": day2}})).json()["id"]
        cid2 = (await c.post("/contacts", headers=H, json={
            "target_type": "listing", "target_id": pk, "note": f"{MARK} 계약 체결",
            "status": "계약", "occurred_on": day2})).json()["id"]
        scheds = await db.fetch(
            "SELECT title, state, contact_id FROM app.schedules WHERE team_id=$1 AND building_pk=$2",
            team, pk)
        chk("표는 여전히 하나(새 표 없음)", 1 == len(scheds),
            f"={[(r['title'], r['state']) for r in scheds]}")
        chk("「계약일」이 완료로", scheds and scheds[0]["title"] == "계약일"
            and scheds[0]["state"] == "완료")
        await c.delete(f"/contacts/{cid2}", headers=H)
        scheds = await db.fetch(
            "SELECT title, state FROM app.schedules WHERE team_id=$1 AND building_pk=$2", team, pk)
        chk("계약 취소 → 「계약일」은 예정으로(표는 남는다)",
            [("계약일", "예정")] == [(r["title"], r["state"]) for r in scheds],
            f"={[dict(r) for r in scheds]}")
        print("\n[H12] 날짜 없이 「계약 체결」 — 잡혀 있던 계약일이 곧 그 날(날짜 유지)")
        # 계약일은 모레(day2)로 잡혀 있고, 계약은 오늘 적는다 — 계약은 계약일에 한 것이다
        cid2 = (await c.post("/contacts", headers=H, json={
            "target_type": "listing", "target_id": pk, "note": f"{MARK} 계약 체결",
            "status": "계약"})).json()["id"]
        scheds = await db.fetch(
            "SELECT title, state, on_date::text AS d FROM app.schedules WHERE team_id=$1 AND building_pk=$2",
            team, pk)
        chk("표 하나 · 「계약일」 완료 · 날짜는 계약일 그대로",
            [("계약일", "완료", day2)] == [(r["title"], r["state"], r["d"]) for r in scheds],
            f"={[dict(r) for r in scheds]}")
        await c.delete(f"/contacts/{cid2}", headers=H)
        scheds = await db.fetch(
            "SELECT title, state FROM app.schedules WHERE team_id=$1 AND building_pk=$2", team, pk)
        chk("되돌리면 다시 예정(0082 링크)",
            [("계약일", "예정")] == [(r["title"], r["state"]) for r in scheds],
            f"={[dict(r) for r in scheds]}")
        await c.delete(f"/contacts/{cid1}", headers=H)
        await c.delete(f"/proposals/{pid}", headers=H)
        await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND building_pk=$2", team, pk)

        print("\n[H13] 사람 장부의 약속 — 참석자가 매물을 하나로 가리키면 그 매물의 것")
        oid = (await c.post("/owners", json={"name": f"{MARK}매도자"}, headers=H)).json()["id"]
        await c.put(f"/owners/{oid}/listings", json={"building_pk": pk}, headers=H)
        pid = (await c.post("/proposals", headers=H, json={
            "buyer_id": bid_a, "building_pk": pk, "note": MARK})).json()["id"]
        # 매수자 화면(사람 장부)에서: 「계약일」 약속 + 참석자 = 매수자·매도자
        cidp = (await c.post("/contacts", headers=H, json={
            "target_type": "buyer", "target_id": str(bid_a), "note": f"{MARK} 계약서 쓰기로함",
            "schedule": {"title": "계약일", "on": tomorrow, "at": "10:00",
                         "people": [
                             {"kind": "buyer", "ref_id": bid_a, "label": f"{MARK}철수"},
                             {"kind": "owner", "ref_id": oid, "label": f"{MARK}매도자"}]}})).json()["id"]
        sch = await db.fetchrow(
            "SELECT id, building_pk, proposal_id, title FROM app.schedules WHERE contact_id=$1", cidp)
        chk("약속이 매물에 닻을 내렸다", sch and sch["building_pk"] == pk and sch["proposal_id"] == pid,
            f"={dict(sch) if sch else None}")
        chk("매물 장부에 자동 한 줄(합본에 뜬다)", 1 == await db.fetchval(
            "SELECT count(*) FROM app.contacts WHERE team_id=$1 AND target_type='listing' "
            "AND target_id=$2 AND auto AND src_schedule_id=$3", team, pk, sch["id"]))
        tl = (await c.get(f"/sales/timeline?building_pk={pk}", headers=H)).json()
        chk("합본에서 보인다 — **한 줄만**",
            1 == sum(1 for r in tl if "계약일" in (r["note"] or "")),
            f"={[r['note'] for r in tl if '계약일' in (r['note'] or '')]}")
        # 이제 매물에서 「계약 체결」 — 잡아 둔 그 계약일이 곧 체결일이다
        cidk = (await c.post("/contacts", headers=H, json={
            "target_type": "listing", "target_id": pk, "note": f"{MARK} 계약 체결",
            "status": "계약"})).json()["id"]
        chk("계약일이 완료로(새 표 없음)",
            "완료" == await db.fetchval("SELECT state FROM app.schedules WHERE id=$1", sch["id"])
            and 1 == await db.fetchval(
                "SELECT count(*) FROM app.schedules WHERE team_id=$1 AND building_pk=$2", team, pk))
        # 원본 커밋 삭제 → 약속·매물 줄·거울 전부 걷힘
        await c.delete(f"/contacts/{cidk}", headers=H)
        await c.delete(f"/contacts/{cidp}", headers=H)
        chk("원본 삭제 → 일정·매물 줄 0", (0, 0) == (
            await db.fetchval("SELECT count(*) FROM app.schedules WHERE id=$1", sch["id"]),
            await db.fetchval("SELECT count(*) FROM app.contacts WHERE team_id=$1 "
                              "AND src_schedule_id=$2", team, sch["id"])))
        await c.delete(f"/proposals/{pid}", headers=H)
        await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND building_pk=$2", team, pk)

        print("\n[H14] 제안 장부의 일정 문장 — 단계 안 찍히고, 매도자 참석자에게 거울")
        pid = (await c.post("/proposals", headers=H, json={
            "buyer_id": bid_a, "building_pk": pk, "note": MARK})).json()["id"]
        await c.patch(f"/proposals/{pid}", headers=H, json={
            "note": f"{MARK} 일정 내일 두시 계약 스타벅스에서",
            "schedule": {"title": "계약", "on": tomorrow, "at": "14:00", "place": "스타벅스",
                         "people": [
                             {"kind": "buyer", "ref_id": bid_a, "label": f"{MARK}철수"},
                             {"kind": "owner", "ref_id": oid, "label": f"{MARK}매도자"}]}})
        ev = await db.fetchrow(
            """SELECT id, status, proposal_id FROM app.contacts WHERE team_id=$1
                AND target_type='buyer' AND proposal_id=$2 ORDER BY id DESC LIMIT 1""", team, pid)
        chk("문장은 그 매수자 장부에 서되 단계가 없다(메모)",
            ev is not None and ev["status"] is None, f"={dict(ev) if ev else None}")
        chk("짝은 아직 합의 전·합의중 사이(값도 상대도 없다)", 1 == await db.fetchval(
            "SELECT app.nego_rank(p) FROM app.proposals p WHERE id=$1", pid))
        sid = await db.fetchval(
            "SELECT id FROM app.schedules WHERE team_id=$1 AND proposal_id=$2", team, pid)
        chk("일정이 짝에 매달려 섰다", sid is not None)
        chk("매도자 참석자 장부에 거울 1", 1 == await db.fetchval(
            "SELECT count(*) FROM app.contacts WHERE team_id=$1 AND target_type='owner' "
            "AND target_id=$2::text AND auto AND src_schedule_id=$3", team, str(oid), sid))
        await c.delete(f"/contacts/{ev['id']}", headers=H)
        chk("문장 삭제 → 일정·매도자 거울 걷힘", (0, 0) == (
            await db.fetchval("SELECT count(*) FROM app.schedules WHERE id=$1", sid),
            await db.fetchval("SELECT count(*) FROM app.contacts WHERE team_id=$1 "
                              "AND src_schedule_id=$2", team, sid)))
        await c.delete(f"/proposals/{pid}", headers=H)
        await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND building_pk=$2", team, pk)

        print("\n[H15] 매물에서 만든 약속 — 매수자 참석자 거울은 그 사람 장부로(0141)")
        pid = (await c.post("/proposals", headers=H, json={
            "buyer_id": bid_a, "building_pk": pk, "note": MARK})).json()["id"]
        cid = (await c.post("/contacts", headers=H, json={
            "target_type": "listing", "target_id": pk, "note": f"{MARK} 계약일정 잡음",
            "schedule": {"title": "계약일정", "on": tomorrow, "at": "10:00",
                         "people": [{"kind": "buyer", "ref_id": bid_a, "label": f"{MARK}철수"}]}})).json()["id"]
        sid = await db.fetchval("SELECT id FROM app.schedules WHERE contact_id=$1", cid)
        chk("매수자 거울이 그 사람 장부에", 1 == await mirrors(bid_a))
        await c.delete(f"/contacts/{cid}", headers=H)
        chk("원본 삭제 → 거울도 걷힘", 0 == await db.fetchval(
            "SELECT count(*) FROM app.contacts WHERE team_id=$1 AND src_schedule_id=$2",
            team, sid))
        await c.delete(f"/proposals/{pid}", headers=H)
        await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND building_pk=$2", team, pk)

        print("\n[H16] 계약일정 ✓ = 계약 체결 — 상태·거울·승격이 한 번에, 해제하면 되감김")
        pid = (await c.post("/proposals", headers=H, json={
            "buyer_id": bid_a, "building_pk": pk, "note": MARK})).json()["id"]
        cid = (await c.post("/contacts", headers=H, json={
            "target_type": "listing", "target_id": pk, "note": f"{MARK} 계약일 잡음",
            "schedule": {"title": "계약일", "on": tomorrow, "at": "11:00"}})).json()["id"]
        sid = await db.fetchval("SELECT id FROM app.schedules WHERE contact_id=$1", cid)
        await c.patch(f"/schedules/{sid}", json={"state": "완료"}, headers=H)
        chk("매물 사다리도 계약칸 done(파생·0142)", True is await db.fetchval(
            "SELECT s6_match FROM app.v_listing_stage WHERE team_id=$1 AND building_pk=$2", team, pk))
        chk("매수 쪽도 상대 확정(거울)", None is not await db.fetchval(
            "SELECT picked_at FROM app.proposals WHERE id=$1", pid))
        chk("그 ✓ 가 낳은 계약 기록이 표에 걸린다", None is not await db.fetchval(
            "SELECT promoted_by_contact_id FROM app.schedules WHERE id=$1", sid))
        await c.patch(f"/schedules/{sid}", json={"state": "예정"}, headers=H)
        chk("해제 → 매물 사다리도 되감김", False is await db.fetchval(
            "SELECT s6_match FROM app.v_listing_stage WHERE team_id=$1 AND building_pk=$2", team, pk))
        chk("해제 → 매수 쪽 상대 확정도 풀림", None is await db.fetchval(
            "SELECT picked_at FROM app.proposals WHERE id=$1", pid))
        chk("해제 → 표는 약속으로", "약속" == await db.fetchval(
            "SELECT kind FROM app.schedules WHERE id=$1", sid))
        await c.delete(f"/contacts/{cid}", headers=H)
        await c.delete(f"/proposals/{pid}", headers=H)
        await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND building_pk=$2", team, pk)

        print("\n[H17] 일정 종류는 모달 토글이 정본(0088) — 이름이 뭐든 지정하면 ✓=체결")
        pid = (await c.post("/proposals", headers=H, json={
            "buyer_id": bid_a, "building_pk": pk, "note": MARK})).json()["id"]
        # 「도장 찍는 날」 — 제목 규칙으로는 계약이 아니지만, 사람이 계약으로 지정했다
        cid = (await c.post("/contacts", headers=H, json={
            "target_type": "listing", "target_id": pk, "note": f"{MARK} 도장 날 잡음",
            "schedule": {"title": "도장 찍는 날", "on": tomorrow, "category": "계약"}})).json()["id"]
        sid = await db.fetchval("SELECT id FROM app.schedules WHERE contact_id=$1", cid)
        chk("종류 저장", "계약" == await db.fetchval(
            "SELECT category FROM app.schedules WHERE id=$1", sid))
        await c.patch(f"/schedules/{sid}", json={"state": "완료"}, headers=H)
        chk("이름 무관 ✓=계약 체결(상대 확정)", None is not await db.fetchval(
            "SELECT picked_at FROM app.proposals WHERE id=$1", pid))
        await c.patch(f"/schedules/{sid}", json={"state": "예정"}, headers=H)
        # 반대: 제목은 「계약일」인데 사람이 일반으로 지정 — ✓는 그냥 완료 로그
        await c.patch(f"/schedules/{sid}", json={"category": "일반", "title": "계약일"}, headers=H)
        await c.patch(f"/schedules/{sid}", json={"state": "완료"}, headers=H)
        chk("일반 지정이면 ✓는 체결 아님", None is await db.fetchval(
            "SELECT picked_at FROM app.proposals WHERE id=$1", pid))
        await c.delete(f"/contacts/{cid}", headers=H)
        await c.delete(f"/proposals/{pid}", headers=H)
        await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND building_pk=$2", team, pk)

        print("\n[H18] 창에서 붙인 매물(명시 닻) — 추론이 못 좁혀도 그 매물이다")
        pk2 = await db.fetchval(
            "SELECT building_pk FROM master.buildings WHERE building_pk NOT IN "
            "(SELECT building_pk FROM app.listings WHERE team_id=$1) AND building_pk != $2 LIMIT 1",
            team, pk)
        # 매수자가 매물 둘에 제안 — 참석자 추론으로는 하나로 못 좁힌다
        pid1 = (await c.post("/proposals", headers=H, json={
            "buyer_id": bid_a, "building_pk": pk, "note": MARK})).json()["id"]
        await c.post("/proposals", headers=H, json={
            "buyer_id": bid_a, "building_pk": pk2, "note": MARK})
        cid = (await c.post("/contacts", headers=H, json={
            "target_type": "buyer", "target_id": str(bid_a), "note": f"{MARK} 내일 보기로",
            "schedule": {"title": "미팅", "on": tomorrow, "building_pk": pk,
                         "people": [{"kind": "buyer", "ref_id": bid_a, "label": f"{MARK}철수"}]}})).json()["id"]
        sch = await db.fetchrow(
            "SELECT building_pk, proposal_id FROM app.schedules WHERE contact_id=$1", cid)
        chk("명시 닻이 그대로 선다", sch and sch["building_pk"] == pk and sch["proposal_id"] == pid1,
            f"={dict(sch) if sch else None}")
        await c.delete(f"/contacts/{cid}", headers=H)
        for r in await db.fetch("SELECT id FROM app.proposals WHERE team_id=$1 AND buyer_id=$2", team, bid_a):
            await c.delete(f"/proposals/{r['id']}", headers=H)
        await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND building_pk IN ($2,$3)", team, pk, pk2)

        print("\n[H19] 안 산다는 답은 **보류**다(0141) — 관계는 살고, 풀 수 있다")
        pid = (await c.post("/proposals", headers=H, json={
            "buyer_id": bid_a, "building_pk": pk, "note": MARK})).json()["id"]
        await c.patch(f"/proposals/{pid}/deal", headers=H, json={"brief_how": ["전화"]})
        chk("브리핑만 하면 합의중(2)", 2 == await db.fetchval(
            "SELECT app.nego_rank(p) FROM app.proposals p WHERE id=$1", pid))
        r = await c.post("/stops", headers=H, json={
            "target_type": "proposal", "target_id": str(pid), "stage": "deal",
            "reason": "가격", "note": f"{MARK} 비싸다고 함"})
        chk("짝 보류 저장 200", r.status_code == 200, f"={r.status_code} {r.text[:80]}")
        got = next(x for x in (await c.get(f"/proposals?buyer_id={bid_a}", headers=H)).json()
                   if x["id"] == pid)
        chk("목록에 보류 사유가 실린다", got.get("stop_reason") == "가격", f"={got.get('stop_reason')}")
        chk("보류해도 짝은 산다(단계 그대로)", got.get("nego") == 2, f"={got.get('nego')}")
        chk("보류 중엔 재촉하지 않는다",
            not any(x.get("building_pk") == pk and x.get("buyer_id") == bid_a
                    for x in (await c.get("/sales/today?mine=false", headers=H)).json()["my_turn"]))
        await c.delete(f"/stops/{got['stop_id']}", headers=H)
        got = next(x for x in (await c.get(f"/proposals?buyer_id={bid_a}", headers=H)).json()
                   if x["id"] == pid)
        chk("풀면 보류가 사라진다", got.get("stop_id") is None, f"={got.get('stop_id')}")

        print("\n[H19b] 재촉의 기준은 매수희망가 — 값을 들었으면 카드가 없다")
        await c.patch(f"/proposals/{pid}", headers=H, json={"hope_price": 12000000000})
        chk("값을 부르면 합의중 유지(2)", 2 == await db.fetchval(
            "SELECT app.nego_rank(p) FROM app.proposals p WHERE id=$1", pid))
        chk("희망가가 있으면 「살 건지 물어보기」가 안 뜬다",
            not any(x.get("kind") == "살건지묻기" and x.get("building_pk") == pk
                    for x in (await c.get("/sales/today?mine=false", headers=H)).json()["my_turn"]))
        chk("값 이력이 남는다(호가판)", 1 == await db.fetchval(
            "SELECT count(*) FROM app.field_events WHERE team_id=$1 AND target_type='proposal' "
            "AND target_id=$2 AND field='hope_price'", team, str(pid)))
        await c.delete(f"/proposals/{pid}", headers=H)
        await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND building_pk=$2", team, pk)

        print("\n[H20] 일정 종류(0088) — 종류는 저장되고, 잔금 ✓ 는 계약 체결이 아니다")
        pid = (await c.post("/proposals", headers=H, json={
            "buyer_id": bid_a, "building_pk": pk, "note": MARK})).json()["id"]
        cid = (await c.post("/contacts", headers=H, json={
            "target_type": "listing", "target_id": pk, "note": f"{MARK} 잔금일",
            "schedule": {"title": "잔금", "on": tomorrow}})).json()["id"]
        chk("제목에서 종류 추정 — 잔금", "잔금" == await db.fetchval(
            "SELECT category FROM app.schedules WHERE contact_id=$1", cid))
        sid = await db.fetchval("SELECT id FROM app.schedules WHERE contact_id=$1", cid)
        await c.patch(f"/schedules/{sid}", headers=H, json={"category": "중도금"})
        chk("모달 토글이 정본 — 중도금", "중도금" == await db.fetchval(
            "SELECT category FROM app.schedules WHERE id=$1", sid))
        await c.patch(f"/schedules/{sid}", headers=H, json={"state": "완료"})
        chk("중도금 ✓ 는 상대 확정이 아니다", None is await db.fetchval(
            "SELECT picked_at FROM app.proposals WHERE id=$1", pid))
        chk("상대가 없으면 중도금 완료여도 5로 안 선다", 1 == await db.fetchval(
            "SELECT app.nego_rank(p) FROM app.proposals p WHERE id=$1", pid))
        await c.delete(f"/contacts/{cid}", headers=H)
        await c.delete(f"/proposals/{pid}", headers=H)
        await db.execute("DELETE FROM app.listings WHERE team_id=$1 AND building_pk=$2", team, pk)

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
            "유령 보류(짝 없음)":
                "SELECT count(*) FROM app.stops st WHERE st.team_id=$1 AND st.target_type='proposal' "
                "AND NOT EXISTS (SELECT 1 FROM app.proposals p WHERE p.id=st.target_id::bigint)",
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
