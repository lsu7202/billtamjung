"""거울 — 한 사건이 여러 자리에 서고, 원본이 사라지면 같이 걷히는 규칙 전부.

왜 한 모듈인가(2026-08-14 밤 QA): 거울 로직이 여섯 군데 흩어져 있었고, 사람-장부의
일정 생성은 인라인 복제라 규칙이 갈라졌다. 그래서 참석자 거울이 고아로 남고(H1),
완료를 되돌려도 「완료」 로그가 남고(H2), 제안을 지워도 일정이 유령으로 남았다(H4).
같은 동사는 한 곳에만 있어야 한다 — 여기가 그곳이다.

동사 목록:
  일정   schedule_create · schedule_retract · schedule_log · schedule_set_state
         attendees_sync · apply_sched_op
         **일정은 매물 · 짝에 영향을 주지 않는다**(0222) — 매물 장부 줄 · 계약 체결 · 짝 칸으로 안 넘어간다.
         계약일 · 중도금 · 잔금일은 짝 칸이다. 사람 장부(참석자 줄 · 완료 로그)만 남는다
  체결   mirror_to_listing · mirror_to_proposal   (계약·계약파기 — 한 사건의 양면)
  값     listing_values_write(매매가·희망가, 스냅샷) · listing_values_restore · listing_values_fold(층별 합계)
         proposal_prices_prev/restore

원칙:
  **매수 쪽 장부는 접촉 장부다**(0141). 예전엔 짝마다 커밋 장부(proposal_events)가 따로
  있었는데, 같은 사건이 두 장부에 서면 「어느 쪽이 사실인가」가 생긴다. 장부는 하나다,
  app.contacts. 매도는 target_type='listing', 매수는 'buyer'.

  **상태는 사람이 고른다**(0199). 자동 판정 엔진(사다리 뷰 · nego_rank)은 걷었다.
  거울은 장부 줄 · 참석자 · 거래가만 옮기고, 채택(picked_at) · 안 산다(dropped_at) · 상태는 켜지 않는다.

  · 거울로 태어난 줄은 원본을 기억한다(src_schedule_id·0079) — 기억해야 걷는다.
  · 되돌리기는 반쪽이 없다 — 상태·일정·거울·가격이 함께 돌아온다.
  · 자동(auto) 줄은 다시 전파를 낳지 않는다.
"""
import datetime as dt
import json

from .listing_core import need_listing
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




def mirror_skips(*, listing_id: int | None, proposal_id: int | None,
                 person: tuple[str, int] | None) -> tuple[bool, bool]:
    """참석자 거울에서 거를 쪽 — **원문이 이미 서 있는 자리**만 거른다.

    제안 장부(매수자 매물탭)에서 난 약속이라고 매도자 거울까지 거르면, 매도자는
    자기가 가는 계약 약속을 아무 데서도 못 본다(2026-08-15 신고). 원문 반대편은 받아야 한다.
      · 사람 장부 원문 → 본인은 skip_person 이 거르고, 매물 닻이 있으면 매물 줄이 매도 쪽
      · 제안 장부 원문 → 매수자만 거른다(그의 매물탭에 문장이 있다)
      · 매물 장부 원문 → 매도자만 거른다(합본·매도 매물탭에 문장이 있다)
    """
    if person is not None:
        return False, listing_id is not None
    if proposal_id is not None:
        return True, False
    return False, listing_id is not None


async def attendees_sync(team_id: int, sid: int, actor: int, people, *,
                         on: dt.date | None, at: str | None, title: str, place: str | None,
                         skip_buyer_side: bool, skip_owner_side: bool,
                         skip_person: tuple[str, int] | None = None,
                         listing_id: int | None = None) -> None:
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
                          listing_id: int | None = None,
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
    일정은 매물에 아무것도 안 쓴다(0222) — listing_id 는 매도자를 앉힐 때만 쓰고 일정 줄엔 남기지 않는다(0255).
    """
    cat = category or getattr(sch, "category", None) or guess_category(sch.title)
    if cat not in SCHED_CATEGORIES:
        cat = "일반"
    sid = await pool().fetchval(
        """INSERT INTO app.schedules(team_id, side, contact_id, proposal_id,
                                     title, on_date, at_time, place, hint, state,
                                     assignee_account_id, contract, category, method, amount)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id""",
        team_id, side, contact_id, proposal_id,
        sch.title, iso_date(sch.on), iso_time(sch.at), sch.place, sch.hint, state,
        getattr(sch, "assignee_account_id", None) or actor, cat == "계약", cat,
        getattr(sch, "method", None), getattr(sch, "amount", None))

    people = getattr(sch, "people", None)
    if people:
        skip_buyer, skip_owner = mirror_skips(
            listing_id=listing_id, proposal_id=proposal_id, person=person)
        await attendees_sync(
            team_id, sid, actor, people,
            on=iso_date(sch.on), at=sch.at, title=sch.title, place=sch.place,
            skip_buyer_side=skip_buyer, skip_owner_side=skip_owner,
            skip_person=person, listing_id=listing_id)
    elif proposal_id:
        await pool().execute(
            """INSERT INTO app.schedule_people(schedule_id, ref_kind, ref_id)
               SELECT $1, 'buyer', p.buyer_id FROM app.proposals p WHERE p.id=$2""",
            sid, proposal_id)
    elif listing_id:
        await pool().execute(
            """INSERT INTO app.schedule_people(schedule_id, ref_kind, ref_id)
               SELECT $1, 'owner', l.owner_id FROM app.office_listings l
                WHERE l.id=$2 AND l.team_id=$3 AND l.owner_id IS NOT NULL""",
            sid, listing_id, team_id)
    elif person:
        await pool().execute(
            """INSERT INTO app.schedule_people(schedule_id, ref_kind, ref_id)
               VALUES($1,$2,$3)""", sid, person[0], person[1])
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
    else:
        # 붙은 사람의 장부로(0076). 매물 장부에는 적지 않는다(0222). 아무도 없으면 적을 자리가 없다.
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
        # 계약 일정을 되돌려도 채택(picked_at)은 건드리지 않는다(0199) — 채택은 사람이 누른다
        if crows:
            # 걷힌 로그가 완료시켰던 표면 예정으로 되돌린다
            await pool().execute(
                """UPDATE app.schedules SET state='예정', promoted_by_contact_id=NULL
                     WHERE team_id=$1 AND id=$2
                       AND promoted_by_contact_id = ANY($3::bigint[])""",
                team_id, sch["id"], [r["id"] for r in crows])
        return
    # ── 완료 ── 일정 완료는 그 일정의 일이다. 계약 체결 · 거울 · 매물 장부로 넘어가지 않는다(0222)
    await schedule_log(team_id, sch, actor, f"{sch['on_date']:%-m/%-d} {sch['title']} {state}")


async def apply_sched_op(team_id: int, listing_id: int | None, op, new_on: dt.date | None,
                         side: str, proposal_id: int | None = None) -> None:
    """장부에 쓴 말이 캘린더를 움직인다 — 「브리핑 다음주로 미룸」·「3시로」·「잘 마쳤습니다」.

    어느 약속인지: ① 자기 장부의 것(짝 · 그 매물의 매도자가 앉은 약속) ② 제목이 같은 것 ③ 가장 가까운 예정.
    일정 줄엔 매물 칸이 없다(0222 · 0255) — 매물 장부의 말이면 그 매물 소유자가 참석자인 약속을 먼저 본다.
    취소는 일정을 **걷는다**(0074) — 거울 줄까지 함께(schedule_retract)."""
    row = await pool().fetchrow(
        """SELECT s.id, s.on_date, s.title FROM app.schedules s
            WHERE s.team_id=$1 AND s.state='예정'
              AND ($2::bigint IS NULL OR $4::bigint IS NOT NULL OR EXISTS (
                    SELECT 1 FROM app.schedule_people sp JOIN app.listing_office o ON o.owner_id = sp.ref_id
                     WHERE sp.schedule_id = s.id AND sp.ref_kind = 'owner' AND o.listing_id = $2))
            ORDER BY (s.proposal_id IS NOT DISTINCT FROM $4 AND $4 IS NOT NULL) DESC,
                     (s.side = $5) DESC,
                     (s.title = COALESCE($3, s.title)) DESC,
                     s.on_date LIMIT 1""",
        team_id, listing_id, op.title, proposal_id, side)
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
        """SELECT p.listing_id, y.name AS buyer, (l.team_id = p.team_id AND o.listing_id IS NOT NULL) AS mine
             FROM app.proposals p
             JOIN app.buyers y ON y.id = p.buyer_id
             JOIN app.listings l ON l.id = p.listing_id
             LEFT JOIN app.listing_office o ON o.listing_id = l.id
            WHERE p.id=$1 AND p.team_id=$2""", pid, team_id)
    if not row:
        return
    lid = row["listing_id"]
    # 매물엔 낱말을 안 적는다(0142) — 계약됐다는 사실은 짝이 들고 있고(picked_at), 매물 화면은 그걸 파생해 읽는다.
    # 짝이 가리키는 매물이 내 매물이 아니면(다른 사무소 · 수집 매물) 적을 매물 장부가 없다 — 매물을 만들지 않는다(0226)
    if not row["mine"]:
        return
    line = _event_line(evt_sid, status, f"매수자 {row['buyer']} 쪽 {status}")
    await pool().execute(
        """INSERT INTO app.contacts(team_id, target_type, listing_id, note, status, created_by,
                                    auto, src_schedule_id)
           VALUES($1,'listing',$2,$3,$4,$5,true,$6)""",
        team_id, lid, line + (f" · {deal // 10**8}억" if deal else ""), status, by, evt_sid)
    if evt_sid:
        owner = await pool().fetchval(
            "SELECT owner_id FROM app.office_listings WHERE id=$1 AND team_id=$2", lid, team_id)
        if owner:
            await _attend(evt_sid, "owner", owner)


async def mirror_to_proposal(team_id: int, listing_id: int, status: str, by: int,
                             deal: int | None = None, *,
                             evt_sid: int | None = None) -> str | None:
    """매도 장부 → 매수 장부. 어느 매수자와의 계약인지가 하나로 정해질 때만.
    거울 줄은 사건 표(evt_sid)를 기억하고, 그 표에 매수자를 앉힌다."""
    rows = await pool().fetch(
        """SELECT p.id, p.buyer_id, y.name FROM app.proposals p
           JOIN app.buyers y ON y.id = p.buyer_id AND y.deleted_at IS NULL
           WHERE p.team_id=$1 AND p.dropped_at IS NULL
             -- 내 매물에 담긴 짝만(0227) — 같은 건물의 다른 매물(네이버 · 다른 사무소)에 담은 짝은 이 장부와 상관없다
             AND p.listing_id = $2""",
        team_id, listing_id)
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
    # 거래가만 옮겨 적는다. 채택(picked_at) · 안 산다(dropped_at)는 사람이 누른다(0199)
    await pool().execute(
        """UPDATE app.proposals SET deal_price = COALESCE($3::bigint, deal_price), updated_at=now()
           WHERE id=$1 AND team_id=$2""", pid, team_id, deal)
    if evt_sid:
        # **그 표는 이 짝의 것이다**(0142). 어느 짝인지가 방금 하나로 정해졌으니 표에도 그 짝을 박는다.
        await pool().execute(
            """UPDATE app.schedules SET proposal_id=$3
                WHERE id=$1 AND team_id=$2 AND proposal_id IS NULL""",
            evt_sid, team_id, pid)
        await _attend(evt_sid, "buyer", rows[0]["buyer_id"])
    return rows[0]["name"]

# ══════════════════ 값 — 매물 줄 한 곳(0173) ══════════════════
#
# 매매가는 매물 줄(app.listings.price, 0226), 매도희망가 · 임대 합계는 관리 줄(app.listing_office).
# 둘 다 매물이 있어야 쓴다 — 매물은 등록으로만 생긴다.
# 층별(floor_rents)을 고치든 총액을 직접 적든, 끝에 listing_values_fold 를 한 번 부른다.

VALUE_FIELDS = ("sale_price", "ask_price")     # 이력(field_events)을 남기는 값 칸


async def listing_values_fold(listing_id: int) -> None:
    """임대내역(층별)이 바뀌면 공실면적 · 만실 월임대를 매물 줄로 다시 접는다.

    **현 보증금 · 월세 · 관리비(total_*)는 사람이 적는다**(2026-10-06 대표). 예전엔 임대중 호실을 다 채우면
    그 합으로 덮었는데(09-27 (다)안), 「다 채웠다」 판정이 화면에 안 보여 고친 값이 말없이 바뀌었다.
    임대내역 합계는 그 탭에 보이고, 사람이 그 값을 보고 옮겨 적는다. 수익률은 그 값과 매매가로 읽을 때 낸다.

    공실면적은 DB 함수 app.listing_vacancy 하나가 판다 — 적힌 공실 호실의 합, 없으면 null(0186)."""
    await pool().execute(
        "UPDATE app.listing_office SET vacant_area = app.listing_vacancy($1) WHERE listing_id = $1", listing_id)
    # 만실 월임대·만실 수익률(0181) — 공실면적 × 같은 층 실측 평당가(추정 폴백은 0239 삭제). 산식은 DB 함수
    # 하나에 있다. 바탕은 사람이 적은 현 월세다.
    await pool().execute("SELECT app.listing_full_fold($1)", listing_id)


async def listing_values_write(team_id: int, listing_id: int, changes: dict[str, int | None],
                               actor: int) -> str | None:
    """매매가·매도희망가를 쓴다. 매매가는 매물 줄(0226), 매도희망가는 관리 줄. **매물이 있어야 한다.**
    덮이는 값을 prev(json)로 돌려준다(커밋 되돌리기용, 0078).
    값이 실제로 바뀌면 field_events 에 한 줄 남긴다 — 「125 → 120」이 협상의 핵심 정보다(0109)."""
    changes = {k: v for k, v in changes.items() if k in VALUE_FIELDS}
    if not changes:
        return None
    lid = await need_listing(team_id, listing_id)
    cur = await pool().fetchrow("SELECT price, ask_price FROM app.office_listings WHERE id=$1", lid)
    old = {"sale_price": cur["price"], "ask_price": cur["ask_price"]}
    prev: dict = {}
    for field, v in changes.items():
        before = old[field]
        after = int(v) if v is not None and int(v) > 0 else None
        prev[field] = before
        if field == "sale_price":
            await pool().execute(
                "UPDATE app.listings SET price=$2, price_on=CASE WHEN $2::bigint IS NULL THEN NULL ELSE current_date END,"
                " updated_at=now() WHERE id=$1", lid, after)
        else:
            await pool().execute("UPDATE app.listing_office SET ask_price=$2 WHERE listing_id=$1", lid, after)
        if before != after:
            await pool().execute(
                """INSERT INTO app.field_events(team_id, target_type, listing_id, field, prev, value, created_by)
                   VALUES($1,'listing',$2,$3,$4,$5,$6)""",
                team_id, lid, field, str(before) if before is not None else None,
                str(after) if after is not None else None, actor)
    await listing_values_fold(lid)
    return json.dumps(prev)


async def listing_values_restore(team_id: int, listing_id: int, prev_json: str, actor: int) -> None:
    """커밋이 덮었던 값을 되돌린다 — prev 의 null 은 「비어 있었다」라 다시 비운다."""
    prev = json.loads(prev_json)
    await listing_values_write(team_id, listing_id, {k: prev.get(k) for k in VALUE_FIELDS if k in prev}, actor)


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
