import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchApi, savedApi, listingsApi, buyersApi, type AttrFilters } from "../../shared/api/endpoints";
import { GROUPS, type Field, type Group } from "./filterConfig";
import "./filter.css";
import { Icon } from "../../shared/ui/Icon";
import { Segmented } from "../../shared/ui/Segmented";

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
function toFilters(v: Values, members: { account_id: number; name: string }[] = []): AttrFilters {
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
  const lbc = sl("법정 건폐율"), lfr = sl("법정 용적률"), bslk = sl("건폐율 여유분"), fslk = sl("용적률 여유분");
  const pop = sl("유동인구");
  const st = sl("역과의거리"), age = sl("사용승인일"), rm = sl("대수선 및 리모델링 경과"), el = sl("엘리베이터"), pkg = sl("주차");
  // 팀 값과 추정값은 **다른 항목**이다(2026-08-27). 매매가 칸에 추정가를 채워 넣던 걸
  // 걷어냈으니, 추정가로 찾고 싶으면 추정가 항목으로 찾는다.
  // 값·수익률·평단가·공시총액 비율은 한 줄 안에서 갈래로 갈린다(2026-08-27).
  const price = pr("금액", "team"), est = pr("금액", "est");
  const roi = pr("수익률", "team"), roiEst = pr("수익률", "est");
  const roiv = sl("수익률(공실제외)");
  const ppl = pr("대지 평단가", "est"), pplTeam = pr("대지 평단가", "team");
  const ppt = pr("연면적 평단가", "est"), pptTeam = pr("연면적 평단가", "team");
  const dep = pr("보증금", "team"), depEst = pr("보증금", "est");
  const rent = pr("임대료", "team"), rentEst = pr("임대료", "est");
  const mgmt = sl("관리비");
  const realPrice = sl("실거래가"), deal = sl("실거래일"), pnl = sl("실거래손익"), scnt = sl("실거래횟수");
  const gongsi = sl("최신 공시지가"), up5 = sl("공시지가 상승률 5년"), up10 = sl("공시지가 상승률 10년");
  const gratio = pr("공시총액 비율", "est"), gratioTeam = pr("공시총액 비율", "team"), gtot = sl("공시지가 기준"), recv = sl("접수일");
  const zones = ms("용도지역").map(toZone).filter(Boolean);
  const assignees = ms("담당자").map((nm) => members.find((m) => m.name === nm)?.account_id).filter((x): x is number => x != null);
  return {
    use_zones: arr(zones), jimoks: arr(ms("지목")), land_uses: arr(ms("토지이용상황")),
    shapes: arr(ms("지형/형상")), road_frontages: arr(ms("도로접면")), slopes: arr(ms("지세")),
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
    sale_est_min: eok(est.lo), sale_est_max: eok(est.hi),
    rent_est_min: man(rentEst.lo), rent_est_max: man(rentEst.hi),
    deposit_est_min: man(depEst.lo), deposit_est_max: man(depEst.hi),
    roi_min: num(roi.lo), roi_max: num(roi.hi),
    roi_est_min: num(roiEst.lo), roi_est_max: num(roiEst.hi),
    roi_exvac_min: num(roiv.lo), roi_exvac_max: num(roiv.hi),
    pp_land_min: man(ppl.lo), pp_land_max: man(ppl.hi),
    pp_land_team_min: man(pplTeam.lo), pp_land_team_max: man(pplTeam.hi),
    pp_total_min: man(ppt.lo), pp_total_max: man(ppt.hi),
    pp_total_team_min: man(pptTeam.lo), pp_total_team_max: man(pptTeam.hi),
    deposit_total_min: man(dep.lo), deposit_total_max: man(dep.hi),
    rent_total_min: man(rent.lo), rent_total_max: man(rent.hi),
    mgmt_total_min: man(mgmt.lo), mgmt_total_max: man(mgmt.hi),
    vacant: seg1("공실"),
    // 공시·실거래
    gongsi_min: man(gongsi.lo), gongsi_max: man(gongsi.hi),
    gongsi_up5_min: num(up5.lo), gongsi_up5_max: num(up5.hi),
    gongsi_up10_min: num(up10.lo), gongsi_up10_max: num(up10.hi),
    gongsi_ratio_min: num(gratio.lo), gongsi_ratio_max: num(gratio.hi),
    gongsi_ratio_team_min: num(gratioTeam.lo), gongsi_ratio_team_max: num(gratioTeam.hi),
    gongsi_total_min: eok(gtot.lo), gongsi_total_max: eok(gtot.hi),
    last_sale_min: eok(realPrice.lo), last_sale_max: eok(realPrice.hi),
    last_sale_years_min: num(deal.lo), last_sale_years_max: num(deal.hi),
    sale_pnl_min: num(pnl.lo), sale_pnl_max: num(pnl.hi),
    sale_count_min: num(scnt.lo), sale_count_max: num(scnt.hi),
    pop_day_min: num(pop.lo), pop_day_max: num(pop.hi),   // 실측 생활인구(주간 평균, 명)
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
  initialValues, initialRegions, initialPolygon, initialHidden, onApply, onClose, onDraw,
}: {
  initialValues?: Values; initialRegions?: RegionPick[]; initialPolygon?: object | null;
  initialHidden?: string[];
  onApply: (r: FilterResult) => void; onClose: () => void; onDraw?: () => void;
}) {
  const regionsQ = useQuery({ queryKey: ["regions"], queryFn: searchApi.regions });
  const saved = useQuery({ queryKey: ["saved"], queryFn: savedApi.list });
  // 매수자 조건도 같은 목록에 선다(2026-08-16) — 조건이 두 곳에 흩어져 있으면
  // 「저장했는데 불러오기에 없다」가 된다. 여기서는 **불러오기만**(고치기·삭제는 그 사람 화면에서).
  const buyerConds = useQuery({ queryKey: ["buyers"], queryFn: () => buyersApi.list() });
  const bcList = (buyerConds.data ?? []).flatMap((b) =>
    (b.conditions ?? []).map((c) => ({ id: c.id, who: b.name, name: c.name,
      conditions_json: c.conditions_json as Record<string, unknown> })));
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
  const [pgon] = useState<object | null>(initialPolygon ?? null);   // 그린 영역(필터·저장 대상) — 그리기는 지도에서 한다
  const [gu, setGu] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  /* 조건을 만질 때마다 건수를 다시 센다(2026-08-27) — 닫기 전에 결과 크기를 알 수 있게.
     목록 조회는 무거워서 building_pk 만 세는 가벼운 요청을 따로 쓴다. */
  const liveFilters = useMemo(() => toFilters(values, membersQ.data ?? []), [values, membersQ.data]);
  const hitQ = useQuery({
    // 지역이 여러 개면 키도 여러 개여야 한다 — regions[0] 만 넣으면 둘째를 담아도 안 다시 센다
    queryKey: ["fcount", regions.map((r) => r.bjd_code).join(","), pgon, liveFilters],
    queryFn: () => searchApi.count({
      bjd_code: pgon ? undefined : regions[0]?.bjd_code,
      polygon: pgon ?? undefined, filters: liveFilters,
      mine_only: !regions.length && !pgon,
    }),
    placeholderData: (prev) => prev,
  });
  const hitCount = hitQ.data?.total ?? null;
  const [showSave, setShowSave] = useState(false); const [showLoad, setShowLoad] = useState(false);
  const [saveName, setSaveName] = useState(""); const [saveWarn, setSaveWarn] = useState("");
  const [renameId, setRenameId] = useState<number | null>(null);   // 저장조건 이름 편집 중인 항목
  const [renameVal, setRenameVal] = useState("");

  /** 조건을 확정해 부모로 넘긴다. '적용'과 '불러오기'가 같은 길을 타야 결과가 어긋나지 않는다.
   *  구만 고르고 동을 안 고른 경우 = 구 전체로 자동 등록 — 지역 없이 적용되면 검색이
   *  조용히 안 돌아서(enabled 게이트) 모든 필터가 "안 먹는" 것처럼 보이는 함정을 막는다. */
  function apply(v: Values, rs: RegionPick[], pg: object | null, hid?: string[]) {
    let regs = rs;
    const sgg = gu ? regionsQ.data?.[gu]?.sgg_code : null;
    if (sgg && !rs.some((r) => r.bjd_code.startsWith(sgg))) regs = [...rs, { bjd_code: sgg, label: `${gu} 전체` }];
    // **조건을 손대면 접어둔 것이 다시 나온다**(2026-08-29). 접기는 「이 조건에서 안 본다」인데
    // 조건이 달라졌으면 그 판단의 전제가 사라진 것이다. 저장 조건을 불러올 때만(hid) 딸려 온다.
    // 저장 조건 자체를 덮어쓰는 것은 조건을 손댄 게 아니라 갱신이라 접기가 유지된다.
    const changed = JSON.stringify(v) !== JSON.stringify(initialValues ?? {})
      || JSON.stringify(regs) !== JSON.stringify(initialRegions ?? [])
      || JSON.stringify(pg ?? null) !== JSON.stringify(initialPolygon ?? null);
    onApply({ values: v, regions: regs, filters: toFilters(v, membersQ.data ?? []), polygon: pg,
      hidden: hid ?? (changed ? [] : initialHidden ?? []) });
    onClose();
  }

  const guList = Object.keys(regionsQ.data ?? {});
  const dongs = gu && regionsQ.data ? regionsQ.data[gu]?.dongs ?? [] : [];
  const count = activeCount(values, regions);

  const setVal = (label: string, val: Val) => setValues((s) => ({ ...s, [label]: val }));
  const clearVal = (label: string) => setValues((s) => { const n = { ...s }; delete n[label]; return n; });
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

  /* 줄 문법(2026-08-27) — 줄엔 라벨과 현재 값만. 누르면 그 자리에서 펼쳐진다.
     예전엔 칩을 누르면 창 위에 창(팝오버)이 떠서 좌표를 화면 밖으로 안 밀리게 계산해야 했다. */
  const row = (f: Field) => {
    const active = !isEmpty(f, values[f.label]);
    const on = openRow === f.label;
    return (
      <div key={f.label} className={`frow ${on ? "open" : ""}`}>
        <div className="fr-h" onClick={() => setOpenRow(on ? null : f.label)}>
          <span className="fr-k">{f.label}</span>
          <span className={`fr-v ${active ? "" : "off"}`}>{summary(f, values[f.label], unit)}</span>
          {active
            ? <span className="fr-x" onClick={(e) => { e.stopPropagation(); clearVal(f.label); }}>✕</span>
            : <span className="fr-a">{on ? "▴" : "▾"}</span>}
        </div>
        {on && (
          <div className="fr-b" onClick={(e) => e.stopPropagation()}>
            <Control f={f} value={values[f.label]} onChange={(val) => setVal(f.label, val)} unit={unit} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="s01b">
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          {/* 헤더 */}
          <div className="modal-head">
            <h2>상세검색</h2><span className="sub">S01 필터</span><span className="sp" />
            <Icon name="unit" size={15} style={{ verticalAlign: "-3px", marginRight: 4 }} />
            <Segmented value={unit} onChange={setUnit} size="sm" options={[{ value: "평", label: "평" }, { value: "㎡", label: "㎡" }]} />
            <button className="lnk" onClick={() => setShowLoad(true)}><Icon name="load" size={13} style={{ verticalAlign: "-2px", marginRight: 3 }} />불러오기</button>
            <button className="lnk" onClick={() => setShowSave(true)}><Icon name="save" size={13} style={{ verticalAlign: "-2px", marginRight: 3 }} />조건저장</button>
          </div>

          <div className="modal-body">
            {/* 지역 — 조건이 아니라 **범위**다(2026-08-27). 다른 모든 조건이 그 안에서 걸린다.
                그래서 묶음 목록에 넣지 않고 창 맨 위에 둔다.
                3단 드롭다운을 칩으로 바꿨다: 여러 개를 담을 수 있고, 구만 고르고 동을 안 골라
                검색이 조용히 안 도는 함정이 없어진다. */}
            <div className="rgn">
              <span className="rgn-k">지역</span>
              {regions.map((r) => (
                <span key={r.bjd_code} className="rgn-c">{r.label}
                  <span className="x" onClick={() => setRegions(regions.filter((x) => x.bjd_code !== r.bjd_code))}>✕</span></span>
              ))}
              <span className="rgn-add">
                <select value={gu} onChange={(e) => setGu(e.target.value)}>
                  <option value="">＋ 구</option>
                  {guList.map((g) => <option key={g}>{g}</option>)}
                </select>
                {gu && (
                  <select value="" onChange={(e) => addRegion(e.target.value)}>
                    <option value="">＋ 동</option>
                    <option value="ALL">{gu} 전체</option>
                    {dongs.map((d) => <option key={d.bjd_code} value={d.bjd_code}>{d.dong} ({d.count.toLocaleString()})</option>)}
                  </select>
                )}
              </span>
              <span className="rgn-or">또는</span>
              <button className="rgn-draw" onClick={onDraw}>
                <Icon name="polygon" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />지도에서 영역 그리기</button>
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
                <button className={`idx-item ${tab === "all" ? "on" : ""}`} onClick={() => setTab("all")}><span className="il"><Icon name="star" size={13} style={{verticalAlign:"-2px",marginRight:3}} />자주 찾는 조건</span><span className="badge zero">{count}</span></button>
                {groups.map((g, i) => {
                  const c = [...g.reps, ...g.body].filter((f) => !isEmpty(f, values[f.label])).length;
                  return <button key={g.t} className={`idx-item ${tab === i ? "on" : ""}`}
                    onClick={() => { setTab(i); setOpenRow(null); }}>
                    <span className="il">{g.t}</span>
                    <span className={`badge ${c ? "" : "zero"}`}>{c}</span></button>;
                })}
              </div>
              <div className="pane">
                {tab === "all" && (
                  <div className="fpanel on">{groups.flatMap((g) => g.reps).map(row)}</div>
                )}
                {typeof tab === "number" && (
                  /* 묶음 안에서 한 번 더 가른다(2026-08-28) — 열두 줄이 같은 무게로 늘어서면
                     자주 쓰는 줄을 매번 눈으로 찾아야 한다. */
                  <div className="fpanel on">
                    <div className="fsec">자주</div>
                    {groups[tab].reps.map(row)}
                    {groups[tab].body.length > 0 && <div className="fsec">그 밖에</div>}
                    {groups[tab].body.map(row)}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 하단 */}
          <div className="modal-foot">
            <button className="reset" onClick={() => { setValues({}); setRegions([]); }}><Icon name="reset" size={13} style={{ verticalAlign: "-2px", marginRight: 3 }} />전체 초기화</button>
            <span className="applied">적용 조건 <b>{count}</b>개</span>
            <span className="sp" />
            <button className="cancel" onClick={onClose}>취소</button>
            {/* 「적용」과 「닫기」가 하나다 — 닫기 전에 결과 크기를 알 수 있게 건수를 적는다 */}
            <button className="apply" onClick={() => apply(values, regions, pgon)}>
              {hitCount != null ? `${hitCount.toLocaleString()}건 보기` : "적용"}</button>
          </div>
        </div>
      </div>

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
                await savedApi.save(saveName.trim(), { values, regions, polygon: pgon, hidden: initialHidden ?? [],
                  filters: toFilters(values, membersQ.data ?? []) } as Record<string, unknown>);
                setShowSave(false); setSaveName(""); setSaveWarn(""); saved.refetch();
              }}><Icon name="save" size={13} style={{ verticalAlign: "-2px", marginRight: 3 }} />저장</button>
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
              {(saved.data ?? []).length === 0 && bcList.length === 0
                && <div className="preset-empty">저장된 조건이 없습니다</div>}
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
                      <div className="pc">조건 {activeCount(c.values ?? {}, c.regions ?? [])}개{c.polygon ? " · 영역" : ""}</div>
                    </div>
                    <span className="sp" />
                    {/* 불러오기 = 그 자리에서 적용. 모달 값만 채워두고 「적용」을 또 누르게 하면
                        불러왔는데 아무 일도 안 일어난 것처럼 보인다. */}
                    <button className="pload" onClick={() => apply(c.values ?? {}, c.regions ?? [], c.polygon ?? null, (c.hidden ?? []).map(String))}><Icon name="load" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />불러오기</button>
                    <button className="pdel" title="이름 바꾸기"
                      onMouseDown={(e) => { e.preventDefault(); setRenameId(p.id); setRenameVal(p.name); }}><Icon name="edit" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />이름</button>
                    {/* 덮어쓰기 — 저장조건을 고쳐 쓰는 가장 흔한 길. 지우고 다시 저장하지 않아도 된다. */}
                    <button className="pdel" title="지금 화면의 조건으로 덮어쓰기"
                      onClick={async () => { await savedApi.update(p.id, { conditions: { values, regions, polygon: pgon, hidden: initialHidden ?? [],
                        filters: toFilters(values, membersQ.data ?? []) } as Record<string, unknown> }); saved.refetch(); }}><Icon name="save" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />덮어쓰기</button>
                    <button className="pdel" onClick={async () => { await savedApi.remove(p.id); saved.refetch(); }}><Icon name="trash" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />삭제</button>
                  </div>
                );
              })}
              {bcList.map((p) => {
                const c = p.conditions_json as { values?: Values; regions?: RegionPick[]; polygon?: object | null; hidden?: number[] };
                return (
                  <div key={`b${p.id}`} className="preset">
                    <div style={{ minWidth: 0 }}>
                      <div className="pn">{p.name}</div>
                      <div className="pc">{p.who} · 조건 {activeCount(c.values ?? {}, c.regions ?? [])}개{c.polygon ? " · 영역" : ""}</div>
                    </div>
                    <span className="sp" />
                    <button className="pload" onClick={() => apply(c.values ?? {}, c.regions ?? [], c.polygon ?? null, (c.hidden ?? []).map(String))}>
                      <Icon name="load" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />불러오기</button>
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
