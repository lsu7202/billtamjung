import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchApi, savedApi, type AttrFilters } from "../../shared/api/endpoints";
import { GROUPS, type Field } from "./filterConfig";
import "./filter.css";

/* S01b 상세검색 필터 — 목업 S01b.html 정본. 7카테고리·60필드·컨트롤 8종·vchip/팝오버·지역 캐스케이드·저장/불러오기. */

type SliderVal = { lo?: number; hi?: number };
type Val = SliderVal | string[] | string;
export type Values = Record<string, Val>;

export interface RegionPick { bjd_code: string; label: string }
export interface FilterResult { values: Values; regions: RegionPick[]; filters: AttrFilters }

const PY = 3.305785;
const isEmpty = (f: Field, v: Val | undefined): boolean => {
  if (v == null) return true;
  if (f.ctl === "slider") { const s = v as SliderVal; return s.lo == null && s.hi == null; }
  if (f.ctl === "text") return !(v as string).trim();
  return (v as string[]).length === 0;
};

/* vchip 값 요약 */
function summary(f: Field, v: Val | undefined): string {
  if (isEmpty(f, v)) return "전체";
  if (f.ctl === "slider") {
    const { lo, hi } = v as SliderVal; const u = f.unit ?? "";
    if (lo != null && hi != null) return `${lo}~${hi}${u}`;
    if (lo != null) return `${lo}${u} ${f.ge ?? "이상"}`;
    return `${hi}${u} ${f.le ?? "이하"}`;
  }
  if (f.ctl === "text") return v as string;
  const arr = v as string[];
  return arr.length === 1 ? arr[0] : `${arr[0]} 외 ${arr.length - 1}`;
}

/* ── 컨트롤: 듀얼 슬라이더 ── */
function Slider({ f, value, onChange }: { f: Field; value: SliderVal; onChange: (v: SliderVal) => void }) {
  const min = f.min ?? 0, max = f.max ?? 100, step = f.step ?? 1;
  const both = (f.handle ?? "dual") === "dual";
  const useLo = both || f.handle === "left";
  const useHi = both || f.handle === "right";
  const lo = value.lo ?? min, hi = value.hi ?? max;
  const pct = (n: number) => ((n - min) / (max - min)) * 100;
  const ticks = (f.ticks ?? "").split(",").filter(Boolean).map(Number);
  const set = (k: "lo" | "hi", raw: string) => {
    const n = raw === "" ? undefined : Number(raw);
    onChange({ ...value, [k]: n });
  };
  return (
    <div>
      <div className={`rs-io ${isEmpty(f, value) ? "full" : ""}`}>
        <span className="rs-all">전체</span>
        <div className="rs-inputs">
          {useLo && <span className="lo-g"><input inputMode="numeric" value={value.lo ?? ""} onChange={(e) => set("lo", e.target.value)} /><span className="u">{f.unit}</span><span className="ge">{f.ge ?? "이상"}</span></span>}
          {useHi && <span className="hi-g"><input inputMode="numeric" value={value.hi ?? ""} onChange={(e) => set("hi", e.target.value)} /><span className="u">{f.unit}</span><span className="le">{f.le ?? "이하"}</span></span>}
        </div>
      </div>
      <div className="rs">
        <div className="rs-rail"><div className="rs-sel" style={{ left: `${useLo ? pct(lo) : 0}%`, width: `${(useHi ? pct(hi) : 100) - (useLo ? pct(lo) : 0)}%` }} /></div>
        {useLo && <input type="range" min={min} max={max} step={step} value={lo} onChange={(e) => onChange({ ...value, lo: Number(e.target.value) })} />}
        {useHi && <input type="range" min={min} max={max} step={step} value={hi} onChange={(e) => onChange({ ...value, hi: Number(e.target.value) })} />}
        <div className="rs-ticks">
          {ticks.map((t) => (
            <span key={t} className="rs-tick" style={{ left: `${pct(t)}%` }} onClick={() => onChange(useHi && !both ? { hi: t } : { ...value, lo: t })}><i /><span>{f.inf && t === min ? "무한" : t}</span></span>
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

/* ── 알약 다중선택(ms/segmulti) ── */
function PillMulti({ f, value, onChange }: { f: Field; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div className="seg multi">
      {(f.opts ?? []).map((o) => <button key={o} className={value.includes(o) ? "on" : ""} onClick={() => toggle(o)}>{o}</button>)}
    </div>
  );
}

/* ── 드롭다운 다중선택(ms dd) ── */
function DropdownMulti({ f, value, onChange }: { f: Field; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const opts = (f.opts ?? []).filter((o) => o.includes(q));
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div className="ms open">
      <div className="ms-box">
        {value.map((v) => <span key={v} className="tag">{v}<b onClick={() => toggle(v)}>×</b></span>)}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색·선택" />
      </div>
      <div className="ms-menu" style={{ position: "static", maxHeight: 200, marginTop: 5 }}>
        {opts.map((o) => <div key={o} className={`ms-opt ${value.includes(o) ? "sel" : ""}`} onClick={() => toggle(o)}>{value.includes(o) ? "✓ " : ""}{o}</div>)}
      </div>
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

function Control({ f, value, onChange }: { f: Field; value: Val | undefined; onChange: (v: Val) => void }) {
  switch (f.ctl) {
    case "slider": return <Slider f={f} value={(value as SliderVal) ?? {}} onChange={onChange} />;
    case "ms": return f.dd ? <DropdownMulti f={f} value={(value as string[]) ?? []} onChange={onChange} /> : <PillMulti f={f} value={(value as string[]) ?? []} onChange={onChange} />;
    case "segmulti": return <PillMulti f={f} value={(value as string[]) ?? []} onChange={onChange} />;
    case "sector": return <SectorGroup f={f} value={(value as string[]) ?? []} onChange={onChange} />;
    case "tier": return <TierMulti f={f} value={(value as string[]) ?? []} onChange={onChange} />;
    case "text": return <TextChips f={f} value={(value as string) ?? ""} onChange={onChange} />;
  }
}

/* ── 백엔드 지원 필드만 AttrFilters로 직렬화(나머지 UI 전용, 백엔드 추가 시 활성) ── */
const ZONE_MAP: Record<string, string> = {
  "제1종전용주거": "제1종전용주거지역", "제2종전용주거": "제2종전용주거지역", "제1종일반주거": "제1종일반주거지역",
  "제2종일반주거": "제2종일반주거지역", "제3종일반주거": "제3종일반주거지역", "준주거": "준주거지역",
  "중심상업": "중심상업지역", "일반상업": "일반상업지역", "근린상업": "근린상업지역", "유통상업": "유통상업지역",
  "전용공업": "전용공업지역", "일반공업": "일반공업지역", "준공업": "준공업지역",
  "보전녹지": "보전녹지지역", "생산녹지": "생산녹지지역", "자연녹지": "자연녹지지역",
};
function toFilters(v: Values, unit: "평" | "㎡"): AttrFilters {
  const sl = (label: string) => (v[label] as SliderVal | undefined) ?? {};
  const area = (n?: number) => (n == null ? null : unit === "평" ? Math.round(n * PY) : n); // 저장=㎡
  const zones = (v["용도지역"] as string[] | undefined)?.map((z) => ZONE_MAP[z]).filter(Boolean) ?? [];
  const la = sl("대지면적"), ta = sl("연면적"), fl = sl("규모 지상"), st = sl("역과의거리");
  const mainUse = ((v["기타용도"] as string) || "").trim() || null;
  return {
    use_zones: zones.length ? zones : null,
    main_use: mainUse,
    land_area_min: area(la.lo), land_area_max: area(la.hi),
    total_area_min: area(ta.lo), total_area_max: area(ta.hi),
    floors_above_min: fl.lo ?? null, floors_above_max: fl.hi ?? null,
    station_dist_max: st.hi ?? null,
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
  initialValues, initialRegions, onApply, onClose,
}: {
  initialValues?: Values; initialRegions?: RegionPick[];
  onApply: (r: FilterResult) => void; onClose: () => void;
}) {
  const regionsQ = useQuery({ queryKey: ["regions"], queryFn: searchApi.regions });
  const saved = useQuery({ queryKey: ["saved"], queryFn: savedApi.list });
  const [unit, setUnit] = useState<"평" | "㎡">("평");
  const [tab, setTab] = useState<"all" | number>("all");
  const [values, setValues] = useState<Values>(initialValues ?? {});
  const [regions, setRegions] = useState<RegionPick[]>(initialRegions ?? []);
  const [gu, setGu] = useState(""); const [dong, setDong] = useState("");
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
    setPop({ f, x: Math.min(r.left, window.innerWidth - 356), y: r.bottom + 6 });
  };
  const addRegion = () => {
    if (!gu || !dong) return;
    const d = dongs.find((x) => x.bjd_code === dong);
    if (d && !regions.some((r) => r.bjd_code === dong)) setRegions([...regions, { bjd_code: dong, label: `${gu} ${d.dong}` }]);
    setDong("");
  };

  const chip = (f: Field) => {
    const active = !isEmpty(f, values[f.label]);
    return (
      <span key={f.label} className={`vchip ${active ? "active" : ""}`} onClick={(e) => openPop(f, e)}>
        <span className="vc-l">{f.label}</span><span className="vc-v">{summary(f, values[f.label])}</span>
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
            <button className="close" onClick={onClose}>×</button>
          </div>

          <div className="modal-body">
            {/* 지역 앵커 */}
            <div className="region">
              <div className="f"><label>시/도</label><select value="서울특별시" disabled><option>서울특별시</option></select></div>
              <div className="f"><label>시/군/구</label><select value={gu} onChange={(e) => { setGu(e.target.value); setDong(""); }}><option value="">선택</option>{guList.map((g) => <option key={g}>{g}</option>)}</select></div>
              <div className="f"><label>법정동 <small>선택 시 조건 추가</small></label>
                <select value={dong} disabled={!gu} onChange={(e) => { setDong(e.target.value); }}><option value="">선택</option>{dongs.map((d) => <option key={d.bjd_code} value={d.bjd_code}>{d.dong} ({d.count.toLocaleString()})</option>)}</select>
              </div>
            </div>
            <div className="region-draw"><button className="rd-btn" onClick={addRegion} disabled={!dong}>＋ 지역 추가</button><span className="rd-hint">여러 지역 누적 가능 · 지도 영역 그리기는 지도 뷰에서</span></div>

            {/* 적용 조건 칩바 */}
            <div className="applied-bar">
              <span className="albl">적용된 조건</span>
              {count === 0 && <span className="empty">아직 없음 — 카테고리에서 조건을 지정하세요</span>}
              {regions.map((r) => <span key={r.bjd_code} className="achip"><span className="k">지역</span>{r.label}<span className="x" onClick={() => setRegions(regions.filter((x) => x.bjd_code !== r.bjd_code))}>×</span></span>)}
              {GROUPS.flatMap((g) => [...g.reps, ...g.body]).filter((f) => !isEmpty(f, values[f.label])).map((f) => (
                <span key={f.label} className="achip"><span className="k">{f.label}</span>{summary(f, values[f.label])}<span className="x" onClick={() => clearVal(f.label)}>×</span></span>
              ))}
            </div>

            {/* 인덱스 + 패널 */}
            <div className="acc-title">검색 조건 · 카테고리</div>
            <div className="sb">
              <div className="idx">
                <button className={`idx-item ${tab === "all" ? "on" : ""}`} onClick={() => setTab("all")}><span className="il">⭐ 자주 찾는 조건</span><span className="badge zero">{count}</span></button>
                {GROUPS.map((g, i) => {
                  const c = [...g.reps, ...g.body].filter((f) => !isEmpty(f, values[f.label])).length;
                  return <button key={g.t} className={`idx-item ${tab === i ? "on" : ""}`} onClick={() => setTab(i)}><span className="il">{g.t}</span><span className={`badge ${c ? "" : "zero"}`}>{c}</span></button>;
                })}
              </div>
              <div className="pane">
                {tab === "all" && (
                  <div className="fpanel on"><div className="p-hint">자주 쓰는 조건 — 칩을 눌러 바로 편집하세요. 세부조건은 왼쪽 카테고리에서 설정합니다.</div>
                    <div className="fav-wrap">{GROUPS.flatMap((g) => g.reps).map(chip)}</div>
                  </div>
                )}
                {typeof tab === "number" && (
                  <div className="fpanel on">
                    <div className="p-head">{GROUPS[tab].t}<button className="sec-reset" onClick={() => [...GROUPS[tab].reps, ...GROUPS[tab].body].forEach((f) => clearVal(f.label))}>초기화</button></div>
                    <div className="bodylbl">대표조건</div>
                    <div className="fav-wrap rep-grid">{GROUPS[tab].reps.map(chip)}</div>
                    <div className="bodylbl">세부조건 {GROUPS[tab].body.length}개</div>
                    <div className="fav-wrap">{GROUPS[tab].body.map(chip)}</div>
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
            <button className="apply" onClick={() => onApply({ values, regions, filters: toFilters(values, unit) })}>적용</button>
          </div>
        </div>
      </div>

      {/* 값칩 팝오버 */}
      {pop && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={() => setPop(null)} />
          <div ref={popRef} className="s01b-popover show" style={{ left: pop.x, top: pop.y }} onClick={(e) => e.stopPropagation()}>
            <div className="pop-head"><span className="pt">{pop.f.label}</span><button className="pclr" onClick={() => { clearVal(pop.f.label); }}>이 조건 지우기</button></div>
            <div className="pop-slot"><div className="f"><Control f={pop.f} value={values[pop.f.label]} onChange={(val) => setVal(pop.f.label, val)} /></div></div>
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
                if (count === 0) { setSaveWarn("저장할 조건이 없습니다"); return; }
                await savedApi.save(saveName.trim(), { values, regions } as Record<string, unknown>);
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
                const c = p.conditions_json as { values?: Values; regions?: RegionPick[] };
                return (
                  <div key={p.id} className="preset">
                    <div><div className="pn">{p.name}</div><div className="pc">조건 {activeCount(c.values ?? {}, c.regions ?? [])}개</div></div>
                    <span className="sp" />
                    <button className="pload" onClick={() => { setValues(c.values ?? {}); setRegions(c.regions ?? []); setShowLoad(false); }}>불러오기</button>
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
