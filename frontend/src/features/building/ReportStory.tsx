import { useEffect, useRef, useState, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CountUp, BuildingArt } from "./ReportAssets";
import { ScoreRadar, CompareBar } from "./ReportPrimitives";
import { ReportMap, ZONE_COLOR } from "./ReportMap";
import { useReportModel, AXIS, num, eokman, eokManParts, py, type Seg } from "./reportModel";

/** 몰입형 스크롤 보고서 — 덱(/report)과 동일한 reportModel(값·문구·슬라이드 내용 단일 소스)을 쓰고 디자인만 다르게.
 * 내용(제목·설명·표시 항목·의견·서술)은 덱과 100% 동일, 표현(다크 북엔드·스크롤·모션)만 다름. */
const RAIL = ["표지", "핵심요약", "기본정보", "매력도", "실거래", "공시지가", "임대수익", "투자유형", "미래가치", "종합결론"];

/** 스토리 세그먼트 서술 렌더(강조=민트/네이비). */
function Prose({ segs, bold }: { segs: Seg[]; bold: string }) {
  return <>{segs.map((s, i) => s.b ? <b key={i} style={{ color: bold }}>{s.t}</b> : <Fragment key={i}>{s.t}</Fragment>)}</>;
}

export function ReportStory() {
  const { pk = "" } = useParams();
  const nav = useNavigate();
  const m = useReportModel(null, pk);
  const {
    sub, b, fair, rent, curRent, totalArea, avgPer, usedComps, comps, compMin, compMax,
    gLatest, nbhdGongsi, gTotal, roiFair, nbhdRoi, ut, officeApt, fut, useZone, mainUse,
    grade, score, gradeCol, shortAddr, opinions, conclusion,
    SLIDES, summaryTail, basicInfo, gongsiMetrics, gongsiProse, rentMetrics, rentProse, rentNote, futureAxes,
  } = m;
  const SM = Object.fromEntries(SLIDES.map((s) => [s.key, s])) as Record<string, typeof SLIDES[number]>;
  const addr = shortAddr === "—" ? "매물 분석" : shortAddr;

  // ── 스크롤: 인트로 패럴랙스 + 진행바 + 섹션 레일(스크롤 스파이) ──
  const scRef = useRef<HTMLDivElement>(null);
  const secRefs = useRef<(HTMLElement | null)[]>([]);
  const [p, setP] = useState(0);
  const [prog, setProg] = useState(0);
  const [shown, setShown] = useState<boolean[]>([]);
  const [active, setActive] = useState(0);
  const onScroll = () => {
    const el = scRef.current; if (!el) return;
    setP(Math.min(1, el.scrollTop / el.clientHeight));
    setProg(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight));
  };
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      const i = Number((e.target as HTMLElement).dataset.i);
      if (e.isIntersecting) { setShown((prev) => { if (prev[i]) return prev; const n = [...prev]; n[i] = true; return n; }); setActive(i); }
    }), { threshold: 0.45 });
    secRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [m.sub, m.b]);
  const setRef = (i: number) => (el: HTMLElement | null) => { secRefs.current[i] = el; };
  const cls = (i: number, dark = false) => `story-sec${dark ? " story-dark" : ""}${shown[i] ? " in" : ""}`;
  const goto = (i: number) => secRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  const SquareMap = ({ zones }: { zones?: any }) => (
    <div style={{ width: "min(540px, 100%)", aspectRatio: "1 / 1", borderRadius: 14, overflow: "hidden" }}>
      <ReportMap lng={num(b.lng)} lat={num(b.lat)} geom={b.parcel_geom} zones={zones} h="100%" />
    </div>
  );

  return (
    <div ref={scRef} onScroll={onScroll} className="story-root">
      <div className="story-prog" style={{ width: `${prog * 100}%` }} />
      <button className="btn" style={{ position: "fixed", top: 14, left: 16, zIndex: 30, padding: "6px 12px" }} onClick={() => nav(`/buildings/${pk}/report`)}>← 덱 뷰</button>
      <nav className="story-rail">
        {RAIL.map((l, i) => (
          <button key={i} className={active === i ? "on" : ""} onClick={() => goto(i)} title={l}>
            <span className="dot" /><span className="lab">{l}</span>
          </button>
        ))}
      </nav>

      {/* 0 ── 인트로 ── */}
      <section data-i={0} ref={setRef(0)} style={{ height: "230vh", position: "relative" }}>
        <div style={{ position: "sticky", top: 0, height: "100vh", overflow: "hidden", background: "#0a0e17" }}>
          <div style={{ position: "absolute", inset: 0, transformOrigin: "50% 88%", transform: `scale(${1 + p * 5.5})`, opacity: Math.max(0, 1 - p * 1.15), willChange: "transform, opacity" }}>
            <BuildingArt />
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 50% 40%, transparent 40%, rgba(5,8,15,.85) 100%)" }} />
          </div>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", color: "#fff", opacity: Math.max(0, 1 - p * 2.4), pointerEvents: "none" }}>
            <div style={{ fontSize: 14, letterSpacing: ".28em", color: "#8fb0e0", fontWeight: 700, marginBottom: 22 }}>빌탐정 부동산 가치분석 보고서</div>
            <div style={{ fontSize: "clamp(38px,6.5vw,84px)", fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.05, textShadow: "0 2px 30px rgba(0,0,0,.5)" }}>{addr}</div>
            <div style={{ fontSize: "clamp(15px,1.7vw,20px)", color: "#c7d3e6", marginTop: 18 }}>{useZone} · {mainUse}</div>
          </div>
          <div style={{ position: "absolute", bottom: 34, left: 0, right: 0, textAlign: "center", color: "#9fb0cc", fontSize: 12, letterSpacing: ".15em", opacity: Math.max(0, 1 - p * 3), animation: "story-bounce 1.8s ease-in-out infinite" }}>스크롤하여 진입 ↓</div>
        </div>
      </section>

      {/* 1 ── 핵심 요약(다크) — 적정가·수익률·매력도 + 투자유형 ── */}
      <section data-i={1} ref={setRef(1)} className={cls(1, true)}>
        <div className="story-kicker">{SM.summary.title}</div>
        <h2 className="story-h">{addr}의 <b>빌탐정 적정가</b></h2>
        <div className="story-big">
          {shown[1] && fair ? <CountUp end={eokManParts(fair)[0]} dur={1400} fmt={(v) => Math.round(v).toLocaleString()} /> : eokManParts(fair)[0].toLocaleString()}<span className="unit">억{eokManParts(fair)[1] ? ` ${eokManParts(fair)[1].toLocaleString()}만원` : "원"}</span>
        </div>
        <p className="story-sub">
          매력도 <b style={{ color: "#5fe0a8" }}>{grade}등급 · {score}점</b> · 적정가 기준 예상수익률 <b style={{ color: "#5fe0a8" }}>{roiFair != null ? roiFair.toFixed(2) : "—"}%</b> · 평당 적정가 {summaryTail.avgPerMan} · 연면적 {summaryTail.totalPy}
        </p>
        <KeywordBand items={summaryTail.primary ? [{ lab: "투자 유형", val: summaryTail.primary, extra: officeApt ? "사옥 적합" : null, c: "#7FB0FF" }] : []} />
      </section>

      {/* 2 ── 매물 기본정보 ── */}
      <section data-i={2} ref={setRef(2)} className={cls(2)}>
        <div className="story-kicker">{SM.basic.title}</div>
        <h2 className="story-h">{addr}</h2>
        <div style={{ display: "flex", gap: "4vw", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div className="st-grid2" style={{ flex: "1 1 540px", marginTop: 0 }}>
            {basicInfo.map(([k, v]) => (
              <div className="st-row" key={k}><span className="k" style={{ whiteSpace: "nowrap" }}>{k}</span><span className="v">{v}</span></div>
            ))}
          </div>
          {num(b.lng) != null && <SquareMap />}
        </div>
      </section>

      {/* 3 ── 매력도 (의견 = 덱과 동일) ── */}
      <section data-i={3} ref={setRef(3)} className={cls(3)}>
        <div className="story-kicker">{SM.appeal.title}</div>
        <h2 className="story-h">입지·건물 종합 매력도 <b style={{ color: gradeCol }}>{grade}등급 · {score}점</b></h2>
        <div className="st-cols">
          <div>
            {opinions.map((o) => (
              <div key={o.key} style={{ padding: "12px 0", borderTop: "1px solid #ececef" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14 }}>
                  <span style={{ color: "#1a1f2b", fontWeight: 600, fontSize: "clamp(14px,1.4vw,17px)" }}>{o.label}</span>
                  <span style={{ color: o.score >= 70 ? "#2b5aa8" : "#828a99", fontWeight: 700, whiteSpace: "nowrap" }}>{o.word} · {Math.round(o.score)}</span>
                </div>
                <div style={{ fontSize: "clamp(12.5px,1.25vw,15px)", color: "#828a99", marginTop: 4, lineHeight: 1.4 }}>{o.text}</div>
              </div>
            ))}
          </div>
          <div style={{ minHeight: 240, display: "flex", justifyContent: "center", alignSelf: "center" }}>
            {shown[3] && sub?.items && <ScoreRadar axes={AXIS.map(([kk, l]) => ({ label: l, score: (sub.items![kk] ?? 0) as number }))} color={gradeCol} size={270} showValues />}
          </div>
        </div>
      </section>

      {/* 4 ── 실거래가 ── */}
      <section data-i={4} ref={setRef(4)} className={cls(4)}>
        <div className="story-kicker">{SM.deal.title}</div>
        <h2 className="story-h">인근 유사 실거래 <b>{usedComps.length}건</b>{compMin && compMax ? <> · 평당 {compMin.toLocaleString()}~{compMax.toLocaleString()}만원</> : null}</h2>
        {comps.length ? <>
          <div style={{ marginTop: "2vh" }}>
            {comps.map((c, i) => (
              <div className="st-row" key={c.building_pk + String(i)}>
                <span className="k">{i + 1}. {(c.addr ?? "").replace(/^서울특별시\s*/, "")}</span>
                <span className="v">{c.contract_ym} · {eokman(c.price)} · {c.area_py ?? "—"}평 · <b className="hl">{c.per_now ? `${Math.round(c.per_now / 1e4).toLocaleString()}만/평` : "—"}</b></span>
              </div>
            ))}
          </div>
          {shown[4] && <div style={{ marginTop: "3vh", maxWidth: 660 }}>
            <CompareBar height={150} fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}`}
              items={[...comps.map((c, i) => ({ label: `${i + 1}`, value: c.per_now ?? 0, color: "#1e2a4a" })),
                ...(avgPer ? [{ label: "본매물", value: avgPer, color: "#2b5aa8", strong: true }] : [])].filter((x) => x.value > 0)} />
          </div>}
          <div className="st-flow">
            <div className="cell"><div className="k">가중평균 평단가</div><div className="v">{avgPer ? `${Math.round(avgPer / 1e4).toLocaleString()}만/평` : "—"}</div></div>
            <span className="op">×</span>
            <div className="cell"><div className="k">본매물 연면적</div><div className="v">{py(totalArea)}평</div></div>
            <span className="op">=</span>
            <div className="cell"><div className="k">빌탐정 적정가</div><div className="v" style={{ color: "#1c8c63" }}>{eokman(fair)}</div></div>
          </div>
        </> : <p className="story-sub">반경 내 실거래 사례가 없습니다.</p>}
      </section>

      {/* 5 ── 공시지가 (덱과 동일: 2지표 + 비교 + 공시총액 + 서술) ── */}
      <section data-i={5} ref={setRef(5)} className={cls(5)}>
        <div className="story-kicker">{SM.gongsi.title}</div>
        <div className="story-row" style={{ marginTop: "2vh" }}>
          {gongsiMetrics.map((g) => (
            <div key={g.k} className="story-cell">
              <div className="k">{g.k} {g.sub && <span style={{ color: "#a0a8b4", fontWeight: 400 }}>{g.sub}</span>}</div>
              <div className="v" style={{ color: "#2b5aa8" }}>{g.v}</div>
              <div style={{ fontSize: 12.5, color: "#a0a8b4", marginTop: 4 }}>{g.cap}</div>
            </div>
          ))}
        </div>
        <div className="st-cols" style={{ marginTop: "3vh" }}>
          <div>
            <div style={{ fontSize: "clamp(14px,1.4vw,17px)", fontWeight: 700, color: "#1a1f2b", marginBottom: 10 }}>최근 공시지가 비교 <span style={{ color: "#828a99", fontWeight: 400 }}>(만원/㎡)</span></div>
            {gLatest && nbhdGongsi
              ? <CompareBar height={160} fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}`}
                  items={[{ label: "본매물", value: gLatest, color: "#2b5aa8", strong: true }, { label: "주변 평균", value: nbhdGongsi, color: "#1e2a4a" }]} />
              : <p className="story-sub">주변 사례 공시지가 데이터가 부족합니다.</p>}
          </div>
          <div style={{ alignSelf: "center" }}>
            <div style={{ fontSize: 14, color: "#828a99" }}>공시총액 (공시지가 × 대지면적)</div>
            <div className="st-lead" style={{ fontSize: "clamp(26px,3.4vw,46px)" }}>{gTotal ? eokman(gTotal) : "—"}</div>
            <p style={{ fontSize: "clamp(14px,1.4vw,17px)", lineHeight: 1.7, color: "#1a1f2b", marginTop: 12 }}><Prose segs={gongsiProse} bold="#2b5aa8" /></p>
          </div>
        </div>
      </section>

      {/* 6 ── 임대수익 (층별 나열 X — 요약 5지표 + 비교 + 서술) ── */}
      <section data-i={6} ref={setRef(6)} className={cls(6)}>
        <div className="story-kicker">{SM.rent.title}</div>
        <div style={{ display: "flex", gap: "2vw", flexWrap: "wrap", marginTop: "2vh" }}>
          {rentMetrics.map(([k, v, d]) => (
            <div key={k} style={{ flex: "1 1 150px", borderTop: "2px solid #1e2a4a", paddingTop: 10 }}>
              <div style={{ fontSize: "clamp(12px,1.2vw,14px)", fontWeight: 700, color: "#1e2a4a" }}>{k}</div>
              <div style={{ fontSize: "clamp(20px,2.4vw,30px)", fontWeight: 800, color: "#1e2a4a", lineHeight: 1.1, margin: "2px 0" }}>{v}</div>
              <div style={{ fontSize: "clamp(11px,1.1vw,13px)", color: "#828a99" }}>{d}</div>
            </div>
          ))}
        </div>
        <div className="st-cols" style={{ marginTop: "3.5vh" }}>
          <div style={{ display: "flex", gap: "3vw" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "clamp(13px,1.3vw,16px)", fontWeight: 700, color: "#1a1f2b", marginBottom: 8 }}>현재 vs 주변 임대시세 <span style={{ color: "#828a99", fontWeight: 400 }}>(월, 만원)</span></div>
              {curRent && rent
                ? <CompareBar height={140} fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}`}
                    items={[{ label: "현재", value: curRent, color: "#1e2a4a" }, { label: "주변시세", value: rent, color: "#2b5aa8", strong: true }]} />
                : <p className="story-sub">주변 임대사례가 부족합니다.</p>}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "clamp(13px,1.3vw,16px)", fontWeight: 700, color: "#1a1f2b", marginBottom: 8 }}>수익률 vs 주변 평균 <span style={{ color: "#828a99", fontWeight: 400 }}>(%)</span></div>
              {roiFair != null && nbhdRoi != null
                ? <CompareBar height={140} fmt={(v) => v.toFixed(2)}
                    items={[{ label: "본매물", value: roiFair, color: "#2b5aa8", strong: true }, { label: "주변평균", value: nbhdRoi, color: "#1e2a4a" }]} />
                : <p className="story-sub">주변 수익률 데이터가 부족합니다.</p>}
            </div>
          </div>
          <div style={{ alignSelf: "center" }}>
            <p style={{ fontSize: "clamp(15px,1.5vw,18px)", lineHeight: 1.7, color: "#1a1f2b" }}><Prose segs={rentProse} bold="#2b5aa8" /></p>
            <p style={{ fontSize: "clamp(13px,1.3vw,15px)", lineHeight: 1.6, color: "#828a99", marginTop: 12 }}>{rentNote}</p>
          </div>
        </div>
      </section>

      {/* 7 ── 투자 유형 + 상권 지도 ── */}
      <section data-i={7} ref={setRef(7)} className={cls(7)}>
        <div className="story-kicker">{SM.usetype.title}</div>
        <h2 className="story-h">가장 적합한 활용 <b style={{ color: "#2b5aa8" }}>{ut?.primary ?? "—"}</b>{officeApt ? " · 사옥 적합" : ""}</h2>
        {ut ? <div className="st-cols">
          <div>
            <p className="story-sub" style={{ marginTop: 0 }}>{ut.reason}</p>
            {shown[7] && <div style={{ marginTop: "2.5vh", maxWidth: 460 }}>
              <CompareBar height={150} fmt={(v) => `${Math.round(v)}`}
                items={[{ label: "신축", value: Math.max(ut.scores["신축용"] ?? 0, 1), color: "#1e2a4a" },
                        { label: "리모델", value: Math.max(ut.scores["리모델링용"] ?? 0, 1), color: "#1e2a4a" },
                        { label: "수익", value: Math.max(ut.scores["수익형"] ?? 0, 1), color: "#2b5aa8", strong: true },
                        { label: "사옥적합", value: Math.max(ut.office_fit ?? 0, 1), color: "#6E56CF" }]} />
            </div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            {ut.zones && ut.zones.length
              ? <><SquareMap zones={ut.zones as any} />
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "#828a99" }}>
                    {Object.entries(ZONE_COLOR).map(([k, c]) => (
                      <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 11, height: 11, background: c, borderRadius: 3, display: "inline-block" }} />{k}</span>
                    ))}
                  </div></>
              : <p className="story-sub">주변 상권 데이터가 부족합니다.</p>}
          </div>
        </div> : <p className="story-sub">투자 유형 산정 데이터가 부족합니다.</p>}
      </section>

      {/* 8 ── 미래가치 ── */}
      <section data-i={8} ref={setRef(8)} className={cls(8)}>
        <div className="story-kicker">{SM.future.title}</div>
        <h2 className="story-h">미래가치 <b style={{ color: "#6E56CF" }}>{fut?.label ?? "—"}</b></h2>
        {fut ? <>
          <p className="story-sub" style={{ maxWidth: 820 }}>{fut.reason}</p>
          <div style={{ marginTop: "3vh", maxWidth: 760 }}>
            {futureAxes.map((x, i) => (
              <div key={x.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 20, padding: "16px 0", borderTop: i === 0 ? "none" : "1px solid #ececef" }}>
                <div>
                  <div style={{ fontSize: "clamp(15px,1.6vw,19px)", fontWeight: 700, color: "#1a1f2b" }}>{x.label}</div>
                  <div style={{ fontSize: "clamp(12.5px,1.25vw,15px)", color: "#828a99", marginTop: 3 }}>{x.sub}</div>
                </div>
                <div style={{ fontSize: "clamp(26px,3vw,40px)", fontWeight: 800, color: x.c, lineHeight: 1, whiteSpace: "nowrap" }}>{x.value}</div>
              </div>
            ))}
          </div>
          <p className="story-note" style={{ marginTop: "3vh" }}>※ 미래가치 = 개발여지 + 임대 상향 여력 + 지가 상승 추세를 종합해 유형을 판정합니다. 현재가치(적정가)와 별개의 상승 잠재력 지표입니다.</p>
        </> : <p className="story-sub">미래가치 산정 데이터가 부족합니다.</p>}
      </section>

      {/* 9 ── 종합 결론(다크) ── */}
      <section data-i={9} ref={setRef(9)} className={cls(9, true)}>
        <div className="story-kicker">{SM.conclusion.title}</div>
        <h2 className="story-h">실거래·공시지가·임대수익을 종합한 <b>빌탐정 적정가</b></h2>
        <div className="story-big">
          {shown[9] && fair ? <CountUp end={eokManParts(fair)[0]} dur={1500} fmt={(v) => Math.round(v).toLocaleString()} /> : eokManParts(fair)[0].toLocaleString()}<span className="unit">억{eokManParts(fair)[1] ? ` ${eokManParts(fair)[1].toLocaleString()}만원` : "원"}</span>
        </div>
        <div className="story-row">
          {[["예상수익률", roiFair != null ? `${roiFair.toFixed(2)}%` : "—", nbhdRoi != null ? `주변 평균 ${nbhdRoi}%` : "적정가 기준"],
            ["예상 연임대수익", rent ? eokman(rent * 12) : "—", "주변 임대시세 적용"],
            ["매력도", `${grade}등급`, `가치점수 ${score}점`]].map(([k, v, s], i) => (
            <div key={i} className="story-cell">
              <div className="k" style={{ color: "#9fb0cc" }}>{k}</div>
              <div className="v" style={{ color: "#eaf0fa" }}>{v}</div>
              <div style={{ fontSize: 12.5, color: "#7f92b5", marginTop: 4 }}>{s}</div>
            </div>
          ))}
        </div>
        <KeywordBand items={[
          ...(summaryTail.primary ? [{ lab: "투자 유형", val: summaryTail.primary, extra: officeApt ? "사옥 적합" : null, c: "#7FB0FF" }] : []),
          ...(fut?.label ? [{ lab: "미래가치", val: fut.label, extra: null, c: "#B9A5FF" }] : []),
        ]} />
        <p style={{ fontSize: "clamp(14px,1.5vw,18px)", color: "#c7d3e6", marginTop: "4.5vh", lineHeight: 1.75, maxWidth: 880 }}>
          <Prose segs={conclusion} bold="#5fe0a8" />
        </p>
        <p className="story-note">본 보고서는 빌탐정의 자체 조사·분석 기반이며 실제 거래 시 차이가 발생할 수 있습니다.</p>
      </section>
    </div>
  );
}

/** 성격 키워드 밴드 — 중앙 양옆(다크). items=[{lab,val,extra,c}]. */
function KeywordBand({ items }: { items: { lab: string; val: string; extra: string | null; c: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="story-kw">
      {items.map((t, i) => (
        <Fragment key={t.lab}>
          {i > 0 && <div className="kw-div" />}
          <div>
            <div className="kw-lab">{t.lab}</div>
            <div className="kw-val" style={{ color: t.c }}>{t.val}</div>
            {t.extra && <div className="kw-ex" style={{ color: t.c }}>· {t.extra}</div>}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
