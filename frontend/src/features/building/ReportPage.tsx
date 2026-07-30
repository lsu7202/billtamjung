import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { reportsApi, buildingsApi, type CompUsed, type RentFloor } from "../../shared/api/endpoints";
import { ScoreRadar, CompareBar } from "./ReportPrimitives";
import { Logo, Seal, Icon, ScoreRing, BuildingArt } from "./ReportAssets";
import { loadNaver } from "../../shared/map/naver";
import { geoToPaths } from "../../shared/map/geo";
import "./reportslide.css";

/** 분석 보고서 — R_example.pptx 8슬라이드를 웹으로(네이비 코퍼레이트·16:9·cqw 스케일).
 * 표지 → 핵심요약 → 기본정보 → 미래가치 → 실거래가 → 공시지가 → 임대수익 → 종합결론(적정가+수익성). specs R-보고서 §5·§6a. */
const P = 3.305785;
const AXIS: [string, string][] = [
  ["road_access", "도로접면"], ["station_dist", "역과의거리"], ["use_zone", "용도지역"],
  ["shape", "지형형상"], ["approval_date", "사용승인일"], ["elevator", "엘리베이터"],
  ["remodel", "대수선·리모델링"], ["slope", "경사도"], ["float_pop", "유동인구"],
];
const AXIS_ICON: Record<string, string> = {
  road_access: "road", station_dist: "train", use_zone: "zone", shape: "mountain",
  approval_date: "calendar", elevator: "elevator", remodel: "tools", slope: "slope", float_pop: "people",
};
const word = (s: number) => s >= 90 ? "매우 우수" : s >= 80 ? "우수" : s >= 70 ? "양호" : s >= 60 ? "보통" : "미흡";
/** 가치 분석 항목별 '사실 기반' 의견 — 실제 필드값 + 점수대 평가. "[사실]해서 [평가]하다" 형태. */
function opinion(k: string, s: number, b: Record<string, any>): string {
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
const num = (x: unknown): number | null => (x == null || x === "" ? null : Number(x));
const eok = (v: number | null | undefined, d = 0) => (v ? `${(v / 1e8).toFixed(d)}` : "—");
const man = (v: number | null | undefined) => (v ? `${Math.round(v / 1e4).toLocaleString()}` : "—");
const py = (m2: number | null) => (m2 ? (m2 / P).toFixed(2) : "—");

/** 보고서용 지도 — 네이버 SDK, 상호작용 off(정적 지도처럼). 필지 폴리곤 표시(있으면 마커 대신). */
function ReportMap({ lng, lat, geom }: { lng?: number | null; lat?: number | null; geom?: any }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (lng == null || lat == null || !ref.current) return;
    let map: any;
    loadNaver().then((naver) => {
      if (!ref.current) return;
      const pos = new naver.maps.LatLng(lat, lng);
      map = new naver.maps.Map(ref.current, {
        center: pos, zoom: 18, draggable: false, scrollWheel: false, pinchZoom: false,
        disableDoubleClickZoom: true, scaleControl: false, mapDataControl: false, zoomControl: false,
      });
      const paths = geom ? geoToPaths(naver, geom) : [];
      if (paths.length) {
        new naver.maps.Polygon({
          map, paths, clickable: false,
          fillColor: "#2B5AA8", fillOpacity: 0.25, strokeColor: "#2B5AA8", strokeWeight: 3.5, strokeOpacity: 1,
        });
        const bnds = new naver.maps.LatLngBounds();
        paths.forEach((ring: any[]) => ring.forEach((p: any) => bnds.extend(p)));
        map.fitBounds(bnds, { top: 60, right: 60, bottom: 60, left: 60 });
        map.setZoom(map.getZoom() - 3);   // fit에서 3단계 줌아웃 — 로케이터형(넓은 맥락)
        map.setCenter(new naver.maps.LatLng(lat, lng));
      } else {
        new naver.maps.Marker({
          position: pos, map,
          icon: { content: `<div style="width:15px;height:15px;border-radius:50%;background:#262320;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>`, anchor: new naver.maps.Point(9, 9) },
        });
      }
    }).catch(() => setErr(true));
    return () => map?.destroy?.();
  }, [lng, lat, geom]);
  if (lng == null || lat == null) return <div className="rs-map rs-map-empty">위치 정보 없음</div>;
  return <div className="rs-map" ref={ref}>{err && <span className="rs-map-empty">지도를 불러오지 못했습니다</span>}</div>;
}

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
  const rq = useQuery({ enabled: reportId != null, queryKey: ["report", reportId], queryFn: () => reportsApi.get(reportId!) });
  const snap = rq.data?.result_json ?? null;
  const pk = reportId != null ? (rq.data?.building_pk ?? "") : (params.pk ?? "");
  const needLive = reportId == null || (!!rq.data && !snap);
  const cq = useQuery({ enabled: needLive && !!pk, queryKey: ["report-comps", pk], queryFn: () => reportsApi.comps(pk) });
  const bq = useQuery({ enabled: !!pk, queryKey: ["building", pk], queryFn: () => buildingsApi.get(pk) });

  const [cur, setCur] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else rootRef.current?.requestFullscreen?.();
  };
  const SLIDES = 8;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); setCur((c) => Math.min(SLIDES - 1, c + 1)); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); setCur((c) => Math.max(0, c - 1)); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const sub = snap?.subject ?? cq.data?.subject;
  const pv = snap?.preview ?? cq.data?.preview;
  const canDownload = reportId != null && rq.data?.status === "done";
  const b = (bq.data ?? {}) as Record<string, any>;

  // ── 3층 가격 모델(specs data-overview) ──
  // 빌탐정 적정가 = 시스템 산정(sale_est 정본, 스냅샷은 생성시점 fair 고정)
  const saleEst = num(b.sale_est);
  const fair = reportId == null ? (saleEst ?? pv?.fair_price ?? null) : (pv?.fair_price ?? saleEst ?? null);
  // 매도희망가 = 건물주 호가(기본정보 필드로만 표시). 매매가·협의(중개인 판단)는 브리핑 소관 — 본 보고서 제외
  const ask = pv?.ask_price ?? num(b.ask_price) ?? null;
  const rent = pv?.applied_rent ?? sub?.total_rent ?? null;
  const _floors0 = (pv?.rent_floors ?? []) as RentFloor[];
  const curRent = _floors0.length ? _floors0.reduce((s, f) => s + f.cur, 0) : (sub?.total_rent ?? null);  // 현재 총임대료 = 층별 현재(대장 추정) 합
  const totalArea = sub?.total_area ?? num(b.total_area);
  const landArea = num(b.land_area);
  const totalP = totalArea ? totalArea / P : null;
  const avgPer = fair && totalP ? Math.round(fair / totalP) : (pv?.avg_per_pyeong ?? null);   // 산정요약 = 빌탐정 적정가와 일치
  const usedComps = (pv?.comps_used ?? []) as CompUsed[];                      // 산정에 쓰인 전체 comp
  const comps = [...usedComps].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, 4);  // 대표 = 가까운 순 4건
  const moreCount = Math.max(0, usedComps.length - comps.length);              // 표에 안 나온 나머지
  const avgPerNow = usedComps.length                                          // 주변 실거래 연면적당 평단가 평균(원/평)
    ? Math.round(usedComps.reduce((s, c) => s + (c.per_now || 0), 0) / usedComps.length) : null;
  const gLatest = num(b.gongsi_latest);                            // 본매물 공시지가(원/㎡)
  const gTotal = gLatest && landArea ? gLatest * landArea : null;  // 공시총액(원)
  const gctx = pv?.gongsi_ctx ?? null;
  const nbhdGongsi = gctx?.nbhd_per_m2 ?? null;                    // 주변 사례 공시지가 중앙값(원/㎡)
  const gmult = gctx?.mult ?? null;                               // 공시배율(실거래÷공시총액)
  const landPremium = gLatest && nbhdGongsi ? (gLatest / nbhdGongsi - 1) * 100 : null;   // 본매물 땅값 주변 대비 %
  const _perVals = comps.map((c) => c.per_now).filter((v): v is number => !!v);   // comp 연면적당 평단가(원/평)
  const compMin = _perVals.length ? Math.round(Math.min(..._perVals) / 1e4) : null;
  const compMax = _perVals.length ? Math.round(Math.max(..._perVals) / 1e4) : null;
  const floors = _floors0;
  const roiFair = rent && fair ? (rent * 12 / fair) * 100 : null;   // 적정가 기준 예상수익률(리포트용)
  const rs = pv?.rent_summary ?? null;                              // 임대 요약(층수·보증금)
  const rFloors = rs?.floor_count ?? floors.length;
  const rCurDep = rs?.cur_deposit ?? null;                          // 현재 총보증금
  const perPyRent = curRent && totalArea ? curRent / (totalArea / P) : null;   // 평당 월임대료(연면적 기준)
  const upsidePct = (rent != null && curRent) ? ((rent - curRent) / curRent) * 100 : null;   // 임대 상승여력 %

  const loading = (reportId != null && rq.isLoading) || (needLive && cq.isLoading) || (!!pk && bq.isLoading);
  if (loading && !sub) return <div style={{ padding: 40, color: "var(--muted)" }}>보고서 계산 중…</div>;
  if (!sub && (cq.isError || rq.isError)) return <div style={{ padding: 40, color: "var(--up)" }}>보고서를 불러오지 못했습니다.</div>;

  const rno = reportId != null ? `BT-${new Date(rq.data?.created_at ?? "2026-01-01").getFullYear()}-${String(reportId).padStart(6, "0")}` : "미리보기";
  const date = new Date(rq.data?.created_at ?? "2026-01-01").toLocaleDateString("ko-KR").replace(/\. /g, ".").replace(/\.$/, "");
  const useZone = (b.use_zone as string) || "—";
  const mainUse = (b.main_use_name as string) || (b.main_use as string) || (b.etc_use as string) || "—";
  const grade = sub?.grade ?? "—";
  const score = sub?.score ?? 0;
  const gradeCol = grade === "S" ? "#B8912E" : grade === "A" ? "var(--blue)" : grade === "B" ? "var(--green)" : "var(--rmuted)";
  const gc = (s: number) => s >= 70 ? "var(--blue)" : "var(--rmuted)";
  const addr = sub?.addr ?? "—";
  const shortAddr = addr.replace(/^서울특별시\s*/, "").replace(/\s*번지$/, "");

  const toolbar = (
    <div className="deck-top">
      <button className="btn" onClick={() => nav(`/buildings/${pk}`)} style={{ padding: "6px 12px" }}>← 매물로</button>
      <span className="ttl">분석 보고서 · {rno}</span>
      <button className="btn" style={{ marginLeft: "auto", padding: "6px 12px" }} onClick={() => nav(`/buildings/${pk}/story`)} title="애니메이션 모드(스크롤)">✨ 애니메이션 모드</button>
      <button className="btn" style={{ padding: "6px 12px" }} onClick={toggleFs} title="전체화면 (발표 모드)">⛶ 전체화면</button>
      {canDownload
        ? <button className="btn primary" style={{ padding: "6px 12px" }}
            onClick={() => reportsApi.download(reportId!, "analysis").catch((e) => alert(String(e?.message ?? e)))}>PPT 내보내기</button>
        : <button className="btn" disabled style={{ padding: "6px 12px", opacity: .6 }} title="생성 완료 후 다운로드">PPT 내보내기</button>}
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
            <div style={{ fontSize: "1.15cqw", letterSpacing: ".24em", color: "#8fb0e0", fontWeight: 700, marginBottom: "1cqw" }}>부동산 가치분석 보고서</div>
            <div style={{ fontSize: "4.8cqw", fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.04, textShadow: "0 2px 26px rgba(0,0,0,.55)" }}>{shortAddr}</div>
            <div style={{ fontSize: "1.5cqw", color: "#c7d3e6", marginTop: ".9cqw" }}>{useZone} · {mainUse}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1.4cqw" }}>
            <Seal mono size={8.5} />
            <div style={{ fontSize: ".95cqw", color: "#aab6cc", lineHeight: 1.55 }}>
              빌탐정이 자체 조사·분석한 <b style={{ color: "#fff" }}>공식 분석 보고서</b>입니다.<br />제3자 무단복제·유포·변경 시 법적 책임을 질 수 있습니다.
            </div>
          </div>
        </div>
      </div>,
      <Slide key={0} n="01" foot="핵심 요약" rno={rno} date={date}
        title="핵심 요약" desc="본 매물의 빌탐정 적정가·수익성과 미래가치를 한눈에 확인하세요.">
        <div style={{ display: "flex", gap: "3cqw", width: "100%", alignItems: "stretch" }}>
          <div className="rs-fade" style={{ flex: "0 0 33%", borderRadius: "1.2cqw", background: "linear-gradient(135deg,#dfe4ec,#c3cbd8)", display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7688", fontSize: "1.3cqw", fontWeight: 700 }}>건물 사진</div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "1.8cqw" }}>
            <div className="rs-fade" style={{ display: "flex", alignItems: "center", gap: "2.6cqw" }}>
              <ScoreRing score={score} grade={grade} gradeColor={gradeCol} size={13.5} />
              <div style={{ flex: 1 }}>
                {[{ k: "빌탐정 적정가", s: "시스템 산정", v: fair ? `${eok(fair)}억원` : "—", c: "var(--navy)" },
                  { k: "적정가 기준 예상수익률", s: "연 임대수익 기준", v: roiFair != null ? `${roiFair.toFixed(2)}%` : "—", c: "var(--purple)" },
                  { k: "미래가치 등급", s: "입지·건물 매력도 (적정가와 별개)", v: `${grade}등급`, c: "var(--blue)" }].map((r, i) => (
                  <div key={r.k} className="rs-fade" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: ".9cqw .2cqw", borderBottom: i < 2 ? "1px solid var(--rl)" : "none", ["--d" as string]: `${(i + 1) * 90}ms` }}>
                    <div><div style={{ fontSize: "1.55cqw", fontWeight: 700, color: "var(--navy)" }}>{r.k}</div><div style={{ fontSize: ".9cqw", color: "var(--rmuted)" }}>{r.s}</div></div>
                    <div className="num" style={{ fontSize: "2.8cqw", fontWeight: 800, color: r.c, lineHeight: 1 }}>{r.v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rs-fade" style={{ display: "flex", gap: "3.5cqw", paddingTop: "1.3cqw", borderTop: "1px solid var(--rl)", fontSize: "1.1cqw", color: "var(--rmuted)", ["--d" as string]: "360ms" }}>
              <span>평당 적정가 <b style={{ color: "var(--navy)" }}>{avgPer ? `${Math.round(avgPer / 1e4).toLocaleString()}만원` : "—"}</b></span>
              <span>연면적 <b style={{ color: "var(--navy)" }}>{py(totalArea)}평</b></span>
              {rent ? <span>주변시세 총임대료 <b style={{ color: "var(--navy)" }}>{man(rent)}만원</b></span> : null}
            </div>
          </div>
        </div>
      </Slide>,
      <Slide key={1} n="02" foot="매물 기본정보" rno={rno} date={date}
        title="매물 기본정보" desc="해당 건물의 기본정보 및 입지 정보 (토지이용계획확인원 및 건축물대장 기준)">
        <div style={{ display: "flex", gap: "2.5cqw", width: "100%" }}>
          <div style={{ flex: "0 0 46%", alignSelf: "flex-start", display: "flex", flexDirection: "column", gap: "1cqw" }}>
            <div style={{ fontSize: "2.1cqw", fontWeight: 800, color: "var(--navy)", letterSpacing: "-.01em", lineHeight: 1.1 }}>{shortAddr}</div>
            <table className="rs-tbl rs-kv"><tbody>
              <tr><td>대지면적</td><td>{py(landArea)}평 ({landArea ?? "—"}㎡)</td></tr>
              <tr><td>연면적</td><td>{py(totalArea)}평 ({totalArea ?? "—"}㎡)</td></tr>
              <tr><td>용도지역</td><td>{useZone}</td></tr>
              <tr><td>건축물용도</td><td>{mainUse}</td></tr>
              <tr><td>층수</td><td>지하 {b.floors_below ?? "—"}층 / 지상 {b.floors_above ?? "—"}층</td></tr>
              <tr><td>사용승인일</td><td>{b.approval_ymd ? String(b.approval_ymd).slice(0, 10).replace(/-/g, ".") : "—"}</td></tr>
              <tr><td>주차</td><td>{b.parking != null ? `${b.parking}대` : "—"}</td></tr>
              <tr><td>엘리베이터</td><td>{b.elevator != null ? (Number(b.elevator) > 0 ? `${b.elevator}대` : "없음") : "—"}</td></tr>
              <tr><td>도로접면</td><td>{b.road_frontage ?? "—"}</td></tr>
              <tr><td>매도희망가</td><td className="blue b">{ask ? `${eok(ask)}억 원` : "—"}</td></tr>
            </tbody></table>
          </div>
          <ReportMap lng={num(b.lng)} lat={num(b.lat)} geom={b.parcel_geom} />
        </div>
      </Slide>,
      <Slide key={2} n="03" foot="미래가치 분석" rno={rno} date={date}
        title="미래가치 분석" desc="입지·교통·건물 등 매력도를 종합한 미래가치·임대여력 지표입니다. 적정가 산정과는 별개로, 향후 성장 잠재력을 봅니다.">
        <div style={{ display: "flex", gap: "2.5cqw", width: "100%" }}>
          <table className="rs-tbl" style={{ flex: "0 0 52%", alignSelf: "flex-start" }}>
            <thead><tr><th>평가 항목</th><th>평가 결과</th><th>분석 의견</th></tr></thead>
            <tbody>
              {AXIS.map(([k, l], i) => {
                const s = sub?.items?.[k] ?? 0;
                return <tr key={k}>
                  <td className="b"><span style={{ display: "inline-flex", alignItems: "center", gap: ".7cqw" }}><Icon name={AXIS_ICON[k]} size={1.9} color="var(--navy)" />{`①②③④⑤⑥⑦⑧⑨`[i]} {l}</span></td>
                  <td style={{ color: gc(s), fontWeight: 700 }}>{word(s)}</td>
                  <td style={{ color: "var(--rmuted)", fontSize: "1cqw", lineHeight: 1.35 }}>{opinion(k, s, b)}</td>
                </tr>;
              })}
            </tbody>
          </table>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1cqw" }}>
            <div className="rs-sc blue" style={{ display: "flex", alignItems: "center" }}>
              <div><div className="k">미래가치 점수</div><div className="v">{score}<u>/100점</u></div></div>
              <span className="rs-pill blue" style={{ marginLeft: "auto", fontSize: "1.6cqw", padding: ".7cqw 1.3cqw" }}>{grade}등급</span>
            </div>
            {sub?.items && <ScoreRadar axes={AXIS.map(([k, l]) => ({ label: l, score: sub.items![k] ?? 0 }))} color="var(--navy)" size={210} showValues />}
            <div style={{ fontSize: ".98cqw", color: "var(--rmuted)", textAlign: "center" }}>등급 기준 · S 90↑ / A 75~89 / B 60~74 / C 60↓ → 본 매물 {grade}등급({word(score)})</div>
          </div>
        </div>
      </Slide>,
      <Slide key={3} n="04" foot="실거래가 분석" rno={rno} date={date}
        title="실거래가 분석" desc={`${shortAddr} 인근의 유사 실거래를 바탕으로 본 매물의 적정매매가를 분석했습니다.`}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.2cqw", width: "100%", height: "100%" }}>
          <table className="rs-tbl">
            <thead><tr><th>사례</th><th>주소</th><th className="r">거리</th><th>거래일</th><th className="r">매매가</th><th className="r">연면적</th><th className="r">평단가</th><th className="r">시점보정</th></tr></thead>
            <tbody>
              <tr style={{ background: "color-mix(in srgb, var(--blue) 8%, transparent)" }}>
                <td className="b blue">본매물</td>
                <td className="b" style={{ maxWidth: "16cqw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortAddr}</td>
                <td className="r">—</td>
                <td>—</td>
                <td className="r b blue">{fair ? `${eok(fair, 1)}억` : "—"}<span style={{ fontSize: ".82cqw", color: "var(--rmuted)", fontWeight: 500 }}> 적정가</span></td>
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
                  <td className="r">{eok(c.price, 1)}억</td>
                  <td className="r">{c.area_py ?? "—"}평</td>
                  <td className="r b blue">{c.per_now ? `${Math.round(c.per_now / 1e4).toLocaleString()}만` : "—"}</td>
                  <td className="r">{c.time_adj != null ? `${c.time_adj >= 0 ? "+" : ""}${Math.round(c.time_adj * 100)}%` : "—"}</td>
                </tr>
              )) : <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--rmuted)", padding: "2cqw" }}>반경 내 실거래 사례 없음</td></tr>}
              {moreCount > 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--rmuted)", fontSize: ".95cqw", padding: ".55cqw", borderTop: "1px dashed var(--rl)" }}>가까운 순 4건 표시 · 외 <b style={{ color: "var(--navy)" }}>+{moreCount}건</b>도 적정가 산정에 반영됨</td></tr>}
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
                이 실거래 기준값은 하나의 근거이며, 공시지가·주변 임대시세(수익가치) 등 다른 요소와 함께 종합해 최종 적정가를 산정합니다. 종합 결론은 마지막 장에서 정리합니다.
              </div>
            </div>
          </div>
        </div>
      </Slide>,
      <Slide key={4} n="05" foot="공시지가" rno={rno} date={date}
        title="공시지가 분석" desc={`${shortAddr}의 공시지가 추이와, 실거래가 공시가 대비 형성되는 수준(공시배율)을 반영합니다.`}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.4cqw", width: "100%", height: "100%" }}>
          <div style={{ display: "flex", gap: "2.5cqw" }}>
            <div style={{ flex: 1, borderTop: "2px solid var(--navy)", paddingTop: ".7cqw" }}>
              <div style={{ fontSize: "1.05cqw", fontWeight: 700, color: "var(--navy)" }}>주변 대비 땅값 (공시지가)</div>
              <div style={{ fontSize: "3.2cqw", fontWeight: 800, color: "var(--blue)", lineHeight: 1.05 }}>{landPremium != null ? `${landPremium >= 0 ? "+" : ""}${landPremium.toFixed(0)}%` : "—"}</div>
              <div style={{ fontSize: ".92cqw", color: "var(--rmuted)" }}>주변 실거래 사례 평균 대비 {landPremium != null && landPremium >= 0 ? "높음 · 입지 우위" : "낮음"}</div>
            </div>
            <div style={{ flex: 1, borderTop: "2px solid var(--navy)", paddingTop: ".7cqw" }}>
              <div style={{ fontSize: "1.05cqw", fontWeight: 700, color: "var(--navy)" }}>공시배율 <span style={{ color: "var(--rmuted)", fontWeight: 400 }}>(실거래 ÷ 공시총액)</span></div>
              <div style={{ fontSize: "3.2cqw", fontWeight: 800, color: "var(--blue)", lineHeight: 1.05 }}>{gmult != null ? `${gmult.toFixed(1)}배` : "—"}</div>
              <div style={{ fontSize: ".92cqw", color: "var(--rmuted)" }}>시장이 공시가보다 이만큼 높게 값을 매김</div>
            </div>
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
              <div className="rs-fbox" style={{ textAlign: "center" }}><div className="k">공시총액 (공시지가 × 대지면적)</div><div className="v">{gTotal ? eok(gTotal) : "—"}<span style={{ fontSize: "1cqw", color: "var(--rmuted)" }}>억</span></div></div>
              <div style={{ fontSize: "1.08cqw", lineHeight: 1.7, color: "var(--rink)" }}>
                {landPremium != null
                  ? <>이 건물이 앉은 땅의 공시지가는 <b style={{ color: "var(--blue)" }}>{Math.round(gLatest! / 1e4).toLocaleString()}만원/㎡</b>로, 주변 실거래 평균 <b>{Math.round(nbhdGongsi! / 1e4).toLocaleString()}만원/㎡</b>보다 <b style={{ color: "var(--blue)" }}>약 {Math.abs(landPremium).toFixed(0)}% {landPremium >= 0 ? "높습니다" : "낮습니다"}</b>. {landPremium >= 0 ? "상대적으로 입지가 우수한 땅입니다. " : "주변 대비 저평가 상태입니다. "}실거래가 공시가의 몇 배에 형성되는지(공시배율)는 적정가 산정의 한 축으로 반영됩니다.</>
                  : <>공시지가와 실거래 배율을 함께 반영해 적정가를 산정합니다.</>}
              </div>
            </div>
          </div>
        </div>
      </Slide>,
      <Slide key={5} n="06" foot="임대수익 분석" rno={rno} date={date}
        title="임대수익 분석" desc="주변 임대시세로 임대수익을 추정하고, 이를 수익가치(수익환원)로 적정가에 반영합니다.">
        <div style={{ display: "flex", flexDirection: "column", gap: "1.6cqw", width: "100%", height: "100%", justifyContent: "center" }}>
          <div style={{ display: "flex", gap: "2cqw" }}>
            {([
              ["건물 규모", `지하 ${b.floors_below ?? "—"} · 지상 ${b.floors_above ?? "—"}층`, `임대 분석 ${rFloors}개 층`],
              ["총 월임대료", `${man(curRent)}만원`, `연 ${eok(curRent ? curRent * 12 : null)}억`],
              ["예상 보증금", rCurDep ? `${eok(rCurDep, 0)}억원` : "—", "층별 보증금 합계"],
              ["평균 평당 임대료", perPyRent ? `${(perPyRent / 1e4).toFixed(1)}만원` : "—", "연면적 기준 · 월"],
              ["적정가 기준 예상수익률", roiFair != null ? `${roiFair.toFixed(2)}%` : "—", "연 임대수익 ÷ 적정가"],
            ] as [string, string, string][]).map(([k, v, d]) => (
              <div key={k} style={{ flex: 1, borderTop: "2px solid var(--navy)", paddingTop: ".7cqw" }}>
                <div style={{ fontSize: ".95cqw", fontWeight: 700, color: "var(--navy)" }}>{k}</div>
                <div style={{ fontSize: "1.85cqw", fontWeight: 800, color: "var(--navy)", lineHeight: 1.05, margin: ".15cqw 0" }}>{v}</div>
                <div style={{ fontSize: ".85cqw", color: "var(--rmuted)" }}>{d}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "2.5cqw", alignItems: "center", flex: 1 }}>
            <div style={{ flex: "0 0 38%" }}>
              <div style={{ fontSize: "1.1cqw", fontWeight: 700, color: "var(--navy)", marginBottom: ".3cqw" }}>현재 vs 주변 임대시세 <span style={{ color: "var(--rmuted)", fontWeight: 400 }}>(월 총액, 만원)</span></div>
              {curRent && rent
                ? <CompareBar height={150} fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}`}
                    items={[{ label: "현재", value: curRent, color: "var(--navy)" },
                            { label: "주변시세", value: rent, color: "var(--blue)", strong: true }]} />
                : <div style={{ color: "var(--rmuted)", fontSize: "1.1cqw", padding: "2cqw 0" }}>주변 임대사례가 부족합니다.</div>}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: ".9cqw" }}>
              <div style={{ fontSize: "1.15cqw", lineHeight: 1.75, color: "var(--rink)" }}>
                본 매물의 현재 총 월임대료는 <b>{man(curRent)}만원</b>(연 {eok(curRent ? curRent * 12 : null)}억), 총 보증금은 <b>{rCurDep ? eok(rCurDep, 0) : "—"}억</b> 수준입니다.
                {upsidePct != null && (upsidePct >= 3
                  ? <> 주변 임대시세를 적용하면 <b style={{ color: "var(--blue)" }}>{man(rent)}만원</b>까지 <b style={{ color: "var(--blue)" }}>약 {upsidePct.toFixed(0)}% 상승 여력</b>이 있습니다.</>
                  : upsidePct <= -3
                    ? <> 현재 임대료가 주변 시세보다 다소 높은 편으로, 임대 안정성이 높습니다.</>
                    : <> 현재 임대료가 주변 시세와 유사한 적정 수준입니다.</>)}
              </div>
              <div style={{ fontSize: "1cqw", lineHeight: 1.6, color: "var(--rmuted)" }}>
                이 임대수익은 <b style={{ color: "var(--navy)" }}>수익환원</b>(연 임대수익 ÷ 자치구 환원율)으로 적정가 산정에 반영되며, 예상수익률은 빌탐정 적정가 대비 연 임대수익 기준입니다.
              </div>
            </div>
          </div>
        </div>
      </Slide>,
      <Slide key={6} n="07" foot="종합 결론" rno={rno} date={date}
        title="종합 결론" desc="적정가와 수익성을 종합한 본 매물의 최종 결론입니다.">
        <div style={{ display: "flex", flexDirection: "column", gap: "1.1cqw", width: "100%", height: "100%", justifyContent: "center" }}>
          <div className="rs-fade" style={{ fontSize: "1.1cqw", fontWeight: 700, color: "var(--navy)", textAlign: "center", ["--d" as string]: "40ms" }}>실거래·공시지가·임대수익을 종합해 적정가를 산정했습니다</div>
          <div style={{ display: "flex", gap: "1.6cqw", alignItems: "stretch" }}>
            {([
              ["1", "실거래가", "주축", compMin && compMax ? `평당 ${compMin.toLocaleString()}~${compMax.toLocaleString()}만` : "인근 유사 거래", "공시·대지·연면적 3방식으로 환산"],
              ["2", "공시지가", "", gmult ? `공시가의 약 ${gmult.toFixed(1)}배` : "공시배율 반영", "실거래가 공시총액 대비 수준"],
              ["3", "임대수익", "", rent ? `연 ${eok(rent * 12)}억` : "임대수익 반영", "수익환원으로 약 20% 가미"],
            ] as [string, string, string, string, string][]).map(([n, k, tag, v, d], i) => (
              <div key={k} className="rs-fade" style={{ flex: 1, ["--d" as string]: `${200 + i * 170}ms`, background: "color-mix(in srgb,var(--navy) 4%,transparent)", border: "1px solid var(--rl)", borderLeft: `.35cqw solid ${n === "1" ? "var(--blue)" : "var(--navy)"}`, borderRadius: ".8cqw", padding: "1cqw 1.2cqw", display: "flex", flexDirection: "column", gap: ".35cqw" }}>
                <div style={{ display: "flex", alignItems: "center", gap: ".6cqw" }}>
                  <span style={{ width: "2cqw", height: "2cqw", borderRadius: "50%", background: "var(--navy)", color: "#fff", fontSize: "1.1cqw", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>{n}</span>
                  <span style={{ fontSize: "1.4cqw", fontWeight: 800, color: "var(--navy)" }}>{k}</span>
                  {tag && <span style={{ fontSize: ".8cqw", color: "#fff", background: "var(--blue)", borderRadius: "1cqw", padding: ".1cqw .6cqw", fontWeight: 700 }}>{tag}</span>}
                </div>
                <div style={{ fontSize: "2cqw", fontWeight: 800, color: "var(--blue)", lineHeight: 1.05 }}>{v}</div>
                <div style={{ fontSize: ".88cqw", color: "var(--rmuted)", lineHeight: 1.35 }}>{d}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "1.5cqw", alignItems: "stretch", marginTop: ".2cqw" }}>
            <div style={{ flex: "0 0 38%", background: "color-mix(in srgb,var(--navy) 6%,transparent)", borderRadius: ".8cqw", padding: ".9cqw", textAlign: "center" }}>
              <div style={{ fontSize: "1cqw", color: "var(--rmuted)", fontWeight: 700 }}>빌탐정 적정가</div>
              <div style={{ fontSize: "3cqw", fontWeight: 800, color: "var(--navy)", lineHeight: 1.05 }}>{eok(fair)}<span style={{ fontSize: "1.5cqw" }}>억</span></div>
              <div style={{ fontSize: ".88cqw", color: "var(--rmuted)" }}>평당 {avgPer ? Math.round(avgPer / 1e4).toLocaleString() : "—"}만 · {py(totalArea)}평</div>
            </div>
            <div style={{ flex: 1, display: "flex", gap: "1.5cqw" }}>
              {([
                ["예상수익률", roiFair != null ? `${roiFair.toFixed(2)}%` : "—", "적정가 대비 연 임대수익"],
                ["예상 연임대수익", rent ? `${eok(rent * 12)}억` : "—", "주변 임대시세 적용"],
                ["미래가치 등급", `${grade}등급`, `가치점수 ${score}점`],
              ] as [string, string, string][]).map(([k, v, d]) => (
                <div key={k} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", borderLeft: "1px solid var(--rl)", paddingLeft: "1.1cqw" }}>
                  <div style={{ fontSize: ".92cqw", color: "var(--rmuted)", fontWeight: 700 }}>{k}</div>
                  <div style={{ fontSize: "1.85cqw", fontWeight: 800, color: "var(--blue)", lineHeight: 1.1 }}>{v}</div>
                  <div style={{ fontSize: ".78cqw", color: "var(--rmuted)" }}>{d}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ fontSize: "1.05cqw", lineHeight: 1.6, color: "var(--rink)", textAlign: "center", maxWidth: "92%", margin: "0 auto" }}>
            본 매물은 적정가 <b style={{ color: "var(--blue)" }}>약 {eok(fair)}억</b>, 적정가 기준 <b style={{ color: "var(--blue)" }}>예상수익률 {roiFair != null ? roiFair.toFixed(2) : "—"}%</b> 수준의 현재가치를 지니며, 입지·건물 매력도(미래가치)는 <b>{grade}등급</b>입니다.
          </div>
          <div style={{ fontSize: ".82cqw", lineHeight: 1.5, color: "var(--rmuted)", textAlign: "center", maxWidth: "92%", margin: "0 auto" }}>
            ※ 적정가 = 실거래가(주축)를 공시·대지·연면적으로 환산 + 임대수익 수익환원 20% 가미(시점보정·거리가중·이상치 제외). 가치점수는 미래가치 지표로 적정가와 별개(이중계산 방지).
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
          <button className="deck-arrow l" disabled={cur === 0} onClick={() => setCur((c) => Math.max(0, c - 1))} aria-label="이전">‹</button>
          <div className="stage-slide rs-enter" key={cur}>{slides[cur]}</div>
          <button className="deck-arrow r" disabled={cur === slides.length - 1} onClick={() => setCur((c) => Math.min(slides.length - 1, c + 1))} aria-label="다음">›</button>
          <div className="deck-counter">{cur + 1} / {slides.length}</div>
        </div>
      </div>
    </div>
  );
}

