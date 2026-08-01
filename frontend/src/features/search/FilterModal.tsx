import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchApi, savedApi, listingsApi, type AttrFilters } from "../../shared/api/endpoints";
import { GROUPS, type Field, type Group } from "./filterConfig";
import "./filter.css";

/* S01b 상세검색 필터 — 목업 S01b.html 정본. 7카테고리·60필드·컨트롤 8종·vchip/팝오버·지역 캐스케이드·저장/불러오기. */

type SliderVal = { lo?: number; hi?: number };
type Val = SliderVal | string[] | string;
export type Values = Record<string, Val>;

export interface RegionPick { bjd_code: string; label: string }
export interface FilterResult { values: Values; regions: RegionPick[]; filters: AttrFilters; polygon?: object | null }

const PY = 3.305785;
const isEmpty = (f: Field, v: Val | undefined): boolean => {
  if (v == null) return true;
  if (f.ctl === "slider") { const s = v as SliderVal; return s.lo == null && s.hi == null; }
  if (f.ctl === "text") return !(v as string).trim();
  return (v as string[]).length === 0;
};

/* vchip 값 요약 (목업 포맷: "100평 이상 200평 이하") */
function summary(f: Field, v: Val | undefined, unit: "평" | "㎡" = "평"): string {
  if (isEmpty(f, v)) return "전체";
  if (f.ctl === "slider") {
    const { lo, hi } = v as SliderVal; const u = dispUnit(f, unit);
    const D = (n: number) => toDisp(n, f, unit);
    if (lo != null && hi != null) return `${D(lo)}${u} ${f.ge ?? "이상"} ${D(hi)}${u} ${f.le ?? "이하"}`;
    if (lo != null) return `${D(lo)}${u} ${f.ge ?? "이상"}`;
    return `${D(hi!)}${u} ${f.le ?? "이하"}`;
  }
  if (f.ctl === "text") return v as string;
  const arr = v as string[];
  return arr.length <= 2 ? arr.join(", ") : `${arr[0]} 외 ${arr.length - 1}`;
}

/* 면적 필드(평)는 헤더 토글에 따라 ㎡로 표시. 저장값=평(config 단위, 내부). */
const isArea = (f: Field) => f.unit === "평";
const dispUnit = (f: Field, u: "평" | "㎡") => (isArea(f) ? u : f.unit ?? "");
const toDisp = (n: number, f: Field, u: "평" | "㎡") => (isArea(f) && u === "㎡" ? Math.round(n * PY) : n);
const toStore = (n: number, f: Field, u: "평" | "㎡") => (isArea(f) && u === "㎡" ? +(n / PY).toFixed(1) : n);

/* ── 컨트롤: 듀얼 슬라이더 (목업 initSlider 정본) ── */
function Slider({ f, value, onChange, unit }: { f: Field; value: SliderVal; onChange: (v: SliderVal) => void; unit: "평" | "㎡" }) {
  const min = f.min ?? 0, max = f.max ?? 100, step = f.step ?? 1;
  const both = (f.handle ?? "dual") === "dual";
  const useLo = both || f.handle === "left";
  const useHi = both || f.handle === "right";
  const lo = value.lo ?? min, hi = value.hi ?? max;
  const pct = (n: number) => ((n - min) / (max - min)) * 100;
  const u = dispUnit(f, unit), d = (n: number) => toDisp(n, f, unit);
  const railRef = useRef<HTMLDivElement>(null);
  const [expand, setExpand] = useState(false);
  const full = isEmpty(f, value) && !expand;
  // 끝에 닿으면 무경계(undefined) = 무한: lo≤min → 하한 없음, hi≥max → 상한 없음(목업 fromSlider)
  const clampLo = (v: number): number | undefined => (v <= min ? undefined : v);
  const clampHi = (v: number): number | undefined => (v >= max ? undefined : v);
  const setIn = (k: "lo" | "hi", raw: string) => {
    if (raw === "") { onChange({ ...value, [k]: undefined }); return; }
    const n = toStore(Number(raw), f, unit);
    onChange({ ...value, [k]: k === "lo" ? clampLo(n) : clampHi(n) });
  };

  // ④ 눈금/레일 클릭 → handle 모드대로 핸들 이동(left=하한·right=상한·dual=가까운 쪽). 끝=무한.
  const moveHandle = (v: number) => {
    v = Math.max(min, Math.min(Math.round(v / step) * step, max));
    if (f.handle === "left") onChange({ ...value, lo: clampLo(v) });
    else if (f.handle === "right") onChange({ ...value, hi: clampHi(v) });
    else if (Math.abs(v - lo) <= Math.abs(v - hi)) onChange({ ...value, lo: clampLo(v) });
    else onChange({ ...value, hi: clampHi(v) });
  };
  const railClick = (e: React.MouseEvent) => {
    const r = railRef.current!.getBoundingClientRect();
    moveHandle(min + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (max - min));
  };

  // ⑤ 무한(끝) 포함 눈금 구성(목업 tk)
  const parsed = (f.ticks ?? "").split(",").filter(Boolean).map(Number);
  const tk: { v: number; l: string }[] = [];
  if (f.inflo) tk.push({ v: min, l: "무한" });
  parsed.forEach((v) => { if ((f.inflo && v === min) || v === max) return; tk.push({ v, l: `${d(v)}${u}` }); });
  tk.push({ v: max, l: f.inf ? "무한" : `${d(max)}${u}` });

  return (
    <div>
      <div className={`rs-io ${full ? "full" : ""}`} onClick={() => { if (full) setExpand(true); }}>
        <span className="rs-all">전체</span>
        <div className="rs-inputs">
          {useLo && <span className="lo-g"><input inputMode="numeric" value={value.lo != null ? d(value.lo) : ""} onFocus={() => setExpand(true)} onBlur={() => isEmpty(f, value) && setExpand(false)} onChange={(e) => setIn("lo", e.target.value)} /><span className="u">{u}</span><span className="ge">{f.ge ?? "이상"}</span></span>}
          {useHi && <span className="hi-g"><input inputMode="numeric" value={value.hi != null ? d(value.hi) : ""} onFocus={() => setExpand(true)} onBlur={() => isEmpty(f, value) && setExpand(false)} onChange={(e) => setIn("hi", e.target.value)} /><span className="u">{u}</span><span className="le">{f.le ?? "이하"}</span></span>}
        </div>
      </div>
      <div className="rs">
        <div ref={railRef} className="rs-rail" onClick={railClick}><div className="rs-sel" style={{ left: `${useLo ? pct(lo) : 0}%`, width: `${(useHi ? pct(hi) : 100) - (useLo ? pct(lo) : 0)}%` }} /></div>
        {useLo && <input type="range" min={min} max={max} step={step} value={lo} onChange={(e) => onChange({ ...value, lo: clampLo(Number(e.target.value)) })} />}
        {useHi && <input type="range" min={min} max={max} step={step} value={hi} onChange={(e) => onChange({ ...value, hi: clampHi(Number(e.target.value)) })} />}
        <div className="rs-ticks">
          {tk.map((t) => (
            <span key={t.v} className="rs-tick" style={{ left: `${pct(t.v)}%` }} onClick={() => moveHandle(t.v)}><i /><span>{t.l}</span></span>
          ))}
        </div>
      </div>
      {f.chips && (
        <div className="rchips">
          {f.chips.map((c) => <span key={c[0]} className="c" onClick={() => onChange({ lo: c[1] === "" ? undefined : c[1], hi: c[2] === "" ? undefined : c[2] })}>{c[0]}</span>)}
        </div>
      )}
    </div>
  );
}

/* ── 알약 다중선택(ms/segmulti) — 옵션 많으면 hscroll(아래로 쌓이는 wrap, 목업 드롭다운 대체) ── */
function PillMulti({ f, value, onChange, hscroll }: { f: Field; value: string[]; onChange: (v: string[]) => void; hscroll?: boolean }) {
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div className={`seg multi ${hscroll ? "hscroll" : ""}`}>
      {(f.opts ?? []).map((o) => <button key={o} className={value.includes(o) ? "on" : ""} onClick={() => toggle(o)}>{o}</button>)}
    </div>
  );
}

/* ── 섹터 그룹 ── */
function SectorGroup({ f, value, onChange }: { f: Field; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  const setSector = (items: string[], on: boolean) => {
    const s = new Set(value);
    items.forEach((i) => (on ? s.add(i) : s.delete(i)));
    onChange([...s]);
  };
  return (
    <div className="sector-ms">
      {f.presets && f.presets.length > 0 && (
        <div className="sec-presets"><span className="pl">빠른 선택</span>
          {f.presets.map((p) => { const on = p.items.every((i) => value.includes(i)); return <button key={p.name} className={`preset ${on ? "on" : ""}`} onClick={() => setSector(p.items, !on)}>{p.name}</button>; })}
        </div>
      )}
      {(f.sectors ?? []).map((sec) => {
        const sel = sec.items.filter((i) => value.includes(i)).length;
        const state = sel === 0 ? "" : sel === sec.items.length ? "all" : "part";
        return (
          <div key={sec.name} className={`sec ${open[sec.name] ? "open" : ""}`}>
            <div className="sec-head">
              <button className={`sec-chk ${state}`} onClick={() => setSector(sec.items, state !== "all")}><span className="box" />{sec.name}</button>
              <button className="sec-exp" onClick={() => setOpen((o) => ({ ...o, [sec.name]: !o[sec.name] }))}>▸</button>
            </div>
            <div className="sec-items">{sec.items.map((i) => <button key={i} className={`opt ${value.includes(i) ? "on" : ""}`} onClick={() => toggle(i)}>{i}</button>)}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ── 주용도 티어 2단 ── */
function TierMulti({ f, value, onChange }: { f: Field; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries((f.groups ?? []).map((g) => [g.name, !!g.open])));
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div className="tier-ms">
      {(f.groups ?? []).map((g) => (
        <div key={g.name} className={`tier ${open[g.name] ? "open" : ""}`}>
          <button className="tier-head" onClick={() => setOpen((o) => ({ ...o, [g.name]: !o[g.name] }))}><span className="tx">▸</span>{g.name}<span className="tier-n">{g.items.length}</span></button>
          <div className="tier-items">{g.items.map((i) => <button key={i} className={`opt ${value.includes(i) ? "on" : ""}`} onClick={() => toggle(i)}>{i}</button>)}</div>
        </div>
      ))}
    </div>
  );
}

/* ── 텍스트 + 프리셋칩 ── */
function TextChips({ f, value, onChange }: { f: Field; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <input className="txt" value={value} placeholder={f.ph} onChange={(e) => onChange(e.target.value)} />
      {f.tchips && <div className="tchips">{f.tchips.map((c) => <span key={c} className="tc" onClick={() => onChange(c)}>{c}</span>)}</div>}
    </div>
  );
}

function Control({ f, value, onChange, unit }: { f: Field; value: Val | undefined; onChange: (v: Val) => void; unit: "평" | "㎡" }) {
  switch (f.ctl) {
    case "slider": return <Slider f={f} value={(value as SliderVal) ?? {}} onChange={onChange} unit={unit} />;
    case "ms": return <PillMulti f={f} value={(value as string[]) ?? []} onChange={onChange} hscroll={f.dd} />;
    case "segmulti": return <PillMulti f={f} value={(value as string[]) ?? []} onChange={onChange} />;
    case "sector": return <SectorGroup f={f} value={(value as string[]) ?? []} onChange={onChange} />;
    case "tier": return <TierMulti f={f} value={(value as string[]) ?? []} onChange={onChange} />;
    case "text": return <TextChips f={f} value={(value as string) ?? ""} onChange={onChange} />;
  }
}

/* ── AttrFilters 직렬화: master 컬럼 매핑 필드. 나머지는 UI 전용(백엔드 확장 시 활성) ── */
// 용도지역: 모달 짧은형 → 마스터 풀형("...지역"). 도시지역미지정=미지정.
const ZONE_MAP: Record<string, string> = { "도시지역미지정": "미지정", "전용주거": "", "일반주거": "" };
const toZone = (z: string) => (z in ZONE_MAP ? ZONE_MAP[z] : `${z}지역`);
function toFilters(v: Values, members: { account_id: number; name: string }[] = []): AttrFilters {
  const sl = (label: string) => (v[label] as SliderVal | undefined) ?? {};
  const ms = (label: string) => (v[label] as string[] | undefined) ?? [];
  const area = (n?: number) => (n == null ? null : Math.round(n * PY));           // 평(native)→㎡
  const eok = (n?: number) => (n == null ? null : Math.round(n * 1e8));           // 억→원
  const man = (n?: number) => (n == null ? null : Math.round(n * 1e4));           // 만원→원
  const num = (n?: number) => n ?? null;
  const arr = (a: string[]) => (a.length ? a : null);
  const txt = (label: string) => ((v[label] as string | undefined)?.trim() || null);
  const seg1 = (label: string) => { const a = ms(label); return a.length === 1 ? a[0] : null; };  // 있음/없음 단일 선택만
  const la = sl("대지면적"), ta = sl("연면적"), ba = sl("건축면적"), pa = sl("토지면적"), fla = sl("용적률산정용연면적");
  const fa = sl("규모 지상"), fb = sl("규모 지하"), bc = sl("건폐율"), fr = sl("용적률");
  const lbc = sl("법정건폐율"), lfr = sl("법정용적률"), bslk = sl("건폐율 여유분"), fslk = sl("용적률 여유분");
  const st = sl("역과의거리"), age = sl("사용승인일"), rm = sl("대수선 경과연수"), el = sl("엘리베이터"), pkg = sl("주차장");
  const price = sl("매매가"), roi = sl("수익률(만실)"), roiv = sl("수익률(공실제외)");
  const ppl = sl("평단가(대지)"), ppt = sl("평단가(연면적)");
  const dep = sl("총보증금"), rent = sl("총임대료"), mgmt = sl("총관리비");
  const realPrice = sl("실거래가"), deal = sl("실거래일"), pnl = sl("실거래손익"), scnt = sl("실거래횟수");
  const gongsi = sl("최신 공시지가"), up5 = sl("공시지가 상승률 5년"), up10 = sl("공시지가 상승률 10년");
  const gratio = sl("총공시지가/매매가"), gtot = sl("공시지가 기준"), recv = sl("접수일");
  const zones = ms("용도지역").map(toZone).filter(Boolean);
  const assignees = ms("담당자").map((nm) => members.find((m) => m.name === nm)?.account_id).filter((x): x is number => x != null);
  return {
    use_zones: arr(zones), jimoks: arr(ms("지목")), land_uses: arr(ms("토지이용상황")),
    shapes: arr(ms("지형형상")), road_frontages: arr(ms("도로접면")), slopes: arr(ms("지세")),
    main_uses: arr(ms("주용도")),                          // DB main_use_name과 직접 일치
    etc_use: txt("기타용도"),
    land_area_min: area(la.lo), land_area_max: area(la.hi),
    total_area_min: area(ta.lo), total_area_max: area(ta.hi),
    build_area_min: area(ba.lo), build_area_max: area(ba.hi),
    parcel_area_min: area(pa.lo), parcel_area_max: area(pa.hi),
    far_area_min: area(fla.lo), far_area_max: area(fla.hi),
    elevator_min: num(el.lo), elevator_max: num(el.hi),
    parking_min: num(pkg.lo), parking_max: num(pkg.hi),
    floors_above_min: num(fa.lo), floors_above_max: num(fa.hi),
    floors_below_min: num(fb.lo), floors_below_max: num(fb.hi),
    bcr_min: num(bc.lo), bcr_max: num(bc.hi),
    far_min: num(fr.lo), far_max: num(fr.hi),
    legal_bcr_min: num(lbc.lo), legal_bcr_max: num(lbc.hi),
    legal_far_min: num(lfr.lo), legal_far_max: num(lfr.hi),
    bcr_slack_min: num(bslk.lo), bcr_slack_max: num(bslk.hi),
    far_slack_min: num(fslk.lo), far_slack_max: num(fslk.hi),
    station_dist_max: num(st.hi),
    age_min: num(age.lo), age_max: num(age.hi),
    remodel_years_min: num(rm.lo), remodel_years_max: num(rm.hi),
    // 금액·수익
    price_min: eok(price.lo), price_max: eok(price.hi),
    roi_min: num(roi.lo), roi_max: num(roi.hi),
    roi_exvac_min: num(roiv.lo), roi_exvac_max: num(roiv.hi),
    pp_land_min: man(ppl.lo), pp_land_max: man(ppl.hi),
    pp_total_min: man(ppt.lo), pp_total_max: man(ppt.hi),
    deposit_total_min: man(dep.lo), deposit_total_max: man(dep.hi),
    rent_total_min: man(rent.lo), rent_total_max: man(rent.hi),
    mgmt_total_min: man(mgmt.lo), mgmt_total_max: man(mgmt.hi),
    vacant: seg1("총공실"),
    // 공시·실거래
    gongsi_min: man(gongsi.lo), gongsi_max: man(gongsi.hi),
    gongsi_up5_min: num(up5.lo), gongsi_up5_max: num(up5.hi),
    gongsi_up10_min: num(up10.lo), gongsi_up10_max: num(up10.hi),
    gongsi_ratio_min: num(gratio.lo), gongsi_ratio_max: num(gratio.hi),
    gongsi_total_min: eok(gtot.lo), gongsi_total_max: eok(gtot.hi),
    last_sale_min: eok(realPrice.lo), last_sale_max: eok(realPrice.hi),
    last_sale_years_min: num(deal.lo), last_sale_years_max: num(deal.hi),
    sale_pnl_min: num(pnl.lo), sale_pnl_max: num(pnl.hi),
    sale_count_min: num(scnt.lo), sale_count_max: num(scnt.hi),
    float_pops: arr(ms("유동인구")),
    // 업무(listings)
    statuses: arr(ms("진행상태")), urgencies: arr(ms("긴급도")), grades: arr(ms("등급")), ipjis: arr(ms("입지")),
    owner_types: arr(ms("소유자타입")), relations: arr(ms("관계")), cooperations: arr(ms("협조도")), kindnesses: arr(ms("친절도")),
    building_uses: arr(ms("건물용도")), meongdos: arr(ms("명도")), use_changes: arr(ms("용도변경")), myeolsils: arr(ms("멸실")),
    assignees: assignees.length ? assignees : null,
    owner_name: txt("소유자명"), listing_no: txt("매물번호"),
    intent: seg1("매수의향서"), has_phone: seg1("전화번호"), has_photo: seg1("사진"),
    received_from: recv.lo != null ? `${Math.round(recv.lo)}-01-01` : null,
    received_to: recv.hi != null ? `${Math.round(recv.hi)}-12-31` : null,
  };
}

export function activeCount(v: Values, regions: RegionPick[]): number {
  let n = regions.length;
  GROUPS.forEach((g) => [...g.reps, ...g.body].forEach((f) => { if (!isEmpty(f, v[f.label])) n++; }));
  return n;
}

/* S01 칩바용 — 활성 조건 요약 목록 */
export function conditionChips(v: Values): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  GROUPS.forEach((g) => [...g.reps, ...g.body].forEach((f) => { if (!isEmpty(f, v[f.label])) out.push({ label: f.label, text: summary(f, v[f.label]) }); }));
  return out;
}

export function FilterModal({
  initialValues, initialRegions, initialPolygon, onApply, onClose, onDraw,
}: {
  initialValues?: Values; initialRegions?: RegionPick[]; initialPolygon?: object | null;
  onApply: (r: FilterResult) => void; onClose: () => void; onDraw?: () => void;
}) {
  const regionsQ = useQuery({ queryKey: ["regions"], queryFn: searchApi.regions });
  const saved = useQuery({ queryKey: ["saved"], queryFn: savedApi.list });
  const membersQ = useQuery({ queryKey: ["team-members"], queryFn: listingsApi.members });
  // 담당자 옵션 = 내 팀 멤버(런타임 주입). 하드코딩 대체.
  const groups = useMemo<Group[]>(() => {
    const names = (membersQ.data ?? []).map((m) => m.name);
    const inject = (f: Field) => (f.label === "담당자" ? { ...f, opts: names } : f);
    return GROUPS.map((g) => ({ ...g, reps: g.reps.map(inject), body: g.body.map(inject) }));
  }, [membersQ.data]);
  const [unit, setUnit] = useState<"평" | "㎡">("평");
  const [tab, setTab] = useState<"all" | number>("all");
  const [values, setValues] = useState<Values>(initialValues ?? {});
  const [regions, setRegions] = useState<RegionPick[]>(initialRegions ?? []);
  const [pgon, setPgon] = useState<object | null>(initialPolygon ?? null);   // 그린 영역(필터·저장 대상)
  const [gu, setGu] = useState("");
  const [pop, setPop] = useState<{ f: Field; x: number; y: number } | null>(null);
  const [showSave, setShowSave] = useState(false); const [showLoad, setShowLoad] = useState(false);
  const [saveName, setSaveName] = useState(""); const [saveWarn, setSaveWarn] = useState("");
  const popRef = useRef<HTMLDivElement>(null);

  const guList = Object.keys(regionsQ.data ?? {});
  const dongs = gu && regionsQ.data ? regionsQ.data[gu]?.dongs ?? [] : [];
  const count = activeCount(values, regions);

  const setVal = (label: string, val: Val) => setValues((s) => ({ ...s, [label]: val }));
  const clearVal = (label: string) => setValues((s) => { const n = { ...s }; delete n[label]; return n; });
  const openPop = (f: Field, e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPop({ f, x: Math.min(r.left, window.innerWidth - 356), y: Math.min(r.bottom + 6, window.innerHeight - 380) });
  };
  const addRegion = (val: string) => {               // 법정동 선택 즉시 조건 추가(목업)
    if (!gu || !val) return;
    let pick: RegionPick | null = null;
    if (val === "ALL") {                               // 구 전체 = sgg_code 5자리 prefix
      const sgg = regionsQ.data?.[gu]?.sgg_code;
      if (sgg) pick = { bjd_code: sgg, label: `${gu} 전체` };
    } else {
      const d = dongs.find((x) => x.bjd_code === val);
      if (d) pick = { bjd_code: val, label: `${gu} ${d.dong}` };
    }
    if (pick && !regions.some((r) => r.bjd_code === pick!.bjd_code)) setRegions([...regions, pick]);
  };

  const chip = (f: Field) => {
    const active = !isEmpty(f, values[f.label]);
    return (
      <span key={f.label} className={`vchip ${active ? "active" : ""}`} onClick={(e) => openPop(f, e)}>
        <span className="vc-l">{f.label}</span><span className="vc-v">{summary(f, values[f.label], unit)}</span>
        {active && <span className="clr" onClick={(e) => { e.stopPropagation(); clearVal(f.label); }}>×</span>}
      </span>
    );
  };

  return (
    <div className="s01b">
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          {/* 헤더 */}
          <div className="modal-head">
            <h2>상세검색</h2><span className="sub">S01 필터</span><span className="sp" />
            <span className="unit"><button className={unit === "평" ? "on" : ""} onClick={() => setUnit("평")}>평</button><button className={unit === "㎡" ? "on" : ""} onClick={() => setUnit("㎡")}>㎡</button></span>
            <button className="lnk" onClick={() => setShowLoad(true)}>불러오기</button>
            <button className="lnk" onClick={() => setShowSave(true)}>조건저장</button>
          </div>

          <div className="modal-body">
            {/* 지역 앵커 — 법정동 선택 즉시 조건 추가(목업) */}
            <div className="region">
              <div className="f"><label>시/도</label><select value="서울특별시" disabled><option>서울특별시</option></select></div>
              <div className="f"><label>시/군/구</label><select value={gu} onChange={(e) => setGu(e.target.value)}><option value="">선택</option>{guList.map((g) => <option key={g}>{g}</option>)}</select></div>
              <div className="f"><label>법정동 <small>선택 시 조건 추가 · 여러 개 가능</small></label>
                <select value="" disabled={!gu} onChange={(e) => addRegion(e.target.value)}>
                  <option value="">선택</option>
                  {gu && <option value="ALL">{gu} 전체</option>}
                  {dongs.map((d) => <option key={d.bjd_code} value={d.bjd_code}>{d.dong} ({d.count.toLocaleString()})</option>)}
                </select>
              </div>
            </div>
            {/* 영역 그리기 진입(S01 지도와 범위 공유) */}
            <div className="region-draw">
              <span className="rd-or">또는</span>
              <button className="rd-btn" onClick={onDraw}>🗺️ 지도에서 영역 그리기</button>
              <span className="rd-hint">행정경계로 못 자르는 임의 범위를 지도에 직접 그립니다</span>
            </div>

            {/* 적용 조건 칩바 */}
            <div className="applied-bar">
              <span className="albl">적용된 조건</span>
              {count === 0 && <span className="empty">아직 없음 — 카테고리에서 조건을 지정하세요</span>}
              {regions.map((r) => <span key={r.bjd_code} className="achip"><span className="k">지역</span>{r.label}<span className="x" onClick={() => setRegions(regions.filter((x) => x.bjd_code !== r.bjd_code))}>×</span></span>)}
              {groups.flatMap((g) => [...g.reps, ...g.body]).filter((f) => !isEmpty(f, values[f.label])).map((f) => (
                <span key={f.label} className="achip"><span className="k">{f.label}</span>{summary(f, values[f.label], unit)}<span className="x" onClick={() => clearVal(f.label)}>×</span></span>
              ))}
            </div>

            {/* 인덱스 + 패널 */}
            <div className="acc-title">검색 조건 · 카테고리</div>
            <div className="sb">
              <div className="idx">
                <button className={`idx-item ${tab === "all" ? "on" : ""}`} onClick={() => setTab("all")}><span className="il">⭐ 자주 찾는 조건</span><span className="badge zero">{count}</span></button>
                {groups.map((g, i) => {
                  const c = [...g.reps, ...g.body].filter((f) => !isEmpty(f, values[f.label])).length;
                  return <button key={g.t} className={`idx-item ${tab === i ? "on" : ""}`} onClick={() => setTab(i)}><span className="il">{g.t}</span><span className={`badge ${c ? "" : "zero"}`}>{c}</span></button>;
                })}
              </div>
              <div className="pane">
                {tab === "all" && (
                  <div className="fpanel on"><div className="p-hint">자주 쓰는 조건 — 칩을 눌러 바로 편집하세요. 세부조건은 왼쪽 카테고리에서 설정합니다.</div>
                    <div className="fav-wrap">{groups.flatMap((g) => g.reps).map(chip)}</div>
                  </div>
                )}
                {typeof tab === "number" && (
                  <div className="fpanel on">
                    <div className="p-head">{groups[tab].t}<button className="sec-reset" onClick={() => [...groups[tab].reps, ...groups[tab].body].forEach((f) => clearVal(f.label))}>초기화</button></div>
                    <div className="bodylbl">대표조건</div>
                    <div className="fav-wrap rep-grid">{groups[tab].reps.map(chip)}</div>
                    <div className="bodylbl">세부조건 {groups[tab].body.length}개</div>
                    <div className="fav-wrap">{groups[tab].body.map(chip)}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 하단 */}
          <div className="modal-foot">
            <button className="reset" onClick={() => { setValues({}); setRegions([]); }}>전체 초기화</button>
            <span className="applied">적용 조건 <b>{count}</b>개</span>
            <span className="sp" />
            <button className="cancel" onClick={onClose}>취소</button>
            <button className="apply" onClick={() => { onApply({ values, regions, filters: toFilters(values, membersQ.data ?? []), polygon: pgon }); onClose(); }}>적용</button>
          </div>
        </div>
      </div>

      {/* 값칩 팝오버 */}
      {pop && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={() => setPop(null)} />
          <div ref={popRef} className="s01b-popover show" style={{ left: pop.x, top: pop.y }} onClick={(e) => e.stopPropagation()}>
            <div className="pop-head"><span className="pt">{pop.f.label}</span><button className="pclr" onClick={() => { clearVal(pop.f.label); }}>이 조건 지우기</button></div>
            <div className="pop-slot"><div className="f"><Control f={pop.f} value={values[pop.f.label]} onChange={(val) => setVal(pop.f.label, val)} unit={unit} /></div></div>
          </div>
        </>
      )}

      {/* 조건 저장 */}
      {showSave && (
        <div className="s01b-mini-overlay show" onClick={() => setShowSave(false)}>
          <div className="mini" onClick={(e) => e.stopPropagation()}>
            <h3>조건 저장</h3><p className="mini-sub">현재 설정한 조건 <b>{count}</b>개를 이름을 붙여 저장</p>
            <input className="mini-input" value={saveName} placeholder="예: 강남 수익형 5%↑" onChange={(e) => setSaveName(e.target.value)} />
            <div className="mini-warn">{saveWarn}</div>
            <div className="mini-foot"><button className="mini-cancel" onClick={() => setShowSave(false)}>취소</button>
              <button className="mini-ok" onClick={async () => {
                if (!saveName.trim()) { setSaveWarn("이름을 입력하세요"); return; }
                if (count === 0 && !pgon) { setSaveWarn("저장할 조건이 없습니다"); return; }
                await savedApi.save(saveName.trim(), { values, regions, polygon: pgon } as Record<string, unknown>);
                setShowSave(false); setSaveName(""); setSaveWarn(""); saved.refetch();
              }}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 조건 불러오기 */}
      {showLoad && (
        <div className="s01b-mini-overlay show" onClick={() => setShowLoad(false)}>
          <div className="mini" onClick={(e) => e.stopPropagation()}>
            <h3>저장된 조건 불러오기</h3>
            <div className="preset-list">
              {(saved.data ?? []).length === 0 && <div className="preset-empty">저장된 조건이 없습니다</div>}
              {(saved.data ?? []).map((p) => {
                const c = p.conditions_json as { values?: Values; regions?: RegionPick[]; polygon?: object | null };
                return (
                  <div key={p.id} className="preset">
                    <div><div className="pn">{p.name}</div><div className="pc">조건 {activeCount(c.values ?? {}, c.regions ?? [])}개{c.polygon ? " · 영역" : ""}</div></div>
                    <span className="sp" />
                    <button className="pload" onClick={() => { setValues(c.values ?? {}); setRegions(c.regions ?? []); setPgon(c.polygon ?? null); setShowLoad(false); }}>불러오기</button>
                    <button className="pdel" onClick={async () => { await savedApi.remove(p.id); saved.refetch(); }}>삭제</button>
                  </div>
                );
              })}
            </div>
            <div className="mini-foot"><button className="mini-cancel" onClick={() => setShowLoad(false)}>닫기</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
