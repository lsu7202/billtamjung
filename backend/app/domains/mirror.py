"""거울 — 한 사건이 여러 자리에 서고, 원본이 사라지면 같이 걷히는 규칙 전부.

왜 한 모듈인가(2026-08-14 밤 QA): 거울 로직이 여섯 군데 흩어져 있었고, 사람-장부의
일정 생성은 인라인 복제라 규칙이 갈라졌다. 그래서 참석자 거울이 고아로 남고(H1),
완료를 되돌려도 「완료」 로그가 남고(H2), 제안을 지워도 일정이 유령으로 남았다(H4).
같은 동사는 한 곳에만 있어야 한다 — 여기가 그곳이다.

동사 목록:
  일정   schedule_create · schedule_retract · schedule_log · schedule_set_state
         attendees_sync · apply_sched_op
  체결   mirror_to_listing · mirror_to_proposal   (계약·계약파기 — 한 사건의 양면)
  가격   overlays_write(스냅샷) · overlays_restore · proposal_prices_prev/restore

원칙:
  **매수 쪽 장부는 접촉 장부다**(0141). 예전엔 짝마다 커밋 장부(proposal_events)가 따로
  있었는데, 같은 사건이 두 장부에 서면 「어느 쪽이 사실인가」가 생긴다. 장부는 하나다,
  app.contacts. 매도는 target_type='listing', 매수는 'buyer'.

  **상태는 저장하지 않는다**(0141·0142). 매물도 짝도 상태 칸이 없다. 지금 어디까지 왔나는
  사실에서 판다(v_listing_stage · app.nego_rank). 거울이 옮기는 것은 **사실**이지 낱말이 아니다:
  계약이면 picked_at, 계약파기면 dropped_at.

  · 거울로 태어난 줄은 원본을 기억한다(src_schedule_id·0079) — 기억해야 걷는다.
  · 되돌리기는 반쪽이 없다 — 상태·일정·거울·가격이 함께 돌아온다.
  · 자동(auto) 줄은 다시 전파를 낳지 않는다.
"""
import datetime as dt
import json

from ..core.db import pool


def iso_date(v: str | None) -> dt.date | None:
    return dt.date.fromisoformat(v[:10]) if v else None


def iso_time(v: str | None) -> dt.time | None:
    """HH:MM → time. 안 말한 시각은 그대로 비워 둔다 — 채우면 없던 약속이 생긴다."""
    return dt.time.fromisoformat(v[:5]) if v else None


def has_money(note: str | None) -> bool:
    """문장에 금액이 적혀 있나 — 「148억」·「1억5000」. 가격을 옮긴 커밋은 일정만 지울 때
    같이 지우면 안 된다(그 값의 근거가 이 문장뿐이다)."""
    import re
    return bool(note and re.search(r"[\d.,]+\s*(?:조|억|만|천)", note))


# ══════════════════ 일정 — 커밋의 파생물 ══════════════════

async def resolve_anchor(team_id: int, buyers: set[int], owners: set[int]
                         ) -> tuple[str | None, int | None]:
    """참석자들이 매물을 하나로 가리키는가 — 그러면 그 매물이 약속의 자리다.

    사람 장부에서 「계약서 쓰기로」라고 적어도, 매수자와 매도자가 같이 온다면 그건
    특정 매물의 일이다(2026-08-15 신고: 매물에 안 떠서 아무도 못 찾는다).
    매도자들의 매물 ∩ 매수자들의 살아있는 짝의 매물이 **정확히 하나**로 모일 때만 —
    애매하면 사람 약속으로 남는다(추측이 틀린 자리에 서는 것보다 낫다).
    """
    own = buy = None
    prows: list = []
    if owners:
        own = {r["building_pk"] for r in await pool().fetch(
            "SELECT building_pk FROM app.listings WHERE team_id=$1 AND owner_id = ANY($2::bigint[])",
            team_id, list(owners))}
    if buyers:
        prows = await pool().fetch(
            """SELECT id, building_pk FROM app.proposals
                WHERE team_id=$1 AND buyer_id = ANY($2::bigint[])
                  AND dropped_at IS NULL""", team_id, list(buyers))
        buy = {r["building_pk"] for r in prows}
    cands = (own & buy) if own is not None and buy is not None else (own or buy)
    if not cands or len(cands) != 1:
        return None, None
    bld = next(iter(cands))
    pids = [r["id"] for r in prows if r["building_pk"] == bld]
    return bld, (pids[0] if len(pids) == 1 else None)

# 계약금 일부(옛 「가계약」, 0158) — 계약 전에 대금 일부가 먼저 움직이는 날. 임장은 고르는 종류에서
# 빠졌지만(일반으로 본다) 이미 그 종류로 선 일정이 있어 목록에는 남는다.
SCHED_CATEGORIES = ("일반", "브리핑", "임장", "계약금 일부", "계약", "중도금", "잔금")


def guess_category(title: str | None) -> str:
    """일정 종류의 **기본값** 추정(0088) — 제목에서. 파서는 편의 기능이고 정본은 모달의
    토글이다. 저장된 뒤엔 category 만 본다. 돈이 오가는 날은 캘린더에서 색으로 갈린다."""
    t = title or ""
    if "브리핑" in t:
        return "브리핑"
    if "임장" in t or "보러" in t:
        return "임장"
    if t.startswith("잔금"):
        return "잔금"
    if t.startswith("중도금"):
        return "중도금"
    if t.startswith("계약") and "파기" not in t:
        return "계약"
    return "일반"


def is_contract_title(title: str | None) -> bool:
    """예전 이름 — 계약 일정인가(호출부 호환)"""
    return guess_category(title) == "계약"


def mirror_skips(*, building_pk: str | None, proposal_id: int | None,
                 person: tuple[str, int] | None) -> tuple[bool, bool]:
    """참석자 거울에서 거를 쪽 — **원문이 이미 서 있는 자리**만 거른다.

    제안 장부(매수자 매물탭)에서 난 약속이라고 매도자 거울까지 거르면, 매도자는
    자기가 가는 계약 약속을 아무 데서도 못 본다(2026-08-15 신고). 원문 반대편은 받아야 한다.
      · 사람 장부 원문 → 본인은 skip_person 이 거르고, 매물 닻이 있으면 매물 줄이 매도 쪽
      · 제안 장부 원문 → 매수자만 거른다(그의 매물탭에 문장이 있다)
      · 매물 장부 원문 → 매도자만 거른다(합본·매도 매물탭에 문장이 있다)
    """
    if person is not None:
        return False, building_pk is not None
    if proposal_id is not None:
        return True, False
    return False, building_pk is not None


async def attendees_sync(team_id: int, sid: int, actor: int, people, *,
                         on: dt.date | None, at: str | None, title: str, place: str | None,
                         skip_buyer_side: bool, skip_owner_side: bool,
                         skip_person: tuple[str, int] | None = None,
                         building_pk: str | None = None) -> None:
    """참석자 명단을 통째로 맞춘다 — 생성이든 편집이든 같은 길.

    거울 규칙: 우리 장부에 있는 사람(buyer/owner)이 **커밋이 난 자리의 상대가 아니면**
    그 사람 장부에도 자동 한 줄이 선다(그 사람 화면에서도 약속이 보여야 한다).
    사람 장부에서 난 커밋이면 그 사람 자신(skip_person)도 자리의 상대다 —
    안 거르면 본인 장부에 문장 밑에 같은 약속이 한 줄 더 선다.
    줄은 src_schedule_id 로 원본을 기억한다 — 일정이 사라지면 같이 걷힌다(0079).
    """
    await pool().execute("DELETE FROM app.schedule_people WHERE schedule_id=$1", sid)
    await pool().execute(
        "DELETE FROM app.contacts WHERE team_id=$1 AND src_schedule_id=$2 AND auto",
        team_id, sid)
    when = (f"{on:%-m/%-d}" if on else "") + (f" {at}" if at else "")
    for pn in people:
        kind = pn["kind"] if isinstance(pn, dict) else pn.kind
        ref_id = pn.get("ref_id") if isinstance(pn, dict) else pn.ref_id
        label = pn.get("label") if isinstance(pn, dict) else pn.label
        phone = pn.get("phone") if isinstance(pn, dict) else pn.phone
        await pool().execute(
            """INSERT INTO app.schedule_people(schedule_id, ref_kind, ref_id, label, phone)
               VALUES($1,$2,$3,$4,$5)""",
            sid, kind, ref_id if kind != "guest" else None, label, phone)
        same_side = ((kind == "buyer" and skip_buyer_side)
                     or (kind == "owner" and skip_owner_side)
                     or (skip_person is not None and ref_id is not None
                         and (kind, int(ref_id)) == (skip_person[0], int(skip_person[1]))))
        if kind != "guest" and ref_id and not same_side:
            line = f"{when} {title}".strip() + (f" · {place}" if place else "")
            # 참석자 거울은 **그 사람의 장부**로 간다(0141). 예전엔 매수자만 짝 장부로 갈라져
            # 나갔는데, 그러다 보니 같은 약속이 사람마다 다른 표에 앉았다.
            await pool().execute(
                """INSERT INTO app.contacts(team_id, target_type, target_id, note,
                                            created_by, auto, src_schedule_id)
                   VALUES($1,$2,$3,$4,$5,true,$6)""",
                team_id, kind, str(ref_id), line, actor, sid)


async def schedule_create(team_id: int, side: str, sch, actor: int, *,
                          building_pk: str | None = None,
                          contact_id: int | None = None,
                          proposal_id: int | None = None,
                          person: tuple[str, int] | None = None,
                          state: str = "예정",
                          category: str | None = None) -> int:
    """일정은 커밋의 파생물 — 커밋과 같이 태어나고, 커밋이 지워지면 같이 걷힌다.

    참석자는 셋 중 하나로 정해진다(전부 이 한 함수 — 인라인 복제가 H1 을 낳았다):
      ① 사람이 창에서 고른 명단(sch.people)
      ② 커밋이 난 자리의 상대 — 제안이면 그 매수자, 매물이면 그 매도자
      ③ 사람 장부면 그 사람(person)
    """
    cat = category or getattr(sch, "category", None) or guess_category(sch.title)
    if cat not in SCHED_CATEGORIES:
        cat = "일반"
    sid = await pool().fetchval(
        """INSERT INTO app.schedules(team_id, side, contact_id, proposal_id,
                                     building_pk, title, on_date, at_time, place, hint, state,
                                     assignee_account_id, contract, category, method, amount)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id""",
        team_id, side, contact_id, proposal_id, building_pk,
        sch.title, iso_date(sch.on), iso_time(sch.at), sch.place, sch.hint, state,
        getattr(sch, "assignee_account_id", None) or actor, cat == "계약", cat,
        getattr(sch, "method", None), getattr(sch, "amount", None))

    people = getattr(sch, "people", None)
    if people:
        skip_buyer, skip_owner = mirror_skips(
            building_pk=building_pk, proposal_id=proposal_id, person=person)
        await attendees_sync(
            team_id, sid, actor, people,
            on=iso_date(sch.on), at=sch.at, title=sch.title, place=sch.place,
            skip_buyer_side=skip_buyer, skip_owner_side=skip_owner,
            skip_person=person, building_pk=building_pk)
    elif proposal_id:
        await pool().execute(
            """INSERT INTO app.schedule_people(schedule_id, ref_kind, ref_id)
               SELECT $1, 'buyer', p.buyer_id FROM app.proposals p WHERE p.id=$2""",
            sid, proposal_id)
    elif building_pk:
        await pool().execute(
            """INSERT INTO app.schedule_people(schedule_id, ref_kind, ref_id)
               SELECT $1, 'owner', l.owner_id FROM app.listings l
                WHERE l.building_pk=$2 AND l.team_id=$3 AND l.owner_id IS NOT NULL""",
            sid, building_pk, team_id)
    elif person:
        await pool().execute(
            """INSERT INTO app.schedule_people(schedule_id, ref_kind, ref_id)
               VALUES($1,$2,$3)""", sid, person[0], person[1])
    # 사람 장부에서 태어났는데 매물이 닻으로 잡혔다 — 매물 장부에도 같은 줄이 선다.
    # 화면 표시는 전부 일정 id 에서 파생하므로 「일정이름 · 시간 · 내용」 한 구조다.
    # src_schedule_id 로 일정과 함께 걷힌다.
    if person and building_pk:
        when = (f"{iso_date(sch.on):%-m/%-d}" if sch.on else "") + (f" {sch.at}" if sch.at else "")
        line = f"{when} {sch.title}".strip() + (f" · {sch.place}" if sch.place else "")
        await pool().execute(
            """INSERT INTO app.contacts(team_id, target_type, target_id, note,
                                        created_by, auto, src_schedule_id)
               VALUES($1,'listing',$2,$3,$4,true,$5)""",
            team_id, building_pk, line, actor, sid)
    return sid


async def schedule_retract(team_id: int, *, contact_id: int | None = None,
                           schedule_id: int | None = None,
                           proposal_id: int | None = None) -> None:
    """일정과 그 일정이 낳은 거울 줄(참석자 줄·상태 로그)을 함께 걷는다.

    어느 열쇠로 오든 길은 하나다 — 원본 줄 삭제(contact), 캘린더 삭제(schedule),
    짝 삭제(proposal). H1·H4 는 이 함수가 없어서 생겼다.
    """
    sids = [r["id"] for r in await pool().fetch(
        """SELECT id FROM app.schedules
            WHERE team_id=$1 AND (
              ($2::bigint IS NOT NULL AND contact_id=$2) OR
              ($3::bigint IS NOT NULL AND id=$3) OR
              ($4::bigint IS NOT NULL AND proposal_id=$4))""",
        team_id, contact_id, schedule_id, proposal_id)]
    if not sids:
        return
    gone_c = await pool().fetch(
        """DELETE FROM app.contacts
            WHERE team_id=$1 AND src_schedule_id = ANY($2::bigint[]) AND auto
            RETURNING status, target_type, target_id""", team_id, sids)
    await pool().execute(
        "DELETE FROM app.schedules WHERE team_id=$1 AND id = ANY($2::bigint[])", team_id, sids)

    # **지운 일정이 사실을 실어 나르고 있었다면 그 사실도 함께 걷는다**(2026-08-19).
    #   계약 일정의 ✓ 는 곧 계약 체결이다 — 그 일정을 지우면 계약도 없던 일이 되어야 한다.
    #   진짜 이뤄진 계약이라면 지울 일이 없다. 지운다는 건 시험 삼아 만들었거나 잘못 만든
    #   것이라는 뜻인데, 그게 「계약된 매물」로 남으면 그 뒤 모든 화면이 거짓말을 한다.
    #   (되돌리기 ✓ 해제와 같은 길 — schedule_set_state 가 하던 일을 삭제에도 붙였다.)


async def schedule_log(team_id: int, sch, actor: int, text: str) -> None:
    """캘린더에서 손댄 일을 **장부에도 적는다**. 장부가 정본이라는 규칙은 일정에도 그대로다.
    줄은 src_schedule_id 를 기억한다 — 되돌리면(예정 복귀) 이 로그도 걷을 수 있어야 한다."""
    if sch["side"] == "buy" and sch["proposal_id"]:
        # 짝의 일은 그 **매수자**의 장부에 적는다(0141) — 짝마다 따로 장부를 두지 않는다
        await pool().execute(
            """INSERT INTO app.contacts(team_id, target_type, target_id, note,
                                        created_by, auto, src_schedule_id)
               SELECT $1, 'buyer', p.buyer_id::text, $3, $4, true, $5
                 FROM app.proposals p WHERE p.id = $2""",
            team_id, sch["proposal_id"], text, actor, sch["id"])
    elif sch["building_pk"]:
        await pool().execute(
            """INSERT INTO app.contacts(team_id, target_type, target_id, note,
                                        created_by, auto, src_schedule_id)
               VALUES($1, 'listing', $2, $3, $4, true, $5)""",
            team_id, sch["building_pk"], text, actor, sch["id"])
    else:
        # 매물 없는 약속(0076) — 붙은 사람의 장부로. 아무도 없으면 적을 자리가 없다.
        who = await pool().fetchrow(
            """SELECT ref_kind, ref_id FROM app.schedule_people
                WHERE schedule_id=$1 AND ref_kind IN ('buyer','owner') AND ref_id IS NOT NULL
                ORDER BY id LIMIT 1""", sch["id"])
        if who:
            await pool().execute(
                """INSERT INTO app.contacts(team_id, target_type, target_id, note,
                                            created_by, auto, src_schedule_id)
                   VALUES($1, $2, $3, $4, $5, true, $6)""",
                team_id, who["ref_kind"], str(who["ref_id"]), text, actor, sch["id"])


async def schedule_set_state(team_id: int, sch, actor: int, state: str) -> None:
    """완료 ↔ 예정. 예정으로 **되돌리면** 이 일정이 낳은 것을 걷는다(H2) —
    「완료」라고 적힌 채 예정으로 서 있으면 장부가 거짓말을 한다.
    이동 로그(「…로 미룸」)는 남긴다 — 그건 여전히 일어난 일이다.

    **계약일정의 완료 = 계약 체결이다**(2026-08-15). 계약일을 잡아 뒀다가 그 날이 끝나면
    캘린더의 ✓ 하나로 자연스럽게 이어진다: 상태가 계약이 되고, 반대편 장부에 거울이 서고,
    표는 사건으로 승격된다 — 바에 「계약 완료」라고 친 것과 완전히 같은 길.
    체크를 풀면 전부 되감긴다(상태·거울·승격)."""
    await pool().execute(
        "UPDATE app.schedules SET state=$3 WHERE id=$1 AND team_id=$2",
        sch["id"], team_id, state)
    if state == "예정":
        # 이 일정이 낳은 완료 로그(계약 커밋 포함)를 걷는다 — 거울은 링크로 함께.
        # 걷는 것: 완료 로그 + 상태(계약)가 실린 줄. 참석자 거울·이동 로그는 남는다.
        crows = await pool().fetch(
            """DELETE FROM app.contacts
                WHERE team_id=$1 AND src_schedule_id=$2 AND auto
                  AND (status IS NOT NULL OR note LIKE '%완료%')
                RETURNING id, status""", team_id, sch["id"])
        # 계약 일정을 되돌리면 **상대 확정도 함께 풀린다**(0141) — 예전엔 짝 장부의
        # status='계약' 을 지워 파생시켰는데, 이제 사실이 picked_at 하나라 직접 푼다.
        #
        # 매물 쪽에서 잡은 계약 일정은 proposal_id 가 비어 있다(거울이 짝을 찾아 갔다).
        # 그때는 **그 매물의 짝 전부**를 되돌린다 — 세운 길과 같은 길로 걷어야 한다.
        if sch["category"] == "계약":
            if sch["proposal_id"]:
                await pool().execute(
                    """UPDATE app.proposals SET picked_at=NULL, updated_at=now()
                        WHERE id=$1 AND team_id=$2""", sch["proposal_id"], team_id)
            elif sch["building_pk"]:
                await pool().execute(
                    """UPDATE app.proposals SET picked_at=NULL, updated_at=now()
                        WHERE team_id=$1 AND building_pk=$2 AND picked_at IS NOT NULL""",
                    team_id, sch["building_pk"])
        if crows:
            # 걷힌 로그가 완료시켰던 표면 예정으로 되돌린다
            await pool().execute(
                """UPDATE app.schedules SET state='예정', promoted_by_contact_id=NULL
                     WHERE team_id=$1 AND id=$2
                       AND promoted_by_contact_id = ANY($3::bigint[])""",
                team_id, sch["id"], [r["id"] for r in crows])
        return
    # ── 완료 ──
    contract = sch["category"] == "계약"
    text = (_event_line(sch["id"], "계약", "계약 체결")
            if contract and (sch["proposal_id"] or sch["building_pk"])
            else f"{sch['on_date']:%-m/%-d} {sch['title']} {state}")
    if contract and sch["proposal_id"]:
        # 계약 체결 = 상대 확정(picked_at). 이게 nego_rank 4 를 세운다(0138·0141).
        await pool().execute(
            """UPDATE app.proposals SET picked_at=COALESCE(picked_at, now()), updated_at=now()
                WHERE id=$1 AND team_id=$2""", sch["proposal_id"], team_id)
        await pool().execute(
            """INSERT INTO app.contacts(team_id, target_type, target_id, note,
                                        created_by, auto, src_schedule_id)
               SELECT $1, 'buyer', p.buyer_id::text, $3, $4, true, $5
                 FROM app.proposals p WHERE p.id = $2""",
            team_id, sch["proposal_id"], text, actor, sch["id"])
        await mirror_to_listing(team_id, sch["proposal_id"], "계약", actor, evt_sid=sch["id"])
    elif contract and sch["building_pk"]:
        cid = await pool().fetchval(
            """INSERT INTO app.contacts(team_id, target_type, target_id, status, note,
                                        created_by, auto, src_schedule_id)
               VALUES($1,'listing',$2,'계약',$3,$4,true,$5) RETURNING id""",
            team_id, sch["building_pk"], text, actor, sch["id"])
        # 매물 행이 없으면 만든다(계약이 됐다는 건 우리 매물이라는 뜻) — mirror_to_listing 과 같은 길
        await pool().execute(
            """INSERT INTO app.listings(building_pk, team_id) VALUES($1,$2)
               ON CONFLICT (building_pk, team_id) DO NOTHING""",
            sch["building_pk"], team_id)
        await mirror_to_proposal(team_id, sch["building_pk"], "계약", actor,
                                 evt_sid=sch["id"])
        await pool().execute(
            "UPDATE app.schedules SET promoted_by_contact_id=$3 WHERE id=$1 AND team_id=$2",
            sch["id"], team_id, cid)
    else:
        await schedule_log(team_id, sch, actor, text)


async def apply_sched_op(team_id: int, building_pk: str | None, op, new_on: dt.date | None,
                         side: str, proposal_id: int | None = None) -> None:
    """장부에 쓴 말이 캘린더를 움직인다 — 「브리핑 다음주로 미룸」·「3시로」·「잘 마쳤습니다」.

    어느 약속인지: ① 자기 장부의 것 ② 제목이 같은 것 ③ 가장 가까운 예정.
    취소는 일정을 **걷는다**(0074) — 거울 줄까지 함께(schedule_retract)."""
    row = await pool().fetchrow(
        """SELECT id, on_date, title FROM app.schedules
            WHERE team_id=$1 AND building_pk IS NOT DISTINCT FROM $2
              AND state='예정'
            ORDER BY (proposal_id IS NOT DISTINCT FROM $4 AND $4 IS NOT NULL) DESC,
                     (side = $5) DESC,
                     (title = COALESCE($3, title)) DESC,
                     on_date LIMIT 1""",
        team_id, building_pk, op.title, proposal_id, side)
    if row is None:
        return
    if op.op == "move" and (new_on or op.at):
        if new_on:
            await pool().execute(
                """UPDATE app.schedules SET on_date=$2, moved_from=COALESCE(moved_from, on_date)
                    WHERE id=$1""", row["id"], new_on)
        if op.at:
            await pool().execute("UPDATE app.schedules SET at_time=$2 WHERE id=$1",
                                 row["id"], iso_time(op.at))
    elif op.op == "done":
        await pool().execute("UPDATE app.schedules SET state='완료' WHERE id=$1", row["id"])
    elif op.op == "cancel":
        await schedule_retract(team_id, schedule_id=row["id"])


# ══════════════════ 체결 거울 — 계약·계약파기 ══════════════════

async def _attend(sid: int, kind: str, ref_id: int) -> None:
    """계약 표에 상대를 앉힌다 — 계약 날엔 매도자와 매수자가 **같은 한 줄**에 온다.
    직접 삽입이라 참석자 거울(장부 자동 줄)은 안 낳는다 — 체결 거울이 이미 그 일을 한다."""
    await pool().execute(
        """INSERT INTO app.schedule_people(schedule_id, ref_kind, ref_id)
           SELECT $1, $2, $3 WHERE NOT EXISTS (
             SELECT 1 FROM app.schedule_people
              WHERE schedule_id=$1 AND ref_kind=$2 AND ref_id=$3)""", sid, kind, ref_id)


class _SchedStub:
    """ScheduleIn 없이 mirror 가 자체로 표를 세울 때 쓰는 최소 모양(순환 임포트 회피)."""
    def __init__(self, title: str, on: str):
        self.title, self.on = title, on
        self.at = self.place = self.hint = self.people = self.assignee_account_id = None


async def event_mark(team_id: int, side: str, status: str, day: dt.date, actor: int, *,
                     building_pk: str | None = None, proposal_id: int | None = None,
                     contact_id: int | None = None,
                     own_sid: int | None = None, explicit_day: bool = False) -> int:
    """계약·계약파기의 캘린더 표 — **한 사건 = 한 표**.

    일정은 종류(일반·계약·중도금·잔금)와 완료 여부뿐이다(0089). 장부에 「계약 체결」이라
    적으면 그 날짜에 **계약 종류 · 완료** 일정이 선다 — 일정 창으로 만든 것과 똑같은 표다.

    「계약일」이라고 잡아 뒀는데 계약을 적으면 표가 둘 서면 안 된다 — 하루에 한 자리다:
      ① 이 문장이 품은 약속(own_sid) — 그것을 완료로. 이름도 사람이 붙인 것 유지.
      ② 계약이면, 그 자리에 잡혀 있던 「계약」 예정 일정이 정확히 하나일 때 그것을 완료로.
         날짜를 명시했으면 그날 것만 본다. 날짜 없이 「계약 체결」만 적었으면 날짜가 달라도
         잡고 **약속의 날을 그대로 둔다** — 계약은 계약일에 한 것이고, 적은 날은 적은 날이다.
      ③ 없으면 새 표(제목 = 상태 · 종류 = 계약이면 계약, 파기면 일반 · 완료).
    어느 커밋이 완료시켰는지는 promoted_by(0082)가 기억한다 — 그 커밋을 지우면 예정으로.
    """
    if own_sid is None and status == "계약":
        own_sid = await pool().fetchval(
            """SELECT min(id) FROM app.schedules
                WHERE team_id=$1 AND state='예정' AND category='계약'
                  AND building_pk IS NOT DISTINCT FROM $2
                  AND ($3::bigint IS NULL OR proposal_id IS NOT DISTINCT FROM $3)
                  AND ($5 IS FALSE OR on_date = $4)
                HAVING count(*) = 1""",
            team_id, building_pk, proposal_id, day, explicit_day)
        if own_sid is not None:
            await pool().execute(
                """UPDATE app.schedules SET state='완료', promoted_by_contact_id=$3
                     WHERE id=$1 AND team_id=$2""",
                own_sid, team_id, contact_id)
            return own_sid
    elif own_sid is not None:
        # 같은 문장의 약속 — 이미 이 커밋의 것이라 promoted_by 없이도 함께 걷힌다
        await pool().execute(
            "UPDATE app.schedules SET state='완료', category=$3 WHERE id=$1 AND team_id=$2",
            own_sid, team_id, "계약" if status == "계약" else "일반")
        return own_sid
    return await schedule_create(
        team_id, side, _SchedStub(title=status, on=day.isoformat()), actor,
        building_pk=building_pk, contact_id=contact_id,
        proposal_id=proposal_id, state="완료",
        category="계약" if status == "계약" else "일반")


async def event_unmark(team_id: int, *, contact_id: int) -> None:
    """계약 줄이 지워졌다 — 그 줄이 **완료**시킨 일정을 예정으로 되돌린다(0082 링크).
    줄이 직접 낳은 표는 retract 가 지운다. 참석자는 그대로 둔다 —
    계약이 무효여도 그 자리에 간 것은 사실이다."""
    await pool().execute(
        """UPDATE app.schedules SET state='예정', promoted_by_contact_id=NULL
             WHERE team_id=$1 AND promoted_by_contact_id=$2""", team_id, contact_id)


def _event_line(evt_sid: int | None, status: str, fallback: str) -> str:
    """체결 거울 줄의 문구 — 공동 일정이 있으면 중립으로 쓴다(「계약 체결」).
    「매도자 쪽 계약」처럼 한쪽을 주어로 세우면, 매수자·매도자가 같이 가는 사건이
    한쪽 것처럼 읽힌다(2026-08-15 신고). 표 이름·시간은 화면이 일정 id 에서 파생해 붙인다.
    표가 없을 때만 어느 쪽에서 온 사실인지를 쓴다."""
    if evt_sid:
        return "계약 체결" if status == "계약" else status
    return fallback


async def mirror_to_listing(team_id: int, pid: int, status: str, by: int,
                            deal: int | None = None, *,
                            evt_sid: int | None = None) -> None:
    """매수 장부 → 매도 장부. 계약/계약파기만. 계약이면 거래가도 함께 적는다.
    거울 줄은 사건 표를 기억한다 — 같은 표, 같은 사건."""
    row = await pool().fetchrow(
        """SELECT p.building_pk, y.name AS buyer FROM app.proposals p
           JOIN app.buyers y ON y.id = p.buyer_id
           WHERE p.id=$1 AND p.team_id=$2""", pid, team_id)
    if not row:
        return
    pk = row["building_pk"]
    # 매물엔 낱말을 안 적는다(0142) — 계약됐다는 사실은 짝이 들고 있고(picked_at),
    # 매물 화면은 그걸 파생해 읽는다. 여기서 하는 일은 **행이 있게** 하는 것뿐이다.
    await pool().execute(
        """INSERT INTO app.listings(building_pk, team_id) VALUES($1,$2)
           ON CONFLICT (building_pk, team_id) DO NOTHING""", pk, team_id)
    line = _event_line(evt_sid, status, f"매수자 {row['buyer']} 쪽 {status}")
    await pool().execute(
        """INSERT INTO app.contacts(team_id, target_type, target_id, note, status, created_by,
                                    auto, src_schedule_id)
           VALUES($1,'listing',$2,$3,$4,$5,true,$6)""",
        team_id, pk, line + (f" · {deal // 10**8}억" if deal else ""), status, by, evt_sid)
    if evt_sid:
        owner = await pool().fetchval(
            "SELECT owner_id FROM app.listings WHERE building_pk=$1 AND team_id=$2", pk, team_id)
        if owner:
            await _attend(evt_sid, "owner", owner)


async def mirror_to_proposal(team_id: int, pk: str, status: str, by: int,
                             deal: int | None = None, *,
                             evt_sid: int | None = None) -> str | None:
    """매도 장부 → 매수 장부. 어느 매수자와의 계약인지가 하나로 정해질 때만.
    거울 줄은 사건 표(evt_sid)를 기억하고, 그 표에 매수자를 앉힌다."""
    rows = await pool().fetch(
        """SELECT p.id, p.buyer_id, y.name FROM app.proposals p
           JOIN app.buyers y ON y.id = p.buyer_id AND y.deleted_at IS NULL
           WHERE p.team_id=$1 AND p.building_pk=$2 AND p.dropped_at IS NULL""",
        team_id, pk)
    if len(rows) != 1:
        return None
    pid = rows[0]["id"]
    line = _event_line(evt_sid, status, f"매도자 쪽 {status}")
    await pool().execute(
        """INSERT INTO app.contacts(team_id, target_type, target_id, note, status, created_by,
                                    auto, src_schedule_id)
           VALUES($1,'buyer',$2,$3,$4,$5,true,$6)""",
        team_id, str(rows[0]["buyer_id"]), line + (f" · {deal // 10**8}억" if deal else ""),
        status, by, evt_sid)
    # 짝 쪽 사실은 칸 두 개다(0141): 계약이면 상대 확정, 계약파기면 죽음.
    await pool().execute(
        """UPDATE app.proposals SET
             picked_at  = CASE WHEN $3='계약' THEN COALESCE(picked_at, now()) ELSE picked_at END,
             dropped_at = CASE WHEN $3='계약파기' THEN now() ELSE dropped_at END,
             deal_price = COALESCE($4::bigint, deal_price), updated_at=now()
           WHERE id=$1 AND team_id=$2""", pid, team_id, status, deal)
    if evt_sid:
        # **그 표는 이 짝의 것이다**(0142). 매물 쪽에서 잡은 계약 일정은 proposal_id 가 비어
        # 있는데, 그러면 사다리(v_listing_stage.s6_match)도 nego_rank 4(계약완료)도 이 일정을
        # 못 본다 — 계약이 끝났는데 화면은 「계약예정」에 멈춰 선다.
        # 어느 짝인지가 방금 하나로 정해졌으니 표에도 그 짝을 박는다.
        await pool().execute(
            """UPDATE app.schedules SET proposal_id=$3
                WHERE id=$1 AND team_id=$2 AND proposal_id IS NULL""",
            evt_sid, team_id, pid)
        await _attend(evt_sid, "buyer", rows[0]["buyer_id"])
    return rows[0]["name"]

# ══════════════════ 가격 — 스냅샷과 복원(0078) ══════════════════

async def overlays_write(team_id: int, pk: str, changes: dict[str, int | None],
                         actor: int) -> str | None:
    """오버레이 가격을 쓰기 전에 **덮이는 값**을 뜬다. 돌려줄 prev(json) 를 함께 싣는다."""
    prev: dict = {}
    for field, v in changes.items():
        if v is None:
            continue
        old = await pool().fetchval(
            """SELECT value FROM app.overlays
                WHERE team_id=$1 AND target_type='building' AND target_id=$2 AND field=$3""",
            team_id, pk, field)
        prev[field] = old
        await pool().execute(
            """INSERT INTO app.overlays(team_id,target_type,target_id,field,value,updated_by)
               VALUES($1,'building',$2,$3,$4,$5)
               ON CONFLICT (team_id,target_type,target_id,field)
               DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()""",
            team_id, pk, field, str(int(v)), actor)
    return json.dumps(prev) if prev else None


async def overlays_restore(team_id: int, pk: str, prev_json: str, actor: int) -> None:
    """덮었던 가격을 되돌린다 — null 은 「오버레이가 없었다」는 뜻이라 지운다."""
    for field, old in json.loads(prev_json).items():
        if old is None:
            await pool().execute(
                """DELETE FROM app.overlays
                    WHERE team_id=$1 AND target_type='building' AND target_id=$2 AND field=$3""",
                team_id, pk, field)
        else:
            await pool().execute(
                """INSERT INTO app.overlays(team_id,target_type,target_id,field,value,updated_by)
                   VALUES($1,'building',$2,$3,$4,$5)
                   ON CONFLICT (team_id,target_type,target_id,field)
                   DO UPDATE SET value=EXCLUDED.value, updated_at=now()""",
                team_id, pk, field, old, actor)


async def proposal_prices_prev(team_id: int, pid: int, hope: int | None,
                               deal: int | None) -> str | None:
    """짝의 hope/deal 을 덮기 전에 이전 값을 뜬다 — prev(json) 에 실어 되돌린다."""
    old = await pool().fetchrow(
        "SELECT hope_price, deal_price FROM app.proposals WHERE id=$1 AND team_id=$2",
        pid, team_id)
    prev: dict = {}
    if old is not None:
        if hope is not None and hope != old["hope_price"]:
            prev["hope_price"] = old["hope_price"]
        if deal is not None and deal != old["deal_price"]:
            prev["deal_price"] = old["deal_price"]
    return json.dumps(prev) if prev else None


async def proposal_prices_restore(team_id: int, pid: int, prev_json: str) -> None:
    pv = json.loads(prev_json)
    await pool().execute(
        """UPDATE app.proposals SET
             hope_price = CASE WHEN $3 THEN $4 ELSE hope_price END,
             deal_price = CASE WHEN $5 THEN $6 ELSE deal_price END
           WHERE id=$1 AND team_id=$2""",
        pid, team_id,
        "hope_price" in pv, pv.get("hope_price"),
        "deal_price" in pv, pv.get("deal_price"))
