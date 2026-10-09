import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { contactsApi, listingsApi, proposalsApi, salesApi, savedApi, searchApi, statusesApi, type Seller } from "../../shared/api/endpoints";
import { condRequest, Conditions, type Values, type RegionPick } from "../search/FilterModal";
import { md, shortAddr, wonAcc } from "../../shared/format";
import { Loading } from "../../shared/ui/Spinner";
import { Icon } from "../../shared/ui/Icon";
import { useEnums } from "../../shared/hooks/useEnums";
import { openParcel } from "../../shared/map/geo";
import { useAuth } from "../../shared/store/auth";
import { isUrgent } from "./listingWord";
import { StatusBadge, StatusChips, useStatuses, useSetListingStatus } from "./Status";
import { StatusDictModal } from "./StatusDict";
import { ListingModal } from "./ListingModal";
import { AddListing } from "./AddListing";
import { UnifiedModal, type UniTab } from "./draft/UnifiedModal";
import { useTradeCtx } from "./tradeCtx";
import { touchListing } from "./recent";
import "./draft/salestab.css";

/* ══════════════════════ 매물 — 표 하나(2026-09-26) ══════════════════════
 *
 * 부기사처럼 매물 표가 첫 화면이다. 왼쪽 목록 + 오른쪽 판으로 나뉘어 있던 것을 표 하나로 합쳤다 —
 * 오른쪽 판(결정 문장·소유자·매수자 짝)은 모달의 「요약」 탭으로 들어갔다.
 * 줄을 누르면 모달, 조작은 줄 오른쪽 아이콘 하나(건물 상세)뿐이다.
 *
 * 확인일 = 사람이 이 매물에 남긴 마지막 기록의 날(listings.checked_on, 0182).
 * 대시보드 「재통화」와 같은 기준(7일)이라, 넘으면 빨강이다. */

/** 상태(0199) — 사무소가 만든 상태(부기사). 거르기 값은 상태 id, "none" 은 미지정. 자동 판정은 없다 */
type St = number | "none";
/** 확인일 구간(2026-09-28) — 부기사 「수정일 확인」. 색을 늘리지 않고 필터로 찾는다 */
type Chk = "m1" | "m3" | "m6" | "old" | "none";
const CHK: [Chk, string][] = [["m1", "1개월 안"], ["m3", "1~3개월"], ["m6", "3~6개월"], ["old", "6개월 넘음"], ["none", "기록 없음"]];
const chkOf = (d: number | null): Chk =>
  d == null ? "none" : d <= 30 ? "m1" : d <= 90 ? "m3" : d <= 180 ? "m6" : "old";
type SortKey = "received_on" | "updated_at" | "listing_no" | "addr" | "size" | "price" | "rent" | "roi" | "checked_on";
type RangeKey = "price" | "land" | "total";
type Range = [number | null, number | null];
/** 범위 거르기 — 입력 단위(억·평)와 저장 단위(원·㎡) 사이 환산 */
const RANGES: { k: RangeKey; label: string; unit: string; of: (r: Seller) => number | null | undefined; per: number }[] = [
  { k: "price", label: "금액", unit: "억", of: (r) => r.list_price ?? null, per: 1e8 },
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
const won = (v: number | null | undefined) => (v == null ? "" : Number(v) === 0 ? "0" : wonAcc(v));
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
  // 도구 줄이 가로 스크롤 상자라 그 안에 띄우면 잘린다 — 칸의 화면 좌표 바로 아래에 띄운다(10-02)
  const btn = useRef<HTMLButtonElement>(null);
  const r = open ? btn.current?.getBoundingClientRect() : null;
  return (
    <span className="lx-rg" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onClose(); }}>
      <button ref={btn} className={`lx-pn ${val ? "on" : ""} ${open ? "open" : ""}`} onClick={onToggle}>
        {label}{val && <b>{val}</b>}</button>
      {open && (
        <span className="lx-rg-pop lx-pop" tabIndex={-1} style={r ? { position: "fixed", left: r.left, top: r.bottom } : undefined}
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
function Thumb({ lid, id }: { lid: number; id: number | null | undefined }) {
  const access = useAuth((s) => s.access);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) { setUrl(null); return; }
    let obj: string | null = null, alive = true;
    fetch(`/api/listings/${lid}/photos/${id}`, { headers: { Authorization: `Bearer ${access}` } })
      .then((res) => (res.ok ? res.blob() : Promise.reject()))
      .then((b) => { obj = URL.createObjectURL(b); if (alive) setUrl(obj); else URL.revokeObjectURL(obj); })
      .catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [lid, id, access]);
  return <span className="lx-th">{url && <img src={url} alt="" />}</span>;
}

/** focus = 열 매물(매물 번호) · focusPnu = 다른 화면에서 넘어온 땅(지번) — 내 매물이면 그 줄, 아니면 담기 창 */
export function ListingsTab({ focus, focusPnu, focusTab, onDone, onBuyer }: {
  focus: number | null; focusPnu?: string | null; focusTab?: UniTab; onDone: () => void; onBuyer: (id: number) => void;
}) {
  const qc = useQueryClient();
  const { options } = useEnums();
  const rows = useQuery({ queryKey: ["sellers"], queryFn: () => salesApi.sellers() });
  const members = useQuery({ queryKey: ["team-members"], queryFn: listingsApi.members });
  type Open = { lid?: number; pnu?: string; tab?: UniTab };
  const of = (): Open | null => (focus != null ? { lid: focus, tab: focusTab } : focusPnu ? { pnu: focusPnu, tab: focusTab } : null);
  const [open, setOpen] = useState<Open | null>(of);
  useEffect(() => { const o = of(); if (o) setOpen(o); }, [focus, focusPnu, focusTab]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState("");
  const [st, setSt] = useState<St | null>(null);
  const [who, setWho] = useState<number | null>(null);          // 담당 거르기
  const [major, setMajor] = useState<string | null>(null);      // 대분류 거르기
  const [kind, setKind] = useState<string | null>(null);        // 소분류 거르기
  const [flag, setFlag] = useState<null | "urgent" | "exclusive" | "ad">(null);
  const statuses = useStatuses("listing");
  const setStatus = useSetListingStatus();
  // 상태를 고치는 줄 — 표 상자가 가로 스크롤이라 아래 줄에서 칩이 잘린다. 화면 좌표에 띄운다
  const [stPop, setStPop] = useState<{ lid: number; x: number; y: number } | null>(null);
  const [gu, setGu] = useState<string | null>(null);           // 지역 — 구, 고르면 동이 열린다
  const [dong, setDong] = useState<string | null>(null);
  const [grade, setGrade] = useState<string | null>(null);
  const [pvm, setPvm] = useState<string | null>(null);         // 시세대비
  const [ranges, setRanges] = useState<Record<RangeKey, Range>>({ price: [null, null], land: [null, null], total: [null, null] });
  const [pop, setPop] = useState<string | null>(null);
  const [chk, setChk] = useState<Chk | null>(null);            // 확인일 구간
  const [sel, setSel] = useState<Set<number>>(new Set());      // 이관할 줄(매물 번호)
  const [busy, setBusy] = useState(false);         // 펼친 필터 하나
  // 기본 정렬 = 등록일 최신(부기사 기본). 열 머리와 정렬 pill 이 같은 값을 바꾼다
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean }>({ k: "received_on", asc: false });
  const [add, setAdd] = useState(false);
  // 저장한 조건(대표 09-29) — 탐색에서 저장한 검색 조건을 골라 우리 매물 중 맞는 것만 본다.
  // 거르기는 탐색과 같은 검색 엔진이 한다(/search/pins · 우리 팀 매물). 표의 다른 필터와 겹쳐 걸린다
  const savedQ = useQuery({ queryKey: ["saved"], queryFn: savedApi.list });
  const [cond, setCond] = useState<{ id: number; name: string } | null>(null);
  const condC = savedQ.data?.find((c) => c.id === cond?.id) ?? null;
  // 필터(09-29) — 탐색과 같은 필터 창을 열어 그 자리에서 건 조건. 저장한 조건과 같은 길로 거른다(둘 중 하나만)
  const [stDict, setStDict] = useState(false);   // 매물 상태 사전(10-04 마이페이지에서 옮김)
  const [adhoc, setAdhoc] = useState<{ values: Values; regions: RegionPick[]; polygon: object | null; filters: Record<string, unknown> } | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const condJson: Record<string, unknown> | null = condC ? condC.conditions_json : adhoc;
  const condPins = useQuery({
    queryKey: ["condPins", cond?.id ?? null, adhoc ? JSON.stringify(adhoc) : null],
    queryFn: () => searchApi.pins({ ...condRequest(condJson!, members.data ?? []), tab: "ad", chip: "mine", for_model: true }),
    enabled: !!condJson,
  });
  const condSet = useMemo(() => (condPins.data ? new Set(condPins.data.map((p) => p.pnu)) : null), [condPins.data]);

  const list = rows.data ?? [];
  const nameOf = (id: number | null | undefined) => members.data?.find((m) => m.account_id === id)?.name ?? null;
  const laneRows = list.filter((r) => (st == null ? true : st === "none" ? r.status_id == null : r.status_id === st));

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
      (condJson == null || (condSet != null && condSet.has(r.pnu)))
      && (!t || [r.addr, r.owner_name, r.listing_no, nameOf(r.assignee_account_id), r.memo_text]
        .some((x) => (x ?? "").includes(t)))
      && (who == null || r.assignee_account_id === who)
      && (gu == null || regionOf(r.addr)[0] === gu)
      && (dong == null || regionOf(r.addr)[1] === dong)
      && (major == null || r.building_major === major)
      && (kind == null || (r.building_use ?? []).includes(kind))
      && (grade == null || r.grade === grade)
      && (pvm == null || r.price_vs_market === pvm)
      && (flag == null || (flag === "urgent" ? isUrgent(r)
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
                : sort.k === "roi" ? r.roi ?? null
                  : r.checked_on ?? null;
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
  }, [laneRows, condJson, condSet, q, who, gu, dong, major, kind, grade, pvm, flag, chk, ranges, sort, members.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 지역 칩 — 이 갈래에 실제로 있는 구·동만
  const gus = useMemo(() => [...new Set(laneRows.map((r) => regionOf(r.addr)[0]).filter(Boolean) as string[])].sort(ko), [laneRows]);
  const dongs = useMemo(() => gu == null ? [] : [...new Set(laneRows.filter((r) => regionOf(r.addr)[0] === gu)
    .map((r) => regionOf(r.addr)[1]).filter(Boolean) as string[])].sort(ko), [laneRows, gu]);
  const anyFilter = cond != null || adhoc != null || chk != null || st != null || who != null || gu != null || major != null || kind != null || grade != null || pvm != null
    || flag != null || Object.values(ranges).some(([a, b]) => a != null || b != null);
  const reset = () => {
    setCond(null); setAdhoc(null); setChk(null); setSt(null); setWho(null); setGu(null); setDong(null); setMajor(null); setKind(null); setGrade(null); setPvm(null);
    setFlag(null); setRanges({ price: [null, null], land: [null, null], total: [null, null] });
  };
  const cur = list.find((r) => (open?.lid != null ? r.listing_id === open.lid : !!open?.pnu && r.pnu === open.pnu)) ?? null;
  const unknown = open?.pnu && !rows.isLoading && !cur ? open.pnu : null;   // 아직 안 담은 땅으로 넘어왔다
  useEffect(() => { touchListing(cur?.listing_id ?? null); }, [cur?.listing_id]);

  useEffect(() => {
    // 다른 화면에서 넘어온 매물이 지금 상태 필터에 가려 있으면 풀어 준다
    if (cur && laneRows.every((r) => r.listing_id !== cur.listing_id)) setSt(null);
  }, [cur?.listing_id, cur?.has_owner]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 모달을 보는 동안 대화창의 대상 = 이 매물
  const setCtx = useTradeCtx((st) => st.setCtx);
  useEffect(() => {
    if (!cur) { setCtx(null); return; }
    setCtx({ kind: "owner", id: cur.owner_id ?? 0, label: cur.owner_name ?? shortAddr(cur.addr),
      listing_id: cur.listing_id, addr: cur.addr });
  }, [cur?.listing_id, cur?.owner_id, setCtx]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 오늘 확인 — 장부에 「확인」 한 줄. 확인일은 그 줄에서 저절로 선다(0182 트리거)
  const markChecked = async (lid: number) => {
    await contactsApi.create({ target_type: "listing", listing_id: lid, kind: "확인", note: "확인" });
    rows.refetch();
    qc.invalidateQueries({ queryKey: ["contacts"] });
  };
  // 고른 줄을 한꺼번에 고친다(부기사 「선택 → 변경」, 09-29) — 담당 · 상태 · 매물 칸(유형 · 소분류 · 등급 · 입지 · 노후도 · 전속).
  // 고른 채로 둔다 — 한 번에 여러 칸을 고치는 일이 흔하다. ✕ 로 푼다
  const [bpop, setBpop] = useState<string | null>(null);
  const bulk = async (fn: (lid: number) => Promise<unknown>) => {
    setBusy(true);
    try { await Promise.all([...sel].map(fn)); }
    finally { setBusy(false); }
    setBpop(null);
    rows.refetch();
    qc.invalidateQueries({ queryKey: ["statuses", "listing"] });
  };
  // 담당 바꾸기는 등록(claim)과 같은 길 — 지번으로 부른다
  const pnuOf = (lid: number) => list.find((r) => r.listing_id === lid)?.pnu ?? "";
  const transfer = (to: number) => bulk((lid) => listingsApi.claim(pnuOf(lid), to));
  const bulkField = (field: string, v: string | boolean | null) => bulk((lid) => listingsApi.patchBiz(lid, { [field]: v }));
  const toggleSel = (lid: number) => setSel((s0) => {
    const s1 = new Set(s0);
    if (s1.has(lid)) s1.delete(lid); else s1.add(lid);
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

  // 판(10-02) — 줄을 누르면 「주소」 열 오른쪽부터 화면 끝까지 붙는다. 목록(사진 · 번호 · 주소)은 남아
  // 판을 연 채로 다른 매물로 넘어간다. 자리는 목록 상자의 오른쪽 · 위 끝에서 잰다
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!cur) { setDock(null); return; }
    const measure = () => {
      const b = wrapRef.current?.getBoundingClientRect();
      if (b) setDock({ left: Math.round(b.right), top: Math.round(b.top) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [!!cur, sel.size]);   // eslint-disable-line react-hooks/exhaustive-deps
  // ↑ ↓ — 판을 연 채로 이전 · 다음 매물
  useEffect(() => {
    if (!cur) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if ((e.target as HTMLElement)?.closest?.("input, textarea, [contenteditable]")) return;
      const i = shown.findIndex((r) => r.listing_id === cur.listing_id);
      const nx = shown[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (nx) { e.preventDefault(); setOpen({ lid: nx.listing_id }); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [cur?.listing_id, shown]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (rows.isLoading) return <Loading label="불러오는 중" minHeight="40vh" />;
  return (
    <div className={`lx ${cur ? "docked" : ""}`}>
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
          const flagTxt = { urgent: "급매", exclusive: "전속", ad: "광고 중" } as const;
          const mem = members.data ?? [];
          return <>
            {/* 필터 — 탐색과 같은 필터 창. 건 조건 수가 이름 옆에 선다 */}
            <button className={`lx-pn ${adhoc ? "on" : ""}`} onClick={() => setShowFilter(true)}>
              <Icon name="filter" size={12} />조건{adhoc ? ` ${Object.keys(adhoc.values).length + (adhoc.regions.length ? 1 : 0) + (adhoc.polygon ? 1 : 0)}` : ""}</button>
            {(savedQ.data ?? []).length > 0 && pp("cond", "저장한 조건", cond?.name ?? null,
              (savedQ.data ?? []).map((c) => chip(cond?.id === c.id, c.name,
                () => { setAdhoc(null); setCond(cond?.id === c.id ? null : { id: c.id, name: c.name }); })))}
            {pp("st", "상태", st === "none" ? "미지정" : (statuses.data ?? []).find((x) => x.id === st)?.name ?? null, <>
              {(statuses.data ?? []).map((x) => chip(st === x.id, x.name, () => setSt(st === x.id ? null : x.id),
                list.filter((r) => r.status_id === x.id).length))}
              {chip(st === "none", "미지정", () => setSt(st === "none" ? null : "none"), list.filter((r) => r.status_id == null).length)}
              <button className="um-chip lx-stdict" onClick={() => setStDict(true)}><Icon name="settings" size={12} />상태 관리</button>
            </>)}
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
        {/* 정렬은 열 머리를 눌러서(10-02) — 정렬 pill 은 열 머리와 겹쳐서 뺐다. + 는 글자 버튼으로 */}
        <button className="lx-addb" onClick={() => setAdd(true)}>매물 등록</button>
        {stDict && <StatusDictModal onClose={() => setStDict(false)} />}
      </div>
      {/* 조건 — 탐색과 같은 왼쪽 판(10-02). 모달이 아니라 표 위를 덮는다 */}
      {showFilter && (
        <div className="lx-cond-bg" onClick={() => setShowFilter(false)}>
          <div className="lx-cond" onClick={(e) => e.stopPropagation()}>
            <Conditions initialValues={adhoc?.values} initialRegions={adhoc?.regions} initialPolygon={adhoc?.polygon ?? null}
              onApply={(r) => {
                const empty = !Object.keys(r.values).length && !r.regions.length && !r.polygon;
                setCond(null);
                setAdhoc(empty ? null : { values: r.values, regions: r.regions, polygon: r.polygon ?? null, filters: r.filters as Record<string, unknown> });
              }}
              onClose={() => setShowFilter(false)} />
          </div>
        </div>
      )}
      {sel.size > 0 && (
        <div className="lx-selbar">
          <b>{sel.size}건</b><span>한꺼번에 바꾸기</span>
          {(() => {
            const bp = (key: string, label: string, body: React.ReactNode) => (
              <Pop key={key} label={label} val={null} open={bpop === key}
                onToggle={() => setBpop(bpop === key ? null : key)} onClose={() => setBpop((o) => (o === key ? null : o))}>{body}</Pop>
            );
            const opt = (field: string, enumKey: string) => options(enumKey).map((o) =>
              <button key={o.code} className="um-chip" disabled={busy} onClick={() => bulkField(field, o.code)}>{o.label}</button>);
            return <>
              {bp("who", "담당", (members.data ?? []).map((m) =>
                <button key={m.account_id} className="um-chip" disabled={busy} onClick={() => transfer(m.account_id)}>{m.name}</button>))}
              {bp("st", "상태", <StatusChips kind="listing" value={null}
                onPick={(id, extra) => bulk((lid) => statusesApi.setListing(lid, { status_id: id, ...(extra ?? {}) }))} />)}
              {bp("major", "매물 유형", opt("building_major", "building_major"))}
              {/* 소분류는 여럿 — 고른 것을 **더한다**(이미 있는 소분류는 그대로) */}
              {bp("kind", "소분류 더하기", options("building_use").map((o) =>
                <button key={o.code} className="um-chip" disabled={busy} onClick={() => bulk((lid) => {
                  const cur = list.find((r) => r.listing_id === lid)?.building_use ?? [];
                  return cur.includes(o.code) ? Promise.resolve() : listingsApi.patchBiz(lid, { building_use: [...cur, o.code] });
                })}>{o.label}</button>))}
              {bp("grade", "등급", opt("grade", "grade"))}
              {bp("ipji", "입지", opt("ipji", "ipji"))}
              {bp("nohudo", "노후도", opt("nohudo", "nohudo"))}
              {bp("excl", "전속", <>
                <button className="um-chip" disabled={busy} onClick={() => bulkField("exclusive", true)}>전속</button>
                <button className="um-chip" disabled={busy} onClick={() => bulkField("exclusive", false)}>일반</button></>)}
            </>;
          })()}
          <span className="sp" />
          <button className="lx-ic on" title="선택 해제" onClick={() => setSel(new Set())}><Icon name="close" size={13} /></button>
        </div>
      )}
      <div ref={wrapRef} className={`lx-wrap ${sel.size ? "selecting" : ""}`}>
        <table className="lx-t">
          <thead><tr>
            {th(null, "", "c-sel")}
            {th(null, "", "c-ph")}
            {th("listing_no", "매물번호", "c-no")}
            {th("addr", "주소")}
            {th(null, "분류", "c-kind c-x")}
            {th("size", "규모", "c-size c-x")}
            {th("price", "금액", "r c-x")}
            {th("rent", "임대", "r c-rent c-x")}
            {th("roi", "수익률", "r c-roi c-x")}
            {th(null, "상태", "c-x")}
            {th(null, "소유자", "c-own c-x")}
            {th(null, "담당", "c-who c-x")}
            {th("checked_on", "확인일", "c-chk c-x")}
            {th(null, "", "c-act c-x")}
          </tr></thead>
          <tbody>
            {shown.map((r) => {
              const age = daysSince(r.checked_on);
              const stale = r.status_name !== "완료" && age != null && age > RECALL_DAYS;
              const kinds = [
                ...(r.building_major ? [options("building_major").find((o) => o.code === r.building_major)?.label ?? r.building_major] : []),
                ...(r.building_use ?? []).map((c) => options("building_use").find((o) => o.code === c)?.label ?? c)];
              return (
                <tr key={r.listing_id} className={cur?.listing_id === r.listing_id ? "on" : ""}
                  onClick={() => setOpen({ lid: r.listing_id })}>
                  <td className="c-sel" onClick={(e) => { e.stopPropagation(); toggleSel(r.listing_id); }}>
                    {/* 고르기 — 그리드 칸 전체가 체크(10-02): 고르면 칸이 연파랑 + 굵은 ✓ */}
                    <button className={`lx-ck ${sel.has(r.listing_id) ? "on" : ""}`} title="고르기"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></button>
                  </td>
                  <td className="c-ph"><Thumb lid={r.listing_id} id={r.photo_id} /></td>
                  <td className="c-no num">{r.listing_no ?? ""}</td>
                  <td className="c-addr">
                    <b>{shortAddr(r.addr)}</b>
                    <span className="tags">
                      {r.is_vacant && <i>나대지</i>}
                      {isUrgent(r) && <i className="red">급매</i>}
                      {r.exclusive && <i className="blue">전속</i>}
                      {r.ad_state === "노출" && <i className="blue">광고</i>}
                    </span>
                  </td>
                  <td className="c-kind">{kinds.length ? kinds.join(" · ") : ""}</td>
                  <td className="c-size num">
                    <span>{py(r.land_area) ? `대지 ${py(r.land_area)}평` : ""}</span>
                    <span className="sub">{[py(r.total_area) ? `연 ${py(r.total_area)}평` : "", floorsOf(r) ?? ""].filter(Boolean).join(" · ")}</span>
                  </td>
                  {/* 부기사처럼 한 칸에 쌓는다 — 이 매물의 매매가(0226) / 평단가(대지) / 매도희망가 */}
                  <td className="r num c-amt">
                    <b>{r.list_price != null ? wonAcc(r.list_price) : ""}
                      {r.price_vs_market && <i className="vs">{r.price_vs_market}</i>}</b>
                    <span className="sub">{r.pp_land != null ? `평단 ${won(r.pp_land)}` : ""}</span>
                    <span className="sub">{r.ask_price != null ? `희망 ${won(r.ask_price)}` : ""}</span>
                  </td>
                  {/* 보증금 / 월임대 / 관리비 */}
                  <td className="r num c-rent">
                    <span>{r.total_deposit != null ? `보 ${won(r.total_deposit)}` : ""}</span>
                    <span className="sub">{r.total_rent != null ? `월 ${won(r.total_rent)}` : ""}</span>
                    <span className="sub">{r.total_mgmt != null ? `관 ${won(r.total_mgmt)}` : ""}</span>
                  </td>
                  <td className="r num c-roi">{r.roi != null ? `${Number(r.roi).toFixed(2)}%` : ""}</td>
                  {/* 상태 — 눌러서 바로 고른다(0199). 고른 칩을 다시 누르면 미지정 */}
                  <td className="c-stx" onClick={(e) => {
                    e.stopPropagation();
                    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setStPop(stPop?.lid === r.listing_id ? null : { lid: r.listing_id, x: b.left, y: b.bottom });
                  }}>
                    <StatusBadge name={r.status_name} color={r.status_color} reason={r.hold_reason} />
                    {stPop?.lid === r.listing_id && (
                      <span className="lx-rg-pop stx-pop" style={{ position: "fixed", left: stPop.x, top: stPop.y }}
                        onClick={(e) => e.stopPropagation()} onMouseLeave={() => setStPop(null)}>
                        <StatusChips kind="listing" value={r.status_id} reason={r.hold_reason} sold={{ sold_on: r.sold_on, sold_price: r.sold_price }}
                          onPick={(id, extra) => { setStatus(r.listing_id, id, extra); setStPop(null); }} />
                      </span>
                    )}
                  </td>
                  <td className="c-own">{r.owner_name ?? ""}</td>
                  <td className="c-who">{nameOf(r.assignee_account_id) ?? ""}</td>
                  <td className={`c-chk num ${stale ? "red" : ""}`}>{r.checked_on ? md(r.checked_on) : ""}</td>
                  <td className="c-act" onClick={(e) => e.stopPropagation()}>
                    <button className="lx-ic" title="오늘 확인" onClick={() => markChecked(r.listing_id)}>
                      <Icon name="check" size={14} /></button>
                    <button className="lx-ic" title="건물 상세" onClick={() => openParcel(r.pnu)}>
                      <Icon name="external" size={14} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <div className="lt-none">{list.length ? "맞는 매물이 없습니다" : "담은 매물이 없습니다"}</div>}
      </div>

      {cur && dock && (
        <ListingHost key={cur.listing_id} r={cur} tab0={open?.tab} onBuyer={onBuyer} docked={dock}
          onClose={() => setOpen(null)} onDone={refresh} />
      )}
      {/* 매물 등록 = 주소 하나(10-02). 고르면 매물이 생기고 그 줄의 판이 열린다 */}
      {add && <AddListing onClose={() => setAdd(false)}
        onSaved={(lid) => { setAdd(false); refresh(); setOpen({ lid, tab: "info" }); }} />}
      {/* 다른 화면에서 아직 안 담은 건물로 넘어왔을 때 — 옛 담기 창(소유자 미리 채우기) */}
      {unknown && (
        <ListingModal preset={{ pnu: unknown }}
          onClose={() => setOpen(null)}
          onSaved={(lid) => { refresh(); setOpen({ lid, tab: "info" }); }} />
      )}
    </div>
  );
}

/** 모달 껍데기 — 이 매물의 매수자 짝을 불러 통합 모달에 넘긴다 */
function ListingHost({ r, tab0, onClose, onDone, onBuyer, docked }: {
  r: Seller; tab0?: UniTab; onClose: () => void; onDone: () => void; onBuyer: (id: number) => void;
  docked?: { left: number; top: number };
}) {
  const props = useQuery({ queryKey: ["proposals", "listing", r.listing_id],
    queryFn: () => proposalsApi.list({ listing_id: r.listing_id }) });
  return (
    <UnifiedModal r={r} buyers={props.data ?? []} tab0={tab0 ?? "info"} docked={docked}
      onClose={onClose} onBuyer={onBuyer}
      onSaved={() => { props.refetch(); onDone(); }} />
  );
}
