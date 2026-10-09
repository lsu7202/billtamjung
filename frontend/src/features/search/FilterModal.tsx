import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUnit } from "../../shared/hooks/useUnit";
import { mergeGeo } from "../../shared/map/geo";
import { useQuery } from "@tanstack/react-query";
import { searchApi, savedApi, listingsApi, buyersApi, type AttrFilters } from "../../shared/api/endpoints";
import { GROUPS, type Field, type Group } from "./filterConfig";
import "./filter.css";
import { Icon } from "../../shared/ui/Icon";
import { useIsBroker } from "../../shared/store/auth";

/* S01b 상세검색 필터 — 목업 S01b.html 정본. 7카테고리·60필드·컨트롤 8종·vchip/팝오버·지역 캐스케이드·저장/불러오기. */

type SliderVal = { lo?: number; hi?: number };
/** 두 갈래 값 — 갈래키(est·team)별 범위. 둘을 동시에 걸 수 있다. */
type PairVal = Record<string, SliderVal>;
type Val = SliderVal | PairVal | string[] | string;
export type Values = Record<string, Val>;

export interface RegionPick { bjd_code: string; label: string }
export interface FilterResult { values: Values; regions: RegionPick[]; filters: AttrFilters; polygon?: object | null;
  /** 접어둔 건물 — 조건에 딸린 값이라 불러올 때 함께 온다(2026-08-28).
   *  building_pk 는 text 다(최장 22자리) — 숫자로 다루면 정밀도가 깨진다(2026-08-29). */
  hidden?: string[] }

const PY = 3.305785;
const isEmpty = (f: Field, v: Val | undefined): boolean => {
  if (v == null) return true;
  if (f.ctl === "slider") { const s = v as SliderVal; return s.lo == null && s.hi == null; }
  if (f.ctl === "pair") {
    const p = v as PairVal;
    return !(f.lanes ?? []).some((l) => p[l.key] && (p[l.key].lo != null || p[l.key].hi != null));
  }
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
  if (f.ctl === "pair") {
    const p = v as PairVal;
    return (f.lanes ?? [])
      .filter((l) => p[l.key] && (p[l.key].lo != null || p[l.key].hi != null))
      .map((l) => `${l.name} ${summary({ ...f, ctl: "slider" }, p[l.key], unit)}`)
      .join(" · ");
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
  const pct = (n: number) => Math.max(0, Math.min(100, ((n - min) / (max - min)) * 100));   // 범위 밖 직접입력값도 레일 안에 표시
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
    if (Number.isNaN(n)) return;
    // 직접입력은 슬라이더 범위 밖 값도 그대로 저장 — "끝=무한" 규칙은 드래그·클릭에만.
    // (기존엔 매매가 300억처럼 max 초과 입력이 무제한(undefined)으로 지워지는 버그)
    onChange({ ...value, [k]: n });
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
/* ── 계열 — 묶음을 먼저 고르고 그 안에서 낱개(2026-08-27).
   용도지역 20개·이용상황 43개·도로접면 12개를 한 줄에 늘어놓으면 화면을 덮는다.
   빠른선택(디벨롭)은 계열을 가로질러 고르므로 계열 줄 **위**에 따로 선다. */
function GroupPick({ f, value, onChange }: { f: Field; value: string[]; onChange: (v: string[]) => void }) {
  const series = f.series ?? [];
  const [openName, setOpenName] = useState<string | null>(() => {
    const hit = series.find((g) => g.items.some((i) => value.includes(i)));
    return hit?.name ?? series[0]?.name ?? null;
  });
  const toggle = (item: string) =>
    onChange(value.includes(item) ? value.filter((x) => x !== item) : [...value, item]);
  const pickSeries = (g: { name: string; items: string[] }) => {
    setOpenName(g.name);
    const all = g.items.every((i) => value.includes(i));
    onChange(all ? value.filter((x) => !g.items.includes(x))
                 : [...new Set([...value, ...g.items])]);
  };
  const open = series.find((g) => g.name === openName);
  return (
    <div className="gp">
      {(f.presets ?? []).length > 0 && (
        <div className="gp-l">
          <span className="gp-n">빠른선택</span>
          <div className="gp-c">
            {(f.presets ?? []).map((p) => {
              const on = p.items.length > 0 && p.items.every((i) => value.includes(i));
              return (
                <button key={p.name} className={`pill ${on ? "on" : ""}`}
                  onClick={() => onChange(on ? value.filter((x) => !p.items.includes(x))
                                             : [...new Set([...value, ...p.items])])}>
                  {p.name}<i>{p.items.length}</i>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="gp-l">
        <span className="gp-n">계열</span>
        <div className="gp-c">
          {series.map((g) => {
            const n = g.items.filter((i) => value.includes(i)).length;
            const cls = n === 0 ? "" : n === g.items.length ? "on" : "half";
            return (
              <button key={g.name} className={`pill ${cls} ${openName === g.name ? "cur" : ""}`}
                onClick={() => pickSeries(g)}>
                {g.name}{n > 0 && <i>{n}/{g.items.length}</i>}
              </button>
            );
          })}
        </div>
      </div>
      {open && (
        <div className="gp-l">
          <span className="gp-n">{open.name}</span>
          <div className="gp-c">
            {open.items.map((it) => (
              <button key={it} className={`pill ${value.includes(it) ? "on" : ""}`}
                onClick={() => toggle(it)}>{it}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 자주 — 계열이 없고 몇 개에 쏠린 항목(주용도 37개 중 다섯이 95%, 지목 24개 중 셋이 98%).
   자주 쓰는 것만 펴 두고 나머지는 「＋ N개」로 접는다. 검색은 접힌 것까지 찾는다. */
function TopPick({ f, value, onChange }: { f: Field; value: string[]; onChange: (v: string[]) => void }) {
  const top = f.top ?? [], rest = f.rest ?? [];
  const [more, setMore] = useState(() => rest.some((i) => value.includes(i)));
  const [q, setQ] = useState("");
  const toggle = (item: string) =>
    onChange(value.includes(item) ? value.filter((x) => x !== item) : [...value, item]);
  const hit = q.trim() ? [...top, ...rest].filter((i) => i.includes(q.trim())) : null;
  return (
    <div className="gp">
      <input className="gp-s" value={q} placeholder="이름으로 찾기"
        onChange={(e) => setQ(e.target.value)} />
      {hit ? (
        <div className="gp-l"><span className="gp-n">찾음</span>
          <div className="gp-c">
            {hit.length === 0 && <span className="gp-none">없습니다</span>}
            {hit.map((it) => (
              <button key={it} className={`pill ${value.includes(it) ? "on" : ""}`}
                onClick={() => toggle(it)}>{it}</button>
            ))}
          </div></div>
      ) : (
        <>
          <div className="gp-l"><span className="gp-n">자주</span>
            <div className="gp-c">
              {top.map((it) => (
                <button key={it} className={`pill ${value.includes(it) ? "on" : ""}`}
                  onClick={() => toggle(it)}>{it}</button>
              ))}
            </div></div>
          <div className="gp-l"><span className="gp-n">그 외</span>
            <div className="gp-c">
              {!more && <button className="pill more" onClick={() => setMore(true)}>＋ {rest.length}개</button>}
              {more && rest.map((it) => (
                <button key={it} className={`pill ${value.includes(it) ? "on" : ""}`}
                  onClick={() => toggle(it)}>{it}</button>
              ))}
            </div></div>
        </>
      )}
    </div>
  );
}

/* ── 값 입력 + 프리셋 칩 ── */
function TextChips({ f, value, onChange }: { f: Field; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <input className="tinput" value={value} placeholder={f.ph} onChange={(e) => onChange(e.target.value)} />
      {f.tchips && <div className="tchips">{f.tchips.map((c) => <span key={c} className="tc" onClick={() => onChange(c)}>{c}</span>)}</div>}
    </div>
  );
}

/* ── 두 갈래 — 값의 출처가 갈리는 항목(2026-08-27).
   추정 계열은 연파랑, 팀이 적은 값은 흰 바탕이다. 낱말로 가르면 이름이 길어지고
   묶음으로 가르면 목록이 늘어난다. 색과 자리로 가른다.
   위가 추정인 것은 처음 손이 가는 자리라서다 — 담은 매물이 없어도 결과가 나온다. */
function PairSlider({ f, value, onChange, unit }: {
  f: Field; value: PairVal; onChange: (v: PairVal) => void; unit: "평" | "㎡";
}) {
  return (
    <div className="pr">
      {(f.lanes ?? []).map((l) => (
        <div key={l.key} className={`pr-l ${l.tone}`}>
          <span className="pr-n">{l.name}</span>
          <div className="pr-b">
            <Slider f={f} value={value[l.key] ?? {}} unit={unit}
              onChange={(sv) => onChange({ ...value, [l.key]: sv as SliderVal })} />
          </div>
          {l.hint && <span className="pr-h">{l.hint}</span>}
        </div>
      ))}
    </div>
  );
}

function Control({ f, value, onChange, unit }: { f: Field; value: Val | undefined; onChange: (v: Val) => void; unit: "평" | "㎡" }) {
  switch (f.ctl) {
    case "slider": return <Slider f={f} value={(value as SliderVal) ?? {}} onChange={onChange} unit={unit} />;
    case "pair": return <PairSlider f={f} value={(value as PairVal) ?? {}} onChange={onChange} unit={unit} />;
    case "ms": return <PillMulti f={f} value={(value as string[]) ?? []} onChange={onChange} hscroll={f.dd} />;
    case "segmulti": return <PillMulti f={f} value={(value as string[]) ?? []} onChange={onChange} />;
    case "group": return <GroupPick f={f} value={(value as string[]) ?? []} onChange={onChange} />;
    case "top": return <TopPick f={f} value={(value as string[]) ?? []} onChange={onChange} />;
    case "text": return <TextChips f={f} value={(value as string) ?? ""} onChange={onChange} />;
  }
}

/* ── AttrFilters 직렬화: master 컬럼 매핑 필드. 나머지는 UI 전용(백엔드 확장 시 활성) ── */
// 용도지역: 모달 짧은형 → 마스터 풀형("...지역").
// 예전엔 「전용주거」·「일반주거」가 빈 문자열이 되고 filter(Boolean)이 지워서, 배열이 비면
// 조건이 통째로 사라졌다 — 0건이 아니라 **전체 결과**가 나오는데 칩은 켜져 있었다.
// 이제 옵션 목록에 서울 실측값만 두므로 특례가 필요 없다(모두 「…지역」을 붙이면 맞는다).
const toZone = (z: string) => `${z}지역`;
export function toFilters(v: Values, members: { account_id: number; name: string }[] = []): AttrFilters {
  const sl = (label: string) => (v[label] as SliderVal | undefined) ?? {};
  /** 두 갈래에서 한 갈래만 꺼낸다 — 추정(est)과 팀(team)은 다른 컬럼으로 간다 */
  const pr = (label: string, lane: string): SliderVal =>
    ((v[label] as Record<string, SliderVal> | undefined)?.[lane]) ?? {};
  const ms = (label: string) => (v[label] as string[] | undefined) ?? [];
  const area = (n?: number) => (n == null ? null : Math.round(n * PY));           // 평(native)→㎡
  const eok = (n?: number) => (n == null ? null : Math.round(n * 1e8));           // 억→원
  const man = (n?: number) => (n == null ? null : Math.round(n * 1e4));           // 만원→원
  const num = (n?: number) => n ?? null;
  const arr = (a: string[]) => (a.length ? a : null);
  const txt = (label: string) => ((v[label] as string | undefined)?.trim() || null);
  const seg1 = (label: string) => { const a = ms(label); return a.length === 1 ? a[0] : null; };  // 있음/없음 단일 선택만
  const la = sl("대지면적"), ta = sl("연면적"), ba = sl("건축면적"), pa = sl("토지면적"), fla = sl("용적산정 연면적");
  const fa = sl("지상 층수"), fb = sl("지하 층수"), bc = sl("건폐율"), fr = sl("용적률");
  const lbc = sl("법정 건폐율"), lfr = sl("법정 용적률"), bov = sl("법정 대비 건폐율"), fov = sl("법정 대비 용적률");
  const st = sl("역과의거리"), age = sl("사용승인일"), rm = sl("대수선 및 리모델링 경과"), el = sl("엘리베이터"), pkg = sl("주차");
  // 팀 값과 추정값은 **다른 항목**이다(2026-08-27). 매매가 칸에 추정가를 채워 넣던 걸
  // 걷어냈으니, 추정가로 찾고 싶으면 추정가 항목으로 찾는다.
  // 값·수익률·평단가·공시총액 비율은 한 줄 안에서 갈래로 갈린다(2026-08-27).
  const price = pr("금액", "team"), est = sl("추정가"), listing = sl("매매가"), road = sl("전면 도로폭");
  const roi = pr("수익률", "team");
  const ppl = pr("대지 평단가", "est"), pplTeam = pr("대지 평단가", "team");
  const ppt = pr("연면적 평단가", "est"), pptTeam = pr("연면적 평단가", "team");
  const dep = pr("보증금", "team");
  const rent = pr("임대료", "team");
  const mgmt = sl("관리비");
  const deal = sl("실거래일"), pnl = sl("실거래손익"), scnt = sl("실거래횟수");
  const gongsi = sl("최신 공시지가"), up5 = sl("공시지가 상승률 5년"), up10 = sl("공시지가 상승률 10년");
  const gratio = pr("공시총액 비율", "est"), gratioTeam = pr("공시총액 비율", "team"), gtot = sl("공시지가 기준"), recv = sl("접수일");
  const zones = ms("용도지역").map(toZone).filter(Boolean);
  const assignees = ms("담당자").map((nm) => members.find((m) => m.name === nm)?.account_id).filter((x): x is number => x != null);
  return {
    use_zones: arr(zones), jimoks: arr(ms("지목")),
    shapes: arr(ms("지형/형상")), road_frontages: arr(ms("도로접면")), slopes: arr(ms("지세")), kinds: arr(ms("매물 유형")),
    // 주용도 · 입주 업종은 모델과 같은 칸으로(09-30) — use(부분일치, 바깥 OR) · biz_dnf(업체 표)
    use: ms("주용도").length ? ms("주용도").map((u) => [u]) : null,
    biz_dnf: txt("입주 업종") ? [[txt("입주 업종")!]] : null,
    regulations: arr(ms("규제")),
    road_front_min: num(road.lo), road_front_max: num(road.hi),
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
    // 법정 대비 = 현재 − 법정(09-30). 옛 여유분(bcr_slack · 법정 − 현재)은 화면에서 안 건다
    bcr_over_min: num(bov.lo), bcr_over_max: num(bov.hi),
    far_over_min: num(fov.lo), far_over_max: num(fov.hi),
    station_dist_max: num(st.hi),
    age_min: num(age.lo), age_max: num(age.hi),
    remodel_years_min: num(rm.lo), remodel_years_max: num(rm.hi),
    // 금액·수익
    // 매매가(0224) — 매물 찾기 「매매가」 줄과 매물관리 「금액」 줄은 화면마다 하나만 서고 같은 칸으로 간다
    price_min: eok(listing.lo ?? price.lo), price_max: eok(listing.hi ?? price.hi),
    sale_est_min: eok(est.lo), sale_est_max: eok(est.hi),
    roi_min: num(roi.lo), roi_max: num(roi.hi),
    pp_land_min: man(ppl.lo), pp_land_max: man(ppl.hi),
    pp_land_sale_min: man(pplTeam.lo), pp_land_sale_max: man(pplTeam.hi),
    pp_total_min: man(ppt.lo), pp_total_max: man(ppt.hi),
    pp_total_sale_min: man(pptTeam.lo), pp_total_sale_max: man(pptTeam.hi),
    deposit_total_min: man(dep.lo), deposit_total_max: man(dep.hi),
    rent_total_min: man(rent.lo), rent_total_max: man(rent.hi),
    mgmt_total_min: man(mgmt.lo), mgmt_total_max: man(mgmt.hi),
    vacant: seg1("공실"),
    // 공시·실거래
    gongsi_min: man(gongsi.lo), gongsi_max: man(gongsi.hi),
    gongsi_up5_min: num(up5.lo), gongsi_up5_max: num(up5.hi),
    gongsi_up10_min: num(up10.lo), gongsi_up10_max: num(up10.hi),
    gongsi_ratio_min: num(gratio.lo), gongsi_ratio_max: num(gratio.hi),
    gongsi_ratio_sale_min: num(gratioTeam.lo), gongsi_ratio_sale_max: num(gratioTeam.hi),
    gongsi_total_min: eok(gtot.lo), gongsi_total_max: eok(gtot.hi),
    last_sale_years_min: num(deal.lo), last_sale_years_max: num(deal.hi),
    sale_pnl_min: num(pnl.lo), sale_pnl_max: num(pnl.hi),
    sale_count_min: num(scnt.lo), sale_count_max: num(scnt.hi),
    // 업무(listings)
    urgencies: arr(ms("긴급도")),
    owner_types: arr(ms("소유자타입")), relations: arr(ms("관계")), cooperations: arr(ms("협조도")), kindnesses: arr(ms("친절도")),
    meongdos: arr(ms("명도")), use_changes: arr(ms("용도변경")), myeolsils: arr(ms("멸실")),
    assignees: assignees.length ? assignees : null,
    owner_name: txt("소유자명"), listing_no: txt("매물번호"),
    intent: seg1("매수의향서"), has_phone: seg1("전화번호"), has_photo: seg1("사진"),
    received_from: recv.lo != null ? `${Math.round(recv.lo)}-01-01` : null,
    received_to: recv.hi != null ? `${Math.round(recv.hi)}-12-31` : null,
  };
}

/** 저장한 조건 → /search/pins 몸통. 새 조건은 request 를 싣고, 옛 조건은 화면 값에서 다시 만든다
 *  (탐색 화면이 적용할 때와 같은 길: 지역은 첫 구 · 매물 유형은 kinds). 매물관리 「저장한 조건」이 쓴다 */
export function condRequest(c: Record<string, unknown>, members: { account_id: number; name: string }[] = []):
  { bjd_code?: string | string[]; polygon?: object; filters: AttrFilters } {
  const req = c.request as { bjd_code?: string | string[]; polygon?: object; filters?: AttrFilters } | undefined;
  if (req) return { ...req, filters: req.filters ?? {} };
  const values = (c.values ?? {}) as Values;
  const { ["매물 유형"]: mk, ...rest } = values as Record<string, unknown>;
  const regions = (c.regions ?? []) as RegionPick[];
  const filters: AttrFilters = { ...(c.filters as AttrFilters | undefined ?? toFilters(rest as Values, members)) };
  if (Array.isArray(mk) && mk.length) (filters as Record<string, unknown>).kinds = mk;
  return { bjd_code: c.polygon || !regions.length ? undefined : regions.map((r) => r.bjd_code), polygon: (c.polygon as object | null) ?? undefined, filters };
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

/** 팀이 적는 값뿐인 줄 — 건물 조건만 볼 때 뺀다 */
const TEAM_ONLY = ["관리비", "공실"];

/** 지역 두 칸 고르기(대표 09-30) — 왼쪽 구, 오른쪽 그 구의 동. 여러 구 · 여러 동을 담는다.
 *  구를 누르면 동이 뜬다. 「전체」를 누르면 구 전체, 동을 누르면 그 동들(전체는 풀린다).
 *  구 = sgg_code 5자리, 동 = bjd_code 10자리 — 서버는 둘 다 접두로 받는다(여럿이면 OR). */
function RegionPicker({ data, regions, setRegions }: {
  data: Record<string, { sgg_code: string; dongs: { bjd_code: string; dong: string; count: number }[] }>;
  regions: RegionPick[]; setRegions: (r: RegionPick[]) => void;
}) {
  const gus = Object.keys(data);
  const [cur, setCur] = useState<string | null>(() => {
    const hit = gus.find((g) => regions.some((r) => r.bjd_code.startsWith(data[g].sgg_code)));
    return hit ?? null;
  });
  const inGu = (g: string) => regions.filter((r) => r.bjd_code.startsWith(data[g].sgg_code));
  const whole = (g: string) => regions.some((r) => r.bjd_code === data[g].sgg_code);
  const others = (g: string) => regions.filter((r) => !r.bjd_code.startsWith(data[g].sgg_code));
  // 구를 누르면 그 구의 동이 뜰 뿐 아무것도 담지 않는다(09-30 — 자동 전체 담기 기각). 전체도 동도 사람이 고른다
  const pickGu = (g: string) => setCur(g);
  const toggleAll = (g: string) =>
    setRegions(whole(g) ? others(g) : [...others(g), { bjd_code: data[g].sgg_code, label: `${g} 전체` }]);
  const toggleDong = (g: string, d: { bjd_code: string; dong: string }) => {
    const mine = inGu(g).filter((r) => r.bjd_code !== data[g].sgg_code);   // 전체를 빼고 남은 동들
    const on = mine.some((r) => r.bjd_code === d.bjd_code);
    const next = on ? mine.filter((r) => r.bjd_code !== d.bjd_code) : [...mine, { bjd_code: d.bjd_code, label: `${g} ${d.dong}` }];
    setRegions([...others(g), ...next]);
  };
  const c = cur ? data[cur] : null;
  return (
    <div className="rp">
      <div className="rp-gu">
        {gus.map((g) => {
          const n = inGu(g).length;
          return (
            <button key={g} className={`${cur === g ? "cur" : ""} ${n ? "has" : ""}`} onClick={() => pickGu(g)}>
              {g}
            </button>
          );
        })}
      </div>
      <div className="rp-dong">
        {c && cur && (
          <>
            <button className={whole(cur) ? "on" : ""} onClick={() => toggleAll(cur)}>전체</button>
            {c.dongs.map((d) => (
              <button key={d.bjd_code} className={regions.some((r) => r.bjd_code === d.bjd_code) ? "on" : ""}
                onClick={() => toggleDong(cur, d)}>{d.dong}</button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** 조건 본체(대표 09-30) — 사이드바(탐색)와 모달(매물관리)이 같이 쓴다.
 *  머리: 제목 · ☆저장한 조건 · ↺초기화 · ✕닫기. 몸: 지역(두 칸) · 영역 · 묶음별 줄을 위에서 아래로.
 *  발: 판 맨 아래 고정 「적용 (N건)」 — 「N건 적용」은 조건 N개로 읽혀서 바꿨다(10-02). 적용을 눌렀을 때만 걸린다. 평/㎡ 는 앱 전체 값(useUnit)을 따른다 */
export function Conditions({
  initialValues, initialRegions, initialPolygon, initialHidden, onApply, onClose, countTab, hideLabels = [], baseFilters,
  profile, draw, extra, onReset,
}: {
  initialValues?: Values; initialRegions?: RegionPick[]; initialPolygon?: object | null;
  initialHidden?: string[];
  onApply: (r: FilterResult) => void; onClose: () => void;
  /** 건수를 셀 기준 — 매물 찾기는 매물(ad), 구해요는 모든 건물(all). 없으면 예전 방식(지역 없으면 내 매물) */
  /** 건수를 어느 목록 기준으로 세나 — 매물 찾기 ad(빌탐정 매물만) · 구해요 all · 매물 탐색 explore(세 원천, S08) */
  countTab?: "ad" | "all" | "explore";
  /** 판 밖에서 이미 고르는 줄(예: 사이드바의 매물 유형) — 여기선 안 세운다 */
  hideLabels?: string[];
  /** 판 밖에서 걸린 조건(사이드바 매물 유형 등) — 건수를 셀 때 같이 건다. 그래야 적용 뒤 목록 수와 맞는다 */
  baseFilters?: AttrFilters;
  /** 어느 화면의 조건인가(09-30). 없으면 매물관리(팀 값 · 업무 조건까지).
   *  sale = 매물 찾기: 건물 조건 + 매매가(매물). seek = 구해요: 건물 조건 + 추정가.
   *  탐색 둘 다 매물 묶음 · 팀이 적은 값(두 갈래 줄 · 관리비 · 공실)은 없다 */
  profile?: "sale" | "seek";
  /** 판 맨 위에 끼우는 줄(매물관리 10-02) — 표에서 바로 거르는 매물 줄(상태 · 확인일 · 담당 …). 누르면 곧바로 걸린다 */
  extra?: React.ReactNode;
  /** ↺ 를 누르면 extra 쪽 값도 지운다 */
  onReset?: () => void;
  /** 그리기 도구(탐색) — 「지역」 머리 오른쪽에 자유곡선 · 다각형 · 원. 그린 영역은 부모가 쥐고 있다가 적용 때 걸린다 */
  draw?: {
    polygons: object[]; mode: "free" | "poly" | "circle" | null;
    onMode: (m: "free" | "poly" | "circle" | null) => void; onClear: () => void;
  };
}) {
  const regionsQ = useQuery({ queryKey: ["regions"], queryFn: searchApi.regions });
  const saved = useQuery({ queryKey: ["saved"], queryFn: savedApi.list });
  // 저장한 조건 = 내 조건 + 우리 팀 고객에 붙은 조건(S09 · 0214) — 한 목록에 고객 이름이 같이 선다.
  // 저장할 때 고객을 고르면 그 고객에 붙는다(중개사만). 고객 계정이 저장한 조건은 그 고객의 프로필 조건이다
  const broker = useIsBroker();
  const buyersQ = useQuery({ queryKey: ["buyers"], queryFn: () => buyersApi.list(), enabled: broker });
  const [saveFor, setSaveFor] = useState<number | null>(null);
  const membersQ = useQuery({ queryKey: ["team-members"], queryFn: listingsApi.members, enabled: !profile });
  const regsQ = useQuery({ queryKey: ["regulations"], queryFn: searchApi.regulationNames, staleTime: Infinity });
  // 기본 · 고급(09-30) — 기본은 누구나 아는 것만, 고급은 중개사가 쓰는 깊은 조건. 누구나 켤 수 있다. 사람마다 기억한다
  const [adv, setAdvRaw] = useState<boolean>(() => { try { return localStorage.getItem("bt_cond_adv") === "1"; } catch { return false; } });
  const [advFlash, setAdvFlash] = useState(0);   // 켤 때마다 새로 선 줄이 한 번 깜빡인다
  const setAdv = (v: boolean) => {
    setAdvRaw(v); if (v) setAdvFlash((n) => n + 1);
    try { localStorage.setItem("bt_cond_adv", v ? "1" : "0"); } catch { /* 사생활 모드 */ }
  };
  // 담당자 옵션 = 내 팀 멤버(런타임 주입)
  const groups = useMemo<Group[]>(() => {
    const names = (membersQ.data ?? []).map((m) => m.name);
    const regs = (regsQ.data ?? []).map((r) => r.name);
    const inject = (f: Field) => (f.label === "담당자" ? { ...f, opts: names }
      : f.label === "규제" ? { ...f, top: regs.slice(0, 10), rest: regs.slice(10) } : f);
    // 화면별로 빼는 줄 — 매물 찾기엔 추정가가, 구해요엔 매매가가, 매물관리엔 둘 다 없다
    const off = (f: Field): boolean => {
      if (!profile) return f.label === "매매가" || f.label === "추정가";
      if (f.label === (profile === "sale" ? "추정가" : "매매가")) return true;
      return TEAM_ONLY.includes(f.label) || f.ctl === "pair";   // 두 갈래 줄은 이제 팀 값뿐
    };
    const keep = (fs: Field[]) => fs.map(inject).filter((f) => !off(f) && !hideLabels.includes(f.label) && (adv || !f.adv));
    return GROUPS.filter((g) => !(profile && g.t === "매물"))
      .map((g) => ({ ...g, reps: keep(g.reps), body: keep(g.body) }))
      .filter((g) => g.reps.length + g.body.length > 0);
  }, [membersQ.data, regsQ.data, hideLabels, profile, adv]);
  const { unit: gu } = useUnit();
  const unit: "평" | "㎡" = gu === "py" ? "평" : "㎡";
  const [values, setValues] = useState<Values>(initialValues ?? {});
  const [regions, setRegions] = useState<RegionPick[]>(initialRegions ?? []);
  const [pgon0] = useState<object | null>(initialPolygon ?? null);
  // 그린 영역 — 그리기 도구가 있으면 부모가 쥔 목록(지도에 그리는 대로 쌓인다), 없으면 받은 것 그대로
  const pgon = draw ? mergeGeo(draw.polygons) : pgon0;
  const [openRow, setOpenRow] = useState<string | null>(null);
  /* 조건을 만질 때마다 건수를 다시 센다 — 적용 전에 결과 크기를 알 수 있게 */
  const liveFilters = useMemo(() => toFilters(values, membersQ.data ?? []), [values, membersQ.data]);
  const codes = regions.map((r) => r.bjd_code);
  const hitQ = useQuery({
    queryKey: ["fcount", codes.join(","), pgon, liveFilters, countTab, baseFilters],
    queryFn: () => searchApi.count({
      bjd_code: pgon || !codes.length ? undefined : codes,
      polygon: pgon ?? undefined, filters: { ...liveFilters, ...(baseFilters ?? {}) }, tab: countTab,
      // 매물 찾기는 중개사도 빌탐정 매물만 본다(S08 §7) — 건수도 같은 기준으로
      chip: countTab === "ad" ? "ads" : undefined,
      mine_only: !countTab && !regions.length && !pgon,
    }),
    placeholderData: (prev) => prev,
  });
  const hitCount = hitQ.data?.total ?? null;
  const [showSave, setShowSave] = useState(false); const [showLoad, setShowLoad] = useState(false);
  const [saveName, setSaveName] = useState(""); const [saveWarn, setSaveWarn] = useState("");
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");

  /** 조건을 확정해 부모로 넘긴다. '적용'과 '불러오기'가 같은 길을 탄다. */
  function apply(v: Values, rs: RegionPick[], pg: object | null, hid?: string[]) {
    // **조건을 손대면 접어둔 것이 다시 나온다**(2026-08-29). 저장 조건을 불러올 때만(hid) 딸려 온다.
    const changed = JSON.stringify(v) !== JSON.stringify(initialValues ?? {})
      || JSON.stringify(rs) !== JSON.stringify(initialRegions ?? [])
      || JSON.stringify(pg ?? null) !== JSON.stringify(initialPolygon ?? null);
    onApply({ values: v, regions: rs, filters: toFilters(v, membersQ.data ?? []), polygon: pg,
      hidden: hid ?? (changed ? [] : initialHidden ?? []) });
    onClose();
  }

  const count = activeCount(values, regions);
  const setVal = (label: string, val: Val) => setValues((s) => ({ ...s, [label]: val }));
  const clearVal = (label: string) => setValues((s) => { const n = { ...s }; delete n[label]; return n; });

  /* 줄 — 이름 칸 + 값 칸. 고르는 값이 적으면(열 개 이하) 칸을 바로 늘어놓고, 그 밖은 누르면 그 자리에서 열린다 */
  const row = (f: Field) => {
    const v = values[f.label];
    const active = !isEmpty(f, v);
    const flat = (f.ctl === "ms" || f.ctl === "segmulti") && (f.opts ?? []).length <= 10;
    const fx = f.adv && advFlash ? " adv-in" : "";
    const k = f.adv ? `${f.label}~${advFlash}` : f.label;   // 켤 때마다 다시 붙어 애니메이션이 다시 돈다
    if (flat) {
      const arr = (v as string[] | undefined) ?? [];
      return (
        <div key={k} className={`cn-row${fx}`}>
          <span className="cn-k">{f.name ?? f.label}</span>
          <div className="cn-cells">
            {(f.opts ?? []).map((o) => (
              <button key={o} className={arr.includes(o) ? "on" : ""}
                onClick={() => setVal(f.label, arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])}>{o}</button>
            ))}
          </div>
        </div>
      );
    }
    const on = openRow === f.label;
    return (
      <div key={k} className={`cn-row col ${on ? "open" : ""}${fx}`}>
        <div className="cn-h" onClick={() => setOpenRow(on ? null : f.label)}>
          <span className="cn-k">{f.name ?? f.label}</span>
          <span className={`cn-v ${active ? "" : "off"}`}>{summary(f, v, unit)}</span>
          {active && <span className="cn-x" title="지우기" onClick={(e) => { e.stopPropagation(); clearVal(f.label); }}>✕</span>}
        </div>
        {on && (
          <div className="cn-b" onClick={(e) => e.stopPropagation()}>
            <Control f={f} value={v} onChange={(val) => setVal(f.label, val)} unit={unit} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="s01b cdp">
      <div className="cn-top">
        <b>조건</b>
        <span className="sp" />
        {/* 고급모드 스위치 — 끄면 회색, 켜면 파랑 */}
        <button className={`cn-adv ${adv ? "on" : ""}`} role="switch" aria-checked={adv} onClick={() => setAdv(!adv)}>
          고급모드<i><b /></i></button>
        <button className="cn-ic" title="저장한 조건" onClick={() => setShowLoad(true)}><Icon name="star" size={17} /></button>
        <button className="cn-ic" title="초기화" onClick={() => { setValues({}); setRegions([]); onReset?.(); }}><Icon name="reset" size={17} /></button>
        <button className="cn-ic" title="닫기" onClick={onClose}><Icon name="close" size={17} /></button>
      </div>

      <div className="cn-body">
        {extra}
        <div className="cn-sec">지역
          {draw && (
            <span className="cn-tools">
              {([["free", "자유곡선"], ["poly", "다각형"], ["circle", "원"]] as const).map(([k, t]) => (
                <button key={k} className={draw.mode === k ? "on" : ""} onClick={() => draw.onMode(draw.mode === k ? null : k)}>{t}</button>
              ))}
              {draw.polygons.length > 0 && <button className="clr" onClick={draw.onClear}>지우기</button>}
            </span>
          )}
        </div>
        {regionsQ.data && <RegionPicker data={regionsQ.data} regions={regions} setRegions={setRegions} />}
        {/* 순서(09-30): 지역 → 금액 → 건물 · 토지 · 교통(· 매물) */}
        {groups.filter((g) => g.t === "금액").map((g) => (
          <div key={g.t}>
            <div className="cn-sec">{g.t}</div>
            {[...g.reps, ...g.body].map(row)}
          </div>
        ))}
        {groups.filter((g) => g.t !== "금액").map((g) => (
          <div key={g.t}>
            <div className="cn-sec">{g.t}</div>
            {[...g.reps, ...g.body].map(row)}
          </div>
        ))}

      </div>

      {/* 적용 — 판 맨 아래에 늘 붙어 있다. 글자가 곧 건수 */}
      <div className="cn-foot">
        <button className="cn-apply" onClick={() => apply(values, regions, pgon)}>
          {hitCount != null ? `적용 (${hitCount.toLocaleString()}건)` : "적용"}</button>
      </div>

      {/* 조건 저장 */}
      {showSave && (
        <div className="s01b-mini-overlay show" onClick={() => setShowSave(false)}>
          <div className="mini" onClick={(e) => e.stopPropagation()}>
            <h3>조건 저장</h3><p className="mini-sub">지금 조건 <b>{count}</b>개를 이름을 붙여 저장</p>
            <input className="mini-input" value={saveName} placeholder="예: 강남 수익형 5%↑" onChange={(e) => setSaveName(e.target.value)} />
            {/* 붙일 고객 — 고르면 그 고객의 조건(팀 전체가 본다), 안 고르면 내 조건. 고른 칸 재클릭 = 내 조건 */}
            {broker && (buyersQ.data ?? []).length > 0 && (
              <div className="mini-for">
                <span>고객</span>
                <div className="mini-for-c">{(buyersQ.data ?? []).map((b) => (
                  <button key={b.id} className={saveFor === b.id ? "on" : ""} onClick={() => setSaveFor(saveFor === b.id ? null : b.id)}>{b.name}</button>
                ))}</div>
              </div>
            )}
            <div className="mini-warn">{saveWarn}</div>
            <div className="mini-foot"><button className="mini-cancel" onClick={() => setShowSave(false)}>취소</button>
              <button className="mini-ok" onClick={async () => {
                if (!saveName.trim()) { setSaveWarn("이름을 입력하세요"); return; }
                if (count === 0 && !pgon) { setSaveWarn("저장할 조건이 없습니다"); return; }
                await savedApi.save(saveName.trim(), { values, regions, polygon: pgon, hidden: initialHidden ?? [],
                  filters: toFilters(values, membersQ.data ?? []) } as Record<string, unknown>, saveFor);
                setShowSave(false); setSaveName(""); setSaveWarn(""); setSaveFor(null); saved.refetch(); buyersQ.refetch();
              }}><Icon name="save" size={13} style={{ verticalAlign: "-2px", marginRight: 3 }} />저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 저장한 조건 — 불러오기 · 이름 · 덮어쓰기 · 삭제, 맨 아래 「지금 조건 저장」 */}
      {showLoad && (
        <div className="s01b-mini-overlay show" onClick={() => setShowLoad(false)}>
          <div className="mini" onClick={(e) => e.stopPropagation()}>
            <h3>저장한 조건</h3>
            <div className="preset-list">
              {(saved.data ?? []).length === 0 && <div className="preset-empty">저장된 조건이 없습니다</div>}
              {(saved.data ?? []).map((p) => {
                const c = p.conditions_json as { values?: Values; regions?: RegionPick[]; polygon?: object | null; hidden?: number[] };
                const editing = renameId === p.id;
                return (
                  <div key={p.id} className="preset">
                    <div style={{ minWidth: 0 }}>
                      {editing
                        ? <input className="input" autoFocus value={renameVal} style={{ padding: "2px 6px", maxWidth: 150 }}
                            onChange={(e) => setRenameVal(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === "Escape") setRenameId(null);
                              if (e.key === "Enter" && renameVal.trim()) {
                                await savedApi.update(p.id, { name: renameVal.trim() });
                                setRenameId(null); saved.refetch();
                              }
                            }}
                            onBlur={() => setRenameId(null)} />
                        : <div className="pn">{p.name}</div>}
                      <div className="pc">{p.buyer_name ? <b className="pc-who">{p.buyer_name}</b> : null}조건 {activeCount(c.values ?? {}, c.regions ?? [])}개{c.polygon ? " · 영역" : ""}</div>
                    </div>
                    <span className="sp" />
                    {/* 불러오기 = 그 자리에서 적용 */}
                    <button className="pload" onClick={() => apply(c.values ?? {}, c.regions ?? [], c.polygon ?? null, (c.hidden ?? []).map(String))}><Icon name="load" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />불러오기</button>
                    <button className="pdel" title="이름 바꾸기"
                      onMouseDown={(e) => { e.preventDefault(); setRenameId(p.id); setRenameVal(p.name); }}><Icon name="edit" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />이름</button>
                    <button className="pdel" title="지금 조건으로 덮어쓰기"
                      onClick={async () => { await savedApi.update(p.id, { conditions: { values, regions, polygon: pgon, hidden: initialHidden ?? [],
                        filters: toFilters(values, membersQ.data ?? []) } as Record<string, unknown> }); saved.refetch(); }}><Icon name="save" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />덮어쓰기</button>
                    <button className="pdel" onClick={async () => { await savedApi.remove(p.id); saved.refetch(); }}><Icon name="trash" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />삭제</button>
                  </div>
                );
              })}
            </div>
            <div className="mini-foot">
              <button className="mini-ok" onClick={() => { setShowLoad(false); setShowSave(true); }}>
                <Icon name="save" size={13} style={{ verticalAlign: "-2px", marginRight: 3 }} />지금 조건 저장</button>
              <button className="mini-cancel" onClick={() => setShowLoad(false)}>닫기</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 모달 틀(매물관리) — 본체는 사이드바와 같다 */
export function FilterModal(p: Parameters<typeof Conditions>[0]) {
  return createPortal((
    <div className="cdm-bg" onClick={p.onClose}>
      <div className="cdm" onClick={(e) => e.stopPropagation()}><Conditions {...p} /></div>
    </div>
  ), document.body);
}
