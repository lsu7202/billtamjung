import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { reportsApi, buildingsApi, type CompUsed, type RentFloor } from "../../shared/api/endpoints";
import { CountUp, BuildingArt } from "./ReportAssets";
import { ScoreRadar, CompareBar } from "./ReportPrimitives";

/** 몰입형 스크롤 보고서 — 표지(건물 줌인 인트로) → 핵심요약 → 기본정보 → 가치점수 → 매매사례 → 주변임대 → 수익률 → 결론.
 * 원본 슬라이드 내용 전부 포함. 박스 없이 여백·큰 숫자·스크롤 리빌. 덱(/report)과 같은 데이터, 다른 표현. */
const P = 3.305785;
const num = (x: unknown) => (x == null || x === "" ? null : Number(x));
const eok = (v: number | null | undefined) => (v ? (v / 1e8).toFixed(0) : "—");
const man = (v: number | null | undefined) => (v ? `${Math.round(v / 1e4).toLocaleString()}` : "—");
const py = (m2: number | null | undefined) => (m2 ? (m2 / P).toFixed(1) : "—");
const word = (s: number) => s >= 90 ? "매우 우수" : s >= 80 ? "우수" : s >= 70 ? "양호" : s >= 60 ? "보통" : "미흡";
const AXIS: [string, string, string][] = [
  ["road_access", "도로접면", "road"], ["station_dist", "역과의거리", "train"], ["use_zone", "용도지역", "zone"],
  ["shape", "지형형상", "mountain"], ["approval_date", "사용승인일", "calendar"], ["elevator", "엘리베이터", "elevator"],
  ["remodel", "대수선·리모델링", "tools"], ["slope", "경사도", "slope"], ["float_pop", "유동인구", "people"],
];

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setShown(true)), { threshold: 0.35 });
    io.observe(el); return () => io.disconnect();
  }, []);
  return { ref, shown };
}

export function ReportStory() {
  const { pk = "" } = useParams();
  const nav = useNavigate();
  const cq = useQuery({ queryKey: ["report-comps", pk], queryFn: () => reportsApi.comps(pk) });
  const bq = useQuery({ queryKey: ["building", pk], queryFn: () => buildingsApi.get(pk) });
  const sub = cq.data?.subject, pv = cq.data?.preview;
  const b = (bq.data ?? {}) as Record<string, any>;
  const fair = num(b.sale_est) ?? pv?.fair_price ?? null;
  const ask = pv?.ask_price ?? null;
  const broker = num(b.sale_price) ?? fair;
  const gap = ask != null && broker != null ? ask - broker : null;
  const brokerAdj = broker != null && fair != null && Math.abs(broker - fair) > 1e6;
  const score = sub?.score ?? 0;
  const grade = sub?.grade ?? "—";
  const gradeCol = grade === "S" ? "#B8912E" : grade === "A" ? "#2b5aa8" : grade === "B" ? "#1c8c63" : "#828a99";
  const addr = (sub?.addr ?? "").replace(/^서울특별시\s*/, "").replace(/\s*번지$/, "");
  const totalArea = sub?.total_area ?? num(b.total_area);
  const landArea = num(b.land_area);
  const totalP = totalArea ? totalArea / P : null;
  const landP = landArea ? landArea / P : null;
  const rent = pv?.applied_rent ?? sub?.total_rent ?? null;
  const curRent = sub?.total_rent ?? null;
  const dep = pv?.expected_deposit ?? null;
  const avgPer = fair && totalP ? Math.round(fair / totalP) : null;
  const roi = broker && rent ? Math.round((rent * 12 / broker) * 100) / 100 : (pv?.expected_roi ?? null);
  const roiAsk = ask && rent ? (rent * 12 / ask) * 100 : null;
  const comps = ((pv?.comps_used ?? []) as CompUsed[]).slice(0, 7);
  const floors = (pv?.rent_floors ?? []) as RentFloor[];
  const useZone = (b.use_zone as string) || "—";
  const mainUse = (b.main_use_name as string) || (b.main_use as string) || (b.etc_use as string) || "—";

  const scRef = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);
  const onScroll = () => {
    const el = scRef.current; if (!el) return;
    setP(Math.min(1, el.scrollTop / el.clientHeight));
  };
  const sum = useReveal(), basic = useReveal(), valu = useReveal(), cmps = useReveal(), rentR = useReveal(), roiR = useReveal(), concl = useReveal();

  return (
    <div ref={scRef} onScroll={onScroll} className="story-root">
      <button className="btn" style={{ position: "fixed", top: 14, left: 16, zIndex: 20, padding: "6px 12px" }} onClick={() => nav(`/buildings/${pk}/report`)}>← 덱 뷰</button>

      {/* ── 인트로: 건물 속으로 빨려들어감 ── */}
      <section style={{ height: "230vh", position: "relative" }}>
        <div style={{ position: "sticky", top: 0, height: "100vh", overflow: "hidden", background: "#0a0e17" }}>
          <div style={{ position: "absolute", inset: 0, transformOrigin: "50% 88%", transform: `scale(${1 + p * 5.5})`, opacity: Math.max(0, 1 - p * 1.15), willChange: "transform, opacity" }}>
            <BuildingArt />
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 50% 40%, transparent 40%, rgba(5,8,15,.85) 100%)" }} />
          </div>
          {/* 타이틀 — 초반 노출 후 진입하며 사라짐 */}
          <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", textAlign: "center", color: "#fff", opacity: Math.max(0, 1 - p * 2.4), pointerEvents: "none" }}>
            <div style={{ fontSize: "clamp(38px,6.5vw,84px)", fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.05, textShadow: "0 2px 30px rgba(0,0,0,.5)" }}>{addr || "매물 분석"}</div>
          </div>
          {/* 스크롤 유도 */}
          <div style={{ position: "absolute", bottom: 34, left: 0, right: 0, textAlign: "center", color: "#9fb0cc", fontSize: 12, letterSpacing: ".15em", opacity: Math.max(0, 1 - p * 3), animation: "story-bounce 1.8s ease-in-out infinite" }}>스크롤하여 진입 ↓</div>
        </div>
      </section>

      {/* ── 핵심 요약: 큰 숫자, 박스 없음 ── */}
      <section ref={sum.ref} className={`story-sec${sum.shown ? " in" : ""}`}>
        <div className="story-kicker">핵심 요약</div>
        <h2 className="story-h">{addr}의 <b>빌탐정 적정가</b>는</h2>
        <div className="story-big">
          {sum.shown && fair ? <CountUp end={fair / 1e8} dur={1400} fmt={(v) => v.toFixed(0)} /> : eok(fair)}<span className="unit">억원</span>
        </div>
        <p className="story-sub">가치점수 <b style={{ color: "#2b5aa8" }}>{grade}등급 {score}점</b> · 연면적당 {fair && totalP ? `${Math.round(fair / totalP / 1e4).toLocaleString()}만원/평` : "—"}</p>
        <div className="story-row">
          {[["매도희망가", ask], ["매매가", broker], ["협의 필요금액", gap != null ? Math.abs(gap) : null]].map(([k, v], i) => (
            <div key={i} className="story-cell">
              <div className="k">{k as string}</div>
              <div className="v">{v != null ? <><CountUp end={(v as number) / 1e8} delay={200 + i * 120} fmt={(x) => x.toFixed(0)} />억</> : "—"}</div>
            </div>
          ))}
        </div>
        <p className="story-note">※ 프로토타입 — 인트로 줌인 + 스크롤 리빌 + 카운트업. 건물 이미지는 임시(교체 예정).</p>
      </section>

      {/* ── 기본 정보 ── */}
      <section ref={basic.ref} className={`story-sec${basic.shown ? " in" : ""}`}>
        <div className="story-kicker">기본 정보</div>
        <h2 className="story-h">토지이용계획·건축물대장 기준 제원</h2>
        <div className="st-grid2">
          {[["대지면적", `${py(landArea)}평 · ${landArea ?? "—"}㎡`],
            ["연면적", `${py(totalArea)}평 · ${totalArea ?? "—"}㎡`],
            ["대지 평단가(호가)", ask && landP ? `${(ask / landP / 1e8).toFixed(2)}억` : "—"],
            ["연면적 평단가(호가)", ask && totalP ? `${Math.round(ask / totalP / 1e4).toLocaleString()}만` : "—"],
            ["용도지역", useZone], ["건축물용도", mainUse],
            ["규모", `지하 ${b.floors_below ?? "—"} / 지상 ${b.floors_above ?? "—"}층`],
            ["사용승인", b.approval_ymd ? `${String(b.approval_ymd).slice(0, 4)}년` : "—"],
            ["건폐율 / 용적률", `${b.bcr ?? "—"}% / ${b.far ?? "—"}%`],
            ["주차 / 승강기", `${b.parking ?? "—"}대 / ${b.elevator ?? "—"}`],
            ["현재 총임대료", `${man(curRent)}만원`],
            ["현재 실수익률", roiAsk != null ? `${roiAsk.toFixed(2)}%` : "—"]].map(([k, v], i) => (
            <div className="st-row" key={i}><span className="k">{k}</span><span className="v">{v}</span></div>
          ))}
        </div>
      </section>

      {/* ── 가치점수 ── */}
      <section ref={valu.ref} className={`story-sec${valu.shown ? " in" : ""}`}>
        <div className="story-kicker">가치점수 분석</div>
        <h2 className="story-h">입지·건물·환경 종합 <b style={{ color: gradeCol }}>{score}점 · {grade}등급</b></h2>
        <div className="st-cols">
          <div>
            {AXIS.map(([kk, l]) => { const s = sub?.items?.[kk] ?? 0; return (
              <div className="st-row" key={kk}><span className="k">{l}</span><span className="v" style={{ color: s >= 70 ? "#2b5aa8" : "#828a99" }}>{word(s)} · {Math.round(s)}</span></div>
            ); })}
          </div>
          <div style={{ minHeight: 230 }}>
            {valu.shown && sub?.items && <ScoreRadar axes={AXIS.map(([kk, l]) => ({ label: l, score: sub.items![kk] ?? 0 }))} color={gradeCol} size={250} showValues />}
          </div>
        </div>
      </section>

      {/* ── 매매사례 ── */}
      <section ref={cmps.ref} className={`story-sec${cmps.shown ? " in" : ""}`}>
        <div className="story-kicker">매매사례 시세분석</div>
        <h2 className="story-h">반경 500m · 최근 5년 유사 실거래 <b>{comps.length}건</b></h2>
        {comps.length ? <>
          <div style={{ marginTop: "2.5vh" }}>
            {comps.map((c, i) => (
              <div className="st-row" key={c.building_pk + i}>
                <span className="k">{i + 1}. {(c.addr ?? "").replace(/^서울특별시\s*/, "")}</span>
                <span className="v">{c.contract_ym} · {eok(c.price)}억 · {c.area_py ?? "—"}평 · <b className="hl">{c.per_now ? `${Math.round(c.per_now / 1e4).toLocaleString()}만/평` : "—"}</b></span>
              </div>
            ))}
          </div>
          {cmps.shown && <div style={{ marginTop: "3vh", maxWidth: 640 }}>
            <CompareBar height={140} fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}`}
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

      {/* ── 주변임대시세 ── */}
      <section ref={rentR.ref} className={`story-sec${rentR.shown ? " in" : ""}`}>
        <div className="story-kicker">주변임대시세 분석</div>
        {floors.length ? <>
          <h2 className="story-h">주변시세 적용 총임대료 <b style={{ color: "#2b5aa8" }}>{man(rent)}만원</b> <span style={{ fontSize: ".6em", color: "#828a99", fontWeight: 500 }}>(현재 {man(curRent)}만원)</span></h2>
          <div style={{ marginTop: "2.5vh" }}>
            {floors.map((f) => (
              <div className="st-row" key={f.floor}><span className="k">{f.floor}</span>
                <span className="v">현재 {man(f.cur)} · 주변 {man(f.mkt)} · <b className="hl">{f.diff >= 0 ? "+" : ""}{Math.round(f.diff / 1e4)}만</b> · {f.count}건</span></div>
            ))}
          </div>
        </> : <h2 className="story-h">주변 임대광고 사례가 없어 <b>현재 임대료 기준</b>으로 분석됩니다.</h2>}
      </section>

      {/* ── 예상수익률 ── */}
      <section ref={roiR.ref} className={`story-sec${roiR.shown ? " in" : ""}`}>
        <div className="story-kicker">예상수익률</div>
        <h2 className="story-h">매매가 기준 예상수익률</h2>
        <div className="st-lead">{roiR.shown && roi != null ? <CountUp end={roi} fmt={(v) => v.toFixed(2)} /> : (roi != null ? roi.toFixed(2) : "—")}<span className="unit">%</span></div>
        <p className="story-sub">예상보증금 {dep ? `${(dep / 1e8).toFixed(1)}억` : "—"} · 예상월임대료 {man(rent)}만원 · 예상 연임대수익 {rent ? `${eok(rent * 12)}억` : "—"}</p>
        <div className="st-flow">
          <div className="cell"><div className="k">적용 총임대료</div><div className="v">{man(rent)}만</div></div><span className="op">×</span>
          <div className="cell"><div className="k">개월</div><div className="v">12</div></div><span className="op">=</span>
          <div className="cell"><div className="k">연임대수익</div><div className="v">{rent ? `${eok(rent * 12)}억` : "—"}</div></div><span className="op">÷</span>
          <div className="cell"><div className="k">매매가</div><div className="v">{eok(broker)}억</div></div><span className="op">=</span>
          <div className="cell"><div className="k">수익률</div><div className="v" style={{ color: "#1c8c63" }}>{roi != null ? `${roi.toFixed(2)}%` : "—"}</div></div>
        </div>
      </section>

      {/* ── 최종 결론 ── */}
      <section ref={concl.ref} className={`story-sec${concl.shown ? " in" : ""}`} style={{ background: "#0b1224", color: "#fff" }}>
        <div className="story-kicker" style={{ color: "#8fb0e0" }}>최종 결론</div>
        <div className="st-prog">
          <div><div style={{ color: "#9fb0cc", fontSize: 14 }}>매도희망가</div><div className="st-lead" style={{ color: "#fff" }}>{eok(ask)}<span className="unit" style={{ color: "#9fb0cc" }}>억</span></div></div>
          <span className="arw" style={{ color: "#4d6fa8" }}>▶</span>
          <div><div style={{ color: "#9fb0cc", fontSize: 14 }}>매매가</div><div className="st-lead" style={{ color: "#4ecb8f" }}>{eok(broker)}<span className="unit" style={{ color: "#9fb0cc" }}>억</span></div></div>
          <span className="arw" style={{ color: "#4d6fa8" }}>▶</span>
          <div><div style={{ color: "#9fb0cc", fontSize: 14 }}>협의 필요금액</div><div className="st-lead" style={{ color: "#6ea0e6" }}>{gap != null ? eok(Math.abs(gap)) : "—"}<span className="unit" style={{ color: "#9fb0cc" }}>억</span></div></div>
        </div>
        <p style={{ fontSize: "clamp(15px,1.7vw,20px)", color: "#c7d3e6", marginTop: "4.5vh", lineHeight: 1.7, maxWidth: 780 }}>
          유사 매매사례 분석 결과 <b style={{ color: "#4ecb8f" }}>빌탐정 적정가</b>는 약 {eok(fair)}억 원 수준이며, 가치점수 <b style={{ color: "#fff" }}>{grade}등급({score}점)</b>{brokerAdj ? ` · 매매가 ${eok(broker)}억` : ""}입니다.
        </p>
        <div style={{ display: "flex", gap: "3vw", flexWrap: "wrap", marginTop: "3.5vh", fontSize: "clamp(13px,1.4vw,16px)", color: "#aab6cc" }}>
          {["적정매매가 기준 접근 필요", "주변임대시세 적용 시 수익성 개선 여지", "가격 협의 여부가 투자 판단의 핵심"].map((t, i) => <span key={i}>· {t}</span>)}
        </div>
        <p className="story-note" style={{ color: "#5f6d86" }}>본 보고서는 빌탐정의 자체 조사·분석 기반이며 실제 거래 시 차이가 발생할 수 있습니다. 건물 이미지는 임시(교체 예정).</p>
      </section>
    </div>
  );
}
