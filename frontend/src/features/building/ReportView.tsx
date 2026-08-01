import { type SeriesPt } from "../../shared/api/endpoints";
import { ScoreRadar, CompareBar } from "./ReportPrimitives";
import { ReportMap, ZONE_COLOR } from "./ReportMap";
import { TrendChart } from "./TrendChart";
import { useReportModel, AXIS, num, eokman, py, type Seg } from "./reportModel";

/** S02 리포트 뷰 — 분석보고서와 동일 내용(reportModel 단일 소스)을 '보고서형 문서'로.
 *  ★ 데이터 수정용 카드 없음. 읽는 리포트. 한 장의 문서 시트에 섹션을 괘선으로 구분. */
const INK = "#1a1f2b", BLUE = "#2b5aa8", NAVY = "#1e2a4a", PURPLE = "#6E56CF", GREEN = "#1c8c63", MUTED = "#828a99", LINE = "#e7e9ee";

function Prose({ segs, bold = BLUE }: { segs: Seg[]; bold?: string }) {
  return <>{segs.map((s, i) => s.b ? <b key={i} style={{ color: bold }}>{s.t}</b> : <span key={i}>{s.t}</span>)}</>;
}
function Sec({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: "26px 0", borderTop: `1px solid ${LINE}` }}>
      <div style={{ fontSize: 12, letterSpacing: ".14em", fontWeight: 800, color: BLUE }}>{title}</div>
      {desc && <div style={{ fontSize: 13, color: MUTED, marginTop: 3 }}>{desc}</div>}
      <div style={{ marginTop: 16 }}>{children}</div>
    </section>
  );
}
const ratePct = (series: [number, number][], back: number): number | null => {
  if (series.length < 2) return null;
  const last = series[series.length - 1][1], prev = series[Math.max(0, series.length - 1 - back)]?.[1];
  return prev ? ((last - prev) / prev) * 100 : null;
};
const gradeColor = (g: string) => g === "S" ? "#B8912E" : g === "A" ? BLUE : g === "B" ? GREEN : MUTED;

export function ReportView({ pk, b, gongsiSeries }: {
  pk: string; b: Record<string, unknown>; price?: number | null;
  tRent?: number | null; tDeposit?: number | null; roiFull?: number | null;
  gongsiSeries: [number, number][]; realSeries?: SeriesPt[]; totalGongsi?: number | null;
}) {
  const rm = useReportModel(null, pk);
  const {
    sub, loading, shortAddr, useZone, mainUse, fair, roiFair, grade, score, avgPer,
    comps, moreCount, compMin, compMax, avgPerNow, gTotal,
    gongsiProse, gongsiMetrics, rentMetrics, rentProse, ut, officeApt, fut, futureAxes,
    opinions, conclusion, nbhdRoi, curRent, rent,
  } = rm;
  const g5 = ratePct(gongsiSeries, 5), g10 = ratePct(gongsiSeries, 10);

  if (loading && !sub) return <div className="panel" style={{ padding: 40, color: MUTED }}>리포트 계산 중…</div>;

  return (
    <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "clamp(22px,3vw,46px)", color: INK, lineHeight: 1.5 }}>
      {/* ── 표제 ── */}
      <div style={{ fontSize: 12, letterSpacing: ".16em", fontWeight: 800, color: BLUE }}>빌탐정 부동산 가치분석</div>
      <h1 style={{ fontSize: "clamp(24px,3vw,34px)", fontWeight: 800, letterSpacing: "-.01em", margin: "6px 0 2px" }}>{shortAddr}</h1>
      <div style={{ fontSize: 14, color: MUTED }}>{useZone} · {mainUse}</div>

      {/* ── 핵심 요약(큰 숫자 · 괘선 구분, 박스 없음) ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0", marginTop: 22, borderTop: `2px solid ${NAVY}`, paddingTop: 18 }}>
        {[{ k: "빌탐정 적정가", v: fair ? eokman(fair) : "—", c: NAVY, s: avgPer ? `평당 ${Math.round(avgPer / 1e4).toLocaleString()}만원` : "" },
          { k: "예상수익률", v: roiFair != null ? `${roiFair.toFixed(2)}%` : "—", c: PURPLE, s: nbhdRoi != null ? `주변 평균 ${nbhdRoi}%` : "적정가 기준" },
          { k: "매력도", v: `${grade}등급`, c: BLUE, s: `가치점수 ${score}점` },
          { k: "투자 유형", v: ut?.primary ?? "—", c: BLUE, s: officeApt ? "사옥 적합" : "활용 전략" },
          { k: "미래가치", v: fut?.label ?? "—", c: PURPLE, s: "상승 잠재력" }].map((x, i) => (
          <div key={x.k} style={{ flex: "1 1 140px", padding: "0 18px", borderLeft: i > 0 ? `1px solid ${LINE}` : "none" }}>
            <div style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>{x.k}</div>
            <div style={{ fontSize: "clamp(18px,2vw,26px)", fontWeight: 800, color: x.c, lineHeight: 1.15, margin: "2px 0" }}>{x.v}</div>
            <div style={{ fontSize: 11.5, color: MUTED }}>{x.s}</div>
          </div>
        ))}
      </div>

      {/* ── 매력도 ── */}
      <Sec title="매력도 분석" desc="입지·교통·건물 상태를 종합 평가한 이 건물의 매력도(장단점) 지표입니다.">
        <div style={{ display: "grid", gridTemplateColumns: "1.15fr .85fr", gap: 28, alignItems: "center" }}>
          <div>
            {opinions.map((o) => (
              <div key={o.key} style={{ padding: "9px 0", borderTop: `1px solid ${LINE}`, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline" }}>
                <div><span style={{ fontWeight: 700, fontSize: 14 }}>{o.label}</span>
                  <span style={{ fontSize: 12.5, color: MUTED, marginLeft: 8 }}>{o.text}</span></div>
                <span style={{ fontWeight: 700, whiteSpace: "nowrap", color: o.score >= 70 ? BLUE : MUTED }}>{o.word} · {Math.round(o.score)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            {sub?.items && <ScoreRadar axes={AXIS.map(([k, l]) => ({ label: l, score: (sub.items![k] ?? 0) as number }))} color={gradeColor(grade)} size={230} showValues />}
          </div>
        </div>
      </Sec>

      {/* ── 실거래가 ── */}
      <Sec title="실거래가 분석" desc={`${shortAddr} 인근의 유사 실거래로 본 적정매매가입니다.`}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}>
          <thead><tr style={{ color: MUTED, fontSize: 12 }}>
            {["사례", "주소", "거리", "거래일", "매매가", "연면적", "평단가", "시점보정"].map((h, i) => (
              <th key={h} style={{ textAlign: i >= 4 || i === 2 ? "right" : "left", fontWeight: 700, padding: "0 8px 8px", borderBottom: `2px solid ${NAVY}` }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            <tr style={{ background: "rgba(43,90,168,.06)" }}>
              <td style={{ ...tdL, fontWeight: 700, color: BLUE }}>본매물</td><td style={tdL}>{shortAddr}</td><td style={tdR}>—</td><td style={tdL}>—</td>
              <td style={{ ...tdR, fontWeight: 700, color: BLUE }}>{fair ? eokman(fair) : "—"}</td><td style={tdR}>{py(rm.totalArea)}평</td>
              <td style={{ ...tdR, fontWeight: 700, color: BLUE }}>{avgPer ? `${Math.round(avgPer / 1e4).toLocaleString()}만` : "—"}</td><td style={tdR}>—</td>
            </tr>
            {comps.map((c, i) => (
              <tr key={c.building_pk + String(i)}>
                <td style={tdL}>{i + 1}</td><td style={tdL}>{(c.addr ?? "").replace(/^서울특별시\s*/, "")}</td>
                <td style={tdR}>{c.weight ? `${Math.max(0, Math.round(1 / c.weight - 50))}m` : "—"}</td>
                <td style={tdL}>{c.contract_ym ?? "—"}</td><td style={tdR}>{eokman(c.price)}</td><td style={tdR}>{c.area_py ?? "—"}평</td>
                <td style={{ ...tdR, fontWeight: 700, color: BLUE }}>{c.per_now ? `${Math.round(c.per_now / 1e4).toLocaleString()}만` : "—"}</td>
                <td style={tdR}>{c.time_adj != null ? `${c.time_adj >= 0 ? "+" : ""}${Math.round(c.time_adj * 100)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {moreCount > 0 && <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>가까운 순 {comps.length}건 표시 · 외 <b style={{ color: NAVY }}>+{moreCount}건</b>도 적정가 산정에 반영됨</div>}
        <div style={{ display: "grid", gridTemplateColumns: ".9fr 1.1fr", gap: 28, alignItems: "center", marginTop: 20 }}>
          {comps.length >= 2 && <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>연면적당 평단가 비교 <span style={{ color: MUTED, fontWeight: 400 }}>(만원/평)</span></div>
            <CompareBar height={140} fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}`} refLine={avgPerNow ? { value: avgPerNow, label: "주변 평균" } : null}
              items={[...comps.map((c, i) => ({ label: `${i + 1}`, value: c.per_now ?? 0, color: NAVY })), ...(avgPer ? [{ label: "본매물", value: avgPer, color: BLUE, strong: true }] : [])].filter((x) => x.value > 0)} />
          </div>}
          <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
            {compMin && compMax
              ? <>인근 유사 실거래의 연면적당 평단가는 사례별 약 <b>{compMin.toLocaleString()}~{compMax.toLocaleString()}만원</b> 수준입니다. 본 매물은 입지·용도·규모 등 개별 특성을 반영해 <b style={{ color: BLUE }}>평당 약 {avgPer ? Math.round(avgPer / 1e4).toLocaleString() : "—"}만원</b>으로 분석됩니다.</>
              : <>반경 내 유사 실거래가 충분치 않아 다른 기준을 함께 반영해 분석했습니다.</>}
          </p>
        </div>
      </Sec>

      {/* ── 공시지가 ── */}
      <Sec title="공시지가 분석" desc="공시지가 추이와, 실거래가 공시가 대비 형성되는 수준(공시배율)을 반영합니다.">
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginBottom: 14 }}>
          {gongsiMetrics.map((gm) => (
            <div key={gm.k}><div style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>{gm.k} {gm.sub}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: BLUE, lineHeight: 1.1 }}>{gm.v}</div>
              <div style={{ fontSize: 11.5, color: MUTED }}>{gm.cap}</div></div>
          ))}
          <div><div style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>공시총액 <span style={{ fontWeight: 400 }}>(공시지가 × 대지)</span></div>
            <div style={{ fontSize: 24, fontWeight: 800, color: NAVY, lineHeight: 1.1 }}>{gTotal ? eokman(gTotal) : "—"}</div>
            <div style={{ fontSize: 11.5, color: MUTED }}>공시 5년 {g5 != null ? `${g5 >= 0 ? "+" : ""}${g5.toFixed(0)}%` : "—"} · 10년 {g10 != null ? `${g10 >= 0 ? "+" : ""}${g10.toFixed(0)}%` : "—"}</div></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: 28, alignItems: "center" }}>
          {gongsiSeries.length >= 2 && <TrendChart points={gongsiSeries.map(([y, v]) => ({ x: String(y), y: v, sub: `${Math.round(v / 1e4).toLocaleString()}만/㎡` }))} color="var(--c-gongsi)" fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}만`} height={150} />}
          <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}><Prose segs={gongsiProse} /></p>
        </div>
      </Sec>

      {/* ── 임대수익 ── */}
      <Sec title="임대수익 분석" desc="주변 임대시세로 임대수익을 추정하고, 수익가치(수익환원)로 적정가에 반영합니다.">
        <div style={{ display: "flex", gap: 30, flexWrap: "wrap", marginBottom: 16 }}>
          {rentMetrics.map(([k, v]) => (
            <div key={k}><div style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>{k}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: NAVY, lineHeight: 1.1 }}>{v}</div></div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto auto 1fr", gap: 28, alignItems: "center" }}>
          {curRent && rent ? <div style={{ minWidth: 150 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>현재 vs 주변 <span style={{ color: MUTED, fontWeight: 400 }}>(월,만원)</span></div>
            <CompareBar height={128} fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}`} items={[{ label: "현재", value: curRent, color: NAVY }, { label: "주변", value: rent, color: BLUE, strong: true }]} />
          </div> : <div />}
          {roiFair != null && nbhdRoi != null ? <div style={{ minWidth: 150 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>수익률 vs 주변 <span style={{ color: MUTED, fontWeight: 400 }}>(%)</span></div>
            <CompareBar height={128} fmt={(v) => v.toFixed(2)} items={[{ label: "본매물", value: roiFair, color: BLUE, strong: true }, { label: "주변", value: nbhdRoi, color: NAVY }]} />
          </div> : <div />}
          <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}><Prose segs={rentProse} /></p>
        </div>
      </Sec>

      {/* ── 투자 유형 + 상권 지도 ── */}
      {ut && <Sec title="투자 유형 분석" desc="용적률·상권·연식 등으로 이 건물의 최적 활용을 판별했습니다.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, color: NAVY }}>{ut.primary}{officeApt && <span style={{ fontSize: 13, color: "#fff", background: BLUE, borderRadius: 12, padding: "2px 10px", marginLeft: 10, fontWeight: 700, verticalAlign: "middle" }}>사옥 적합</span>}</div>
            <div style={{ fontSize: 13.5, color: MUTED, margin: "6px 0 14px" }}>{ut.reason}</div>
            <CompareBar height={130} fmt={(v) => `${Math.round(v)}`}
              items={[{ label: "신축", value: Math.max(ut.scores["신축용"] ?? 0, 1), color: NAVY }, { label: "리모델", value: Math.max(ut.scores["리모델링용"] ?? 0, 1), color: NAVY },
                      { label: "수익", value: Math.max(ut.scores["수익형"] ?? 0, 1), color: BLUE, strong: true }, { label: "사옥적합", value: Math.max(ut.office_fit ?? 0, 1), color: PURPLE }]} />
          </div>
          <div>
            {ut.zones && ut.zones.length && num(b.lng) != null
              ? <><div style={{ borderRadius: 12, overflow: "hidden" }}><ReportMap lng={num(b.lng)} lat={num(b.lat)} geom={b.parcel_geom} zones={ut.zones as any} h="260px" /></div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: MUTED, marginTop: 8 }}>
                    {Object.entries(ZONE_COLOR).map(([k, c]) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, background: c, borderRadius: 2, display: "inline-block" }} />{k}</span>)}
                  </div></>
              : <p style={{ fontSize: 13, color: MUTED }}>주변 상권 데이터가 부족합니다.</p>}
          </div>
        </div>
      </Sec>}

      {/* ── 미래가치(실제 값) ── */}
      {fut && <Sec title="미래가치 분석" desc="지가 상승 추세에 개발여지·임대 상향 여력을 더해 향후 가치 성장을 평가했습니다.">
        <div style={{ fontSize: 22, fontWeight: 800, color: PURPLE }}>{fut.label}</div>
        <div style={{ fontSize: 13.5, color: MUTED, margin: "6px 0 14px", maxWidth: 720 }}>{fut.reason}</div>
        {futureAxes.map((x) => (
          <div key={x.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, padding: "11px 0", borderTop: `1px solid ${LINE}` }}>
            <div><div style={{ fontWeight: 700, fontSize: 14.5 }}>{x.label}</div><div style={{ fontSize: 12.5, color: MUTED, marginTop: 1 }}>{x.sub}</div></div>
            <div style={{ fontSize: 20, fontWeight: 800, color: x.c, whiteSpace: "nowrap" }}>{x.value}</div>
          </div>
        ))}
      </Sec>}

      {/* ── 종합 의견 ── */}
      {conclusion?.length > 0 && <Sec title="종합 결론" desc="적정가와 수익성을 종합한 본 매물의 최종 결론입니다.">
        <p style={{ fontSize: 15, lineHeight: 1.8, margin: 0 }}><Prose segs={conclusion} bold={GREEN} /></p>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 12 }}>상세 근거·comp 편집은 상단 <b>[매물 분석하기]</b>에서 보고서로 확인·생성하세요.</div>
      </Sec>}
    </div>
  );
}

const tdL: React.CSSProperties = { textAlign: "left", padding: "9px 8px", borderBottom: `1px solid ${LINE}` };
const tdR: React.CSSProperties = { textAlign: "right", padding: "9px 8px", borderBottom: `1px solid ${LINE}` };
