import { type SeriesPt } from "../../shared/api/endpoints";
import { CountUp } from "./ReportAssets";
import { useReportModel, eokManParts } from "./reportModel";

/** S02 리포트 — 중요 결론만 요약(읽는 용도). 적정가·수익률·매력도·투자유형·미래가치가 각각 뭔지 간단 설명.
 *  ★ 상세 표·차트·의견은 분석보고서([매물 분석하기])에서. 여기선 한눈 요약 + 가벼운 애니메이션. */
const INK = "#1a1f2b", NAVY = "#1e2a4a", BLUE = "#2b5aa8", PURPLE = "#6E56CF", MUTED = "#828a99", LINE = "#e7e9ee";

export function ReportView({ pk }: {
  pk: string; b?: Record<string, unknown>; price?: number | null;
  tRent?: number | null; tDeposit?: number | null; roiFull?: number | null;
  gongsiSeries?: [number, number][]; realSeries?: SeriesPt[]; totalGongsi?: number | null;
}) {
  const rm = useReportModel(null, pk);
  const { sub, loading, shortAddr, useZone, mainUse, fair, avgPer, roiFair, nbhdRoi, grade, score, ut, officeApt, fut } = rm;

  if (loading && !sub) return <div className="panel" style={{ padding: 40, color: MUTED }}>리포트 계산 중…</div>;

  const [fe, fm] = eokManParts(fair);
  const items = [
    { k: "예상수익률", v: roiFair != null ? `${roiFair.toFixed(2)}%` : "—", c: PURPLE,
      d: `적정가 대비 연 임대수익 비율${nbhdRoi != null ? ` · 주변 평균 ${nbhdRoi}%` : ""}` },
    { k: "매력도", v: `${grade}등급`, c: BLUE, d: `입지·교통·건물 상태 종합 (가치점수 ${score}점)` },
    { k: "투자 유형", v: ut?.primary ?? "—", extra: officeApt ? "사옥 적합" : null, c: NAVY, d: "데이터로 판별한 최적 활용 전략" },
    { k: "미래가치", v: fut?.label ?? "—", c: PURPLE, d: "개발여지·임대상향·지가상승으로 본 상승 잠재력" },
  ];

  return (
    <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "clamp(24px,3vw,44px)", color: INK }}>
      {/* 표제 */}
      <div className="rv-in" style={{ fontSize: 12, letterSpacing: ".16em", fontWeight: 800, color: BLUE }}>빌탐정 가치분석 리포트</div>
      <div className="rv-in" style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{shortAddr} · {useZone} · {mainUse}</div>

      {/* 적정가 히어로 */}
      <div className="rv-in" style={{ marginTop: 20, paddingBottom: 22, borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 13, color: MUTED, fontWeight: 700, letterSpacing: ".04em" }}>빌탐정 적정가</div>
        <div style={{ fontSize: "clamp(40px,5.5vw,68px)", fontWeight: 800, color: NAVY, lineHeight: 1, letterSpacing: "-.02em" }}>
          <CountUp end={fe} dur={1100} fmt={(v) => Math.round(v).toLocaleString()} />
          <span style={{ fontSize: ".42em", fontWeight: 800 }}>억{fm ? ` ${fm.toLocaleString()}만원` : "원"}</span>
        </div>
        <div style={{ fontSize: 14, color: MUTED, marginTop: 6 }}>평당 약 {avgPer ? Math.round(avgPer / 1e4).toLocaleString() : "—"}만원 · 실거래·공시지가·임대수익을 종합한 적정 매매가</div>
      </div>

      {/* 핵심 4 — 값 + '뭔지' 한 줄 설명 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 0 }}>
        {items.map((x, i) => (
          <div key={x.k} className="rv-in" style={{ ["--rvd" as string]: `${(i + 1) * 90}ms`, padding: "20px 22px", borderBottom: `1px solid ${LINE}`, borderRight: `1px solid ${LINE}` }}>
            <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 700 }}>{x.k}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: x.c, lineHeight: 1.15, margin: "3px 0 5px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {x.v}{x.extra && <span style={{ fontSize: 12, color: "#fff", background: x.c, borderRadius: 11, padding: "2px 9px", fontWeight: 700 }}>{x.extra}</span>}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>{x.d}</div>
          </div>
        ))}
      </div>

      <div className="rv-in" style={{ fontSize: 12.5, color: MUTED, marginTop: 16 }}>
        실거래·공시지가·임대수익 등 상세 분석과 근거는 상단 <b style={{ color: NAVY }}>[매물 분석하기]</b>에서 보고서로 확인하세요.
      </div>
    </div>
  );
}
