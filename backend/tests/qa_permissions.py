"""권한(대표 ↔ 팀원) QA — specs/06-review/권한-경우의수-2026-08-09.md 의 표를 그대로 실행한다.

사용: 로컬 API를 띄운 뒤  backend/.venv/bin/python tests/qa_permissions.py
매 실행마다 대표 1 + 팀원 2로 새 팀을 만든다(기존 데이터를 안 건드린다).
로컬 전용 — 가입을 열어 계정을 만들기 때문에 프로덕션에 대고 돌리지 말 것.
"""
import asyncio
import time

import httpx

BASE = "http://localhost:8000"
PK = "1002117536"       # 종로2가 71-6
PK2 = "1002117537"

R = []


def chk(no: str, name: str, ok: bool, detail: str = ""):
    R.append((no, name, ok, detail))


async def signup(c, email, name):
    r = await c.post("/auth/signup", json={
        "email": email, "password": "testpw12345", "name": name,
        "terms_agreed": True, "privacy_agreed": True})
    if r.status_code >= 400:
        raise SystemExit(f"가입 실패({r.status_code}) — BT_SIGNUPS_OPEN 확인: {r.text[:120]}")
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def main():
    ts = int(time.time())
    async with httpx.AsyncClient(base_url=BASE, timeout=60) as c:
        # ── 팀 구성: A(대표) + M, M2(팀원) ──────────────────
        A = await signup(c, f"qa_a_{ts}@t.com", "대표A")
        M = await signup(c, f"qa_m_{ts}@t.com", "팀원M")
        M2 = await signup(c, f"qa_m2_{ts}@t.com", "팀원M2")

        # 초대 → 수락(가입 시 각자 1인 팀이 생기므로 M·M2가 A의 팀으로 합류)
        for tag, h, email in (("M", M, f"qa_m_{ts}@t.com"), ("M2", M2, f"qa_m2_{ts}@t.com")):
            inv = await c.post("/team/invites", headers=A, json={"channel": "email", "target": email})
            if inv.status_code >= 400:
                raise SystemExit(f"초대 실패: {inv.status_code} {inv.text[:160]}")
            code = inv.json()["token"]
            acc = await c.post("/team/invites/accept", headers=h, json={"token": code})
            if acc.status_code >= 400:
                raise SystemExit(f"수락 실패: {acc.status_code} {acc.text[:160]}")

        # 합류 후 토큰 재발급(팀이 바뀌었으므로)
        async def relogin(email):
            r = await c.post("/auth/login", json={"email": email, "password": "testpw12345"})
            return {"Authorization": f"Bearer {r.json()['access_token']}"}
        M = await relogin(f"qa_m_{ts}@t.com")
        M2 = await relogin(f"qa_m2_{ts}@t.com")
        A = await relogin(f"qa_a_{ts}@t.com")

        team = (await c.get("/team", headers=A)).json()
        by_name = {m["name"]: m["account_id"] for m in team["members"]}
        aid, mid, m2id = by_name["대표A"], by_name["팀원M"], by_name["팀원M2"]
        chk("T0", "팀 구성(대표1+팀원2)", len(team["members"]) == 3, str(list(by_name)))

        claim = lambda h, pk, target: c.put("/listings/claim", headers=h,   # noqa: E731
                                            json={"building_pk": pk, "assignee_account_id": target})
        async def assignee(pk):
            return (await c.get(f"/listings/{pk}", headers=A)).json().get("assignee_account_id")

        # ── 2.1 담당자 지정/해제 ────────────────────────────
        await claim(A, PK, None)
        chk("C1", "담당 없음 · 팀원이 나를 담당", (await claim(M, PK, mid)).status_code == 200)
        await claim(A, PK, None)
        chk("C2", "담당 없음 · 대표가 나를 담당", (await claim(A, PK, aid)).status_code == 200)
        await claim(A, PK, None)
        chk("C3", "팀원이 다른 팀원을 담당 지정", (await claim(M, PK, m2id)).status_code == 403)
        chk("C4", "대표가 팀원을 담당 지정", (await claim(A, PK, mid)).status_code == 200)

        await claim(A, PK, aid)                                  # 대표가 담당
        chk("C5", "대표 담당 · 팀원이 뺏기", (await claim(M, PK, mid)).status_code == 409)
        await claim(A, PK, m2id)                                 # M2가 담당
        chk("C6", "M2 담당 · M이 뺏기", (await claim(M, PK, mid)).status_code == 409)
        chk("C7", "대표가 자기에게 재배정", (await claim(A, PK, aid)).status_code == 200)
        chk("C8", "대표가 M2에게 재배정", (await claim(A, PK, m2id)).status_code == 200)

        await claim(A, PK, aid)                                  # 대표 담당으로
        r9 = await claim(M, PK, None)
        after9 = await assignee(PK)
        chk("C9", "대표 담당 · 팀원이 해제", r9.status_code == 403 and after9 == aid,
            f"status={r9.status_code} assignee={after9}")

        await claim(A, PK, mid)
        chk("C10", "본인 담당 · 본인이 해제", (await claim(M, PK, None)).status_code == 200)
        await claim(A, PK, mid)
        chk("C11", "대표가 해제", (await claim(A, PK, None)).status_code == 200)
        chk("C12", "팀 밖 계정 지정", (await claim(A, PK, 999999)).status_code == 422)

        # C13 — 2단계 탈취(해제 → 재지정)
        await claim(A, PK, aid)
        await claim(M, PK, None)
        r13 = await claim(M, PK, mid)
        final13 = await assignee(PK)
        chk("C13", "해제→재지정 2단계 탈취", final13 == aid,
            f"최종담당={final13}(대표={aid}) 재지정status={r13.status_code}")

        # ── 2.2 열람 제한 ───────────────────────────────────
        await claim(A, PK2, mid)                                 # M 담당
        await c.patch("/listings/biz", headers=M,
                      json={"building_pk": PK2, "fields": {"owner_phone": "010-1111-2222"}})
        get = lambda h: c.get(f"/listings/{PK2}", headers=h)     # noqa: E731
        chk("V1", "담당 본인이 전화번호 열람", "1111" in str((await get(M)).json().get("owner_phone")))
        chk("V2", "대표가 전화번호 열람", "1111" in str((await get(A)).json().get("owner_phone")))
        v3 = (await get(M2)).json().get("owner_phone")
        chk("V3", "다른 팀원에겐 가려짐", v3 is None or "1111" not in str(v3), f"본값={v3}")

        wm = await c.put(f"/buildings/{PK2}/memos", headers=M, json={"kind": "secret", "body": "비밀"})
        chk("V4a", "담당 본인이 비밀메모 작성", wm.status_code == 200, f"status={wm.status_code} {wm.text[:80]}")
        seen_m2 = (await c.get(f"/buildings/{PK2}/memos", headers=M2)).json()
        chk("V4", "비밀메모 · 다른 팀원 안 보임",
            all(x.get("kind") != "secret" for x in seen_m2), str(seen_m2)[:100])
        seen_a = (await c.get(f"/buildings/{PK2}/memos", headers=A)).json()
        chk("V5", "비밀메모 · 대표 보임", any(x.get("kind") == "secret" for x in seen_a))
        w = await c.put(f"/buildings/{PK2}/memos", headers=M2, json={"kind": "secret", "body": "x"})
        chk("V6", "비밀메모 · 담당 아닌 팀원 작성 차단", w.status_code == 403, f"status={w.status_code}")

        # ── 2.3 팀 관리 ─────────────────────────────────────
        chk("T1", "팀명 변경(팀원)", (await c.patch("/team", headers=M, json={"name": "x"})).status_code == 403)
        chk("T2", "사무소 수정(팀원)", (await c.patch("/team/office", headers=M, json={"office_name": "x"})).status_code == 403)
        chk("T4", "초대 생성(팀원)", (await c.post("/team/invites", headers=M, json={"channel": "email", "target": "z@t.com"})).status_code == 403)
        chk("T5", "팀원 제외(팀원)", (await c.delete(f"/team/members/{m2id}", headers=M)).status_code == 403)
        chk("T6", "대표 탈퇴 차단", (await c.post("/team/leave", headers=A)).status_code >= 400)

        # ── 2.4 승계 ────────────────────────────────────────
        await claim(A, PK2, mid)
        await c.patch("/listings/biz", headers=A, json={"building_pk": PK2, "fields": {"status": "협의중"}})
        await c.delete(f"/team/members/{mid}", headers=A)
        row = (await c.get(f"/listings/{PK2}", headers=A)).json()
        chk("S1", "제외 시 대표에게 귀속", row.get("assignee_account_id") == aid,
            f"assignee={row.get('assignee_account_id')} (대표={aid})")
        chk("S3", "승계 후 진행상태 유지", row.get("status") == "협의중", f"status={row.get('status')}")

        # ── 2.5 영업(S04) ───────────────────────────────────
        bid = (await c.post("/buyers", headers=A, json={"name": "매수자X", "phone": "010-9999-8888"})).json()["id"]
        seen = (await c.get("/buyers", headers=M2)).json()
        chk("B1", "팀원이 팀 매수자 조회", any(x["id"] == bid for x in seen))
        upd = await c.patch(f"/buyers/{bid}", headers=M2, json={"name": "고침"})
        chk("B1b", "팀원이 팀 매수자 수정(팀 공유 정책)", upd.status_code == 200, f"status={upd.status_code}")

    ng = [x for x in R if not x[2]]
    print(f"\n통과 {len(R)-len(ng)} / 실패 {len(ng)}\n")
    for no, name, ok, detail in R:
        print(f"  {'OK  ' if ok else 'FAIL'} {no:<5} {name}{'  — ' + detail if detail and not ok else ''}")

asyncio.run(main())
