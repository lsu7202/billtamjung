import { Loading } from "../../shared/ui/Spinner";
import { useState, useEffect, useRef, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ScoreRadar, CompareBar } from "./ReportPrimitives";
import { Logo, Seal, Icon, ScoreRing, BuildingArt, CountUp } from "./ReportAssets";
import { ReportMap } from "./ReportMap";
import { BuildingPhoto } from "./BuildingPhoto";
import { useReportModel, AXIS, num, man, eokman, eokManParts, py, word, type Seg } from "./reportModel";
import "./reportslide.css";
import { Icon as ActionIcon } from "../../shared/ui/Icon";

/** 분석 보고서 — R_example.pptx 8슬라이드를 웹으로(네이비 코퍼레이트·16:9·cqw 스케일). 내용은 reportModel 단일 소스.
 * 표지 → 핵심요약 → 기본정보 → 매력도 → 실거래가 → 공시지가 → 임대수익 → 투자유형 → 미래가치 → 종합결론. */

function Slide({ n, foot, title, desc, children, rno, date }:
  { n: string; foot: string; title: string; desc: string; children: React.ReactNode; rno: string; date: string }) {
  return (
    <div className="rs-slide">
      <div className="rs-head">
        <Logo size={2.5} />
        <span className="rs-tag">신뢰할 수 있는 부동산 가치분석 파트너</span>
        <span className="rs-rno">Report No. <b>{rno}</b> · 분석일 {date}</span>
      </div>
      <div className="rs-sec">
        <span className="rs-badge">{n}</span>
        <div><div className="rs-title">{title}</div><div className="rs-desc">{desc}</div></div>
      </div>
      <div className="rs-body">{children}</div>
      <div className="rs-foot"><em>{n}  {foot}</em>
        <span className="c">본 보고서는 빌탐정의 자체 조사·분석을 기반으로 작성되었으며, 실제 거래 시 시세 변동 및 개별 조건에 따라 차이가 발생할 수 있습니다.</span>
        <Logo mono size={1.9} />
      </div>
    </div>
  );
}

export function ReportPage() {
  const params = useParams();
  const nav = useNavigate();
  const reportId = params.id ? Number(params.id) : null;
  const m = useReportModel(reportId, params.pk);

  const [cur, setCur] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else rootRef.current?.requestFullscreen?.();
  };
  const SLIDES = 10;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); setCur((c) => Math.min(SLIDES - 1, c + 1)); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); setCur((c) => Math.max(0, c - 1)); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ── 모든 값·의견·서술은 reportModel 단일 소스(애니메이션 모드와 동일) ──
  const {
    pk, sub, b, loading, isError, rno, date,
    fair, rent, curRent, totalArea, avgPer, comps, moreCount, avgPerNow,
    gLatest, gTotal, nbhdGongsi, gmult, compMin, compMax,
    roiFair, nbhdRoi,
    ut, officeApt, fut, useZone, mainUse, grade, score, gradeCol, shortAddr, opinions, conclusion,
    SLIDES: SLIDE_META, summaryRows, summaryTail, basicInfo, gongsiMetrics, gongsiProse, rentMetrics, rentProse, futureAxes,
  } = m;
  const gc = (s: number) => s >= 70 ? "var(--blue)" : "var(--rmuted)";
  const SM = Object.fromEntries(SLIDE_META.map((s) => [s.key, s])) as Record<string, typeof SLIDE_META[number]>;

  if (loading && !sub) return <Loading label="보고서 계산 중" minHeight="60vh" />;
  if (!sub && isError) return <div style={{ padding: 40, color: "var(--up)" }}>보고서를 불러오지 못했습니다.</div>;

  const toolbar = (
    <div className="deck-top">
      <button className="btn" onClick={() => nav(`/buildings/${pk}`)} style={{ padding: "6px 12px" }}><ActionIcon name="back" size={15} />매물로</button>
      <span className="ttl">빌탐정 리포트 · {rno}</span>
      <button className="btn" style={{ marginLeft: "auto", padding: "6px 12px" }} onClick={() => { document.documentElement.requestFullscreen?.().catch(() => {}); nav(`/buildings/${pk}/story`); }} title="애니메이션 모드(전체화면)"><ActionIcon name="presentation" size={14} />애니메이션 모드</button>
      <button className="btn" style={{ padding: "6px 12px" }} onClick={toggleFs} title="전체화면 (발표 모드)"><ActionIcon name="fullscreen" size={14} />전체화면</button>
    </div>
  );

  const slides = [
      <div className="rs-slide" key="cover" style={{ position: "relative" }}>
        <div style={{ position: "absolute", inset: 0 }}><BuildingArt /></div>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,12,22,.5) 0%, rgba(8,12,22,.12) 34%, rgba(8,12,22,.82) 100%)" }} />
        <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", padding: "2.8cqw 3.4cqw", color: "#fff", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Logo mono size={2.6} />
            <span style={{ marginLeft: "auto", fontSize: "1cqw", color: "#c7d3e6" }}>Report No. {rno} · 분석일 {date}</span>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: "1.15cqw", letterSpacing: ".24em", color: "#8fb0e0", fontWeight: 700, marginBottom: "1cqw" }}>빌탐정 리포트 — 부동산 가치분석</div>
            <div style={{ fontSize: "4.8cqw", fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.04, textShadow: "0 2px 26px rgba(0,0,0,.55)" }}>{shortAddr}</div>
            <div style={{ fontSize: "1.5cqw", color: "#c7d3e6", marginTop: ".9cqw" }}>{useZone} · {mainUse}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1.4cqw" }}>
            <Seal mono size={8.5} />
            <div style={{ fontSize: ".95cqw", color: "#aab6cc", lineHeight: 1.55 }}>
              빌탐정이 자체 조사·분석한 <b style={{ color: "#fff" }}>공식 리포트</b>입니다.<br />제3자 무단복제·유포·변경 시 법적 책임을 질 수 있습니다.
            </div>
          </div>
        </div>
      </div>,
      <Slide key={0} n={SM.summary.n} foot={SM.summary.foot} rno={rno} date={date}
        title={SM.summary.title} desc={SM.summary.desc}>
        <div style={{ display: "flex", gap: "3cqw", width: "100%", alignItems: "stretch" }}>
          <div className="rs-fade" style={{ flex: "0 0 33%", borderRadius: "1.2cqw", overflow: "hidden", background: "linear-gradient(135deg,#dfe4ec,#c3cbd8)" }}><BuildingPhoto pk={pk} /></div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "1.8cqw" }}>
            <div className="rs-fade" style={{ display: "flex", alignItems: "center", gap: "2.6cqw" }}>
              <ScoreRing score={score} grade={grade} gradeColor={gradeCol} size={13.5} />
              <div style={{ flex: 1 }}>
                {summaryRows.map((r, i) => (
                  <div key={r.k} className="rs-fade" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: ".9cqw .2cqw", borderBottom: i < 2 ? "1px solid var(--rl)" : "none", ["--d" as string]: `${(i + 1) * 90}ms` }}>
                    <div><div style={{ fontSize: "1.55cqw", fontWeight: 700, color: "var(--navy)" }}>{r.k}</div><div style={{ fontSize: ".9cqw", color: "var(--rmuted)" }}>{r.s}</div></div>
                    <div className="num" style={{ fontSize: "2.8cqw", fontWeight: 800, color: r.c, lineHeight: 1 }}>{r.v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rs-fade" style={{ display: "flex", alignItems: "center", gap: "2.6cqw", paddingTop: "1.3cqw", borderTop: "1px solid var(--rl)", fontSize: "1.1cqw", color: "var(--rmuted)", ["--d" as string]: "360ms" }}>
              {summaryTail.primary ? <span>투자 유형 <b style={{ color: "var(--blue)" }}>{summaryTail.primary}</b>{summaryTail.officeApt && <span style={{ fontSize: ".8cqw", color: "#fff", background: "var(--navy)", borderRadius: "1cqw", padding: ".1cqw .6cqw", marginLeft: ".4cqw", fontWeight: 700 }}>사옥 적합</span>}</span> : null}
              <span>대지 평당 추정가 <b style={{ color: "var(--navy)" }}>{summaryTail.avgPerMan}</b></span>
              <span>연면적 <b style={{ color: "var(--navy)" }}>{summaryTail.totalPy}</b></span>
            </div>
          </div>
        </div>
      </Slide>,
      <Slide key={1} n={SM.basic.n} foot={SM.basic.foot} rno={rno} date={date}
        title={SM.basic.title} desc={SM.basic.desc}>
        <div style={{ display: "flex", gap: "2.5cqw", width: "100%" }}>
          <div style={{ flex: "0 0 46%", alignSelf: "flex-start", display: "flex", flexDirection: "column", gap: "1cqw" }}>
            <div style={{ fontSize: "2.1cqw", fontWeight: 800, color: "var(--navy)", letterSpacing: "-.01em", lineHeight: 1.1 }}>{shortAddr}</div>
            <table className="rs-tbl rs-kv"><tbody>
              {basicInfo.map(([k, v]) => (
                <tr key={k}><td>{k}</td><td className={k === "매도희망가" ? "blue b" : undefined}>{v}</td></tr>
              ))}
            </tbody></table>
          </div>
          <ReportMap lng={num(b.lng)} lat={num(b.lat)} geom={b.parcel_geom} />
        </div>
      </Slide>,
      <Slide key={2} n={SM.appeal.n} foot={SM.appeal.foot} rno={rno} date={date}
        title={SM.appeal.title} desc={SM.appeal.desc}>
        <div style={{ display: "flex", gap: "2.5cqw", width: "100%" }}>
          <table className="rs-tbl" style={{ flex: "0 0 52%", alignSelf: "flex-start" }}>
            <thead><tr><th>평가 항목</th><th>평가 결과</th><th>분석 의견</th></tr></thead>
            <tbody>
              {opinions.map((o, i) => (
                <tr key={o.key}>
                  <td className="b"><span style={{ display: "inline-flex", alignItems: "center", gap: ".7cqw" }}><Icon name={o.icon} size={1.9} color="var(--navy)" />{`①②③④⑤⑥⑦⑧⑨`[i]} {o.label}</span></td>
                  <td style={{ color: gc(o.score), fontWeight: 700 }}>{o.word}</td>
                  <td style={{ color: "var(--rmuted)", fontSize: "1cqw", lineHeight: 1.35 }}>{o.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1cqw" }}>
            <div className="rs-sc blue" style={{ display: "flex", alignItems: "center" }}>
              <div><div className="k">매력도 점수</div><div className="v">{score}<u>/100점</u></div></div>
              <span className="rs-pill blue" style={{ marginLeft: "auto", fontSize: "1.6cqw", padding: ".7cqw 1.3cqw" }}>{grade}등급</span>
            </div>
            {sub?.items && <ScoreRadar axes={AXIS.map(([k, l]) => ({ label: l, score: sub.items![k] ?? 0 }))} color="var(--navy)" size={210} showValues />}
            <div style={{ fontSize: ".98cqw", color: "var(--rmuted)", textAlign: "center" }}>등급 기준 · S 90↑ / A 75~89 / B 60~74 / C 60↓ → 본 매물 {grade}등급({word(score)})</div>
          </div>
        </div>
      </Slide>,
      <Slide key={3} n={SM.deal.n} foot={SM.deal.foot} rno={rno} date={date}
        title={SM.deal.title} desc={SM.deal.desc}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.2cqw", width: "100%", height: "100%" }}>
          <table className="rs-tbl">
            <thead><tr><th>사례</th><th>주소</th><th className="r">거리</th><th>거래일</th><th className="r">매매가</th><th className="r">연면적</th><th className="r">평단가</th><th className="r">시점보정</th></tr></thead>
            <tbody>
              <tr style={{ background: "color-mix(in srgb, var(--blue) 8%, transparent)" }}>
                <td className="b blue">본매물</td>
                <td className="b" style={{ maxWidth: "16cqw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortAddr}</td>
                <td className="r">—</td>
                <td>—</td>
                <td className="r b blue">{fair ? eokman(fair) : "—"}<span style={{ fontSize: ".82cqw", color: "var(--rmuted)", fontWeight: 500 }}> 추정가</span></td>
                <td className="r">{py(totalArea)}평</td>
                <td className="r b blue">{avgPer ? `${Math.round(avgPer / 1e4).toLocaleString()}만` : "—"}</td>
                <td className="r">—</td>
              </tr>
              {comps.length ? comps.map((c, i) => (
                <tr key={c.building_pk + i}>
                  <td>{i + 1}</td>
                  <td style={{ maxWidth: "16cqw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(c.addr ?? "").replace(/^서울특별시\s*/, "")}</td>
                  <td className="r">{c.weight ? `${Math.max(0, Math.round(1 / c.weight - 50))}m` : "—"}</td>
                  <td>{c.contract_ym ?? "—"}</td>
                  <td className="r">{eokman(c.price)}</td>
                  <td className="r">{c.area_py ?? "—"}평</td>
                  <td className="r b blue">{c.per_now ? `${Math.round(c.per_now / 1e4).toLocaleString()}만` : "—"}</td>
                  <td className="r">{c.time_adj != null ? `${c.time_adj >= 0 ? "+" : ""}${Math.round(c.time_adj * 100)}%` : "—"}</td>
                </tr>
              )) : <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--rmuted)", padding: "2cqw" }}>반경 내 실거래 사례 없음</td></tr>}
              {moreCount > 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--rmuted)", fontSize: ".95cqw", padding: ".55cqw", borderTop: "1px dashed var(--rl)" }}>가까운 순 4건 표시 · 외 <b style={{ color: "var(--navy)" }}>+{moreCount}건</b>도 추정가 산정에 반영됨</td></tr>}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: "2.5cqw", alignItems: "center", flex: 1 }}>
            <div style={{ flex: "0 0 42%", display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: "1.1cqw", fontWeight: 700, color: "var(--navy)", marginBottom: ".3cqw" }}>연면적당 평단가 비교 <span style={{ color: "var(--rmuted)", fontWeight: 400 }}>(만원/평)</span></div>
              {comps.length >= 2 && <CompareBar height={150} fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}`}
                refLine={avgPerNow ? { value: avgPerNow, label: "주변 평균" } : null}
                items={[...comps.map((c, i) => ({ label: `${i + 1}`, value: c.per_now ?? 0, color: "var(--navy)" })),
                  ...(avgPer ? [{ label: "본매물", value: avgPer, color: "var(--blue)", strong: true }] : [])].filter((x) => x.value > 0)} />}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: "1.15cqw", lineHeight: 1.75, color: "var(--rink)" }}>
                {compMin && compMax
                  ? <>인근 유사 실거래의 연면적당 평단가는 사례별 약 <b>{compMin.toLocaleString()}~{compMax.toLocaleString()}만원</b> 수준입니다. 본 매물은 입지·용도·건물 규모 등 개별 특성을 반영해 <b style={{ color: "var(--blue)" }}>평당 약 {avgPer ? Math.round(avgPer / 1e4).toLocaleString() : "—"}만원</b> 수준으로 분석됩니다.</>
                  : <>반경 내 유사 실거래가 충분치 않아, 다른 기준을 함께 반영해 시세를 분석했습니다.</>}
              </div>
              <div style={{ fontSize: "1cqw", lineHeight: 1.6, color: "var(--rmuted)", marginTop: ".9cqw" }}>
                이 실거래 기준값은 하나의 근거이며, 공시지가·주변 임대시세(수익가치) 등 다른 요소와 함께 종합해 최종 추정가를 산정합니다. 종합 결론은 마지막 장에서 정리합니다.
              </div>
            </div>
          </div>
        </div>
      </Slide>,
      <Slide key={4} n={SM.gongsi.n} foot={SM.gongsi.foot} rno={rno} date={date}
        title={SM.gongsi.title} desc={SM.gongsi.desc}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.4cqw", width: "100%", height: "100%" }}>
          <div style={{ display: "flex", gap: "2.5cqw" }}>
            {gongsiMetrics.map((g) => (
              <div key={g.k} style={{ flex: 1, borderTop: "2px solid var(--navy)", paddingTop: ".7cqw" }}>
                <div style={{ fontSize: "1.05cqw", fontWeight: 700, color: "var(--navy)" }}>{g.k} {g.sub && <span style={{ color: "var(--rmuted)", fontWeight: 400 }}>{g.sub}</span>}</div>
                <div style={{ fontSize: "3.2cqw", fontWeight: 800, color: "var(--blue)", lineHeight: 1.05 }}>{g.v}</div>
                <div style={{ fontSize: ".92cqw", color: "var(--rmuted)" }}>{g.cap}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "2.5cqw", flex: 1, alignItems: "center" }}>
            <div style={{ flex: "0 0 46%" }}>
              <div style={{ fontSize: "1.1cqw", fontWeight: 700, color: "var(--navy)", marginBottom: ".3cqw" }}>최근 공시지가 비교 <span style={{ color: "var(--rmuted)", fontWeight: 400 }}>(만원/㎡)</span></div>
              {gLatest && nbhdGongsi
                ? <CompareBar height={175} fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}`}
                    items={[{ label: "본매물", value: gLatest, color: "var(--blue)", strong: true },
                            { label: "주변 평균", value: nbhdGongsi, color: "var(--navy)" }]} />
                : <div style={{ color: "var(--rmuted)", fontSize: "1.1cqw", padding: "2cqw 0" }}>주변 사례 공시지가 데이터가 부족합니다.</div>}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: ".9cqw" }}>
              <div className="rs-fbox" style={{ textAlign: "center" }}><div className="k">공시총액 (공시지가 × 대지면적)</div><div className="v">{gTotal ? eokman(gTotal) : "—"}</div></div>
              <div style={{ fontSize: "1.08cqw", lineHeight: 1.7, color: "var(--rink)" }}>
                {gongsiProse.map((s: Seg, i: number) => s.b ? <b key={i} style={{ color: "var(--blue)" }}>{s.t}</b> : <Fragment key={i}>{s.t}</Fragment>)}
              </div>
            </div>
          </div>
        </div>
      </Slide>,
      <Slide key={5} n={SM.rent.n} foot={SM.rent.foot} rno={rno} date={date}
        title={SM.rent.title} desc={SM.rent.desc}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.6cqw", width: "100%", height: "100%", justifyContent: "center" }}>
          <div style={{ display: "flex", gap: "2cqw" }}>
            {rentMetrics.map(([k, v]) => (
              <div key={k} style={{ flex: 1, borderTop: "2px solid var(--navy)", paddingTop: ".7cqw" }}>
                <div style={{ fontSize: ".95cqw", fontWeight: 700, color: "var(--navy)" }}>{k}</div>
                <div style={{ fontSize: "1.85cqw", fontWeight: 800, color: "var(--navy)", lineHeight: 1.05, marginTop: ".15cqw" }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "2.2cqw", alignItems: "center", flex: 1 }}>
            <div style={{ flex: "0 0 25%" }}>
              <div style={{ fontSize: "1.05cqw", fontWeight: 700, color: "var(--navy)", marginBottom: ".3cqw" }}>현재 vs 주변 임대시세 <span style={{ color: "var(--rmuted)", fontWeight: 400, fontSize: ".85cqw" }}>(월, 만원)</span></div>
              {curRent && rent
                ? <CompareBar height={140} fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}`}
                    items={[{ label: "현재", value: curRent, color: "var(--navy)" },
                            { label: "주변시세", value: rent, color: "var(--blue)", strong: true }]} />
                : <div style={{ color: "var(--rmuted)", fontSize: "1.05cqw", padding: "2cqw 0" }}>주변 임대사례가 부족합니다.</div>}
            </div>
            <div style={{ flex: "0 0 25%" }}>
              <div style={{ fontSize: "1.05cqw", fontWeight: 700, color: "var(--navy)", marginBottom: ".3cqw" }}>수익률 vs 주변 평균 <span style={{ color: "var(--rmuted)", fontWeight: 400, fontSize: ".85cqw" }}>(%)</span></div>
              {roiFair != null && nbhdRoi != null
                ? <CompareBar height={140} fmt={(v) => v.toFixed(2)}
                    items={[{ label: "본매물", value: roiFair, color: "var(--blue)", strong: true },
                            { label: "주변평균", value: nbhdRoi, color: "var(--navy)" }]} />
                : <div style={{ color: "var(--rmuted)", fontSize: "1.05cqw", padding: "2cqw 0" }}>주변 수익률 데이터가 부족합니다.</div>}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: "1.12cqw", lineHeight: 1.7, color: "var(--rink)" }}>
                {rentProse.map((s: Seg, i: number) => s.b ? <b key={i} style={{ color: "var(--blue)" }}>{s.t}</b> : <Fragment key={i}>{s.t}</Fragment>)}
              </div>
            </div>
          </div>
        </div>
      </Slide>,
      <Slide key={6} n={SM.usetype.n} foot={SM.usetype.foot} rno={rno} date={date}
        title={SM.usetype.title} desc={SM.usetype.desc}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1cqw", width: "100%", height: "100%" }}>
          {ut ? <>
            <div style={{ display: "flex", gap: "2.2cqw", flex: 1, alignItems: "stretch", minHeight: 0 }}>
              {/* 좌: 대표유형(좌측 정렬) + 유형별 적합도 */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "1.6cqw" }}>
                <div className="rs-pop" style={{ ["--d" as string]: "150ms" }}>
                  <div style={{ fontSize: "1.1cqw", color: "var(--rmuted)", fontWeight: 700 }}>이 건물에 가장 적합한 활용</div>
                  <div style={{ fontSize: "3.4cqw", fontWeight: 800, color: "var(--navy)", lineHeight: 1.1 }}>
                    {ut.primary}{officeApt && <span style={{ fontSize: "1.3cqw", color: "#fff", background: "var(--blue)", borderRadius: "1.5cqw", padding: ".2cqw 1cqw", marginLeft: ".8cqw", fontWeight: 700, verticalAlign: "middle" }}>사옥 적합</span>}
                  </div>
                  <div style={{ fontSize: "1.05cqw", color: "var(--rmuted)", marginTop: ".3cqw" }}>{ut.reason}</div>
                </div>
                <div>
                  <div style={{ fontSize: "1.05cqw", fontWeight: 700, color: "var(--navy)", marginBottom: ".3cqw" }}>유형별 적합도 <span style={{ color: "var(--rmuted)", fontWeight: 400, fontSize: ".85cqw" }}>(점)</span></div>
                  <CompareBar height={140} fmt={(v) => `${Math.round(v)}`}
                    items={[{ label: "신축", value: ut.scores["신축용"] ?? 0, color: "var(--navy)" },
                            { label: "리모델", value: ut.scores["리모델링용"] ?? 0, color: "var(--navy)" },
                            { label: "수익", value: ut.scores["수익형"] ?? 0, color: "var(--blue)", strong: true },
                            { label: "사옥적합", value: ut.office_fit ?? 0, color: "var(--purple)" }].map((x) => ({ ...x, value: Math.max(x.value, 1) }))} />
                </div>
              </div>
              {/* 우: 큰 상권 지도(높이 채움) */}
              <div style={{ flex: 1.5, display: "flex", flexDirection: "column", gap: ".5cqw", minHeight: 0 }}>
                <div style={{ fontSize: "1.05cqw", fontWeight: 700, color: "var(--navy)" }}>주변 상권 지도 <span style={{ color: "var(--rmuted)", fontWeight: 400, fontSize: ".85cqw" }}>(반경 300m · 격자 지배 용도)</span></div>
                {ut.zones && ut.zones.length
                  ? <ReportMap lng={num(b.lng)} lat={num(b.lat)} geom={b.parcel_geom} zones={ut.zones as any} />
                  : <div style={{ color: "var(--rmuted)", fontSize: "1.05cqw", padding: "2cqw 0" }}>주변 상권 데이터가 부족합니다.</div>}
                <div style={{ display: "flex", gap: "1cqw", flexWrap: "wrap", fontSize: ".85cqw", color: "var(--rmuted)" }}>
                  {[["업무", "#3182F6"], ["먹자", "#E8833A"], ["유흥", "#D64545"], ["판매", "#2E9E6B"]].map(([k, c]) => (
                    <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: ".3cqw" }}><span style={{ width: ".9cqw", height: ".9cqw", background: c, borderRadius: ".2cqw", display: "inline-block" }} />{k}</span>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ fontSize: ".9cqw", lineHeight: 1.5, color: "var(--rmuted)", textAlign: "center", maxWidth: "88%", margin: "0 auto" }}>
              ※ 활용률(현재 용적률÷법정) {ut.util != null ? `${ut.util}%` : "—"} · 상권 프로필(층별 용도)·연식·입지로 판별. 사옥 적합도는 업무상권·역세권 기준이며, 실제 활용 목적은 매수자 판단입니다.
            </div>
          </> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--rmuted)", fontSize: "1.2cqw" }}>투자 유형 산정에 필요한 데이터가 부족합니다.</div>}
        </div>
      </Slide>,
      <Slide key={8} n={SM.future.n} foot={SM.future.foot} rno={rno} date={date}
        title={SM.future.title} desc={SM.future.desc}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.8cqw", width: "100%", height: "100%", justifyContent: "center" }}>
          {fut && fut.label ? <>
            <div style={{ display: "flex", gap: "2.8cqw", alignItems: "center", minHeight: 0 }}>
              {/* 좌: 미래가치 유형 */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div className="rs-pop" style={{ ["--d" as string]: "150ms" }}>
                  <div style={{ fontSize: "1.1cqw", color: "var(--rmuted)", fontWeight: 700 }}>미래가치 유형</div>
                  <div style={{ fontSize: "3.2cqw", fontWeight: 800, color: "var(--navy)", lineHeight: 1.1 }}>{fut.label}</div>
                  <div style={{ fontSize: "1.05cqw", color: "var(--rmuted)", marginTop: ".5cqw", lineHeight: 1.6 }}>{fut.reason}</div>
                </div>
              </div>
              {/* 우: 3축 실제 값(점수 아님) */}
              <div style={{ flex: 1.25, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                {futureAxes.map((x, i) => (
                  <div key={x.key} className="rs-fade" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1cqw", padding: ".9cqw 0", borderBottom: i < 2 ? "1px solid var(--rl)" : "none", ["--d" as string]: `${300 + i * 130}ms` }}>
                    <div><div style={{ fontSize: "1.2cqw", fontWeight: 700, color: "var(--navy)" }}>{x.label}</div>
                      <div style={{ fontSize: ".88cqw", color: "var(--rmuted)", marginTop: ".2cqw" }}>{x.sub}</div></div>
                    <div style={{ fontSize: "2.4cqw", fontWeight: 800, color: x.c, lineHeight: 1, whiteSpace: "nowrap" }}>{x.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rs-fade" style={{ fontSize: "1.05cqw", lineHeight: 1.75, color: "var(--rink)", maxWidth: "92%", margin: "0 auto", ["--d" as string]: "750ms" }}>
              <b style={{ color: "var(--navy)" }}>해석 &nbsp;</b>
              {(fut.dev ?? 0) < 20
                ? <>활용률 {ut?.util != null ? `${ut.util}%` : "—"}로 법정 용적률을 이미 채워 <b>신축·증축 여지가 제한적</b>이고, </>
                : <>법정 용적률 대비 미사용분이 남아 <b>개발여지가 유효</b>하고, </>}
              {(fut.upside ?? 0) < 20
                ? <>현재 임대료도 주변 시세와 유사해 단기 상향 여력이 낮습니다.</>
                : <>현재 임대료가 주변 시세를 밑돌아 <b>임대 리포지셔닝 여지</b>가 있습니다.</>}
              {fut.land != null && fut.land_rate5 != null
                ? (fut.land >= 50
                    ? <> 반면 최근 5년 공시지가가 <b style={{ color: "var(--navy)" }}>{fut.land_rate5 >= 0 ? "+" : ""}{fut.land_rate5}%</b> 올라 <b>지가 상승 추세가 양호</b>합니다.</>
                    : fut.land >= 25
                      ? <> 최근 5년 공시지가는 <b>{fut.land_rate5 >= 0 ? "+" : ""}{fut.land_rate5}%</b> 상승했습니다.</>
                      : <> 최근 5년 공시지가 변동도 완만합니다.</>)
                : null}
              {fut.label === "상승 기대형"
                ? <> 이 여력이 실현되면 현재가치를 넘어서는 <b>추가 상승</b>이 기대됩니다.</>
                : fut.label === "정체형"
                  ? <> 단기적으로는 가치 변동이 크지 않은 <b>안정 보유형</b>입니다.</>
                  : <> 다만 이는 입지·수익이 이미 성숙한 <b>우량자산</b>이라는 의미로, 지가가 꾸준히 오르는 만큼 <b>보유 시 가치도 점진적으로 상승</b>합니다. 개발·리모델링을 더하면 추가 상승 여력도 열립니다.</>}
            </div>
            <div style={{ fontSize: ".9cqw", lineHeight: 1.5, color: "var(--rmuted)", textAlign: "center", maxWidth: "90%", margin: "0 auto" }}>
              ※ 미래가치 = 개발여지(40%) + 임대 상향 여력(30%) + 지가 상승 추세(30%) 블렌드. 현재가치(추정가)와 별개의 상승 잠재력 지표입니다. 지가 상승은 개별 공시지가 5년 변동률(없으면 자치구 지가변동률)을 사용합니다.
            </div>
          </> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--rmuted)", fontSize: "1.2cqw" }}>미래가치 산정에 필요한 데이터가 부족합니다.</div>}
        </div>
      </Slide>,
      <Slide key={7} n={SM.conclusion.n} foot={SM.conclusion.foot} rno={rno} date={date}
        title={SM.conclusion.title} desc={SM.conclusion.desc}>
        <div style={{ display: "flex", flexDirection: "column", gap: ".9cqw", width: "100%", height: "100%", justifyContent: "center" }}>
          {/* 3축 — 작은 supporting 한 줄(결론보다 약하게) */}
          <div style={{ display: "flex", justifyContent: "center", gap: "1.6cqw", fontSize: ".98cqw", color: "var(--rmuted)" }}>
            <span className="cv-l">실거래 {compMin && compMax ? <b style={{ color: "var(--navy)" }}>{compMin.toLocaleString()}~{compMax.toLocaleString()}만/평</b> : "—"}</span>
            <span className="cv-l" style={{ color: "var(--rl)" }}>|</span>
            <span className="rs-fade" style={{ ["--d" as string]: "60ms" }}>공시배율 {gmult ? <b style={{ color: "var(--navy)" }}>×{gmult.toFixed(1)}</b> : "—"}</span>
            <span className="cv-r" style={{ color: "var(--rl)" }}>|</span>
            <span className="cv-r">월임대료 <b style={{ color: "var(--navy)" }}>{rent ? `${man(rent)}만원` : "—"}</b></span>
            <span className="cv-r" style={{ color: "var(--rmuted)" }}>을 종합</span>
          </div>
          {/* 결론 — 추정가 초대형(팝인+카운트업+글로우 수렴) */}
          <div className="rs-pop" style={{ textAlign: "center", position: "relative", ["--d" as string]: "260ms" }}>
            <div className="cv-glow" />
            <div style={{ position: "relative", fontSize: "1.2cqw", color: "var(--rmuted)", fontWeight: 700, letterSpacing: ".06em" }}>빌탐정 추정가</div>
            <div style={{ fontSize: "5.4cqw", fontWeight: 800, color: "var(--navy)", lineHeight: 1, letterSpacing: "-.02em" }}>
              <CountUp end={eokManParts(fair)[0]} dur={1300} delay={400} fmt={(v) => Math.round(v).toLocaleString()} /><span style={{ fontSize: "2.4cqw" }}>억{eokManParts(fair)[1] ? ` ${eokManParts(fair)[1].toLocaleString()}만원` : "원"}</span>
            </div>
            <div style={{ fontSize: "1.05cqw", color: "var(--rmuted)" }}>평당 약 {avgPer ? Math.round(avgPer / 1e4).toLocaleString() : "—"}만원 · 연면적 {py(totalArea)}평</div>
          </div>
          {/* 핵심 지표 3 — 큼지막, hairline, 순차 카운트업 */}
          <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
            {([
              ["예상수익률", <CountUp key="r" end={roiFair ?? 0} dur={1000} delay={1200} fmt={(v) => v.toFixed(2)} />, "%", nbhdRoi ? `주변 평균 ${nbhdRoi}%` : "추정가 기준"],
              ["예상 월임대수익", rent ? `${man(rent)}만원` : "—", "", "주변 임대시세 적용"],
              ["매력도", grade, "등급", `가치점수 ${score}점`],
            ] as [string, React.ReactNode, string, string][]).map(([k, v, u, d], i) => (
              <div key={k} className="rs-fade" style={{ textAlign: "center", padding: "0 2.8cqw", borderRight: i < 2 ? "1px solid var(--rl)" : "none", ["--d" as string]: `${1100 + i * 200}ms` }}>
                <div style={{ fontSize: "1cqw", color: "var(--rmuted)", fontWeight: 700 }}>{k}</div>
                <div style={{ fontSize: "2.7cqw", fontWeight: 800, color: "var(--blue)", lineHeight: 1.05 }}>{v}<span style={{ fontSize: "1.35cqw" }}>{u}</span></div>
                <div style={{ fontSize: ".82cqw", color: "var(--rmuted)" }}>{d}</div>
              </div>
            ))}
          </div>
          {/* 성격 키워드 — 중앙 양옆, 아래서 위로 올라오며(rs-fade) 큼지막하게 */}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "4.5cqw", marginTop: ".6cqw" }}>
            {([
              ut?.primary ? { lab: "투자 유형", val: ut.primary, extra: officeApt ? "사옥 적합" : null, c: "var(--blue)" } : null,
              fut?.label ? { lab: "미래가치", val: fut.label, extra: null, c: "var(--blue)" } : null,
            ].filter(Boolean) as { lab: string; val: string; extra: string | null; c: string }[]).map((t, i) => (
              <Fragment key={t.lab}>
                {i > 0 && <div style={{ width: "1px", height: "3.4cqw", background: "var(--rl)" }} />}
                <div className="rs-fade" style={{ textAlign: "center", ["--d" as string]: `${1650 + i * 240}ms` }}>
                  <div style={{ fontSize: ".92cqw", fontWeight: 700, letterSpacing: ".1em", color: "var(--rmuted)", marginBottom: ".25cqw" }}>{t.lab}</div>
                  <div style={{ fontSize: "3.2cqw", fontWeight: 800, lineHeight: 1, color: t.c, letterSpacing: "-.01em" }}>{t.val}</div>
                  {t.extra && <div style={{ fontSize: ".95cqw", fontWeight: 700, color: t.c, opacity: .85, marginTop: ".35cqw", letterSpacing: ".02em" }}>· {t.extra}</div>}
                </div>
              </Fragment>
            ))}
          </div>
          {/* 종합 의견 — reportModel.conclusion 단일 소스(애니메이션 모드와 동일 문구) */}
          <div className="rs-fade" style={{ fontSize: "1.05cqw", lineHeight: 1.75, color: "var(--rink)", maxWidth: "90%", margin: ".6cqw auto 0", ["--d" as string]: "2050ms" }}>
            <b style={{ color: "var(--navy)" }}>종합 의견 &nbsp;</b>
            {conclusion.map((s: Seg, i: number) => s.b ? <b key={i} style={{ color: "var(--blue)" }}>{s.t}</b> : <Fragment key={i}>{s.t}</Fragment>)}
          </div>
        </div>
      </Slide>,
  ];

  return (
    <div className="rslide-root deck" ref={rootRef}>
      {toolbar}
      <div className="deck-main">
        <aside className="deck-nav">
          {slides.map((s, i) => (
            <div key={i} className={`deck-thumb${cur === i ? " on" : ""}`} onClick={() => setCur(i)} title={`슬라이드 ${i + 1}`}>
              <span className="tnum">{String(i + 1).padStart(2, "0")}</span>
              <div className="twrap">{s}</div>
            </div>
          ))}
        </aside>
        <div className="deck-stage">
          <div className="stage-slide rs-enter" key={cur}>{slides[cur]}</div>
          <div className="deck-counter">{cur + 1} / {slides.length}</div>
        </div>
      </div>
    </div>
  );
}

