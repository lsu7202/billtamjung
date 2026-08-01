import { Loading } from "../../shared/ui/Spinner";
import { type SeriesPt } from "../../shared/api/endpoints";
import { CountUp } from "./ReportAssets";
import { ScoreRadar, CompareBar } from "./ReportPrimitives";
import { ReportMap, ZONE_COLOR } from "./ReportMap";
import { useReportModel, AXIS, num, eokManParts } from "./reportModel";

/** S02 리포트 — 핵심 결론(적정가·수익률·매력도·투자유형·미래가치) + 설명 차트만.
 *  ★ 원자료 표(주변실거래·축별 점수·매물기본정보)는 제거. 상세는 [매물 분석하기] 보고서. */
const INK = "#1a1f2b", NAVY = "#1e2a4a", BLUE = "#2b5aa8", PURPLE = "#6E56CF", GREEN = "#1c8c63", MUTED = "#828a99", LINE = "#e7e9ee";
const gradeColor = (g: string) => g === "S" ? "#B8912E" : g === "A" ? BLUE : g === "B" ? GREEN : MUTED;
const eokBar = (v: number) => `${Math.round(v / 1e8).toLocaleString()}억`;

/** 결론 블록 — 좌: 라벨·값·한줄설명 / 우: 설명 차트. 박스 없이 괘선 구분. */
function Block({ label, value, valColor, extra, desc, chart, delay }: {
  label: string; value: React.ReactNode; valColor: string; extra?: string | null; desc: string; chart: React.ReactNode; delay: number;
}) {
  return (
    <section className="rv-in" style={{ ["--rvd" as string]: `${delay}ms`, padding: "24px 0", borderTop: `1px solid ${LINE}`, display: "grid", gridTemplateColumns: "minmax(200px,.85fr) 1.15fr", gap: 28, alignItems: "center" }}>
      <div>
        <div style={{ fontSize: 12.5, letterSpacing: ".1em", fontWeight: 800, color: MUTED }}>{label}</div>
        <div style={{ fontSize: "clamp(24px,2.6vw,34px)", fontWeight: 800, color: valColor, lineHeight: 1.15, margin: "4px 0 8px", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          {value}{extra && <span style={{ fontSize: 13, color: "#fff", background: valColor, borderRadius: 12, padding: "2px 10px", fontWeight: 700 }}>{extra}</span>}
        </div>
        <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, maxWidth: 340 }}>{desc}</div>
      </div>
      <div>{chart}</div>
    </section>
  );
}

export function ReportView({ pk, b, realSeries }: {
  pk: string; b: Record<string, unknown>; price?: number | null;
  tRent?: number | null; tDeposit?: number | null; roiFull?: number | null;
  gongsiSeries?: [number, number][]; realSeries?: SeriesPt[]; totalGongsi?: number | null;
}) {
  const rm = useReportModel(null, pk);
  const { sub, loading, nonCommercial, shortAddr, useZone, mainUse, fair, avgPer, roiFair, nbhdRoi, grade, score,
    gTotal, curRent, rent, ut, officeApt, fut, futureAxes, topStrengths } = rm;

  if (loading && !sub) return <div className="panel"><Loading label="리포트 계산 중" minHeight={220} /></div>;
  if (nonCommercial) return <div className="panel" style={{ padding: 40, color: MUTED, lineHeight: 1.6 }}>
    <b style={{ color: INK }}>적정가 분석 대상이 아닙니다.</b><br />빌탐정 적정가는 상업·업무 성격 건물({useZone} · {mainUse})을 대상으로 산정합니다. 주거용 건물은 산정 방식이 달라 제공하지 않습니다.
  </div>;

  const [fe, fm] = eokManParts(fair);
  const realLast = realSeries && realSeries.length ? realSeries[realSeries.length - 1].y : null;
  const priceBars = [
    { label: "적정가", value: fair ?? 0, color: BLUE, strong: true },
    { label: "실거래", value: realLast ?? 0, color: "#E8833A" },
    { label: "공시지가", value: gTotal ?? 0, color: NAVY },
  ].filter((x) => x.value > 0);

  return (
    <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "clamp(24px,3vw,44px)", color: INK }}>
      {/* 표제 */}
      <div className="rv-in" style={{ fontSize: 12, letterSpacing: ".16em", fontWeight: 800, color: BLUE }}>빌탐정 가치분석 리포트</div>
      <div className="rv-in" style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{shortAddr} · {useZone} · {mainUse}</div>

      {/* 적정가 히어로 + 가격 비교 */}
      <section className="rv-in" style={{ ["--rvd" as string]: "90ms", display: "grid", gridTemplateColumns: "minmax(240px,1fr) 1.1fr", gap: 30, alignItems: "center", marginTop: 20, paddingTop: 20, borderTop: `2px solid ${NAVY}` }}>
        <div>
          <div style={{ fontSize: 13, color: MUTED, fontWeight: 700, letterSpacing: ".04em" }}>빌탐정 적정가</div>
          <div style={{ fontSize: "clamp(36px,4.6vw,58px)", fontWeight: 800, color: NAVY, lineHeight: 1, letterSpacing: "-.02em" }}>
            <CountUp end={fe} dur={1100} fmt={(v) => Math.round(v).toLocaleString()} /><span style={{ fontSize: ".42em", fontWeight: 800 }}>억{fm ? ` ${fm.toLocaleString()}만원` : "원"}</span>
          </div>
          <div style={{ fontSize: 13.5, color: MUTED, marginTop: 6, lineHeight: 1.6 }}>평당 약 {avgPer ? Math.round(avgPer / 1e4).toLocaleString() : "—"}만원 · 실거래·공시지가·임대수익을 종합한 적정 매매가입니다.</div>
        </div>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: MUTED, marginBottom: 6 }}>가격 비교 <span style={{ fontWeight: 400 }}>(총액)</span></div>
          {priceBars.length ? <CompareBar height={150} fmt={eokBar} items={priceBars} /> : <p style={{ color: MUTED, fontSize: 13 }}>가격 데이터 없음</p>}
        </div>
      </section>

      {/* 예상수익률 */}
      <Block label="예상수익률" value={roiFair != null ? `${roiFair.toFixed(2)}%` : "—"} valColor={PURPLE} delay={180}
        desc="적정가 대비 연 임대수익 비율입니다. 주변 유사 건물과 비교해 수익성 위치를 봅니다."
        chart={roiFair != null && nbhdRoi != null
          ? <div style={{ display: "flex", gap: 24 }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 4 }}>수익률 vs 주변 (%)</div>
                <CompareBar height={130} fmt={(v) => v.toFixed(2)} items={[{ label: "본매물", value: roiFair, color: PURPLE, strong: true }, { label: "주변", value: nbhdRoi, color: NAVY }]} /></div>
              {curRent && rent ? <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 4 }}>임대 vs 주변 (월,만)</div>
                <CompareBar height={130} fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}`} items={[{ label: "현재", value: curRent, color: NAVY }, { label: "주변", value: rent, color: BLUE, strong: true }]} /></div> : null}
            </div>
          : <p style={{ color: MUTED, fontSize: 13 }}>주변 수익률 데이터가 부족합니다.</p>} />

      {/* 매력도 — 레이더 + 강점 문구(축별 표 없음) */}
      <Block label="매력도" value={`${grade}등급`} valColor={gradeColor(grade)} delay={270}
        desc={`입지·교통·건물 상태를 종합한 등급입니다(가치점수 ${score}점).${topStrengths.length ? ` 특히 ${topStrengths.join("·")}이 우수합니다.` : ""}`}
        chart={sub?.items ? <div style={{ display: "flex", justifyContent: "center" }}><ScoreRadar axes={AXIS.map(([k, l]) => ({ label: l, score: (sub.items![k] ?? 0) as number }))} color={gradeColor(grade)} size={220} showValues /></div>
          : <p style={{ color: MUTED, fontSize: 13, textAlign: "center" }}>데이터 없음</p>} />

      {/* 투자 유형 — 적합도 막대 + 상권 지도 */}
      {ut && <Block label="투자 유형" value={ut.primary} valColor={NAVY} extra={officeApt ? "사옥 적합" : null} delay={360}
        desc={ut.reason + " · 유형별 적합도와 주변 상권으로 판별했습니다."}
        chart={<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "center" }}>
          <CompareBar height={128} fmt={(v) => `${Math.round(v)}`}
            items={[{ label: "신축", value: Math.max(ut.scores["신축용"] ?? 0, 1), color: NAVY }, { label: "리모델", value: Math.max(ut.scores["리모델링용"] ?? 0, 1), color: NAVY },
                    { label: "수익", value: Math.max(ut.scores["수익형"] ?? 0, 1), color: BLUE, strong: true }, { label: "사옥", value: Math.max(ut.office_fit ?? 0, 1), color: PURPLE }]} />
          {ut.zones && ut.zones.length && num(b.lng) != null
            ? <div><div style={{ borderRadius: 10, overflow: "hidden" }}><ReportMap lng={num(b.lng)} lat={num(b.lat)} geom={b.parcel_geom} zones={ut.zones as any} h="150px" /></div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: MUTED, marginTop: 6 }}>
                  {Object.entries(ZONE_COLOR).map(([k, c]) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 9, height: 9, background: c, borderRadius: 2 }} />{k}</span>)}
                </div></div>
            : <div style={{ fontSize: 12, color: MUTED }}>상권 데이터 부족</div>}
        </div>} />}

      {/* 미래가치 — 3축 실제값 미니 시각화 */}
      {fut && <Block label="미래가치" value={fut.label ?? "—"} valColor={PURPLE} delay={450}
        desc="개발여지·임대 상향 여력·지가 상승으로 본 향후 가치 상승 잠재력입니다."
        chart={<div>{futureAxes.map((x) => (
          <div key={x.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14, padding: "8px 0", borderTop: `1px solid ${LINE}` }}>
            <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{x.label}</div><div style={{ fontSize: 11.5, color: MUTED, marginTop: 1 }}>{x.sub}</div></div>
            <div style={{ fontSize: 17, fontWeight: 800, color: x.c, whiteSpace: "nowrap" }}>{x.value}</div>
          </div>
        ))}</div>} />}

      <div className="rv-in" style={{ fontSize: 12.5, color: MUTED, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
        실거래 사례·상세 근거와 편집은 상단 <b style={{ color: NAVY }}>[매물 분석하기]</b>에서 보고서로 확인·생성하세요.
      </div>
    </div>
  );
}
