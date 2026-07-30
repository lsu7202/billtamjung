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
    { t: `약 ${eok(fair)}억원`, b: true }, { t: `으로 산정됩니다.` },
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
    { t: ` 연 약 ` }, { t: `${rent ? eok(rent * 12) : "—"}억원`, b: true }, { t: `의 임대수익이 기대됩니다.` },
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
    opinions, conclusion,
  };
}
