"""사람 읽기 — 고객 조회(`customers`, 중개사만) · 내 정보(`me`, 고객만). 11b §3 · §4.

건물 조회(`tools._run_buildings`)와 같은 어법이다: 이름 하나에 손잡이 하나, 조건은 늘 목록(사이는 「또는」),
`{}` 는 보기만, 응답은 물어본 칸만. **전화는 이름이 없다** — 바깥 모델로 안 보낸다. 있는지만 「전화있음」.

여기서 안 하는 것: 쓰기. 고객 등록 · 조건 붙이기 · 메모는 고객관리 쓰기 스킬이 한다.
"""
from __future__ import annotations

import datetime as dt
import difflib
import json
from typing import Any

from ..core.db import pool
from ..core.deps import CurrentUser

# 갈래 값은 **정본에서 읽는다**(11b ①) — ref.enums(customer_goal · customer_timing · build_intent · customer_experience ·
# buyer_source) · master.region_index(구) · 팀원. 손으로 적은 목록을 두지 않는다(출처 값을 지어냈던 자리)
_ENUM_KEY = {"목표": "customer_goal", "매수시기": "customer_timing", "건축의사": "build_intent",
             "매입경험": "customer_experience", "출처": "buyer_source"}


# 이름 → (갈래, SQL 칸). 갈래: 수 · 목록 · 배열(겹침) · 날짜 · 글(부분일치) · 있음 · 보기만
_C: dict[str, tuple[str, str]] = {
    "이름": ("글", "b.name"),
    "희망매매가": ("겹침", ""),
    "시드": ("수", "b.equity_won"),
    "목표": ("배열", "b.goal"),
    "원하는지역": ("배열", "b.regions"),
    "매수시기": ("목록", "b.timing"),
    "건축의사": ("목록", "b.build_intent"),
    "개인법인": ("법인", "b.is_corp"),
    "매입경험": ("목록", "b.experience"),
    "출처": ("목록", "b.source"),
    "등록일": ("날짜", "b.created_at::date"),
    "담당자": ("담당", "b.assignee_account_id"),
    "전화있음": ("있음", "b.phone"),
    "비고": ("보기만", "b.memo"),
}
def _vals(n: str, ctx: dict) -> list | None:
    if n in _ENUM_KEY:
        return ctx["enums"].get(_ENUM_KEY[n]) or None
    return {"원하는지역": ctx.get("regions"), "담당자": ctx.get("members"),
            "개인법인": ["개인", "법인"], "전화있음": ["있음", "없음"]}.get(n)
SECTIONS = ("조건", "문의", "메모", "담긴매물")
_SORT = {"등록일": "b.created_at", "희망매매가": "COALESCE(b.budget_max, b.budget_min)",
         "시드": "b.equity_won", "이름": "b.name"}
_ROWS = 20
_LIST = 10


def customers_schema(ctx: dict) -> tuple[dict, list[str]]:
    props: dict[str, Any] = {}
    for n, (k, _c) in _C.items():
        if k in ("수", "겹침"):
            props[n] = {"type": "object", "properties": {"이상": {"type": "number"}, "이하": {"type": "number"}},
                        **({"description": "원. 고객의 최소~최대와 범위가 겹치면 걸린다(상관없음은 늘 걸림)"}
                           if k == "겹침" else {"description": "원"})}
        elif k == "날짜":
            props[n] = {"type": "object", "properties": {"이후": {"type": "string"}, "이전": {"type": "string"}}}
        elif k == "글":
            props[n] = {"type": "object", "properties": {"값": {"type": "string"}}, "description": "부분일치"}
        elif k == "보기만":
            props[n] = {"type": "object", "description": "보기만. {} 로 달라고 한다"}
        else:
            vals = _vals(n, ctx)
            item = {"type": "string", **({"enum": vals} if vals else {})}
            props[n] = {"type": "object", "properties": {"값": {"type": "array", "items": item}}}
    for sec in SECTIONS:
        props[sec] = {"type": "object", "description": "묶음. {} 로 달라고 한다"}
    return {"type": "object", "properties": {
        "조건": {"type": "array", "items": {"type": "object", "properties": props},
                 "description": "목록 사이는 「또는」, 한 항목 안은 「그리고」. 이름을 대면 보이고 손잡이를 달면 걸린다"},
        "정렬": {"type": "string", "enum": list(_SORT)},
        "차순": {"type": "string", "enum": ["내림차순", "오름차순"]},
    }, "required": ["정렬", "차순"]}, []


CUSTOMERS_DESC = (
    "고객 조회 — 우리 사무소 고객을 찾고 한 명을 본다(중개사만). 응답은 `고객` 묶음(전체 · 보여준수 · 목록)이다. "
    "고객은 **이름**으로 가리킨다(한 명은 `이름` 조건). 줄의 뼈대는 이름 · 등록일 · 전화있음이고 나머지는 이름을 댄 칸만 실린다. "
    "번호(고객 · 건물 · 계정)와 전화번호는 오지 않는다. 담당자는 이름으로 온다. "
    "묶음: 조건(이 고객에게 붙은 저장한 조건 이름 · 요약 — 건물 조회 `저장조건` 에 이름을 그대로 넣는다) · 문의(본문 포함) · 메모 · 담긴매물. "
    "「이 고객이 원할 만한 매물」은 고객 조회 없이 건물 조회에 `고객: 이름` 을 주면 된다."
)


def _won(v):
    return int(v) if v is not None else None


async def run_customers(args: dict[str, Any], user: CurrentUser) -> Any:
    if user.kind != "중개사" or user.team_id is None:
        raise ValueError("그런 도구는 없다: customers")
    conds = args.get("조건") or [{}]
    conds = conds if isinstance(conds, list) else [conds]
    srt = args.get("정렬") or ""
    if srt not in _SORT:
        raise ValueError(f"정렬이 없다. 고를 수 있는 이름: {list(_SORT)}")
    asc = args.get("차순") or ""
    if asc not in ("내림차순", "오름차순"):
        raise ValueError("차순이 없다. 「내림차순」 또는 「오름차순」")

    params: list = [user.team_id]
    ors: list[str] = []
    want: set[str] = set()
    secs: set[str] = set()
    for c in conds:
        if not isinstance(c, dict):
            continue
        ands: list[str] = []
        for n, v in c.items():
            if n in SECTIONS:
                secs.add(n); continue
            if n not in _C:
                near = difflib.get_close_matches(n, [*_C, *SECTIONS], n=3, cutoff=0.5)
                raise ValueError(f"그런 이름은 없다: 「{n}」." + (f" 혹시 {' · '.join(near)}?" if near else ""))
            want.add(n)
            if not isinstance(v, dict) or not v:
                continue
            kind, col = _C[n]

            def p(x):
                params.append(x)
                return f"${len(params)}"
            if kind == "수":
                if v.get("이상") is not None: ands.append(f"{col} >= {p(int(v['이상']))}")
                if v.get("이하") is not None: ands.append(f"{col} <= {p(int(v['이하']))}")
            elif kind == "겹침":
                lo, hi = v.get("이상"), v.get("이하")
                cond = []
                if hi is not None: cond.append(f"COALESCE(b.budget_min, b.budget_max) <= {p(int(hi))}")
                if lo is not None: cond.append(f"COALESCE(b.budget_max, b.budget_min) >= {p(int(lo))}")
                if cond:
                    ands.append(f"(b.budget_any IS TRUE OR ({' AND '.join(cond)}))")
            elif kind == "날짜":
                if v.get("이후"): ands.append(f"{col} >= {p(dt.date.fromisoformat(v['이후'][:10]))}")
                if v.get("이전"): ands.append(f"{col} <= {p(dt.date.fromisoformat(v['이전'][:10]))}")
            elif kind == "글":
                if v.get("값"): ands.append(f"{col} ILIKE '%' || {p(str(v['값']))} || '%'")
            elif kind == "배열":
                if v.get("값"): ands.append(f"{col} && {p([str(x) for x in v['값']])}::text[]")
            elif kind == "법인":
                vals = v.get("값") or []
                if vals and len(set(vals)) == 1:
                    ands.append(f"{col} IS {'TRUE' if vals[0] == '법인' else 'FALSE'}")
            elif kind == "있음":
                vals = v.get("값") or []
                if vals == ["있음"]: ands.append(f"COALESCE({col}, '') <> ''")
                elif vals == ["없음"]: ands.append(f"COALESCE({col}, '') = ''")
            elif kind == "담당":                  # 팀원 이름으로 받는다 — 계정 번호는 모델이 모른다
                if v.get("값"):
                    ands.append(f"{col} IN (SELECT m.account_id FROM app.team_members m JOIN app.accounts a ON a.id = m.account_id"
                                f" WHERE m.team_id = $1 AND a.name = ANY({p([str(x) for x in v['값']])}::text[]))")
            elif kind == "목록":
                if v.get("값"):
                    ands.append(f"{col} = ANY({p(list(v['값']))}::text[])")
            elif kind == "보기만" and v:
                raise ValueError(f"「{n}」은 보기만 한다. {{}} 로 달라고만 해라")
        ors.append("(" + (" AND ".join(ands) or "TRUE") + ")")
    where = " OR ".join(ors) or "TRUE"
    order = f"{_SORT[srt]} {'ASC' if asc == '오름차순' else 'DESC'} NULLS LAST, b.id"
    base = f"FROM app.buyers b WHERE b.team_id = $1 AND b.deleted_at IS NULL AND ({where})"
    total = await pool().fetchval(f"SELECT count(*) {base}", *params)
    rows = await pool().fetch(
        f"""SELECT b.id, b.name, (COALESCE(b.phone, '') <> '') AS has_phone, b.budget_min, b.budget_max, b.budget_any,
                   b.equity_won, b.goal, b.regions, b.timing, b.build_intent, b.is_corp, b.experience, b.source,
                   b.created_at::date AS created_on, b.memo,
                   (SELECT a.name FROM app.accounts a WHERE a.id = b.assignee_account_id) AS assignee_name
             {base} ORDER BY {order} LIMIT {_ROWS}""", *params)

    def budget(r):
        if r["budget_any"]:
            return "상관없음"
        d = {k: v for k, v in (("최소", _won(r["budget_min"])), ("최대", _won(r["budget_max"]))) if v is not None}
        return d or None
    pick = {
        "희망매매가": budget, "시드": lambda r: _won(r["equity_won"]), "목표": lambda r: r["goal"],
        "원하는지역": lambda r: r["regions"], "매수시기": lambda r: r["timing"], "건축의사": lambda r: r["build_intent"],
        "개인법인": lambda r: None if r["is_corp"] is None else ("법인" if r["is_corp"] else "개인"),
        "매입경험": lambda r: r["experience"], "출처": lambda r: r["source"], "등록일": lambda r: r["created_on"],
        "담당자": lambda r: r["assignee_name"], "비고": lambda r: r["memo"], "이름": lambda r: r["name"],
        "전화있음": lambda r: r["has_phone"],
    }
    items = []
    for r in rows:
        # 번호는 안 낸다(11b · 10-04). 같은 이름을 가르려고 등록일을 뼈대에 둔다
        d: dict[str, Any] = {"_id": r["id"], "이름": r["name"], "등록일": r["created_on"], "전화있음": r["has_phone"]}
        for n in sorted(want):
            v = pick[n](r)
            if v not in (None, [], ""):
                d[n] = v
        items.append(d)
    ids = [r["id"] for r in rows]
    if ids and "조건" in secs:
        for s in await pool().fetch(
                "SELECT id, buyer_id, name, conditions_json FROM app.saved_searches WHERE buyer_id = ANY($1) AND closed_at IS NULL ORDER BY id",
                ids):
            cj = s["conditions_json"]
            cj = json.loads(cj) if isinstance(cj, str) else (cj or {})
            vals = cj.get("values") or {}
            regs = [g.get("label") for g in (cj.get("regions") or []) if g.get("label")]
            summary = " · ".join([*regs, *[f"{k}" for k in vals][:6]])
            row = next(x for x in items if x["_id"] == s["buyer_id"])
            row.setdefault("조건", []).append({"이름": s["name"], **({"요약": summary} if summary else {})})
    if ids and "문의" in secs:
        for q in await pool().fetch(
                """SELECT q.buyer_id, q.created_at::date AS d, q.kind, q.status,
                          app.parcel_addr(COALESCE(lp.pnu, sk.pnu)) AS addr, q.body FROM app.inquiries q
                     LEFT JOIN app.listing_parcels lp ON lp.listing_id = q.listing_id AND lp.main
                     LEFT JOIN app.seeks sk ON sk.id = q.seek_id
                    WHERE q.team_id = $1 AND q.buyer_id = ANY($2) ORDER BY q.created_at DESC""", user.team_id, ids):
            row = next(x for x in items if x["_id"] == q["buyer_id"])
            lst = row.setdefault("문의", [])
            if len(lst) < _LIST:
                lst.append({k: v for k, v in (("날짜", q["d"]), ("유형", q["kind"]), ("상태", q["status"]),
                                               ("주소", q["addr"]), ("본문", q["body"])) if v is not None})
    if ids and "메모" in secs:
        for m in await pool().fetch(
                """SELECT target_id, occurred_on, note FROM app.contacts
                    WHERE team_id = $1 AND target_type = 'buyer' AND target_id = ANY($2::text[]) AND NOT auto
                    ORDER BY occurred_on DESC, id DESC""", user.team_id, [str(i) for i in ids]):
            row = next(x for x in items if str(x["_id"]) == m["target_id"])
            lst = row.setdefault("메모", [])
            if len(lst) < _LIST and m["note"]:
                lst.append({"날짜": m["occurred_on"], "글": m["note"]})
    if ids and "담긴매물" in secs:
        for pr in await pool().fetch(
                """SELECT p.buyer_id, app.parcel_addr(lp.pnu) AS addr, p.hope_price, p.picked_at, p.dropped_at
                     FROM app.proposals p LEFT JOIN app.listing_parcels lp ON lp.listing_id = p.listing_id AND lp.main
                    WHERE p.team_id = $1 AND p.buyer_id = ANY($2) ORDER BY p.updated_at DESC""", user.team_id, ids):
            row = next(x for x in items if x["_id"] == pr["buyer_id"])
            lst = row.setdefault("담긴매물", [])
            if len(lst) < _LIST:
                lst.append({k: v for k, v in (("주소", pr["addr"]),
                                               ("매수희망가", pr["hope_price"]), ("채택", pr["picked_at"] is not None),
                                               ("안산다", True if pr["dropped_at"] else None)) if v is not None})
    for x in items:
        x.pop("_id", None)                      # 내부 번호는 묶음을 붙이는 동안만
    blk: dict[str, Any] = {"전체": total}
    if len(items) < total:
        blk["보여준수"] = len(items)
    blk["목록"] = items
    return {"고객": blk}


# ── 내 정보(고객만) ─────────────────────────────────────────────
ME_DESC = (
    "내 정보 — 지금 상담하는 고객 본인의 내 투자 · 찾는 조건 · 관심 매물 · 구해요 · 보낸 문의. 입력은 없다. "
    "이미 아는 것을 다시 묻지 않으려고 부른다. `찾는조건`의 이름을 건물 조회 `저장조건` 에 그대로 넣는다. 건물은 주소로 온다."
)


def me_schema(_ctx: dict) -> tuple[dict, list[str]]:
    return {"type": "object", "properties": {}}, []


async def run_me(_args: dict[str, Any], user: CurrentUser) -> Any:
    if user.kind == "중개사" and user.team_id is not None:
        raise ValueError("그런 도구는 없다: me")
    p = await pool().fetchrow("SELECT * FROM app.customer_profile WHERE account_id = $1", user.account_id)
    inv: dict[str, Any] = {}
    if p:
        p = dict(p)
        if p.get("budget_any"):
            inv["희망매매가"] = "상관없음"
        elif p.get("budget_min") is not None or p.get("budget_max") is not None:
            inv["희망매매가"] = {k: v for k, v in (("최소", p.get("budget_min")), ("최대", p.get("budget_max"))) if v is not None}
        for k, n in (("equity_won", "시드"), ("goal", "목표"), ("regions", "원하는지역"), ("timing", "매수시기"),
                     ("build_intent", "건축의사"), ("experience", "매입경험")):
            if p.get(k) not in (None, [], ""):
                inv[n] = p[k]
        if p.get("is_corp") is not None:
            inv["개인법인"] = "법인" if p["is_corp"] else "개인"
    conds = [{"이름": r["name"]} for r in await pool().fetch(
        "SELECT name FROM app.saved_searches WHERE account_id = $1 AND closed_at IS NULL ORDER BY id", user.account_id)]
    saves = [{k: v for k, v in (("주소", r["addr"]), ("매매가", r["price"])) if v is not None}
             for r in await pool().fetch(
        """SELECT app.parcel_addr(lp.pnu) AS addr, CASE WHEN a.price_open THEN l.price END AS price
             FROM app.saves s
             LEFT JOIN app.ads a ON a.id = s.ad_id
             LEFT JOIN app.listings l ON l.id = a.listing_id
             LEFT JOIN app.listing_parcels lp ON lp.listing_id = l.id AND lp.main
            WHERE s.account_id = $1 ORDER BY s.created_at DESC LIMIT 20""", user.account_id)]
    seeks = [{k: v for k, v in (("주소", r["addr"]), ("상태", r["state"]), ("제안수", r["n"]), ("마감", r["expires_on"])) if v is not None}
             for r in await pool().fetch(
        """SELECT app.parcel_addr(s.pnu) AS addr, s.state, s.expires_on,
                  (SELECT count(*) FROM app.seek_proposals sp WHERE sp.seek_id = s.id) AS n
             FROM app.seeks s
            WHERE s.account_id = $1 AND s.closed_at IS NULL ORDER BY s.created_at DESC LIMIT 20""",
        user.account_id)]
    inqs = [{k: v for k, v in (("날짜", r["d"]), ("주소", r["addr"]), ("상태", r["status"])) if v is not None}
            for r in await pool().fetch(
        "SELECT q.created_at::date AS d, app.parcel_addr(COALESCE(lp.pnu, sk.pnu)) AS addr, q.status FROM app.inquiries q"
        " LEFT JOIN app.listing_parcels lp ON lp.listing_id = q.listing_id AND lp.main"
        " LEFT JOIN app.seeks sk ON sk.id = q.seek_id WHERE q.account_id = $1 ORDER BY q.created_at DESC LIMIT 20",
        user.account_id)]
    out = {"내투자": inv, "찾는조건": conds, "관심매물": saves, "구해요": seeks, "보낸문의": inqs}
    return {k: v for k, v in out.items() if v}
