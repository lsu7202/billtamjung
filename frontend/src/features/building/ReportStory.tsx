import { useEffect, useRef, useState, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CountUp, BuildingArt } from "./ReportAssets";
import { ScoreRadar, CompareBar } from "./ReportPrimitives";
import { ReportMap, ZONE_COLOR } from "./ReportMap";
import { useReportModel, AXIS, num, eok, man, py, type Seg } from "./reportModel";

/** 몰입형 스크롤 보고서 — 덱(/report)과 동일한 reportModel(값·의견·서술 단일 소스)을 쓰고 디자인만 다르게.
 * 다크 북엔드(인트로·결론) + 라이트 분석부 · 스크롤 리빌 · 카운트업 · 섹션 레일. */
const RAIL = ["표지", "핵심요약", "기본정보", "매력도", "실거래", "공시지가", "임대수익", "투자유형", "미래가치", "종합결론"];

export function ReportStory() {
  const { pk = "" } = useParams();
  const nav = useNavigate();
  const m = useReportModel(null, pk);
  const {
    sub, b, fair, ask, rent, totalArea, landArea, avgPer, usedComps, comps, compMin, compMax,
    gLatest, gTotal, nbhdGongsi, gmult, landPremium, roiFair, rs, rCurDep, perPyRent, nbhdRoi,
    ut, officeApt, fut, useZone, mainUse, grade, score, gradeCol, shortAddr, floors, opinions, conclusion,
  } = m;
  const addr = shortAddr;

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
            <div style={{ fontSize: 14, letterSpacing: ".28em", color: "#8fb0e0", fontWeight: 700, marginBottom: 22 }}>빌탐정 부동산 가치분석</div>
            <div style={{ fontSize: "clamp(38px,6.5vw,84px)", fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.05, textShadow: "0 2px 30px rgba(0,0,0,.5)" }}>{addr || "매물 분석"}</div>
            <div style={{ fontSize: "clamp(15px,1.7vw,20px)", color: "#c7d3e6", marginTop: 18 }}>{useZone} · {mainUse}</div>
          </div>
          <div style={{ position: "absolute", bottom: 34, left: 0, right: 0, textAlign: "center", color: "#9fb0cc", fontSize: 12, letterSpacing: ".15em", opacity: Math.max(0, 1 - p * 3), animation: "story-bounce 1.8s ease-in-out infinite" }}>스크롤하여 진입 ↓</div>
        </div>
      </section>

      {/* 1 ── 핵심 요약(다크) ── */}
      <section data-i={1} ref={setRef(1)} className={cls(1, true)}>
        <div className="story-kicker">핵심 요약</div>
        <h2 className="story-h">{addr}의 <b>빌탐정 적정가</b></h2>
        <div className="story-big">
          {shown[1] && fair ? <CountUp end={fair / 1e8} dur={1400} fmt={(v) => Math.round(v).toLocaleString()} /> : eok(fair)}<span className="unit">억원</span>
        </div>
        <p className="story-sub">매력도 <b style={{ color: "#5fe0a8" }}>{grade}등급 · {score}점</b> · 평당 {avgPer ? Math.round(avgPer / 1e4).toLocaleString() : "—"}만원 · 적정가 기준 예상수익률 <b style={{ color: "#5fe0a8" }}>{roiFair != null ? roiFair.toFixed(2) : "—"}%</b></p>
        <KeywordBand ut={ut} fut={fut} officeApt={officeApt} dark />
      </section>

      {/* 2 ── 기본 정보 ── */}
      <section data-i={2} ref={setRef(2)} className={cls(2)}>
        <div className="story-kicker">기본 정보</div>
        <h2 className="story-h">토지이용계획·건축물대장 기준 제원</h2>
        <div className="st-grid2">
          {[["대지면적", `${py(landArea)}평 · ${landArea ?? "—"}㎡`],
            ["연면적", `${py(totalArea)}평 · ${totalArea ?? "—"}㎡`],
            ["용도지역", useZone], ["건축물용도", mainUse],
            ["규모", `지하 ${b.floors_below ?? "—"} / 지상 ${b.floors_above ?? "—"}층`],
            ["사용승인", b.approval_ymd ? `${String(b.approval_ymd).slice(0, 4)}년` : "—"],
            ["건폐율 / 용적률", `${b.bcr ?? "—"}% / ${b.far ?? "—"}%`],
            ["주차 / 승강기", `${b.parking ?? "—"}대 / ${b.elevator ?? "—"}`],
            ["도로접면", b.road_frontage ?? b.road_access ?? "—"],
            ["매도희망가", ask ? `${eok(ask)}억원` : "—"]].map(([k, v], i) => (
            <div className="st-row" key={i}><span className="k">{k}</span><span className="v">{v}</span></div>
          ))}
        </div>
        {num(b.lng) != null && <div style={{ marginTop: "4vh", borderRadius: 14, overflow: "hidden" }}>
          <ReportMap lng={num(b.lng)} lat={num(b.lat)} geom={b.parcel_geom} h="44vh" />
        </div>}
      </section>

      {/* 3 ── 매력도 (의견 텍스트 = 덱과 동일) ── */}
      <section data-i={3} ref={setRef(3)} className={cls(3)}>
        <div className="story-kicker">매력도 분석</div>
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
        <div className="story-kicker">주변 실거래 분석</div>
        <h2 className="story-h">인근 유사 실거래 <b>{usedComps.length}건</b>{compMin && compMax ? <> · 평당 {compMin.toLocaleString()}~{compMax.toLocaleString()}만원</> : null}</h2>
        {comps.length ? <>
          <div style={{ marginTop: "2vh" }}>
            {comps.map((c, i) => (
              <div className="st-row" key={c.building_pk + String(i)}>
                <span className="k">{i + 1}. {(c.addr ?? "").replace(/^서울특별시\s*/, "")}</span>
                <span className="v">{c.contract_ym} · {eok(c.price)}억 · {c.area_py ?? "—"}평 · <b className="hl">{c.per_now ? `${Math.round(c.per_now / 1e4).toLocaleString()}만/평` : "—"}</b></span>
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
            <div className="cell"><div className="k">빌탐정 적정가</div><div className="v" style={{ color: "#1c8c63" }}>{eok(fair)}억</div></div>
          </div>
        </> : <p className="story-sub">반경 내 실거래 사례가 없습니다.</p>}
      </section>

      {/* 5 ── 공시지가 ── */}
      <section data-i={5} ref={setRef(5)} className={cls(5)}>
        <div className="story-kicker">공시지가 분석</div>
        <h2 className="story-h">이 땅의 공시지가는 <b style={{ color: "#2b5aa8" }}>{man(gLatest)}만원/㎡</b></h2>
        <div className="story-row">
          {[["주변 대비", landPremium != null ? `${landPremium >= 0 ? "+" : ""}${landPremium.toFixed(0)}%` : "—", `주변 평균 ${man(nbhdGongsi)}만/㎡`],
            ["공시배율", gmult != null ? `×${gmult.toFixed(1)}` : "—", "실거래 ÷ 공시총액"],
            ["공시총액", gTotal ? `${eok(gTotal)}억` : "—", "공시지가 × 대지면적"]].map(([k, v, s], i) => (
            <div key={i} className="story-cell">
              <div className="k">{k}</div><div className="v">{v}</div>
              <div style={{ fontSize: 12.5, color: "#a0a8b4", marginTop: 4 }}>{s}</div>
            </div>
          ))}
        </div>
        <p className="story-sub">시장이 공시가 대비 형성한 배율(공시배율)은 적정가 산정의 한 축으로 반영됩니다.</p>
      </section>

      {/* 6 ── 임대수익 ── */}
      <section data-i={6} ref={setRef(6)} className={cls(6)}>
        <div className="story-kicker">임대수익 분석</div>
        <h2 className="story-h">총 월임대료 <b style={{ color: "#2b5aa8" }}>{man(rent)}만원</b> <span style={{ fontSize: ".6em", color: "#828a99", fontWeight: 500 }}>(연 {rent ? eok(rent * 12) : "—"}억)</span></h2>
        <div className="story-row">
          {[["예상 보증금", rCurDep ? `${eok(rCurDep)}억` : "—", "층별 보증금 합"],
            ["평당 임대료", perPyRent ? `${(perPyRent / 1e4).toFixed(1)}만` : "—", "연면적 기준 · 월"],
            ["예상수익률", roiFair != null ? `${roiFair.toFixed(2)}%` : "—", nbhdRoi != null ? `주변 평균 ${nbhdRoi}%` : "적정가 기준"]].map(([k, v, s], i) => (
            <div key={i} className="story-cell">
              <div className="k">{k}</div><div className="v">{v}</div>
              <div style={{ fontSize: 12.5, color: "#a0a8b4", marginTop: 4 }}>{s}</div>
            </div>
          ))}
        </div>
        {floors.length > 0 && <div style={{ marginTop: "3.5vh", maxWidth: 760 }}>
          {floors.slice(0, 8).map((f) => (
            <div className="st-row" key={f.floor}><span className="k">{f.floor}</span>
              <span className="v">현재 {man(f.cur)} · 주변 {man(f.mkt)} · <b className="hl">{f.diff >= 0 ? "+" : ""}{Math.round(f.diff / 1e4)}만</b></span></div>
          ))}
        </div>}
      </section>

      {/* 7 ── 투자 유형 + 상권 지도 ── */}
      <section data-i={7} ref={setRef(7)} className={cls(7)}>
        <div className="story-kicker">투자 유형 분석</div>
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
          <div>
            {ut.zones && ut.zones.length
              ? <><div style={{ borderRadius: 14, overflow: "hidden" }}><ReportMap lng={num(b.lng)} lat={num(b.lat)} geom={b.parcel_geom} zones={ut.zones as any} h="40vh" /></div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "#828a99", marginTop: 12 }}>
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
        <div className="story-kicker">미래가치 분석</div>
        <h2 className="story-h">미래가치 <b style={{ color: "#6E56CF" }}>{fut?.label ?? "—"}</b></h2>
        {fut ? <>
          <p className="story-sub" style={{ maxWidth: 780 }}>{fut.reason}</p>
          <div className="story-bars">
            {[{ n: "개발여지", v: fut.dev, c: "#1e2a4a", s: `법정 용적률 대비 미사용분 (나지=최대)` },
              { n: "임대 상향 여력", v: fut.upside, c: "#2b5aa8", s: rs?.cur_rent && rs?.mkt_rent ? `현재 ${man(rs.cur_rent)}만 → 주변 ${man(rs.mkt_rent)}만/월` : "주변 임대시세 대비" },
              { n: "지가 상승 추세", v: fut.land, c: "#6E56CF", s: fut.land_rate5 != null ? `최근 5년 공시지가 ${fut.land_rate5 >= 0 ? "+" : ""}${fut.land_rate5}% 변동` : "지가 시계열 없음" }].map((x) => (
              <div key={x.n}>
                <div className="story-bar-t"><span className="n">{x.n}</span><span className="s" style={{ color: x.c }}>{x.v != null ? x.v : "—"}<span style={{ fontSize: ".55em", color: "#828a99" }}>{x.v != null ? "점" : ""}</span></span></div>
                <div className="story-bar-track"><div className="story-bar-fill" style={{ background: x.c, transform: `scaleX(${shown[8] ? Math.max(x.v ?? 0, 2) / 100 : 0})` }} /></div>
                <div className="story-bar-sub">{x.s}</div>
              </div>
            ))}
          </div>
        </> : <p className="story-sub">미래가치 산정 데이터가 부족합니다.</p>}
      </section>

      {/* 9 ── 종합 결론(다크) ── */}
      <section data-i={9} ref={setRef(9)} className={cls(9, true)}>
        <div className="story-kicker">종합 결론</div>
        <h2 className="story-h">실거래·공시지가·임대수익을 종합한 <b>빌탐정 적정가</b></h2>
        <div className="story-big">
          {shown[9] && fair ? <CountUp end={fair / 1e8} dur={1500} fmt={(v) => Math.round(v).toLocaleString()} /> : eok(fair)}<span className="unit">억원</span>
        </div>
        <div className="story-row">
          {[["예상수익률", roiFair != null ? `${roiFair.toFixed(2)}%` : "—", nbhdRoi != null ? `주변 평균 ${nbhdRoi}%` : "적정가 기준"],
            ["예상 연임대수익", rent ? `${eok(rent * 12)}억` : "—", "주변 임대시세 적용"],
            ["매력도", `${grade}등급`, `가치점수 ${score}점`]].map(([k, v, s], i) => (
            <div key={i} className="story-cell">
              <div className="k" style={{ color: "#9fb0cc" }}>{k}</div>
              <div className="v" style={{ color: "#eaf0fa" }}>{v}</div>
              <div style={{ fontSize: 12.5, color: "#7f92b5", marginTop: 4 }}>{s}</div>
            </div>
          ))}
        </div>
        <KeywordBand ut={ut} fut={fut} officeApt={officeApt} dark />
        <p style={{ fontSize: "clamp(14px,1.5vw,18px)", color: "#c7d3e6", marginTop: "4.5vh", lineHeight: 1.75, maxWidth: 880 }}>
          {conclusion.map((s: Seg, i: number) => s.b ? <b key={i} style={{ color: "#5fe0a8" }}>{s.t}</b> : <Fragment key={i}>{s.t}</Fragment>)}
        </p>
        <p className="story-note">본 보고서는 빌탐정의 자체 조사·분석 기반이며 실제 거래 시 차이가 발생할 수 있습니다.</p>
      </section>
    </div>
  );
}

/** 성격 키워드 밴드 — 중앙 양옆, 투자유형·미래가치. */
function KeywordBand({ ut, fut, officeApt, dark }: { ut: any; fut: any; officeApt: boolean; dark?: boolean }) {
  const items = [
    ut?.primary ? { lab: "투자 유형", val: ut.primary, extra: officeApt ? "사옥 적합" : null, c: dark ? "#7FB0FF" : "#2b5aa8" } : null,
    fut?.label ? { lab: "미래가치", val: fut.label, extra: null, c: dark ? "#B9A5FF" : "#6E56CF" } : null,
  ].filter(Boolean) as { lab: string; val: string; extra: string | null; c: string }[];
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
