/** 보고서 단일 콘텐츠 모델 — 덱(ReportPage)·애니메이션(ReportStory) 공용.
 * ★ 값·분석 의견·종합 서술 등 '보고서에 들어가는 모든 내용'을 여기서 한 번만 계산한다.
 *   두 화면은 이 모델을 그대로 렌더만 하고 디자인(레이아웃·색·모션)만 다르게 한다 → 내용 불일치 원천 차단. */
import { useQuery } from "@tanstack/react-query";
import { reportsApi, buildingsApi, type CompUsed, type RentFloor } from "../../shared/api/endpoints";

export const P = 3.305785;
export const num = (x: unknown): number | null => (x == null || x === "" ? null : Number(x));
export const eok = (v: number | null | undefined, d = 0) => (v ? `${(v / 1e8).toFixed(d)}` : "—");
export const man = (v: number | null | undefined) => (v ? `${Math.round(v / 1e4).toLocaleString()}` : "—");
export const py = (m2: number | null | undefined) => (m2 ? (m2 / P).toFixed(2) : "—");
/** 원 → "X억 Y,YYY만원"(항상 만 단위까지, 정확한 금액). 0 자리는 생략. */
export const eokman = (won: number | null | undefined) => {
  if (won == null || won === 0) return "—";
  const neg = won < 0, w = Math.abs(won);
  let e = Math.floor(w / 1e8), mn = Math.round((w - e * 1e8) / 1e4);
  if (mn >= 10000) { e += 1; mn -= 10000; }
  const s = e && mn ? `${e.toLocaleString()}억 ${mn.toLocaleString()}만원` : e ? `${e.toLocaleString()}억원` : `${mn.toLocaleString()}만원`;
  return (neg ? "−" : "") + s;
};
/** 원 → [억 정수, 만 정수] — 카운트업 헤드라인용(억은 애니메이션, 만은 정적). */
export const eokManParts = (won: number | null | undefined): [number, number] => {
  if (!won) return [0, 0];
  const neg = won < 0, w = Math.abs(won);
  let e = Math.floor(w / 1e8), mn = Math.round((w - e * 1e8) / 1e4);
  if (mn >= 10000) { e += 1; mn -= 10000; }
  return [neg ? -e : e, mn];
};
export const word = (s: number) => s >= 90 ? "매우 우수" : s >= 80 ? "우수" : s >= 70 ? "양호" : s >= 60 ? "보통" : "미흡";

export const AXIS: [string, string][] = [
  ["road_access", "도로접면"], ["station_dist", "역과의거리"], ["use_zone", "용도지역"],
  ["shape", "지형형상"], ["approval_date", "사용승인일"], ["elevator", "엘리베이터"],
  ["remodel", "대수선·리모델링"], ["slope", "경사도"], ["float_pop", "유동인구"],
];
export const AXIS_ICON: Record<string, string> = {
  road_access: "road", station_dist: "train", use_zone: "zone", shape: "mountain",
  approval_date: "calendar", elevator: "elevator", remodel: "tools", slope: "slope", float_pop: "people",
};

/** 가치 항목별 '사실 기반' 의견 — 실제 필드값 + 점수대 평가. */
export function opinion(k: string, s: number, b: Record<string, any>): string {
  const A = s >= 90 ? "매우 우수합니다" : s >= 80 ? "우수합니다" : s >= 70 ? "양호합니다" : s >= 60 ? "무난합니다" : "다소 아쉽습니다";
  const yr = b.approval_ymd ? Number(String(b.approval_ymd).slice(0, 4)) : null;
  const age = yr ? new Date().getFullYear() - yr : null;
  switch (k) {
    case "road_access":
      return b.road_frontage ? `${b.road_frontage}에 접해 접근성과 건물 활용도가 ${A}` : `도로 접면 여건상 접근성이 ${A}`;
    case "station_dist":
      return b.station_dist != null ? `가장 가까운 역까지 약 ${Math.round(b.station_dist)}m로, 대중교통 접근성이 ${A}` : `역 접근성이 ${A}`;
    case "use_zone":
      return b.use_zone ? `${b.use_zone}에 속해 상업·업무 활용 잠재력이 ${A}` : `용도지역상 활용 잠재력이 ${A}`;
    case "shape":
      return b.shape ? `대지 형상이 ${b.shape}이라 토지 이용 효율이 ${A}` : `대지 형상상 이용 효율이 ${A}`;
    case "approval_date":
      return yr ? `${yr}년 준공(약 ${age}년차)으로, 건물 연식 여건이 ${A}` : `건물 연식 여건이 ${A}`;
    case "elevator":
      return (Number(b.elevator) || 0) > 0 ? `엘리베이터 ${b.elevator}대가 있어 상층부 접근성이 ${A}` : "엘리베이터가 없어 상층부 접근성이 다소 아쉽습니다";
    case "remodel":
      return b.remodel_ymd ? `${String(b.remodel_ymd).slice(0, 4)}년 대수선 이력이 있어 건물 관리 상태가 ${A}` : "대수선 이력이 없어 노후 관리 측면이 다소 아쉽습니다";
    case "slope":
      return b.slope ? `대지 경사가 ${b.slope}이라 건축·이용 여건이 ${A}` : `대지 경사 여건이 ${A}`;
    case "float_pop":
      return b.float_pop ? `유동인구가 ${b.float_pop} 수준으로, 상권 활력이 ${A}` : `상권 활력이 ${A}`;
    default:
      return `평가 결과 ${word(s)} 수준`;
  }
}

export type Seg = { t: string; b?: boolean };   // 서술 세그먼트(b=강조). 색·크기는 화면이 결정, 문구는 공용.

export function useReportModel(reportId: number | null, pkParam?: string) {
  const rq = useQuery({ enabled: reportId != null, queryKey: ["report", reportId], queryFn: () => reportsApi.get(reportId!) });
  const snap = rq.data?.result_json ?? null;
  const pk = reportId != null ? (rq.data?.building_pk ?? "") : (pkParam ?? "");
  const needLive = reportId == null || (!!rq.data && !snap);
  const cq = useQuery({ enabled: needLive && !!pk, queryKey: ["report-comps", pk], queryFn: () => reportsApi.comps(pk) });
  const bq = useQuery({ enabled: !!pk, queryKey: ["building", pk], queryFn: () => buildingsApi.get(pk) });

  const sub = snap?.subject ?? cq.data?.subject;
  const pv = snap?.preview ?? cq.data?.preview;
  const b = (bq.data ?? {}) as Record<string, any>;

  // ── 값(단일 계산) ──
  const saleEst = num(b.sale_est);
  const fair = reportId == null ? (saleEst ?? pv?.fair_price ?? null) : (pv?.fair_price ?? saleEst ?? null);
  const ask = pv?.ask_price ?? num(b.ask_price) ?? null;
  const rent = pv?.applied_rent ?? sub?.total_rent ?? null;
  const _floors0 = (pv?.rent_floors ?? []) as RentFloor[];
  const curRent = _floors0.length ? _floors0.reduce((s, f) => s + f.cur, 0) : (sub?.total_rent ?? null);
  const totalArea = sub?.total_area ?? num(b.total_area);
  const landArea = num(b.land_area);
  const totalP = totalArea ? totalArea / P : null;
  const avgPer = fair && totalP ? Math.round(fair / totalP) : (pv?.avg_per_pyeong ?? null);
  const usedComps = (pv?.comps_used ?? []) as CompUsed[];
  const comps = [...usedComps].sort((a, c) => (c.weight ?? 0) - (a.weight ?? 0)).slice(0, 4);
  const moreCount = Math.max(0, usedComps.length - comps.length);
  const avgPerNow = usedComps.length
    ? Math.round(usedComps.reduce((s, c) => s + (c.per_now || 0), 0) / usedComps.length) : null;
  const gLatest = num(b.gongsi_latest);
  const gTotal = gLatest && landArea ? gLatest * landArea : null;
  const gctx = pv?.gongsi_ctx ?? null;
  const nbhdGongsi = gctx?.nbhd_per_m2 ?? null;
  const gmult = gctx?.mult ?? null;
  const landPremium = gLatest && nbhdGongsi ? (gLatest / nbhdGongsi - 1) * 100 : null;
  const _perVals = comps.map((c) => c.per_now).filter((v): v is number => !!v);
  const compMin = _perVals.length ? Math.round(Math.min(..._perVals) / 1e4) : null;
  const compMax = _perVals.length ? Math.round(Math.max(..._perVals) / 1e4) : null;
  const floors = _floors0;
  const roiFair = rent && fair ? (rent * 12 / fair) * 100 : null;
  const rs = pv?.rent_summary ?? null;
  const rFloors = rs?.floor_count ?? floors.length;
  const rCurDep = rs?.cur_deposit ?? null;
  const perPyRent = curRent && totalArea ? curRent / (totalArea / P) : null;
  const upsidePct = (rent != null && curRent) ? ((rent - curRent) / curRent) * 100 : null;
  const nbhdRoi = rs?.nearby_roi ?? null;
  const topStrengths = AXIS.map(([k, l]) => ({ l, s: (sub?.items?.[k] ?? 0) as number }))
    .sort((a, c) => c.s - a.s).filter((x) => x.s >= 75).slice(0, 3).map((x) => x.l);
  const ut = pv?.use_type ?? null;
  const officeApt = (ut?.office_fit ?? 0) >= 65;
  const fut = ut?.future ?? null;

  const useZone = (b.use_zone as string) || "—";
  const mainUse = (b.main_use_name as string) || (b.main_use as string) || (b.etc_use as string) || "—";
  const grade = sub?.grade ?? "—";
  const score = sub?.score ?? 0;
  const gradeCol = grade === "S" ? "#B8912E" : grade === "A" ? "#2B5AA8" : grade === "B" ? "#1C8C63" : "#828A99";
  const addr = sub?.addr ?? "—";
  const shortAddr = addr.replace(/^서울특별시\s*/, "").replace(/\s*번지$/, "");

  // ── 분석 의견(9축) — 문구 단일 소스 ──
  const opinions = AXIS.map(([k, l]) => {
    const s = (sub?.items?.[k] ?? 0) as number;
    return { key: k, label: l, icon: AXIS_ICON[k], score: s, word: word(s), text: opinion(k, s, b) };
  });

  // ── 종합 의견 — 서술 세그먼트(문구 단일 소스, 강조 위치 공용) ──
  const conclusion: Seg[] = [
    { t: `인근 실거래를 공시지가·대지·연면적으로 교차 분석하고 주변 임대수익을 반영해 적정가 ` },
    { t: `약 ${eokman(fair)}`, b: true }, { t: `으로 산정됩니다.` },
    ...(landPremium != null && landPremium >= 10
      ? [{ t: ` 이 땅의 공시지가가 주변 평균보다 ` }, { t: `약 ${landPremium.toFixed(0)}% 높아`, b: true }, { t: ` 입지 경쟁력이 뚜렷하고,` }]
      : []),
    ...(topStrengths.length
      ? [{ t: ` ` }, { t: `${topStrengths.join("·")}`, b: true }, { t: ` 등에서 우수해 매력도 ` }, { t: `${grade}등급`, b: true }, { t: `으로 평가됩니다.` }]
      : [{ t: ` 매력도는 ` }, { t: `${grade}등급`, b: true }, { t: `입니다.` }]),
    { t: ` 적정가 기준 예상수익률은 ` }, { t: `${roiFair != null ? roiFair.toFixed(2) : "—"}%`, b: true },
    ...(nbhdRoi != null
      ? [{ t: `로 주변 평균(${nbhdRoi}%)보다 ` }, { t: `${roiFair != null && roiFair >= nbhdRoi ? "높은" : "낮은"}`, b: true }, { t: ` 수준이며,` }]
      : [{ t: `로,` }]),
    { t: ` 월 약 ` }, { t: `${rent ? man(rent) + "만원" : "—"}`, b: true }, { t: `의 임대수익이 기대됩니다.` },
    ...(ut ? [
      { t: ` 활용 측면에서는 ` }, { t: `${ut.primary}`, b: true },
      ...(officeApt ? [{ t: `이 최적이며, 업무 상권·역세권이라 ` }, { t: `사옥으로도 적합`, b: true }, { t: `합니다.` }]
                    : [{ t: `이 최적입니다.` }]),
    ] : []),
    ...(fut?.label ? [
      { t: ` 미래가치는 ` }, { t: `${fut.label}`, b: true },
      { t: fut.label === "상승 기대형" ? `으로 개발·임대 여력에 따른 추가 상승이 기대됩니다.`
          : fut.label === "정체형" ? `으로 단기 변동은 크지 않습니다.`
          : `으로 지가 상승에 따른 안정적 가치 성장이 기대됩니다.` },
    ] : []),
  ];

  // ── 슬라이드 메타(제목·설명) — 단일 소스. 덱·애니메이션 동일 문구 ──
  const SLIDES = [
    { key: "summary", n: "01", foot: "핵심 요약", title: "핵심 요약", desc: "본 매물의 빌탐정 적정가·수익성과 매력도를 한눈에 확인하세요." },
    { key: "basic", n: "02", foot: "매물 기본정보", title: "매물 기본정보", desc: "해당 건물의 기본정보 및 입지 정보 (토지이용계획확인원 및 건축물대장 기준)" },
    { key: "appeal", n: "03", foot: "매력도 분석", title: "매력도 분석", desc: "입지·교통·건물 상태 등을 종합 평가한 이 건물의 매력도(장단점) 지표입니다. 적정가 산정과는 별개입니다." },
    { key: "deal", n: "04", foot: "실거래가 분석", title: "실거래가 분석", desc: `${shortAddr} 인근의 유사 실거래를 바탕으로 본 매물의 적정매매가를 분석했습니다.` },
    { key: "gongsi", n: "05", foot: "공시지가", title: "공시지가 분석", desc: `${shortAddr}의 공시지가 추이와, 실거래가 공시가 대비 형성되는 수준(공시배율)을 반영합니다.` },
    { key: "rent", n: "06", foot: "임대수익 분석", title: "임대수익 분석", desc: "주변 임대시세로 임대수익을 추정하고, 이를 수익가치(수익환원)로 적정가에 반영합니다." },
    { key: "usetype", n: "07", foot: "투자 유형", title: "투자 유형 분석", desc: "용적률·상권·연식 등으로 이 건물의 최적 활용(신축·리모델·수익·사옥)을 판별했습니다." },
    { key: "future", n: "08", foot: "미래가치", title: "미래가치 분석", desc: "지가 상승 추세(기본)에 개발여지·임대 상향 여력(추가)을 더해 본 매물의 향후 가치 성장을 평가했습니다." },
    { key: "conclusion", n: "09", foot: "종합 결론", title: "종합 결론", desc: "적정가와 수익성을 종합한 본 매물의 최종 결론입니다." },
  ];

  // ── 01 핵심요약 ──
  const summaryRows = [
    { k: "빌탐정 적정가", s: "시스템 산정", v: fair ? eokman(fair) : "—", c: "var(--navy)" },
    { k: "적정가 기준 예상수익률", s: "연 임대수익 기준", v: roiFair != null ? `${roiFair.toFixed(2)}%` : "—", c: "var(--purple)" },
    { k: "매력도 등급", s: "입지·건물 매력도 (적정가와 별개)", v: `${grade}등급`, c: "var(--blue)" },
  ];
  const summaryTail = { primary: ut?.primary ?? null, officeApt, avgPerMan: avgPer ? `${Math.round(avgPer / 1e4).toLocaleString()}만원` : "—", totalPy: `${py(totalArea)}평` };

  // ── 02 기본정보 ──
  const basicInfo: [string, string][] = [
    ["대지면적", `${py(landArea)}평 (${landArea ?? "—"}㎡)`],
    ["연면적", `${py(totalArea)}평 (${totalArea ?? "—"}㎡)`],
    ["용도지역", useZone], ["건축물용도", mainUse],
    ["층수", `지하 ${b.floors_below ?? "—"}층 / 지상 ${b.floors_above ?? "—"}층`],
    ["사용승인일", b.approval_ymd ? String(b.approval_ymd).slice(0, 10).replace(/-/g, ".") : "—"],
    ["주차", b.parking != null ? `${b.parking}대` : "—"],
    ["엘리베이터", b.elevator != null ? (Number(b.elevator) > 0 ? `${b.elevator}대` : "없음") : "—"],
    ["도로접면", b.road_frontage ?? "—"],
    ["매도희망가", ask ? eokman(ask) : "—"],
  ];

  // ── 05 공시지가 ──
  const gongsiMetrics = [
    { k: "주변 대비 땅값 (공시지가)", sub: "", v: landPremium != null ? `${landPremium >= 0 ? "+" : ""}${landPremium.toFixed(0)}%` : "—", cap: `주변 실거래 사례 평균 대비 ${landPremium != null && landPremium >= 0 ? "높음 · 입지 우위" : "낮음"}` },
    { k: "공시배율", sub: "(실거래 ÷ 공시총액)", v: gmult != null ? `${gmult.toFixed(1)}배` : "—", cap: "시장이 공시가보다 이만큼 높게 값을 매김" },
  ];
  const gongsiProse: Seg[] = landPremium != null
    ? [{ t: `이 건물이 앉은 땅의 공시지가는 ` }, { t: `${man(gLatest)}만원/㎡`, b: true }, { t: `로, 주변 실거래 평균 ` }, { t: `${man(nbhdGongsi)}만원/㎡`, b: true },
       { t: `보다 ` }, { t: `약 ${Math.abs(landPremium).toFixed(0)}% ${landPremium >= 0 ? "높습니다" : "낮습니다"}`, b: true },
       { t: `. ${landPremium >= 0 ? "상대적으로 입지가 우수한 땅입니다. " : "주변 대비 저평가 상태입니다. "}실거래가 공시가의 몇 배에 형성되는지(공시배율)는 적정가 산정의 한 축으로 반영됩니다.` }]
    : [{ t: `공시지가와 실거래 배율을 함께 반영해 적정가를 산정합니다.` }];

  // ── 06 임대수익(층별 나열 안 함 — 요약 5지표 + 비교) ──
  const rentMetrics: [string, string][] = [
    ["건물 규모", `지하 ${b.floors_below ?? "—"} · 지상 ${b.floors_above ?? "—"}층`],
    ["총 월임대료", `${man(curRent)}만원`],
    ["예상 보증금", rCurDep ? eokman(rCurDep) : "—"],
    ["평균 평당 임대료", perPyRent ? `${(perPyRent / 1e4).toFixed(1)}만원` : "—"],
    ["적정가 기준 예상수익률", roiFair != null ? `${roiFair.toFixed(2)}%` : "—"],
  ];
  const rentProse: Seg[] = [
    { t: `본 매물의 현재 총 월임대료는 ` }, { t: `${man(curRent)}만원`, b: true }, { t: `, 총 보증금은 ` }, { t: `${rCurDep ? eokman(rCurDep) : "—"}`, b: true }, { t: ` 수준입니다.` },
    ...(upsidePct != null ? (upsidePct >= 3
      ? [{ t: ` 주변 임대시세 적용 시 ` }, { t: `약 ${upsidePct.toFixed(0)}% 상승 여력`, b: true }, { t: `이 있습니다.` }]
      : upsidePct <= -3 ? [{ t: ` 현재 임대료가 주변 시세보다 다소 높아 임대 안정성이 높습니다.` }]
      : [{ t: ` 현재 임대료는 주변 시세와 유사한 적정 수준입니다.` }]) : []),
    ...(nbhdRoi != null && roiFair != null
      ? [{ t: ` 적정가 기준 예상수익률 ` }, { t: `${roiFair.toFixed(2)}%`, b: true }, { t: `는 주변 평균(${nbhdRoi}%)보다 ` }, { t: roiFair >= nbhdRoi ? "높아 수익성 우위" : "다소 낮은 편", b: true }, { t: `입니다.` }]
      : []),
  ];

  // ── 08 미래가치 — "그래서 얼마?" 실제 돈·양으로 설명 ──
  const _sign = (v: number) => (v >= 0 ? "+" : "−");
  const _rentDiff = fut && fut.cur_rent && fut.mkt_rent != null ? fut.mkt_rent - fut.cur_rent : null;          // 월 임대 차액(원)
  const _overPct = fut && fut.far && fut.legal_far ? (fut.far / fut.legal_far - 1) * 100 : null;               // 법정 대비 초과 %
  const _buildP = fut && fut.headroom_far && fut.headroom_far > 0 && landArea ? landArea * (fut.headroom_far / 100) / P : null;  // 증축 가능 연면적(평)
  const _g5AgoWon = fut && fut.land_rate5 != null && gTotal ? gTotal / (1 + fut.land_rate5 / 100) : null;       // 5년 전 공시총액(원)
  const _gAnnualWon = _g5AgoWon != null && gTotal ? (gTotal - _g5AgoWon) / 5 : null;                           // 연평균 상승액(원)
  const futureAxes = fut ? [
    { key: "dev", label: "개발여지", c: "var(--navy)",
      value: fut.headroom_far == null ? "—" : fut.headroom_far > 0 ? (_buildP ? `약 ${Math.round(_buildP).toLocaleString()}평` : `+${fut.headroom_far}%p`) : "여지 없음",
      sub: fut.far != null && fut.legal_far != null
        ? (fut.headroom_far! > 0
            ? `현재 용적률 ${fut.far}% / 법정 ${fut.legal_far}% → +${fut.headroom_far}%p 증축 여지`
            : `현재 용적률 ${fut.far}% · 법정 ${fut.legal_far}% (법정 대비 약 ${_overPct!.toFixed(0)}% 초과)`)
        : "용적률 정보 없음" },
    { key: "upside", label: "임대 상향 여력", c: "var(--blue)",
      value: _rentDiff == null ? "—" : `${_sign(_rentDiff)}${Math.abs(Math.round(_rentDiff / 1e4)).toLocaleString()}만원/월`,
      sub: fut.cur_rent && fut.mkt_rent != null && _rentDiff != null
        ? `현재 ${man(fut.cur_rent)}만 → 주변시세 ${man(fut.mkt_rent)}만/월 (${_sign(fut.upside_pct ?? 0)}${Math.abs(fut.upside_pct ?? 0)}%)`
        : "주변 임대시세 대비" },
    { key: "land", label: "지가 상승 추세", c: "var(--purple)",
      value: _gAnnualWon != null ? `연 +${eokman(_gAnnualWon)}` : fut.land_rate5 != null ? `+${fut.land_rate5}%` : "—",
      sub: fut.land_rate5 == null ? "지가 시계열 없음"
        : gTotal != null
          ? `최근 5년 +${fut.land_rate5}%(연 ${fut.land_annual}%) · 현재 공시총액 ${eokman(gTotal)} 기준`
          : `최근 5년 +${fut.land_rate5}% · 연평균 약 ${fut.land_annual ?? "—"}%` },
  ] : [];

  const loading = (reportId != null && rq.isLoading) || (needLive && cq.isLoading) || (!!pk && bq.isLoading);
  const isError = cq.isError || rq.isError;
  const rno = reportId != null ? `BT-${new Date(rq.data?.created_at ?? "2026-01-01").getFullYear()}-${String(reportId).padStart(6, "0")}` : "미리보기";
  const date = new Date(rq.data?.created_at ?? "2026-01-01").toLocaleDateString("ko-KR").replace(/\. /g, ".").replace(/\.$/, "");
  const canDownload = reportId != null && rq.data?.status === "done";

  return {
    pk, reportId, rq, sub, pv, b, loading, isError, canDownload, rno, date,
    fair, ask, rent, curRent, totalArea, landArea, totalP, avgPer, usedComps, comps, moreCount, avgPerNow,
    gLatest, gTotal, gctx, nbhdGongsi, gmult, landPremium, compMin, compMax, floors,
    roiFair, rs, rFloors, rCurDep, perPyRent, upsidePct, nbhdRoi, topStrengths,
    ut, officeApt, fut, useZone, mainUse, grade, score, gradeCol, addr, shortAddr,
    opinions, conclusion, SLIDES, summaryRows, summaryTail, basicInfo,
    gongsiMetrics, gongsiProse, rentMetrics, rentProse, futureAxes,
  };
}
