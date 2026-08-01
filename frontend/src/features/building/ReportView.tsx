import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { reportsApi, rentsApi, marketApi, type SeriesPt } from "../../shared/api/endpoints";
import { circleToGeoJSON } from "../../shared/map/geo";
import { won, wonShort, perPyMan } from "../../shared/format";
import { StatTile, ScoreRadar, CompareBar, Grade, ReportCard } from "./ReportPrimitives";
import { TrendChart } from "./TrendChart";
import { useReportModel, type Seg } from "./reportModel";

/** 리포트 뷰 — 매물 핵심가치 한눈에(매물분석보고서 세미버전). 라이브 comps(적정가·점수) + 마스터 시세.
 * 설계: features/building/DESIGN.md P1~P6. 그래프 합치기는 여기서만.
 */
const AXIS: Record<string, string> = {
  road_access: "도로", station_dist: "역세권", use_zone: "용도지역", shape: "형상",
  approval_date: "연식", elevator: "엘베", remodel: "리모델링", slope: "지세", float_pop: "유동인구",
};
const gradeColor = (g: string) => g === "S" ? "#7C3AED" : g === "A" ? "var(--signal)" : g === "B" ? "var(--green)" : "var(--muted)";

function ratePct(series: [number, number][], back: number): number | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1][1], prev = series[Math.max(0, series.length - 1 - back)]?.[1];
  return prev ? ((last - prev) / prev) * 100 : null;
}
const pct = (v: number | null) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;

export function ReportView({ pk, b, price, tRent, tDeposit, roiFull, gongsiSeries, realSeries, totalGongsi }: {
  pk: string; b: Record<string, unknown>; price: number | null;
  tRent: number | null; tDeposit: number | null; roiFull: number | null;
  gongsiSeries: [number, number][]; realSeries: SeriesPt[]; totalGongsi: number | null;
}) {
  const q = useQuery({ queryKey: ["report-comps", pk], queryFn: () => reportsApi.comps(pk) });
  const sub = q.data?.subject, pv = q.data?.preview;
  const rm = useReportModel(null, pk);   // 분석보고서 단일 소스 — 투자유형·미래가치·종합의견 동일 반영
  // 주변 임대시세(주변임대시세 카드와 동일 소스 = 팀 실입력 + 마스터 추정). 리포트 임대료 비교용.
  const lng = Number(b.lng), lat = Number(b.lat);
  const outlineQ = useQuery({ queryKey: ["floor-outline", pk], queryFn: () => rentsApi.outline(pk) });
  const rFloors = useMemo(() => [...new Set((outlineQ.data ?? []).map((o) => o.floor).filter(Boolean))] as string[], [outlineQ.data]);
  const nb = useQuery({
    queryKey: ["report-nearby-rent", pk, rFloors.length, sub?.radius_m],
    queryFn: () => marketApi.nearby({ center_lat: lat, center_lng: lng, building_pk: pk, radius_m: 0,
      polygon: circleToGeoJSON(sub?.center ?? { lng, lat }, sub?.radius_m ?? 500), floors: rFloors }) as unknown as Promise<{ rents: { floor: string; per_rent?: number; is_outlier: boolean }[] }>,
    enabled: !!(lat && lng && rFloors.length),
  });
  // 주변 총임대료 = Σ(층별 주변 평당 임대료[비이상치 평균] × 그 층 면적[평])
  const marketRent = useMemo(() => {
    const rows = nb.data?.rents ?? [];
    if (!rows.length) return null;
    const byFloor: Record<string, number[]> = {};
    rows.forEach((r) => { if (!r.is_outlier && r.per_rent) (byFloor[r.floor] ??= []).push(r.per_rent); });
    const areaByFloor: Record<string, number> = {};
    (outlineQ.data ?? []).forEach((o) => { if (o.floor && o.exclusive_area) areaByFloor[o.floor] = (areaByFloor[o.floor] ?? 0) + o.exclusive_area; });
    let total = 0, any = false;
    for (const fl in areaByFloor) {
      const prs = byFloor[fl];
      if (prs?.length) { total += (prs.reduce((a, c) => a + c, 0) / prs.length) * (areaByFloor[fl] / 3.305785); any = true; }
    }
    return any ? Math.round(total) : null;
  }, [nb.data, outlineQ.data]);
  // 적정가 = 매매가와 동일 소스(배치 sale_est). 없으면 라이브 comp 계산 폴백. (S02b 큐레이션만 별도)
  const saleEst = b.sale_est != null ? Number(b.sale_est) : null;
  const fair = saleEst ?? pv?.fair_price ?? null;
  const rentApplied = tRent ?? pv?.applied_rent ?? null;
  // 수익률: 매매가 입력 있으면 그 기준(roiFull), 없으면 적정가 기준(총임대료×12÷적정가)
  const roi = roiFull ?? pv?.expected_roi ?? (rentApplied && fair ? (rentApplied * 12 / fair) * 100 : null);
  const realLast = realSeries.length ? realSeries[realSeries.length - 1].y : null;
  const items = sub?.items;
  // 공시지가 총액: 직접값 없으면 최신 단가(원/㎡) × 대지면적(㎡)
  const gLatest = gongsiSeries.length ? gongsiSeries[gongsiSeries.length - 1][1] : null;
  const totalGongsiEff = totalGongsi ?? (gLatest && b.land_area ? gLatest * Number(b.land_area) : null);

  // P1 가격비교 — 있는 값만
  const priceBars = [
    { label: "적정가", value: fair ?? 0, color: "var(--signal)", strong: true },
    { label: "실거래", value: realLast ?? 0, color: "var(--c-real)" },
    { label: "공시지가", value: totalGongsiEff ?? 0, color: "var(--c-gongsi)" },
    { label: "매도희망", value: price ?? 0, color: "var(--c-ad)" },
  ].filter((x) => x.value > 0);

  // PER 배수(실거래/공시)
  const per = realLast && totalGongsiEff ? realLast / totalGongsiEff : null;
  // 적정가 대비 매도희망 gap
  const askGap = fair && price ? ((price - fair) / fair) * 100 : null;

  const g5 = ratePct(gongsiSeries, 5), g10 = ratePct(gongsiSeries, 10);

  // 한줄평(규칙기반)
  const summary = (() => {
    if (!sub) return "";
    const parts: string[] = [];
    parts.push(`매력도 ${sub.grade}등급`);
    if (roi != null) parts.push(roi >= 4 ? "임대수익 안정적" : roi >= 3 ? "임대수익 보통" : "임대수익 낮음");
    if (askGap != null) parts.push(`적정가 대비 매도희망 ${askGap >= 0 ? "+" : ""}${askGap.toFixed(0)}%`);
    return parts.join(" · ");
  })();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
      {/* 헤더 — 매력도 + 적정가 + 한줄평 */}
      <div className="panel" style={{ gridColumn: "1 / -1", padding: "16px 18px", display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {sub ? <Grade grade={sub.grade} color={gradeColor(sub.grade)} /> : <Grade grade="?" color="var(--muted)" />}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>매력도</span>
            <span style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{sub ? sub.score : "—"}<span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}> /100</span></span>
          </div>
        </div>
        <div style={{ width: 1, height: 40, background: "var(--line)" }} />
        <StatTile label="적정 매매가" value={fair ? won(fair) : (q.isLoading ? "계산 중…" : "—")} accent="var(--signal)"
          sub={fair && b.total_area ? `평당 ${perPyMan(fair, (Number(b.total_area) / 3.305785))}` : undefined} hint="F-17 · 주변 매각사례 유사도 가중" />
        <div style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)", maxWidth: 360, textAlign: "right" }}>{summary}</div>
      </div>

      {/* P1 가격 비교 */}
      <ReportCard title="가격 비교" right={per ? `공시 대비 실거래 ${per.toFixed(1)}배` : undefined}>
        {priceBars.length ? <CompareBar items={priceBars} fmt={wonShort} /> : <p style={{ color: "var(--muted)", fontSize: 13 }}>가격 데이터 없음</p>}
        {askGap != null && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            매도희망이 적정가보다 <b style={{ color: askGap > 0 ? "var(--up)" : "var(--green)" }}>{askGap >= 0 ? "+" : ""}{askGap.toFixed(0)}%</b>
          </div>
        )}
      </ReportCard>

      {/* P3 가치 레이더 */}
      <ReportCard title="가치 평가" right={sub ? `${sub.grade}등급` : undefined}>
        {items
          ? <ScoreRadar axes={Object.entries(items).map(([k, v]) => ({ label: AXIS[k] ?? k, score: v }))} color={sub ? gradeColor(sub.grade) : "var(--signal)"} />
          : <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "30px 0" }}>{q.isLoading ? "계산 중…" : "데이터 없음"}</p>}
      </ReportCard>

      {/* P2 수익 */}
      <ReportCard title="수익">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <StatTile label="수익률(만실)" value={roi != null ? `${roi.toFixed(2)}%` : "—"} accent="var(--green)" hint="총임대료×12 ÷ 적정매매가" />
          <StatTile label="총임대료(월)" value={rentApplied ? won(rentApplied) : "—"} />
          <StatTile label="총보증금" value={tDeposit ? won(tDeposit) : "—"} />
          <StatTile label="총면적" value={b.total_area ? `${Math.round(Number(b.total_area) / 3.305785).toLocaleString()}평` : "—"} />
        </div>
      </ReportCard>

      {/* 임대료 비교 — 본매물 vs 주변시세(comp 적용) */}
      {(() => {
        const mine = tRent ?? null;                       // 본매물 총임대료(월)
        const market = marketRent ?? pv?.applied_rent ?? null;   // 주변 총임대료(주변임대시세 소스, est 포함)
        const bars = [
          { label: "본매물", value: mine ?? 0, color: "var(--ink)", strong: true },        // 지도 본매물=잉크와 동일
          { label: "주변시세", value: market ?? 0, color: "var(--c-rent)" },                // 지도 임대 comp=초록과 동일
        ].filter((x) => x.value > 0);
        const gap = mine && market ? ((mine - market) / market) * 100 : null;
        return (
          <ReportCard title="임대료 비교" right="월 총임대료">
            {bars.length
              ? <CompareBar items={bars} fmt={won} />
              : <p style={{ color: "var(--muted)", fontSize: 13 }}>임대료 데이터 없음</p>}
            {gap != null && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                {Math.abs(gap) < 0.5
                  ? <>주변시세와 <b>비슷한 수준</b></>
                  : <>본매물이 주변시세보다 <b style={{ color: gap >= 0 ? "var(--up)" : "var(--down)" }}>{gap >= 0 ? "+" : ""}{gap.toFixed(0)}% {gap >= 0 ? "높음" : "낮음"}</b></>}
              </div>
            )}
          </ReportCard>
        );
      })()}

      {/* P5 지가 추이 — 건물 공시지가 + 지역 지가(land_adjust) */}
      <ReportCard title="지가 추이" right="공시지가 · 지역지가 상승률">
        <div style={{ display: "flex", gap: 18, marginBottom: 4, flexWrap: "wrap" }}>
          <StatTile label="공시 5년" value={pct(g5)} accent={g5 && g5 >= 0 ? "var(--up)" : undefined} />
          <StatTile label="공시 10년" value={pct(g10)} accent={g10 && g10 >= 0 ? "var(--up)" : undefined} />
          {b.region_land_5y != null && <StatTile label="지역지가 5년" value={pct(Number(b.region_land_5y) * 100)} hint="자치구 지가변동률 누적" />}
          {b.region_land_10y != null && <StatTile label="지역지가 10년" value={pct(Number(b.region_land_10y) * 100)} />}
        </div>
        {gongsiSeries.length >= 2 && (
          <TrendChart points={gongsiSeries.map(([y, v]) => ({ x: String(y), y: v, sub: `${Math.round(v / 1e4).toLocaleString()}만/㎡` }))}
            color="var(--c-gongsi)" fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}만`} height={130} />
        )}
      </ReportCard>

      {/* 투자 유형(F-20) — 분석보고서와 동일 */}
      <ReportCard title="투자 유형" right={rm.ut ? `${rm.ut.primary}${rm.officeApt ? " · 사옥 적합" : ""}` : undefined}>
        {rm.ut ? <>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{rm.ut.reason}</div>
          <CompareBar height={128} fmt={(v) => `${Math.round(v)}`}
            items={[{ label: "신축", value: Math.max(rm.ut.scores["신축용"] ?? 0, 1), color: "var(--ink-2)" },
                    { label: "리모델", value: Math.max(rm.ut.scores["리모델링용"] ?? 0, 1), color: "var(--ink-2)" },
                    { label: "수익", value: Math.max(rm.ut.scores["수익형"] ?? 0, 1), color: "var(--signal)", strong: true },
                    { label: "사옥적합", value: Math.max(rm.ut.office_fit ?? 0, 1), color: "#6E56CF" }]} />
        </> : <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>{q.isLoading ? "계산 중…" : "데이터 없음"}</p>}
      </ReportCard>

      {/* 미래가치(F-21) — 실제 값(점수 아님), 분석보고서와 동일 */}
      <ReportCard title="미래가치" right={rm.fut?.label ?? undefined}>
        {rm.fut ? <>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{rm.fut.reason}</div>
          {rm.futureAxes.map((x) => (
            <div key={x.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <div><div style={{ fontWeight: 700, fontSize: 13 }}>{x.label}</div><div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{x.sub}</div></div>
              <div style={{ fontWeight: 800, fontSize: 16, color: x.c, whiteSpace: "nowrap" }}>{x.value}</div>
            </div>
          ))}
        </> : <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>{q.isLoading ? "계산 중…" : "데이터 없음"}</p>}
      </ReportCard>

      {/* 종합 의견 — 분석보고서 종합결론과 동일 문구 */}
      {rm.conclusion?.length > 0 && (
        <ReportCard title="종합 의견" span2>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--ink)", margin: 0 }}>
            {rm.conclusion.map((s: Seg, i: number) => s.b ? <b key={i} style={{ color: "var(--signal)" }}>{s.t}</b> : <span key={i}>{s.t}</span>)}
          </p>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>상세 근거·편집은 <b>[매물 분석하기]</b>에서 보고서로 확인하세요.</div>
        </ReportCard>
      )}
    </div>
  );
}
