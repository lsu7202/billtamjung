import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { reportsApi, buildingsApi, type CompUsed, type RentFloor } from "../../shared/api/endpoints";
import { ScoreRadar } from "./ReportPrimitives";
import "./reportslide.css";

/** 분석 보고서 — R_example.pptx 8슬라이드를 웹으로(네이비 코퍼레이트·16:9·cqw 스케일).
 * 표지 → 기본정보 → 분석흐름 → 가치점수 → 매매사례 → 주변월세 → 예상수익률 → 최종요약. specs R-보고서 §5·§6a. */
const P = 3.305785;
const AXIS: [string, string][] = [
  ["road_access", "도로접면"], ["station_dist", "역과의거리"], ["use_zone", "용도지역"],
  ["shape", "지형형상"], ["approval_date", "사용승인일"], ["elevator", "엘리베이터"],
  ["remodel", "대수선·리모델링"], ["slope", "경사도"], ["float_pop", "유동인구"],
];
const word = (s: number) => s >= 90 ? "매우 우수" : s >= 80 ? "우수" : s >= 70 ? "양호" : s >= 60 ? "보통" : "미흡";
const num = (x: unknown): number | null => (x == null || x === "" ? null : Number(x));
const eok = (v: number | null | undefined, d = 0) => (v ? `${(v / 1e8).toFixed(d)}` : "—");
const eokU = (v: number | null | undefined, d = 0) => (v ? <>{(v / 1e8).toFixed(d)}<u>억원</u></> : "—");
const man = (v: number | null | undefined) => (v ? `${Math.round(v / 1e4).toLocaleString()}` : "—");
const py = (m2: number | null) => (m2 ? (m2 / P).toFixed(2) : "—");

function Slide({ n, foot, title, desc, children, rno, date }:
  { n: string; foot: string; title: string; desc: string; children: React.ReactNode; rno: string; date: string }) {
  return (
    <div className="rs-slide">
      <div className="rs-head">
        <span className="rs-logo">빌탐정<em>BILLTAMJUNG</em></span>
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
        <em>빌탐정 <i>BILLTAMJUNG</i></em>
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
  // 매매가 = 중개인 판단(오버레이 sale_price), 없으면 빌탐정 적정가로 자동
  const broker = num(b.sale_price) ?? num(sub?.sale_price) ?? fair;
  // 매도희망가 = 건물주 원하는 값(오버레이 ask_price)
  const ask = pv?.ask_price ?? num(b.ask_price) ?? null;
  // 협의 필요금액 = 매도희망가 − 매매가
  const gap = (ask != null && broker != null) ? ask - broker : null;
  const brokerAdj = broker != null && fair != null && Math.abs(broker - fair) > 1e6;   // 중개인이 적정가에서 조정했나
  const rent = pv?.applied_rent ?? sub?.total_rent ?? null;
  const curRent = sub?.total_rent ?? null;
  const dep = pv?.expected_deposit ?? null;
  const totalArea = sub?.total_area ?? num(b.total_area);
  const landArea = num(b.land_area);
  const totalP = totalArea ? totalArea / P : null;
  const landP = landArea ? landArea / P : null;
  const avgPer = fair && totalP ? Math.round(fair / totalP) : (pv?.avg_per_pyeong ?? null);   // 산정요약 = 빌탐정 적정가와 일치
  const roi = broker && rent ? Math.round((rent * 12 / broker) * 10000) / 100 : (pv?.expected_roi ?? null);  // 수익률=매매가 기준
  const comps = ((pv?.comps_used ?? []) as CompUsed[]).slice(0, 7);
  const floors = (pv?.rent_floors ?? []) as RentFloor[];
  const roiAsk = ask && rent ? (rent * 12 / ask) * 100 : null;

  const loading = (reportId != null && rq.isLoading) || (needLive && cq.isLoading) || (!!pk && bq.isLoading);
  if (loading && !sub) return <div style={{ padding: 40, color: "var(--muted)" }}>보고서 계산 중…</div>;
  if (!sub && (cq.isError || rq.isError)) return <div style={{ padding: 40, color: "var(--up)" }}>보고서를 불러오지 못했습니다.</div>;

  const rno = reportId != null ? `BT-${new Date(rq.data?.created_at ?? "2026-01-01").getFullYear()}-${String(reportId).padStart(6, "0")}` : "미리보기";
  const date = new Date(rq.data?.created_at ?? "2026-01-01").toLocaleDateString("ko-KR").replace(/\. /g, ".").replace(/\.$/, "");
  const useZone = (b.use_zone as string) || "—";
  const mainUse = (b.main_use_name as string) || (b.main_use as string) || (b.etc_use as string) || "—";
  const grade = sub?.grade ?? "—";
  const score = sub?.score ?? 0;
  const gc = (s: number) => s >= 70 ? "var(--blue)" : "var(--rmuted)";
  const addr = sub?.addr ?? "—";
  const shortAddr = addr.replace(/^서울특별시\s*/, "").replace(/\s*번지$/, "");

  const toolbar = (
    <div className="deck-top">
      <button className="btn" onClick={() => nav(`/buildings/${pk}`)} style={{ padding: "6px 12px" }}>← 매물로</button>
      <span className="ttl">분석 보고서 · {rno}</span>
      {canDownload
        ? <button className="btn primary" style={{ marginLeft: "auto", padding: "6px 12px" }}
            onClick={() => reportsApi.download(reportId!, "analysis").catch((e) => alert(String(e?.message ?? e)))}>PPT 내보내기</button>
        : <button className="btn" disabled style={{ marginLeft: "auto", padding: "6px 12px", opacity: .6 }} title="생성 완료 후 다운로드">PPT 내보내기</button>}
    </div>
  );

  const slides = [
      <Slide key={0} n="01" foot="분석보고서" rno={rno} date={date}
        title={shortAddr} desc={`${useZone} · ${mainUse} 분석보고서`}>
        <div style={{ display: "flex", gap: "2.5cqw", width: "100%" }}>
          <div style={{ flex: "0 0 40%", borderRadius: "1.2cqw", background: "linear-gradient(135deg,#dfe4ec,#c3cbd8)", display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7688", fontSize: "1.4cqw", fontWeight: 700 }}>건물 사진</div>
          <div className="rs-cards" style={{ flex: 1 }}>
            <MC lab="가치점수" sub="입지·건물·환경 종합 평가" val={<>{score}<u>점</u></>} pill={`${grade}등급`} pillC="blue" />
            <MC lab="매도희망가" sub="건물주 희망 매도가" val={eokU(ask)} />
            <MC lab="빌탐정 적정가" sub="시스템 산정 (F-17)" val={eokU(fair)} valC="var(--green)" />
            <MC lab="매매가" sub={brokerAdj ? `중개인 판단 · 적정가 ${eok(fair)}억 대비 조정` : "중개인 판단 (기본 = 적정가)"} val={eokU(broker)} valC="var(--blue)" />
            <MC lab="협의 필요금액" sub="매도희망가 − 매매가" val={gap != null ? <>{eok(Math.abs(gap))}<u>억원</u></> : "—"} pill={gap != null && gap > 0 ? "가격 협의 필요" : undefined} pillC="peach" valC="var(--blue)" />
            <MC lab="예상수익률" sub="매매가 기준" val={roi != null ? <>{roi.toFixed(2)}<u>%</u></> : "—"} valC="var(--purple)" />
          </div>
        </div>
      </Slide>,
      <Slide key={1} n="02" foot="매물 기본정보" rno={rno} date={date}
        title="매물 기본정보" desc="해당 건물의 기본정보 및 입지 정보 (토지이용계획확인원 및 건축물대장 기준)">
        <div style={{ display: "flex", gap: "2.5cqw", width: "100%" }}>
          <table className="rs-tbl rs-kv" style={{ flex: "0 0 46%", alignSelf: "flex-start" }}><tbody>
            <tr><td>매도희망가</td><td className="blue b">{ask ? `${eok(ask)}억 원` : "—"}</td></tr>
            <tr><td>대지면적</td><td>{py(landArea)}평 ({landArea ?? "—"}㎡)</td></tr>
            <tr><td>연면적</td><td>{py(totalArea)}평 ({totalArea ?? "—"}㎡)</td></tr>
            <tr><td>대지 평단가</td><td>{ask && landP ? `${(ask / landP / 1e8).toFixed(2)}억 원 (호가 기준)` : "—"}</td></tr>
            <tr><td>연면적 평단가</td><td>{ask && totalP ? `${Math.round(ask / totalP / 1e4).toLocaleString()}만 원 (호가 기준)` : "—"}</td></tr>
            <tr><td>용도지역</td><td>{useZone}</td></tr>
            <tr><td>건축물용도</td><td>{mainUse}</td></tr>
            <tr><td>건물규모</td><td>지하 {b.floors_below ?? "—"}층 / 지상 {b.floors_above ?? "—"}층</td></tr>
            <tr><td>사용승인</td><td>{b.approval_ymd ? `${String(b.approval_ymd).slice(0, 4)}년` : "—"}</td></tr>
            <tr><td>건폐율 / 용적률</td><td>{b.bcr ?? "—"}% / {b.far ?? "—"}%</td></tr>
            <tr><td>주차 / 승강기</td><td>{b.parking ?? "—"}대 / {b.elevator ?? "—"}</td></tr>
            <tr><td>현재 총월세</td><td>{man(curRent)}만 원</td></tr>
            <tr><td>현재 실수익률</td><td>{roiAsk != null ? `${roiAsk.toFixed(2)}% (현재 월세·매도희망가 기준)` : "—"}</td></tr>
          </tbody></table>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.1cqw" }}>
            <div style={{ fontSize: "1.6cqw", fontWeight: 800, color: "var(--navy)" }}>핵심 스펙 요약</div>
            <Spec k="용도지역" v={useZone} />
            <Spec k="건물규모" v={`지하 ${b.floors_below ?? "—"} · 지상 ${b.floors_above ?? "—"}층`} />
            <Spec k="승강기" v={`승강기 ${b.elevator ?? "—"} 보유`} />
            <Spec k="주차" v={`주차 ${b.parking ?? "—"}대 가능`} />
            <Spec k="수익률" v={`매도희망가 ${roiAsk != null ? roiAsk.toFixed(2) : "—"}%  →  매매가 ${roi != null ? roi.toFixed(2) : "—"}%`} />
            <div className="rs-callout">
              {rent != null && curRent != null && rent !== curRent
                ? <>현재 총월세 {man(curRent)}만원 대비 주변월세시세 적용 시 <b>{man(rent)}만원({rent >= curRent ? "+" : ""}{Math.round((rent - curRent) / 1e4).toLocaleString()}만원)</b>까지 임대료 개선 여지가 있습니다.</>
                : "주변월세시세 미포함(현재 임대료 기준)."}
            </div>
          </div>
        </div>
      </Slide>,
      <Slide key={2} n="03" foot="분석 흐름" rno={rno} date={date}
        title="분석 흐름" desc="단계별 분석을 통해 본 매물의 적정매매가와 주변월세시세를 체계적으로 산정합니다.">
        <div style={{ display: "flex", gap: "2.5cqw", width: "100%" }}>
          <div style={{ flex: "0 0 52%", display: "flex", flexDirection: "column", gap: ".5cqw" }}>
            {[["STEP 1", "가치점수 분석", "입지·건물·환경 종합 평가"],
              ["STEP 2", "매매사례 시세분석", "반경 500m 내 최근 5년 유사 거래사례 비교"],
              ["STEP 3", "주변월세시세 분석", "층별 유사 월세 광고사례 비교"],
              ["STEP 4", "적정매매가·수익률 요약", "적정매매가·협의금액·예상수익률 정리"]].map(([n, t, d], i) => (
              <div key={i}>
                <div className="rs-step"><span className="n">{n}</span><span className="t">{t}</span><span className="d">{d}</span></div>
                {i < 3 && <div className="rs-arrow">▼</div>}
              </div>
            ))}
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1cqw" }}>
            <div className="rs-concl navy"><h4>빌탐정 분석 엔진</h4>
              가치점수 분석, 유사 매매사례 분석, 주변월세시세 분석을 종합하여 본 매물의 <b style={{ color: "var(--blue)" }}>적정매매가와 주변월세시세</b>를 산출합니다.</div>
            <div style={{ fontSize: "1.35cqw", fontWeight: 800, color: "var(--navy)", marginTop: ".3cqw" }}>분석 적용 원칙</div>
            {[["기본 반경 500m", "상권 중심·반경 직접 조정"],
              ["기본 최근 5년", "최근 5년 이내 거래·광고 적용"],
              ["거리가중 우선", "가까운 실거래를 무겁게 반영(1/거리)"],
              ["매매·월세 산정 기준", "매매=연면적당 평단가, 월세=층별 광고사례"]].map(([k, v], i) => (
              <div key={i} style={{ fontSize: "1.05cqw" }}><b style={{ color: "var(--navy)" }}>{k}</b> <span style={{ color: "var(--rmuted)" }}>· {v}</span></div>
            ))}
          </div>
        </div>
      </Slide>,
      <Slide key={3} n="04" foot="가치점수 분석" rno={rno} date={date}
        title="가치점수 분석" desc="입지·교통·물리적 조건 등 주요 항목을 종합 평가한 본 매물의 가치 점수입니다.">
        <div style={{ display: "flex", gap: "2.5cqw", width: "100%" }}>
          <table className="rs-tbl" style={{ flex: "0 0 52%", alignSelf: "flex-start" }}>
            <thead><tr><th>평가 항목</th><th>평가 결과</th><th>분석 의견</th></tr></thead>
            <tbody>
              {AXIS.map(([k, l], i) => {
                const s = sub?.items?.[k] ?? 0;
                return <tr key={k}>
                  <td className="b">{`①②③④⑤⑥⑦⑧⑨`[i]} {l}</td>
                  <td style={{ color: gc(s), fontWeight: 700 }}>{word(s)}</td>
                  <td style={{ color: "var(--rmuted)" }}>{l} 항목 평가 결과 {word(s)} 수준</td>
                </tr>;
              })}
            </tbody>
          </table>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1cqw" }}>
            <div className="rs-sc blue" style={{ display: "flex", alignItems: "center" }}>
              <div><div className="k">가치점수 총평</div><div className="v">{score}<u>/100점</u></div></div>
              <span className="rs-pill blue" style={{ marginLeft: "auto", fontSize: "1.6cqw", padding: ".7cqw 1.3cqw" }}>{grade}등급</span>
            </div>
            {sub?.items && <ScoreRadar axes={AXIS.map(([k, l]) => ({ label: l, score: sub.items![k] ?? 0 }))} color="var(--navy)" size={200} />}
            <div style={{ fontSize: ".98cqw", color: "var(--rmuted)", textAlign: "center" }}>등급 기준 · S 90↑ / A 75~89 / B 60~74 / C 60↓ → 본 매물 {grade}등급({word(score)})</div>
          </div>
        </div>
      </Slide>,
      <Slide key={4} n="05" foot="매매사례 시세분석" rno={rno} date={date}
        title="매매사례 시세분석" desc={`${shortAddr} 인근 유사 거래사례로 연면적당 평단가를 산정하고 적정매매가를 도출했습니다.`}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.2cqw", width: "100%" }}>
          <table className="rs-tbl">
            <thead><tr><th>사례</th><th>주소</th><th className="r">거리</th><th>거래일</th><th className="r">매매가</th><th className="r">연면적</th><th className="r">평단가</th><th className="r">시점보정</th></tr></thead>
            <tbody>
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
            </tbody>
          </table>
          <div style={{ display: "flex", gap: "2cqw", alignItems: "center" }}>
            <div style={{ fontSize: "1.5cqw", fontWeight: 800, color: "var(--navy)", flex: "0 0 auto" }}>적정매매가<br />산정 요약</div>
            <div className="rs-flow" style={{ flex: 1 }}>
              <div className="rs-fbox"><div className="k">유사사례 가중평균 평단가</div><div className="v">{avgPer ? `${Math.round(avgPer / 1e4).toLocaleString()}만원/평` : "—"}</div></div>
              <span className="rs-op">×</span>
              <div className="rs-fbox"><div className="k">본 매물 연면적</div><div className="v">{py(totalArea)}평</div></div>
              <span className="rs-op">=</span>
              <div className="rs-fbox hl"><div className="k">빌탐정 적정매매가</div><div className="v" style={{ color: "var(--peach-tx)" }}>{eok(fair)}억 원</div></div>
            </div>
          </div>
          <div className="rs-callout">
            {gap != null && gap > 0
              ? <>매도희망가 {eok(ask)}억 대비 <b>약 {eok(Math.abs(gap))}억 협의 필요</b> (매매가 {eok(broker)}억 기준 · 빌탐정 적정가 {eok(fair)}억)</>
              : <>빌탐정 적정가 <b>{eok(fair)}억</b> 기준 (매도희망가 미입력)</>}
          </div>
        </div>
      </Slide>,
      <Slide key={5} n="06" foot="주변월세시세 분석" rno={rno} date={date}
        title="주변월세시세 분석" desc="반경 500m 내 유사 임대광고 사례(층별 5건 내외) 기준 브리핑형 임대시세 분석">
        <div style={{ display: "flex", flexDirection: "column", gap: "1.2cqw", width: "100%" }}>
          <div className="rs-grid" style={{ gridTemplateColumns: "1fr 1.3fr 1fr" }}>
            <div className="rs-sc"><div className="k">현재 총월세</div><div className="v">{man(curRent)}<u>만원</u></div></div>
            <div className="rs-sc blue"><div className="k">주변월세시세 적용 총월세</div><div className="v" style={{ color: "var(--blue)" }}>{man(rent)}<u>만원</u> <span style={{ fontSize: ".9cqw", color: "var(--rmuted)", fontWeight: 500 }}>연 {eok(rent ? rent * 12 : null)}억</span></div></div>
            <div className="rs-sc"><div className="k">차이</div><div className="v" style={{ color: "var(--blue)" }}>{rent != null && curRent != null ? `${rent >= curRent ? "+" : ""}${Math.round((rent - curRent) / 1e4).toLocaleString()}` : "—"}<u>만원</u></div></div>
          </div>
          {floors.length ? (
            <table className="rs-tbl">
              <thead><tr><th>층수</th><th className="r">현재 월세</th><th className="r">주변월세시세</th><th className="r">차이</th><th className="r">참고사례수</th></tr></thead>
              <tbody>
                {floors.map((f) => (
                  <tr key={f.floor}><td>{f.floor}</td><td className="r">{man(f.cur)}만원</td><td className="r">{man(f.mkt)}만원</td>
                    <td className="r blue">{f.diff >= 0 ? "+" : ""}{Math.round(f.diff / 1e4).toLocaleString()}만원</td><td className="r">{f.count}건</td></tr>
                ))}
                <tr className="sum"><td>합계</td><td className="r">{man(curRent)}만원</td><td className="r">{man(rent)}만원</td>
                  <td className="r blue">{rent != null && curRent != null ? `${rent >= curRent ? "+" : ""}${Math.round((rent - curRent) / 1e4).toLocaleString()}` : "—"}만원</td>
                  <td className="r">{floors.reduce((a, f) => a + f.count, 0)}건</td></tr>
              </tbody>
            </table>
          ) : <div className="rs-callout" style={{ background: "var(--card)", borderColor: "var(--rl)", color: "var(--rmuted)" }}>주변 임대광고 사례가 없어 현재 임대료 기준으로 분석되었습니다.</div>}
        </div>
      </Slide>,
      <Slide key={6} n="07" foot="예상수익률 분석" rno={rno} date={date}
        title="예상수익률 분석" desc="매매가 기준 수익성 브리핑">
        <div style={{ display: "flex", flexDirection: "column", gap: "1.2cqw", width: "100%" }}>
          <div className="rs-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
            <div className="rs-sc"><div className="k">예상보증금</div><div className="v">{dep ? `${(dep / 1e8).toFixed(1)}` : "—"}<u>억원</u></div></div>
            <div className="rs-sc"><div className="k">예상월임대료</div><div className="v">{man(rent)}<u>만원</u></div></div>
            <div className="rs-sc"><div className="k">예상 연임대수익</div><div className="v">{rent ? eok(rent * 12) : "—"}<u>억</u></div></div>
            <div className="rs-sc hl"><div className="k">매매가 기준 예상수익률</div><div className="v" style={{ color: "var(--peach-tx)" }}>{roi != null ? roi.toFixed(2) : "—"}<u>%</u></div></div>
          </div>
          <div style={{ display: "flex", gap: "2.5cqw" }}>
            <div style={{ flex: "0 0 46%" }}>
              <div style={{ fontSize: "1.3cqw", fontWeight: 800, color: "var(--navy)", marginBottom: ".6cqw" }}>가격 협의가 수익률에 미치는 영향</div>
              <table className="rs-tbl">
                <thead><tr><th>구분</th><th className="r">매도희망가</th><th className="r" style={{ background: "var(--blue)" }}>매매가</th></tr></thead>
                <tbody>
                  <tr><td>가격</td><td className="r">{eok(ask)}억 원</td><td className="r b blue">{eok(broker)}억 원</td></tr>
                  <tr><td>예상수익률</td><td className="r">{roiAsk != null ? `${roiAsk.toFixed(2)}%` : "—"}</td><td className="r b blue">{roi != null ? `${roi.toFixed(2)}%` : "—"}</td></tr>
                </tbody>
              </table>
              <div style={{ fontSize: "1.05cqw", color: "var(--blue)", fontWeight: 700, marginTop: ".6cqw" }}>→ 매매가(적정가) 기준 접근 시 수익률 개선</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="rs-concl navy" style={{ background: "var(--navy)", color: "#dfe6f2" }}>
                <h4 style={{ color: "#fff" }}>왜 이렇게 분석되었나</h4>
                <li style={{ color: "#cfd8e8" }}>주변월세시세 적용 총월세 {man(rent)}만원 기준</li>
                <li style={{ color: "#cfd8e8" }}>예상보증금 {dep ? (dep / 1e8).toFixed(1) : "—"}억 원 반영</li>
                <li style={{ color: "#cfd8e8" }}>매매가 {eok(broker)}억 원 기준 단순 연임대수익 산정 (빌탐정 적정가 {eok(fair)}억)</li>
                <li style={{ color: "#cfd8e8" }}>매도희망가 대비 매매가 매수 시 수익률 개선</li>
              </div>
            </div>
          </div>
          <div className="rs-flow">
            <div className="rs-fbox"><div className="k">적용 총월세</div><div className="v" style={{ fontSize: "1.3cqw" }}>{man(rent)}만원</div></div>
            <span className="rs-op">×</span>
            <div className="rs-fbox"><div className="k">개월</div><div className="v" style={{ fontSize: "1.3cqw" }}>12개월</div></div>
            <span className="rs-op">=</span>
            <div className="rs-fbox"><div className="k">예상 연임대수익</div><div className="v" style={{ fontSize: "1.3cqw" }}>{rent ? eok(rent * 12) : "—"}억</div></div>
            <span className="rs-op">÷</span>
            <div className="rs-fbox"><div className="k">매매가</div><div className="v" style={{ fontSize: "1.3cqw" }}>{eok(broker)}억</div></div>
            <span className="rs-op">=</span>
            <div className="rs-fbox hl"><div className="k">예상수익률</div><div className="v" style={{ fontSize: "1.3cqw", color: "var(--peach-tx)" }}>{roi != null ? roi.toFixed(2) : "—"}%</div></div>
          </div>
        </div>
      </Slide>,
      <Slide key={7} n="08" foot="최종 분석 요약" rno={rno} date={date}
        title="최종 분석 요약" desc="적정매매가 및 수익성 종합 결론">
        <div style={{ display: "flex", flexDirection: "column", gap: "1.4cqw", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "stretch", gap: "1cqw" }}>
            <div className="rs-sc" style={{ flex: 1 }}><div className="lab" style={{ fontSize: "1.3cqw", fontWeight: 700, color: "var(--navy)" }}>매도희망가</div><div style={{ fontSize: ".95cqw", color: "var(--rmuted)" }}>건물주 희망 매도가</div><div className="v" style={{ marginTop: ".5cqw" }}>{eok(ask)}<u>억원</u></div></div>
            <span className="rs-op" style={{ alignSelf: "center", color: "var(--blue)" }}>▶</span>
            <div className="rs-sc blue" style={{ flex: 1 }}><div style={{ fontSize: "1.3cqw", fontWeight: 700, color: "var(--navy)" }}>매매가 <span style={{ fontSize: ".85cqw", fontWeight: 500, color: "var(--rmuted)" }}>(중개인)</span></div><div style={{ fontSize: ".95cqw", color: "var(--rmuted)" }}>빌탐정 적정가 {eok(fair)}억 {brokerAdj ? "대비 조정" : "기준"}</div><div className="v" style={{ marginTop: ".5cqw", color: "var(--green)" }}>{eok(broker)}<u>억원</u></div></div>
            <span className="rs-op" style={{ alignSelf: "center", color: "var(--blue)" }}>▶</span>
            <div className="rs-sc hl" style={{ flex: 1 }}><div style={{ fontSize: "1.3cqw", fontWeight: 700, color: "var(--navy)" }}>협의 필요금액</div><div style={{ fontSize: ".95cqw", color: "var(--rmuted)" }}>매도희망가 − 매매가</div><div className="v" style={{ marginTop: ".5cqw", color: "var(--blue)" }}>{gap != null ? eok(Math.abs(gap)) : "—"}<u>억원</u></div></div>
          </div>
          <div style={{ display: "flex", gap: "1.4cqw" }}>
            <div className="rs-concl navy" style={{ flex: 1 }}><h4>최종 분석 결론</h4>
              <li>유사 매매사례 분석 결과 <b style={{ color: "var(--blue)" }}>빌탐정 적정가</b>는 약 <b style={{ color: "var(--blue)" }}>{eok(fair)}억 원</b> 수준입니다.</li>
              {gap != null && gap > 0 && <li>매도희망가 {eok(ask)}억 원은 매매가 대비 약 {eok(gap)}억 원 높은 수준입니다.</li>}
              <li>매수 검토 시 <b>매매가 {eok(broker)}억 원</b> 내외 기준 가격 협의가 필요합니다.</li>
              <li>가치점수 {grade}등급({score}점) · 매매가 기준 예상수익률 {roi != null ? `${roi.toFixed(2)}%` : "—"}.</li>
            </div>
            <div className="rs-concl peach" style={{ flex: 1 }}><h4>매수 검토 포인트</h4>
              <li>매매가(적정가) 기준 접근 필요</li>
              <li>매도희망가 기준 수익률 제한 ({roiAsk != null ? `${roiAsk.toFixed(2)}%` : "—"})</li>
              <li>주변월세시세 적용 시 수익성 개선 가능</li>
              <li>가격 협의 여부가 투자 판단의 핵심</li>
            </div>
          </div>
          <div className="rs-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
            <div className="rs-sc"><div className="k">예상보증금</div><div className="v" style={{ fontSize: "1.7cqw" }}>{dep ? (dep / 1e8).toFixed(1) : "—"} 억원</div></div>
            <div className="rs-sc"><div className="k">예상월임대료</div><div className="v" style={{ fontSize: "1.7cqw" }}>{man(rent)} 만원</div></div>
            <div className="rs-sc"><div className="k">예상 연임대수익</div><div className="v" style={{ fontSize: "1.7cqw" }}>{rent ? eok(rent * 12) : "—"} 억</div></div>
            <div className="rs-sc hl"><div className="k">매매가 기준 예상수익률</div><div className="v" style={{ fontSize: "1.7cqw", color: "var(--peach-tx)" }}>{roi != null ? roi.toFixed(2) : "—"} %</div></div>
          </div>
        </div>
      </Slide>,
  ];

  return (
    <div className="rslide-root deck">
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
          <div className="stage-slide">{slides[cur]}</div>
          <button className="deck-arrow r" disabled={cur === slides.length - 1} onClick={() => setCur((c) => Math.min(slides.length - 1, c + 1))} aria-label="다음">›</button>
          <div className="deck-counter">{cur + 1} / {slides.length}</div>
        </div>
      </div>
    </div>
  );
}

function MC({ lab, sub, val, unit, pill, pillC, valC }:
  { lab: string; sub?: string; val: React.ReactNode; unit?: string; pill?: string; pillC?: "blue" | "peach"; valC?: string }) {
  return (
    <div className={`rs-mc${pillC === "peach" ? " peach" : ""}`}>
      <div><div className="lab">{lab}</div>{sub && <div className="sub">{sub}</div>}</div>
      {pill && <span className={`rs-pill ${pillC}`}>{pill}</span>}
      <div className="val" style={{ color: valC ?? "var(--navy)" }}>{val}{unit && <u>{unit}</u>}</div>
    </div>
  );
}
function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div className="rs-mc" style={{ padding: "1cqw 1.4cqw" }}>
      <div className="lab" style={{ fontSize: "1.25cqw", flex: "0 0 26%" }}>{k}</div>
      <div style={{ fontSize: "1.05cqw", color: "var(--rmuted)" }}>{v}</div>
    </div>
  );
}
