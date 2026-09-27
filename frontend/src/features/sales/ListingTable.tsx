import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listingsApi, proposalsApi, salesApi, type Seller } from "../../shared/api/endpoints";
import { md, shortAddr, wonAcc } from "../../shared/format";
import { Loading } from "../../shared/ui/Spinner";
import { Icon } from "../../shared/ui/Icon";
import { useEnums } from "../../shared/hooks/useEnums";
import { openDetail } from "../../shared/map/geo";
import { useAuth } from "../../shared/store/auth";
import { stateWord, isUrgent } from "./listingWord";
import { ListingModal } from "./ListingModal";
import { UnifiedModal, type UniTab } from "./draft/UnifiedModal";
import { useTradeCtx } from "./tradeCtx";
import { touchPk } from "./recent";
import "./draft/salestab.css";

/* ══════════════════════ 매물 — 표 하나(2026-09-26) ══════════════════════
 *
 * 부기사처럼 매물 표가 첫 화면이다. 왼쪽 목록 + 오른쪽 판으로 나뉘어 있던 것을 표 하나로 합쳤다 —
 * 오른쪽 판(결정 문장·소유자·매수자 짝)은 모달의 「요약」 탭으로 들어갔다.
 * 줄을 누르면 모달, 조작은 줄 오른쪽 아이콘 하나(건물 상세)뿐이다.
 *
 * 확인일 = 사람이 이 매물에 남긴 마지막 기록의 날(listings.checked_on, 0182).
 * 대시보드 「재통화」와 같은 기준(7일)이라, 넘으면 빨강이다. */

type Lane = "own" | "watch" | "done";
type SortKey = "listing_no" | "addr" | "size" | "price" | "rent" | "roi" | "checked_on" | "next";
const RECALL_DAYS = 7;          // backend buyers.RECALL_DAYS 와 같은 값

const daysSince = (d: string | null | undefined) =>
  d ? Math.floor((Date.now() - new Date(`${d}T00:00:00+09:00`).getTime()) / 86400000) : null;
/** 금액 — 모르면 「—」, 0 은 0(안 받음). wonAcc 는 0 을 빈 글자로 돌려준다 */
const won = (v: number | null | undefined) => (v == null ? "—" : Number(v) === 0 ? "0" : wonAcc(v));
const py = (m2: number | null | undefined) => (m2 ? Math.round(m2 / 3.305785).toLocaleString() : null);
const floorsOf = (r: Seller) => {
  const a = r.floors_above ?? 0, b = r.floors_below ?? 0;
  if (!a && !b) return null;
  return `${b ? `B${b}~` : ""}${a}F`;
};

/** 표 썸네일 — 사진은 인증을 거쳐 받는다(blob). 목록이 준 대표 사진 id 하나만 */
function Thumb({ pk, id }: { pk: string; id: number | null | undefined }) {
  const access = useAuth((s) => s.access);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) { setUrl(null); return; }
    let obj: string | null = null, alive = true;
    fetch(`/api/buildings/${encodeURIComponent(pk)}/photos/${id}`, { headers: { Authorization: `Bearer ${access}` } })
      .then((res) => (res.ok ? res.blob() : Promise.reject()))
      .then((b) => { obj = URL.createObjectURL(b); if (alive) setUrl(obj); else URL.revokeObjectURL(obj); })
      .catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [pk, id, access]);
  return <span className="lx-th">{url && <img src={url} alt="" />}</span>;
}

export function ListingsTab({ focus, focusTab, onDone, onBuyer }: {
  focus: string | null; focusTab?: UniTab; onDone: () => void; onBuyer: (id: number) => void;
}) {
  const qc = useQueryClient();
  const { options } = useEnums();
  const rows = useQuery({ queryKey: ["sellers"], queryFn: () => salesApi.sellers() });
  const members = useQuery({ queryKey: ["team-members"], queryFn: listingsApi.members });
  const [open, setOpen] = useState<{ pk: string; tab?: UniTab } | null>(focus ? { pk: focus, tab: focusTab } : null);
  useEffect(() => { if (focus) setOpen({ pk: focus, tab: focusTab }); }, [focus, focusTab]);
  useEffect(() => { touchPk(open?.pk ?? null); }, [open?.pk]);
  const [q, setQ] = useState("");
  const [lane, setLane] = useState<Lane>("own");
  const [who, setWho] = useState<number | null>(null);          // 담당 거르기
  const [major, setMajor] = useState<string | null>(null);      // 대분류 거르기
  const [kind, setKind] = useState<string | null>(null);        // 소분류 거르기
  const [flag, setFlag] = useState<null | "urgent" | "exclusive">(null);
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean } | null>(null);
  const [add, setAdd] = useState(false);

  const list = rows.data ?? [];
  const nameOf = (id: number | null | undefined) => members.data?.find((m) => m.account_id === id)?.name ?? null;
  const sold = list.filter((r) => r.s6_match);
  const owned = list.filter((r) => r.has_owner && !r.s6_match);
  const watched = list.filter((r) => !r.has_owner && !r.s6_match);
  const laneRows = lane === "own" ? owned : lane === "watch" ? watched : sold;

  const shown = useMemo(() => {
    const t = q.trim();
    let out = laneRows.filter((r) =>
      (!t || (r.addr ?? "").includes(t) || (r.owner_name ?? "").includes(t) || (r.listing_no ?? "").includes(t))
      && (who == null || r.assignee_account_id === who)
      && (major == null || r.building_major === major)
      && (kind == null || (r.building_use ?? []).includes(kind))
      && (flag == null || (flag === "urgent" ? isUrgent(r) : r.exclusive === true)));
    if (sort) {
      const v = (r: Seller): string | number | null =>
        sort.k === "listing_no" ? r.listing_no
          : sort.k === "addr" ? r.addr
            : sort.k === "size" ? r.total_area ?? r.land_area
              : sort.k === "price" ? r.list_price ?? null
                : sort.k === "rent" ? r.total_rent ?? null
                : sort.k === "roi" ? r.roi
                  : sort.k === "checked_on" ? r.checked_on ?? null
                    : r.next_sched_on ?? null;
      // 빈 값은 방향과 상관없이 맨 뒤 — 모르는 것이 앞에 서면 표 머리가 비어 보인다
      out = [...out].sort((a, b) => {
        const x = v(a), y = v(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        const c = x < y ? -1 : x > y ? 1 : 0;
        return sort.asc ? c : -c;
      });
    }
    return out;
  }, [laneRows, q, who, major, kind, flag, sort]);

  const cur = list.find((r) => r.building_pk === open?.pk) ?? null;
  const unknown = open && !rows.isLoading && !cur ? open.pk : null;   // 아직 안 담은 건물로 넘어왔다

  // 다른 화면에서 넘어온 건물이 반대 갈래에 있으면 그 갈래로 옮겨 준다
  useEffect(() => {
    if (cur) setLane(cur.s6_match ? "done" : cur.has_owner ? "own" : "watch");
  }, [cur?.building_pk, cur?.has_owner]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 모달을 보는 동안 대화창의 대상 = 이 매물
  const setCtx = useTradeCtx((st) => st.setCtx);
  useEffect(() => {
    if (!cur) { setCtx(null); return; }
    setCtx({ kind: "owner", id: cur.owner_id ?? 0, label: cur.owner_name ?? shortAddr(cur.addr),
      building_pk: cur.building_pk, addr: cur.addr });
  }, [cur?.building_pk, cur?.owner_id, setCtx]);   // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    rows.refetch();
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["timeline"] });
    onDone();
  };

  const th = (k: SortKey | null, label: string, cls = "") => (
    <th className={`${cls} ${k ? "s" : ""} ${sort?.k === k ? "on" : ""}`}
      onClick={k ? () => setSort((s) => (s?.k === k ? (s.asc ? { k, asc: false } : null) : { k, asc: true })) : undefined}>
      {label}{k && sort?.k === k && <i>{sort.asc ? "↑" : "↓"}</i>}
    </th>
  );
  const chip = (on: boolean, label: string, onClick: () => void, n?: number) => (
    <button key={label} className={`um-chip ${on ? "on" : ""}`} onClick={onClick}>
      {label}{n != null && <i className="num">{n}</i>}</button>
  );

  if (rows.isLoading) return <Loading label="불러오는 중" minHeight="40vh" />;
  return (
    <div className="lx">
      <div className="lx-bar">
        {chip(lane === "own", "매물", () => setLane("own"), owned.length)}
        {chip(lane === "watch", "관심", () => setLane("watch"), watched.length)}
        {chip(lane === "done", "계약", () => setLane("done"), sold.length)}
        <input className="lt-q lx-q" value={q} placeholder="주소 · 소유자 · 매물번호"
          onChange={(e) => setQ(e.target.value)} />
        <span className="sp" />
        <button className="lt-add" title="매물 등록" onClick={() => setAdd(true)}>
          <Icon name="plus" size={14} /></button>
      </div>
      <div className="lx-filt">
        {(members.data ?? []).length > 1 && (members.data ?? []).map((m) =>
          chip(who === m.account_id, m.name, () => setWho(who === m.account_id ? null : m.account_id)))}
        {(members.data ?? []).length > 1 && <span className="lx-div" />}
        {options("building_major").map((o) =>
          chip(major === o.code, o.label, () => setMajor(major === o.code ? null : o.code)))}
        <span className="lx-div" />
        {options("building_use").map((o) =>
          chip(kind === o.code, o.label, () => setKind(kind === o.code ? null : o.code)))}
        <span className="lx-div" />
        {chip(flag === "urgent", "급매", () => setFlag(flag === "urgent" ? null : "urgent"))}
        {chip(flag === "exclusive", "전속", () => setFlag(flag === "exclusive" ? null : "exclusive"))}
      </div>

      <div className="lx-wrap">
        <table className="lx-t">
          <thead><tr>
            {th(null, "", "c-ph")}
            {th("listing_no", "매물번호", "c-no")}
            {th("addr", "주소")}
            {th(null, "분류", "c-kind")}
            {th("size", "규모", "c-size")}
            {th("price", "금액", "r")}
            {th("rent", "임대", "r c-rent")}
            {th("roi", "수익률", "r c-roi")}
            {th(null, "상태")}
            {th(null, "소유자", "c-own")}
            {th(null, "담당", "c-who")}
            {th("checked_on", "확인일", "c-chk")}
            {th("next", "다음 일정")}
            {th(null, "", "c-act")}
          </tr></thead>
          <tbody>
            {shown.map((r) => {
              const word = stateWord(r);
              const age = daysSince(r.checked_on);
              const stale = !r.s6_match && age != null && age > RECALL_DAYS;
              const kinds = [
                ...(r.building_major ? [options("building_major").find((o) => o.code === r.building_major)?.label ?? r.building_major] : []),
                ...(r.building_use ?? []).map((c) => options("building_use").find((o) => o.code === c)?.label ?? c)];
              return (
                <tr key={r.building_pk} className={open?.pk === r.building_pk ? "on" : ""}
                  onClick={() => setOpen({ pk: r.building_pk })}>
                  <td className="c-ph"><Thumb pk={r.building_pk} id={r.photo_id} /></td>
                  <td className="c-no num">{r.listing_no ?? "—"}</td>
                  <td className="c-addr">
                    <b>{shortAddr(r.addr)}</b>
                    <span className="tags">
                      {r.is_vacant && <i>나대지</i>}
                      {isUrgent(r) && <i className="red">급매</i>}
                      {r.exclusive && <i className="blue">전속</i>}
                    </span>
                  </td>
                  <td className="c-kind">{kinds.length ? kinds.join(" · ") : <span className="off">—</span>}</td>
                  <td className="c-size num">
                    <span>대지 {py(r.land_area) ?? "—"}평</span>
                    <span className="sub">연 {py(r.total_area) ?? "—"}평{floorsOf(r) ? ` · ${floorsOf(r)}` : ""}</span>
                  </td>
                  {/* 부기사처럼 한 칸에 쌓는다 — 매매가 / 평단가(대지) / 매도희망가 */}
                  <td className="r num c-amt">
                    <b className={r.list_price != null ? "" : "off"}>{r.list_price != null ? wonAcc(r.list_price) : "—"}
                      {r.price_vs_market && <i className="vs">{r.price_vs_market}</i>}</b>
                    <span className="sub">평단 {won(r.pp_land_team)}</span>
                    <span className="sub">희망 {won(r.ask_price)}</span>
                  </td>
                  {/* 보증금 / 월임대 / 관리비 */}
                  <td className="r num c-rent">
                    <span>보 {won(r.total_deposit)}</span>
                    <span className="sub">월 {won(r.total_rent)}</span>
                    <span className="sub">관 {won(r.total_mgmt)}</span>
                  </td>
                  <td className="r num c-roi">{r.roi != null ? `${Number(r.roi).toFixed(2)}%` : <span className="off">—</span>}</td>
                  <td><span className={`lx-st ${r.stop_id ? "red" : ""}`}>{word}</span></td>
                  <td className="c-own">{r.owner_name ?? <span className="off">—</span>}</td>
                  <td className="c-who">{nameOf(r.assignee_account_id) ?? <span className="off">—</span>}</td>
                  <td className={`c-chk num ${stale ? "red" : ""}`}>{r.checked_on ? md(r.checked_on) : <span className="off">—</span>}</td>
                  <td className="num">{r.next_sched_on
                    ? <>{md(r.next_sched_on)} <span className="sub">{r.next_sched_cat ?? r.next_sched_title ?? ""}</span></>
                    : <span className="off">—</span>}</td>
                  <td className="c-act" onClick={(e) => e.stopPropagation()}>
                    <button className="lx-ic" title="건물 상세" onClick={() => openDetail(r.building_pk)}>
                      <Icon name="external" size={14} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <div className="lt-none">{laneRows.length ? "맞는 매물이 없습니다" : "담은 매물이 없습니다"}</div>}
      </div>

      {cur && (
        <ListingHost key={cur.building_pk} r={cur} tab0={open?.tab} onBuyer={onBuyer}
          onClose={() => setOpen(null)} onDone={refresh} />
      )}
      {(add || unknown) && (
        <ListingModal preset={unknown ? { pk: unknown } : null}
          onClose={() => { setAdd(false); if (unknown) setOpen(null); }}
          onSaved={(pk2) => { setAdd(false); refresh(); setOpen({ pk: pk2, tab: "sum" }); }} />
      )}
    </div>
  );
}

/** 모달 껍데기 — 이 매물의 매수자 짝을 불러 통합 모달에 넘긴다 */
function ListingHost({ r, tab0, onClose, onDone, onBuyer }: {
  r: Seller; tab0?: UniTab; onClose: () => void; onDone: () => void; onBuyer: (id: number) => void;
}) {
  const props = useQuery({ queryKey: ["proposals", "pk", r.building_pk],
    queryFn: () => proposalsApi.list({ building_pk: r.building_pk }) });
  return (
    <UnifiedModal r={r} buyers={props.data ?? []} tab0={tab0 ?? "sum"}
      onClose={onClose} onBuyer={onBuyer}
      onSaved={() => { props.refetch(); onDone(); }} />
  );
}
