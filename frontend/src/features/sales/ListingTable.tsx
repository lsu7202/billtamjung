import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { contactsApi, listingsApi, proposalsApi, salesApi, savedApi, searchApi, type Seller } from "../../shared/api/endpoints";
import { condRequest } from "../search/FilterModal";
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

/** 상태(2026-09-27) — 매물·관심·계약 세 갈래를 목록 하나로 합쳤다(부기사처럼). 기본은 계약을 뺀 전부 */
type St = "unowned" | "active" | "done";
const ST: [St, string][] = [["unowned", "소유자 미확보"], ["active", "진행"], ["done", "계약"]];
/** 확인일 구간(2026-09-28) — 부기사 「수정일 확인」. 색을 늘리지 않고 필터로 찾는다 */
type Chk = "m1" | "m3" | "m6" | "old" | "none";
const CHK: [Chk, string][] = [["m1", "1개월 안"], ["m3", "1~3개월"], ["m6", "3~6개월"], ["old", "6개월 넘음"], ["none", "기록 없음"]];
const chkOf = (d: number | null): Chk =>
  d == null ? "none" : d <= 30 ? "m1" : d <= 90 ? "m3" : d <= 180 ? "m6" : "old";
const stOf = (r: Seller): St => (r.s6_match ? "done" : r.has_owner ? "active" : "unowned");
type SortKey = "received_on" | "updated_at" | "listing_no" | "addr" | "size" | "price" | "rent" | "roi" | "checked_on" | "next";
/** 정렬 pill 의 목록 — 부기사 탭(등록일·수정일·가격·면적·매물번호)에 우리 열(수익률·확인일)을 더했다 */
const SORTS: [SortKey, string][] = [["received_on", "등록일"], ["updated_at", "수정일"], ["listing_no", "매물번호"],
  ["price", "금액"], ["size", "면적"], ["roi", "수익률"], ["checked_on", "확인일"]];
type RangeKey = "price" | "land" | "total";
type Range = [number | null, number | null];
/** 범위 거르기 — 입력 단위(억·평)와 저장 단위(원·㎡) 사이 환산 */
const RANGES: { k: RangeKey; label: string; unit: string; of: (r: Seller) => number | null | undefined; per: number }[] = [
  { k: "price", label: "금액", unit: "억", of: (r) => r.list_price, per: 1e8 },
  { k: "land", label: "대지", unit: "평", of: (r) => r.land_area, per: 3.305785 },
  { k: "total", label: "연면적", unit: "평", of: (r) => r.total_area, per: 3.305785 },
];
/** 주소 「서울특별시 강남구 삼성동 158-19번지」 → [구, 동] */
const regionOf = (addr: string | null | undefined): [string | null, string | null] => {
  const p = (addr ?? "").split(" ");
  return [p[1] || null, p[2] || null];
};
const ko = (a: string, b: string) => a.localeCompare(b, "ko");
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

/** 필터 이름 pill — 누르면 아래에 선택지가 펼쳐지고, 밖을 누르면 닫힌다(2026-09-27 대표).
 *  고른 값이 있으면 이름 옆에 그 값을 적고 파랑으로 선다 */
function Pop({ label, val, open, onToggle, onClose, children }: {
  label: string; val: string | null; open: boolean;
  onToggle: () => void; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <span className="lx-rg" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onClose(); }}>
      <button className={`um-chip lx-pn ${val ? "on" : ""} ${open ? "open" : ""}`} onClick={onToggle}>
        {label}{val && <b>{val}</b>}<i>▾</i></button>
      {open && (
        <span className="lx-rg-pop lx-pop" tabIndex={-1}
          onKeyDown={(e) => { if (e.key === "Escape" || (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT")) onClose(); }}>
          {children}
        </span>
      )}
    </span>
  );
}

/** 범위 입력 — 빈 칸은 한쪽이 열린 범위 */
function RangeBody({ unit, v, onChange }: { unit: string; v: Range; onChange: (v: Range) => void }) {
  const num = (t: string) => { const x = parseFloat(t.replace(/,/g, "")); return Number.isFinite(x) ? x : null; };
  return (
    <span className="lx-rgin">
      <input autoFocus inputMode="decimal" defaultValue={v[0] ?? ""} placeholder="최소"
        onChange={(e) => onChange([num(e.target.value), v[1]])} />
      <span>~</span>
      <input inputMode="decimal" defaultValue={v[1] ?? ""} placeholder="최대"
        onChange={(e) => onChange([v[0], num(e.target.value)])} />
      <span>{unit}</span>
    </span>
  );
}
const rangeTxt = (v: Range, unit: string) =>
  v[0] == null && v[1] == null ? null : `${v[0]?.toLocaleString() ?? ""}~${v[1]?.toLocaleString() ?? ""}${unit}`;

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
  const [st, setSt] = useState<St | null>(null);
  const [who, setWho] = useState<number | null>(null);          // 담당 거르기
  const [major, setMajor] = useState<string | null>(null);      // 대분류 거르기
  const [kind, setKind] = useState<string | null>(null);        // 소분류 거르기
  const [flag, setFlag] = useState<null | "urgent" | "exclusive" | "hold" | "ad">(null);
  const [gu, setGu] = useState<string | null>(null);           // 지역 — 구, 고르면 동이 열린다
  const [dong, setDong] = useState<string | null>(null);
  const [grade, setGrade] = useState<string | null>(null);
  const [pvm, setPvm] = useState<string | null>(null);         // 시세대비
  const [ranges, setRanges] = useState<Record<RangeKey, Range>>({ price: [null, null], land: [null, null], total: [null, null] });
  const [pop, setPop] = useState<string | null>(null);
  const [chk, setChk] = useState<Chk | null>(null);            // 확인일 구간
  const [sel, setSel] = useState<Set<string>>(new Set());      // 이관할 줄
  const [busy, setBusy] = useState(false);         // 펼친 필터 하나
  // 기본 정렬 = 등록일 최신(부기사 기본). 열 머리와 정렬 pill 이 같은 값을 바꾼다
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean }>({ k: "received_on", asc: false });
  const [sortOpen, setSortOpen] = useState(false);
  const [add, setAdd] = useState(false);
  // 저장한 조건(대표 09-29) — 탐색에서 저장한 검색 조건을 골라 우리 매물 중 맞는 것만 본다.
  // 거르기는 탐색과 같은 검색 엔진이 한다(/search/pins · 우리 팀 매물). 표의 다른 필터와 겹쳐 걸린다
  const savedQ = useQuery({ queryKey: ["saved"], queryFn: savedApi.list });
  const [cond, setCond] = useState<{ id: number; name: string } | null>(null);
  const condC = savedQ.data?.find((c) => c.id === cond?.id) ?? null;
  const condPins = useQuery({
    queryKey: ["condPins", cond?.id],
    queryFn: () => searchApi.pins({ ...condRequest(condC!.conditions_json, members.data ?? []), tab: "ad", chip: "mine", for_model: true }),
    enabled: !!condC,
  });
  const condSet = useMemo(() => (condPins.data ? new Set(condPins.data.map((p) => p.building_pk)) : null), [condPins.data]);

  const list = rows.data ?? [];
  const nameOf = (id: number | null | undefined) => members.data?.find((m) => m.account_id === id)?.name ?? null;
  const laneRows = list.filter((r) => (st == null ? stOf(r) !== "done" : stOf(r) === st));

  const shown = useMemo(() => {
    const t = q.trim();
    const inRange = (r: Seller) => RANGES.every(({ k, of, per }) => {
      const [lo, hi] = ranges[k];
      if (lo == null && hi == null) return true;
      const x = of(r);
      if (x == null) return false;              // 모르는 값은 범위를 걸면 빠진다
      return (lo == null || x >= lo * per) && (hi == null || x <= hi * per);
    });
    let out = laneRows.filter((r) =>
      (cond == null || (condSet != null && condSet.has(r.building_pk)))
      && (!t || [r.addr, r.owner_name, r.listing_no, nameOf(r.assignee_account_id), r.memo_text]
        .some((x) => (x ?? "").includes(t)))
      && (who == null || r.assignee_account_id === who)
      && (gu == null || regionOf(r.addr)[0] === gu)
      && (dong == null || regionOf(r.addr)[1] === dong)
      && (major == null || r.building_major === major)
      && (kind == null || (r.building_use ?? []).includes(kind))
      && (grade == null || r.grade === grade)
      && (pvm == null || r.price_vs_market === pvm)
      && (flag == null || (flag === "urgent" ? isUrgent(r) : flag === "hold" ? r.stop_id != null
        : flag === "ad" ? r.ad_state === "노출" : r.exclusive === true))
      && (chk == null || chkOf(daysSince(r.checked_on)) === chk)
      && inRange(r));
    {
      const v = (r: Seller): string | number | null =>
        sort.k === "received_on" ? r.received_on
        : sort.k === "updated_at" ? r.updated_at
        : sort.k === "listing_no" ? r.listing_no
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
  }, [laneRows, cond, condSet, q, who, gu, dong, major, kind, grade, pvm, flag, chk, ranges, sort, members.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 지역 칩 — 이 갈래에 실제로 있는 구·동만
  const gus = useMemo(() => [...new Set(laneRows.map((r) => regionOf(r.addr)[0]).filter(Boolean) as string[])].sort(ko), [laneRows]);
  const dongs = useMemo(() => gu == null ? [] : [...new Set(laneRows.filter((r) => regionOf(r.addr)[0] === gu)
    .map((r) => regionOf(r.addr)[1]).filter(Boolean) as string[])].sort(ko), [laneRows, gu]);
  const anyFilter = cond != null || chk != null || st != null || who != null || gu != null || major != null || kind != null || grade != null || pvm != null
    || flag != null || Object.values(ranges).some(([a, b]) => a != null || b != null);
  const reset = () => {
    setCond(null); setChk(null); setSt(null); setWho(null); setGu(null); setDong(null); setMajor(null); setKind(null); setGrade(null); setPvm(null);
    setFlag(null); setRanges({ price: [null, null], land: [null, null], total: [null, null] });
  };
  const cur = list.find((r) => r.building_pk === open?.pk) ?? null;
  const unknown = open && !rows.isLoading && !cur ? open.pk : null;   // 아직 안 담은 건물로 넘어왔다

  useEffect(() => {
    // 다른 화면에서 넘어온 매물이 지금 상태 필터에 가려 있으면 풀어 준다
    if (cur && laneRows.every((r) => r.building_pk !== cur.building_pk)) setSt(cur.s6_match ? "done" : null);
  }, [cur?.building_pk, cur?.has_owner]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 모달을 보는 동안 대화창의 대상 = 이 매물
  const setCtx = useTradeCtx((st) => st.setCtx);
  useEffect(() => {
    if (!cur) { setCtx(null); return; }
    setCtx({ kind: "owner", id: cur.owner_id ?? 0, label: cur.owner_name ?? shortAddr(cur.addr),
      building_pk: cur.building_pk, addr: cur.addr });
  }, [cur?.building_pk, cur?.owner_id, setCtx]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 오늘 확인 — 장부에 「확인」 한 줄. 확인일은 그 줄에서 저절로 선다(0182 트리거)
  const markChecked = async (pk: string) => {
    await contactsApi.create({ target_type: "listing", target_id: pk, kind: "확인", note: "확인" });
    rows.refetch();
    qc.invalidateQueries({ queryKey: ["contacts"] });
  };
  // 이관 — 고른 줄의 담당을 한꺼번에(부기사 「선택 → 담당 변경」)
  const transfer = async (to: number) => {
    setBusy(true);
    try { await Promise.all([...sel].map((pk) => listingsApi.claim(pk, to))); }
    finally { setBusy(false); }
    setSel(new Set());
    rows.refetch();
  };
  const toggleSel = (pk: string) => setSel((s0) => {
    const s1 = new Set(s0);
    if (s1.has(pk)) s1.delete(pk); else s1.add(pk);
    return s1;
  });
  const refresh = () => {
    rows.refetch();
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["timeline"] });
    onDone();
  };

  const th = (k: SortKey | null, label: string, cls = "") => (
    <th className={`${cls} ${k ? "s" : ""} ${sort.k === k ? "on" : ""}`}
      onClick={k ? () => setSort((s) => (s.k === k ? { k, asc: !s.asc } : { k, asc: true })) : undefined}>
      {label}{k && sort.k === k && <i>{sort.asc ? "↑" : "↓"}</i>}
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
        <input className="lt-q lx-q" value={q} placeholder="주소 · 소유자 · 매물번호 · 담당 · 메모"
          onChange={(e) => setQ(e.target.value)} />
        {(() => {
          const pp = (key: string, label: string, val: string | null, body: React.ReactNode) => (
            <Pop key={key} label={label} val={val} open={pop === key}
              onToggle={() => setPop(pop === key ? null : key)} onClose={() => setPop((o) => (o === key ? null : o))}>
              {body}
            </Pop>
          );
          const labOf = (k: string, c: string | null) => (c == null ? null : options(k).find((o) => o.code === c)?.label ?? c);
          const flagTxt = { urgent: "급매", exclusive: "전속", hold: "보류", ad: "광고 중" } as const;
          const mem = members.data ?? [];
          return <>
            {(savedQ.data ?? []).length > 0 && pp("cond", "저장한 조건", cond?.name ?? null,
              (savedQ.data ?? []).map((c) => chip(cond?.id === c.id, c.name,
                () => setCond(cond?.id === c.id ? null : { id: c.id, name: c.name }))))}
            {pp("st", "상태", ST.find(([k]) => k === st)?.[1] ?? null,
              ST.map(([k, l]) => chip(st === k, l, () => setSt(st === k ? null : k), list.filter((r) => stOf(r) === k).length)))}
            {pp("chk", "확인일", CHK.find(([k]) => k === chk)?.[1] ?? null,
              CHK.map(([k, l]) => chip(chk === k, l, () => setChk(chk === k ? null : k),
                laneRows.filter((r) => chkOf(daysSince(r.checked_on)) === k).length)))}
            {mem.length > 1 && pp("who", "담당", nameOf(who),
              mem.map((m) => chip(who === m.account_id, m.name, () => setWho(who === m.account_id ? null : m.account_id))))}
            {gus.length > 0 && pp("region", "지역", gu ? `${gu}${dong ? ` ${dong}` : ""}` : null, <>
              <span className="lx-pr">{gus.map((g) => chip(gu === g, g, () => { setGu(gu === g ? null : g); setDong(null); }))}</span>
              {dongs.length > 0 && <span className="lx-pr">{dongs.map((d) => chip(dong === d, d, () => setDong(dong === d ? null : d)))}</span>}
            </>)}
            {pp("major", "매물 유형", labOf("building_major", major),
              options("building_major").map((o) => chip(major === o.code, o.label, () => setMajor(major === o.code ? null : o.code))))}
            {pp("kind", "소분류", labOf("building_use", kind),
              options("building_use").map((o) => chip(kind === o.code, o.label, () => setKind(kind === o.code ? null : o.code))))}
            {pp("flag", "여부", flag ? flagTxt[flag] : null,
              (Object.keys(flagTxt) as (keyof typeof flagTxt)[]).map((f) => chip(flag === f, flagTxt[f], () => setFlag(flag === f ? null : f))))}
            {pp("grade", "등급", labOf("grade", grade),
              options("grade").map((o) => chip(grade === o.code, o.label, () => setGrade(grade === o.code ? null : o.code))))}
            {pp("pvm", "시세대비", labOf("price_vs_market", pvm),
              options("price_vs_market").map((o) => chip(pvm === o.code, o.label, () => setPvm(pvm === o.code ? null : o.code))))}
            {RANGES.map(({ k, label, unit }) => pp(k, label, rangeTxt(ranges[k], unit),
              <RangeBody unit={unit} v={ranges[k]} onChange={(v) => setRanges((m) => ({ ...m, [k]: v }))} />))}
            {anyFilter && <button className="lx-ic lx-reset" title="거르기 지움" onClick={reset}><Icon name="reset" size={13} /></button>}
          </>;
        })()}
        <span className="sp" />
        <span className="lx-rg" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSortOpen(false); }}>
          <button className="lx-sort" onClick={() => setSortOpen(!sortOpen)}>
            {SORTS.find(([k]) => k === sort.k)?.[1] ?? { addr: "주소", rent: "임대", next: "다음 일정" }[sort.k as string]}
            <i>{sort.asc ? "↑" : "↓"}</i></button>
          {sortOpen && (
            <span className="lx-rg-pop lx-sort-pop">
              {SORTS.map(([k, l]) => chip(sort.k === k, sort.k === k ? `${l} ${sort.asc ? "↑" : "↓"}` : l,
                () => setSort((s) => (s.k === k ? { k, asc: !s.asc } : { k, asc: k === "listing_no" }))))}
            </span>
          )}
        </span>
        <button className="lt-add" title="매물 등록" onClick={() => setAdd(true)}>
          <Icon name="plus" size={14} /></button>
      </div>
      {sel.size > 0 && (
        <div className="lx-selbar">
          <b>{sel.size}건</b><span>담당 넘기기</span>
          {(members.data ?? []).map((m) =>
            <button key={m.account_id} className="um-chip" disabled={busy} onClick={() => transfer(m.account_id)}>{m.name}</button>)}
          <span className="sp" />
          <button className="lx-ic on" title="선택 해제" onClick={() => setSel(new Set())}><Icon name="close" size={13} /></button>
        </div>
      )}
      <div className={`lx-wrap ${sel.size ? "selecting" : ""}`}>
        <table className="lx-t">
          <thead><tr>
            {th(null, "", "c-sel")}
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
                  <td className="c-sel" onClick={(e) => { e.stopPropagation(); toggleSel(r.building_pk); }}>
                    <button className={`lx-ck ${sel.has(r.building_pk) ? "on" : ""}`} title="고르기">
                      <Icon name="check" size={11} /></button>
                  </td>
                  <td className="c-ph"><Thumb pk={r.building_pk} id={r.photo_id} /></td>
                  <td className="c-no num">{r.listing_no ?? "—"}</td>
                  <td className="c-addr">
                    <b>{shortAddr(r.addr)}</b>
                    <span className="tags">
                      {r.is_vacant && <i>나대지</i>}
                      {isUrgent(r) && <i className="red">급매</i>}
                      {r.exclusive && <i className="blue">전속</i>}
                      {r.ad_state === "노출" && <i className="blue">광고</i>}
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
                    <button className="lx-ic" title="오늘 확인" onClick={() => markChecked(r.building_pk)}>
                      <Icon name="check" size={14} /></button>
                    <button className="lx-ic" title="건물 상세" onClick={() => openDetail(r.building_pk)}>
                      <Icon name="external" size={14} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <div className="lt-none">{list.length ? "맞는 매물이 없습니다" : "담은 매물이 없습니다"}</div>}
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
