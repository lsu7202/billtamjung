import { Loading } from "../../shared/ui/Spinner";
import { Icon } from "../../shared/ui/Icon";
import { useState, useEffect, useRef, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  buildingsApi, overlaysApi, rentsApi, listingsApi, creditsApi, seriesApi, reportsApi, FloorRent,
} from "../../shared/api/endpoints";
import { PhotoPanel } from "../../shared/map/PhotoPanel";
import { won, wonShort } from "../../shared/format";
import { MarketArea, CompPoint } from "../../shared/map/geo";
import { MarketTrend } from "./MarketTrend";
import { MarketBlock } from "./MarketBlock";
import { Sidebar } from "./Sidebar";
import { ReportModal } from "./ReportModal";
import { BriefingModal } from "./BriefingModal";
import { ParcelBlock, GongsiCard } from "./ParcelBlock";
import { ReportView } from "./ReportView";
import { EnumField } from "./EnumField";
import { KV, FloorsRow, vRate100, vNonNeg, vPos, vYmd, vInt } from "./KV";

/** S02 매물 상세 — 목업 전체 구조:
 * 헤더지표 · 사진(지도/로드뷰) · 표시범위 · 금액 · 투자분석 · 층별임대 · 상세정보
 * · 건물 · 토지 · 시계열(공시지가/매각/광고) · 입지 · 주변시세(S03) · 우측 4탭 · 하단 툴바
 */

const P = 3.305785;
type Scope = "report" | "all" | "deal" | "land";

export function BuildingPage() {
  const { pk = "" } = useParams();
  const qc = useQueryClient();
  const [scope, setScope] = useState<Scope>("all");
  const [unit, setUnit] = useState<"py" | "m2">("py");
  const [marketArea, setMarketArea] = useState<MarketArea>({ kind: "circle", radius_m: 500 });   // 주변상권(지도 그리기)
  const [comps, setComps] = useState<CompPoint[]>([]);   // 지도에 찍을 주변 매물(실거래/임대)
  const hydrated = useRef(false);

  const building = useQuery({ queryKey: ["building", pk], queryFn: () => buildingsApi.get(pk) });
  // 저장된 주변상권(유저 오버레이) 복원 — 최초 1회. 이후 방문에도 동일 유지.
  useEffect(() => {
    if (hydrated.current || !building.data) return;
    hydrated.current = true;
    const raw = (building.data as Record<string, unknown>).market_area;
    if (typeof raw === "string") { try { setMarketArea(JSON.parse(raw)); } catch { /* 손상 시 기본 */ } }
  }, [building.data]);
  // 주변상권 변경 = 유저 오버레이로 저장(팀 공유). 그리기·이동·초기화 모두 여기로.
  // 저장 후 report-comps 무효화 — 리포트 요약(ReportView)·검토모달이 같은 캐시를 봐서, 안 하면 새 상권이 새로고침 전까지 반영 안 됨.
  const saveArea = (a: MarketArea) => {
    setMarketArea(a);
    overlaysApi.put(pk, "market_area", JSON.stringify(a))
      .then(() => qc.invalidateQueries({ queryKey: ["report-comps", pk] }))
      .catch(() => {});
  };
  const rents = useQuery({ queryKey: ["rents", pk], queryFn: () => rentsApi.list(pk) });
  const series = useQuery({ queryKey: ["series", pk], queryFn: () => seriesApi.get(pk) });
  const listing = useQuery({ queryKey: ["listing", pk], queryFn: () => listingsApi.get(pk) });

  const [saveErr, setSaveErr] = useState<string | null>(null);
  const editField = useMutation({
    mutationFn: ({ field, value }: { field: string; value: string }) => overlaysApi.put(pk, field, value),
    retry: 2, retryDelay: (n) => 400 * (n + 1),        // 일시적 실패 자동 재시도(#6)
    onMutate: async ({ field, value }) => {            // 낙관적 반영: 즉시 화면 갱신
      await qc.cancelQueries({ queryKey: ["building", pk] });
      const prev = qc.getQueryData<Record<string, any>>(["building", pk]);
      qc.setQueryData(["building", pk], (old: Record<string, any> | undefined) => (old ? { ...old, [field]: value } : old));
      setSaveErr(null);
      return { prev };
    },
    onError: (_e, _v, ctx) => {                        // 재시도 끝내 실패 → 롤백 + 알림
      if (ctx?.prev) qc.setQueryData(["building", pk], ctx.prev);
      setSaveErr("저장 실패 — 이전 값으로 되돌렸습니다. 잠시 후 다시 시도하세요.");
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["building", pk] }); qc.invalidateQueries({ queryKey: ["dist", pk] }); },
  });
  const revert = useMutation({
    mutationFn: (field: string) => overlaysApi.revert(pk, field),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["building", pk] }),
  });

  const credits = useQuery({ queryKey: ["credits"], queryFn: creditsApi.balance });
  const [reportOpen, setReportOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [genState, setGenState] = useState<string | null>(null);
  const nav = useNavigate();
  // 브리핑 생성 — 계산이 없어 바로 완료된다. 완료되면 덱으로 이동.
  const briefing = useMutation({
    mutationFn: async (comment: string) => {
      // 코멘트를 먼저 저장해야 스냅샷에 실린다(생성 시점의 오버레이를 그대로 굳힌다).
      await overlaysApi.put(pk, "briefing_comment", comment);
      const { report_id } = await reportsApi.create(pk, "briefing");
      for (let i = 0; i < 20; i++) {
        const r = await reportsApi.get(report_id);
        if (r.status === "done") return report_id;
        if (r.status === "failed") throw new Error("브리핑 생성에 실패했습니다");
        await new Promise((z) => setTimeout(z, 900));
      }
      throw new Error("생성이 지연되고 있습니다 — 마이페이지에서 확인해 주세요");
    },
    onMutate: () => setGenState("브리핑 자료를 만들고 있습니다…"),
    onSuccess: (rid) => { setGenState(null); nav(`/briefings/${rid}`); },
    onError: (e) => setGenState(String((e as Error)?.message ?? e)),
  });   // S02b 생성 완료 메시지

  // ── 파생값 ──
  const b = (building.data ?? {}) as Record<string, any>;
  const total = rents.data?.total;
  // 층별 임대 추정(공공 상권시세) — 팀 미입력 시 총임대료·수익률 fallback(마스터 추정, 유저 입력이 덮음)
  const outlineEst = useQuery({ queryKey: ["floor-outline", pk], queryFn: () => rentsApi.outline(pk) });
  const estMonthly = (outlineEst.data ?? []).reduce((s, o) => s + (o.rent_est ?? 0), 0);
  const estDeposit = (outlineEst.data ?? []).reduce((s, o) => s + (o.deposit_est ?? 0), 0);
  // 전층 하이브리드 총액: 팀 입력층=실제, 미입력층=마스터 추정(백엔드 rent_full). total 로딩 전엔 추정합 fallback.
  // (추정 여부는 필드명 대신 화면 하단 공통 주의사항으로 안내 — 유저 오버레이 시 라벨이 이상해지지 않게)
  const fullRent = total?.rent_full ?? (estMonthly || 0);
  const fullDeposit = total?.deposit_full ?? (estDeposit || 0);
  // 매매가 = 수기 sale_price 우선, 없으면 적정가 추정(F-17 v2 배치 sale_est). 실거래는 시계열 별도.
  // 3층 가격(specs data-overview): 빌탐정 적정가(sale_est·시스템) / 매매가(sale_price·중개인, 기본=적정가) / 매도희망가(ask_price·건물주)
  const priceActual = b.sale_price != null && b.sale_price !== "" ? Number(b.sale_price) : null;   // 매매가(중개인 오버레이)
  const priceEst = b.sale_est != null && b.sale_est !== "" ? Number(b.sale_est) : null;             // 빌탐정 적정가
  const price = priceActual ?? priceEst;                                                            // 매매가 = 오버레이 or 적정가
  const landP = b.land_area ? Number(b.land_area) / P : null;
  const totalP = b.total_area ? Number(b.total_area) / P : null;
  // 🔀 파생값(data-overview §수정모드): 오버레이 직접입력이 있으면 그 값, 없으면 자동집계.
  const ovr = (field: string, computed: number | null): number | null => {
    const o = b[field];
    return o != null && o !== "" ? Number(o) : computed;
  };
  const tDeposit = ovr("total_deposit", fullDeposit || null);
  const tRent = ovr("total_rent", fullRent || null);
  const tMaint = ovr("total_maintenance", total ? total.maintenance : null);
  const yearRent = tRent != null ? tRent * 12 : 0;                                   // 수익률·투자분석에 override 반영
  const roiComputed = price && yearRent ? (yearRent / price) * 100 : null;           // F-10 만실 단순형
  const roiFull = ovr("roi_full", roiComputed);
  // 공실제외도 만실과 같은 하이브리드(팀 실제 + 미입력층 추정)로 본다.
  // 팀 행만 쓰면 한 층만 입력해도 수익률이 그 층으로 떨어졌다(만실 2.4% / 공실제외 0.4%).
  const rentOccupied = total ? (total.rent_occupied_full ?? total.rent_occupied) : null;
  const roiExVacComputed = price && rentOccupied ? (rentOccupied * 12 / price) * 100 : null;   // F-14 공실제외: 공실 행 임대료 분자 제외(분모=매매가 전체)
  const roiExVac = ovr("roi_exvac", roiExVacComputed);
  const ppLand = ovr("price_per_land", price && landP ? price / landP : null);
  const ppTotal = ovr("price_per_total", price && totalP ? price / totalP : null);

  const area = (m2?: number | string | null) => {
    const v = typeof m2 === "string" ? parseFloat(m2) : m2;
    if (v == null || Number.isNaN(v)) return "";
    return unit === "py" ? `${(v / P).toFixed(1)}평` : `${v.toLocaleString(undefined, { maximumFractionDigits: 20 })}㎡`;   // ㎡=원값 그대로
  };
  const eok = won;   // 공용 포매터(억+만 정밀). shared/format.ts
  // 🔀 직접입력 단위: 금액=억(저장 원), 집계금액=만원(저장 원), 율=% 그대로
  const seedEok = (n: number | null) => (n != null ? +(n / 1e8).toFixed(2) : "");
  const parseEok = (v: string) => String(Math.round(parseFloat(v) * 1e8));
  const seedMan = (n: number | null) => (n != null ? Math.round(n / 1e4) : "");
  const parseMan = (v: string) => String(Math.round(parseFloat(v) * 1e4));
  const ymdDisp = (v: unknown) => (v ? String(v).replace(/-/g, "/") : "");                    // 저장 YYYY-MM-DD → 표시 YYYY/MM/DD
  const parseYmd = (v: string) => { const d = v.replace(/\D/g, ""); return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : v; };   // 입력 → 저장 ISO

  if (building.isLoading) return <Loading label="매물 정보 불러오는 중" minHeight="60vh" />;
  if (building.isError) return <p>건물을 찾을 수 없습니다</p>;

  const show = (grp: Scope) => scope === "all" || scope === grp;

  // 인라인 편집 저장/되돌리기 핸들러(KV는 최상위 컴포넌트 = 리마운트 버그 방지)
  const onSave = (field: string, value: string) => editField.mutate({ field, value });
  const onRevert = (field: string) => revert.mutate(field);
  // 면적: 편집 seed=현재 단위, 저장=㎡
  const areaSeed = (m2: unknown) => (m2 != null && m2 !== "" ? +(unit === "py" ? Number(m2) / P : Number(m2)).toFixed(1) : "");
  const areaParse = (v: string) => String(unit === "py" ? parseFloat(v) * P : parseFloat(v));   // ㎡ 저장은 반올림 없이 원값

  // 헤더 지표 스트립(Compass식) — 박스 없이 값 크게·라벨 작게·세로 hairline 구분. 매매가=히어로(강조 1개).
  const stat = (label: string, value: React.ReactNode, o: { hero?: boolean; accent?: boolean; first?: boolean } = {}) => (
    <div style={{ padding: o.first ? "0 20px 0 0" : "0 20px", borderLeft: o.first ? "none" : "1px solid var(--line)", minWidth: 0 }}>
      <div className="num" style={{ fontSize: o.hero ? 25 : 18, fontWeight: 800, lineHeight: 1.1, whiteSpace: "nowrap", color: o.accent ? "var(--signal)" : "var(--ink)" }}>{value || "—"}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5 }}>{label}</div>
    </div>
  );
  // 면적 값 — 3값(대지/연/건축) 미니 라벨 병기. 단위(평/㎡) 토글 반영.
  const areaVal = () => {
    const c = (lbl: string, m2: number | null) => m2 == null ? null : (
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}>
        <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>{lbl}</span>{Math.round(unit === "py" ? m2 / P : m2).toLocaleString()}
      </span>
    );
    const n = (x: unknown) => (x != null && x !== "" ? Number(x) : null);
    return <span style={{ display: "inline-flex", gap: 11 }}>{c("대지", n(b.land_area))}{c("연", n(b.total_area))}{c("건축", n(b.build_area))}</span>;
  };

  // 입지: 지하철·버스(적재된 JSON)
  const subways: { 역명?: string; 호선?: string; 거리?: number; 도보?: number }[] =
    typeof b.subway_json === "string" ? JSON.parse(b.subway_json || "[]") : (b.subway_json ?? []);
  const buses: { 정류장명?: string; 거리?: number; 도보?: number }[] =
    typeof b.bus_json === "string" ? JSON.parse(b.bus_json || "[]") : (b.bus_json ?? []);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* ── 헤더(S02 §3.1) ── */}
      <div className="panel" style={{ padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, position: "sticky", top: 0, zIndex: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>{b.addr}</h2>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, display: "flex", gap: 14 }}>
            {(listing.data?.listing_no as string) && <span>매물번호 <b>{String(listing.data?.listing_no)}</b></span>}
            {(listing.data?.received_on as string) && <span>접수일 <b>{String(listing.data?.received_on).slice(0, 10)}</b></span>}
            {Boolean(listing.data?.registered) && <span>담당 <b>나</b></span>}
            <span>{String(b.road_addr ?? "")}</span>
          </div>
        </div>
        <div className="hdr-metrics" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 12 }}>
          {stat("매매가", price ? wonShort(price) : "", { hero: true, accent: true, first: true })}
          {stat("수익률 · 만실/공실제외", roiFull != null ? `${roiFull.toFixed(1)}%${roiExVac != null ? ` / ${roiExVac.toFixed(1)}%` : ""}` : "")}
          {stat("평단가 · 대지", ppLand ? won(ppLand) : "")}
          {stat(`면적 (${unit === "py" ? "평" : "㎡"})`, areaVal())}
          {stat("층수", `${Number(b.floors_below) > 0 ? `B${b.floors_below}F/` : ""}${b.floors_above != null ? `${b.floors_above}F` : ""}`)}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {/* 브리핑 = 이 건물의 사실 정리(사무소 정보·서류·임대내역). 우리 판단은 매물 분석에. */}
          <button className="btn" disabled={briefing.isPending} style={{ marginRight: 8 }}
            onClick={() => { setBriefOpen(true); setGenState(null); }}>
            브리핑 자료 (10)</button>
          <button className="btn primary" onClick={() => { setReportOpen(true); setGenState(null); }}>매물 분석하기 (30)</button>
        </div>
      </div>
      {genState && <div className="panel" style={{ padding: "10px 16px", fontSize: 13 }}>{genState}</div>}
      {saveErr && <div className="panel" style={{ padding: "10px 16px", fontSize: 13, color: "var(--up)", display: "flex", alignItems: "center" }}>{saveErr}<button className="btn" style={{ marginLeft: "auto", padding: "2px 10px" }} onClick={() => setSaveErr(null)}>닫기</button></div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 14 }}>
          {typeof b.lng === "number" && typeof b.lat === "number" && (
            <PhotoPanel lng={b.lng} lat={b.lat} pk={pk} area={marketArea} onArea={saveArea} comps={comps} />
          )}

          {/* 표시범위 토글(§3.3) — 리포트(핵심 한눈에) 맨 앞 */}
          <div style={{ display: "flex", gap: 0, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)", marginRight: 10 }}>표시 범위</span>
            {(["report", "all", "deal", "land"] as Scope[]).map((s, i, arr) => (
              <button key={s} className={`btn ${scope === s ? "primary" : ""}`}
                style={{ borderRadius: i === 0 ? "6px 0 0 6px" : i === arr.length - 1 ? "0 6px 6px 0" : 0, borderLeft: i > 0 ? 0 : undefined }}
                onClick={() => setScope(s)}>
                {s === "report" ? "리포트 요약" : s === "all" ? "전체" : s === "deal" ? "매물" : "건물·토지"}
              </button>
            ))}
          </div>

          {/* 리포트 뷰 — 핵심가치 한눈에. 나머지 블록은 show()=false로 숨김 */}
          {scope === "report" && (
            <ReportView pk={pk} b={b} price={priceActual} tRent={tRent} tDeposit={tDeposit} roiFull={roiFull}
              gongsiSeries={(b.gongsi_series as [number, number][]) ?? []}
              realSeries={series.data?.real ?? []}
              totalGongsi={b.total_gongsi != null ? Number(b.total_gongsi) : null} />
          )}

          {/* 금액정보 | 투자분석 (2단) */}
          {show("deal") && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 14, alignItems: "start" }}>
            <div className="panel">
              <div className="sec-head">금액정보</div>
              <div className="kv-grid">
                {/* 🔀 매매가 = 중개인 판단(기본=빌탐정 적정가 sale_est). 매도·매수희망가는 업무탭 '가격 협의'. 빌탐정 적정가 별도표시는 리포트에서만 */}
                <KV label="매매가" field="sale_price" value={price != null ? eok(price) : ""}
                  editable money current={priceActual != null ? String(priceActual) : ""} parse={(v) => v} validate={vPos}
                  onSave={onSave} onRevert={onRevert} />
                <KV label="수익률(만실)" field="roi_full" value={roiFull != null ? `${roiFull.toFixed(2)}%` : ""} calc
                  editable current={roiFull ?? ""} parse={(v) => v} validate={vNonNeg} onSave={onSave} onRevert={onRevert} />
                <KV label="수익률(공실제외)" field="roi_exvac" value={roiExVac != null ? `${roiExVac.toFixed(2)}%` : ""} calc
                  editable current={roiExVac ?? ""} parse={(v) => v} validate={vNonNeg} onSave={onSave} onRevert={onRevert} />
                <KV label="대지 평단가" field="price_per_land" value={eok(ppLand)} calc
                  editable current={seedEok(ppLand)} parse={parseEok} validate={vPos} onSave={onSave} onRevert={onRevert} />
                <KV label="연면적 평단가" field="price_per_total" value={eok(ppTotal)} calc
                  editable current={seedEok(ppTotal)} parse={parseEok} validate={vPos} onSave={onSave} onRevert={onRevert} />
                <KV label="총보증금" field="total_deposit" value={eok(tDeposit)} calc
                  editable current={seedMan(tDeposit)} parse={parseMan} validate={vNonNeg} onSave={onSave} onRevert={onRevert} />
                <KV label="총임대료" field="total_rent" value={eok(tRent)} calc
                  editable current={seedMan(tRent)} parse={parseMan} validate={vNonNeg} onSave={onSave} onRevert={onRevert} />
                <KV label="총관리비" field="total_maintenance" value={eok(tMaint)} calc
                  editable current={seedMan(tMaint)} parse={parseMan} validate={vNonNeg} onSave={onSave} onRevert={onRevert} />
                <KV label="총공실" value={total && total.vacant_count > 0 ? `있음 (${total.vacant_count}실)` : total && total.status_count > 0 ? "없음" : "미지정"} />
              </div>
            </div>

            {/* 투자분석(§3.4a) — 항상 펼침 */}
            <div className="panel">
              <div className="sec-head">투자 분석 <small style={{ color: "var(--muted)", fontWeight: 400 }}>레버리지 · 내 가정값</small></div>
              <InvestCalc price={price} yearRent={yearRent} />
            </div>
          </div>
          )}

          {/* 건물정보 | 상세정보 (2단) */}
          {(show("land") || show("deal")) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 14, alignItems: "start" }}>
            {show("land") && (
            <div className="panel">
              <div className="sec-head">건물정보</div>
              {/* 목업 순서: 대지·연·건축면적 → 층수 → 용적산정연면적 → 주차·엘베 → 승인/대수선 → 주용도 → 건폐·용적 (검증=데이터타입) */}
              <div className="kv-grid">
                <KV label="대지면적" field="land_area" value={area(b.land_area)} editable current={areaSeed(b.land_area)} parse={areaParse} validate={vPos} onSave={onSave} onRevert={onRevert} />
                <KV label="연면적" field="total_area" value={area(b.total_area)} editable current={areaSeed(b.total_area)} parse={areaParse} validate={vPos} onSave={onSave} onRevert={onRevert} />
                <KV label="건축면적" field="build_area" value={area(b.build_area)} editable current={areaSeed(b.build_area)} parse={areaParse} validate={vPos} onSave={onSave} onRevert={onRevert} />
                <FloorsRow above={b.floors_above} below={b.floors_below} onSave={onSave} />
                <KV label="용적률 산정용 연면적" field="far_area" value={area(b.far_area)} editable current={areaSeed(b.far_area)} parse={areaParse} validate={vPos} onSave={onSave} onRevert={onRevert} />
                <KV label="주차" field="parking" value={b.parking ?? ""} unit="대" editable current={b.parking} validate={vInt} onSave={onSave} onRevert={onRevert} />
                <KV label="엘리베이터" field="elevator" value={b.elevator ?? ""} unit="대" editable current={b.elevator} validate={vInt} onSave={onSave} onRevert={onRevert} />
                <KV label="사용승인일" field="approval_ymd" value={ymdDisp(b.approval_ymd)} editable current={b.approval_ymd} parse={parseYmd} validate={vYmd} onSave={onSave} onRevert={onRevert} />
                <KV label="대수선 및 리모델링" field="remodel_ymd" value={ymdDisp(b.remodel_ymd)} editable current={b.remodel_ymd} parse={parseYmd} validate={vYmd} onSave={onSave} onRevert={onRevert} />
                <EnumField label="주용도" enumKey="main_use" value={b.main_use as string}
                  onSave={(v) => editField.mutate({ field: "main_use", value: v })} onRevert={() => onRevert("main_use")} />
                <KV label="건폐율" field="bcr" value={b.bcr ?? ""} unit="%" editable validate={vRate100} current={b.bcr} onSave={onSave} onRevert={onRevert} />
                <KV label="용적률" field="far" value={b.far ?? ""} unit="%" editable validate={vNonNeg} current={b.far} onSave={onSave} onRevert={onRevert} />
                <KV label="기타용도" field="etc_use" value={String(b.etc_use ?? "")} editable current={b.etc_use} onSave={onSave} onRevert={onRevert} />
                <KV label="구조" field="structure" value={String(b.structure ?? "")} editable current={b.structure} onSave={onSave} onRevert={onRevert} />
              </div>
            </div>
            )}
            {/* 상세정보(§3.4b — 사적 enum, 드롭다운) */}
            {show("deal") && (
            <div className="panel">
              <div className="sec-head">상세정보</div>
              <div className="kv-grid">
                {([["명도", "meongdo"], ["입지", "ipji"], ["용도변경", "use_change"],
                   ["등급", "grade"], ["멸실", "myeolsil"], ["노후도", "nohudo"], ["건물용도", "building_use"]] as const).map(([lbl, f]) => (
                  <EnumField key={f} label={lbl} enumKey={f} value={b[f] as string}
                    onSave={(v) => editField.mutate({ field: f, value: v })} onRevert={() => onRevert(f)} />
                ))}
              </div>
            </div>
            )}
          </div>
          )}

          {/* 층별 임대정보(§3.5) — 풀폭 */}
          {show("deal") && (
            <RentTable pk={pk} items={rents.data?.items ?? []} total={total}
              hiddenFloors={rents.data?.hidden_floors ?? []} unit={unit}
              refresh={() => { qc.invalidateQueries({ queryKey: ["rents", pk] }); qc.invalidateQueries({ queryKey: ["nearby"] }); }} eok={eok} />
          )}

          {/* 주변시세(S03 §3.9) — 층별임대 바로 아래(임대 관련 인접 배치) */}
          {show("deal") && typeof b.lng === "number" && typeof b.lat === "number" && (
            <MarketBlock pk={pk} lng={b.lng} lat={b.lat} area={marketArea} onComps={setComps} />
          )}

          {/* 토지정보 · 규제 · 공시지가 = 필지 셀렉터(§3.6 · 다필지·규제 2레벨) — 풀폭 */}
          {show("land") && <ParcelBlock pk={pk} useZoneMix={b.use_zone_mix} unit={unit} />}

          {/* 공시지가 | 실거래 시세 (2단) — 가격 시계열 좌우 비교 */}
          {(show("land") || show("deal")) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 14, alignItems: "start" }}>
            {show("land") && (
            <GongsiCard series={(b.gongsi_series as [number, number][]) ?? []}
              totalGongsi={b.total_gongsi != null ? Number(b.total_gongsi) : null}
              landArea={b.land_area != null ? Number(b.land_area) : null} />
            )}
            {/* 시세 추이(§3.7): 실거래 시세추이(편집 가능) */}
            {show("deal") && (
            <MarketTrend pk={pk} fmt={(v) => eok(v)} areaPy={totalP}
              data={series.data ?? { gongsi: [], real: [] }}
              refresh={() => qc.invalidateQueries({ queryKey: ["series", pk] })} />
            )}
          </div>
          )}

          {/* 입지정보(§3.8) — 풀폭. 실적재 지하철·버스 */}
          {show("land") && (
            <div className="panel">
              <div className="sec-head">입지정보</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, padding: "0 14px 14px" }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: ".03em", fontWeight: 600, marginBottom: 7, display: "flex", alignItems: "center", gap: 5 }}><Icon name="subway" size={14} />주변 지하철</div>
                  {subways.slice(0, 4).map((s, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
                      <span><b style={{ color: "var(--ink)" }}>{s.호선}</b> {s.역명}</span>
                      <span className="num" style={{ color: "var(--muted)" }}>{s.거리}m · 도보 {s.도보}분</span>
                    </div>
                  ))}
                  {subways.length === 0 && <p style={{ color: "var(--muted)", fontSize: 12 }}>—</p>}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: ".03em", fontWeight: 600, marginBottom: 7, display: "flex", alignItems: "center", gap: 5 }}><Icon name="bus" size={14} />주변 버스정류소</div>
                  {buses.slice(0, 4).map((s, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
                      <span>{s.정류장명}</span>
                      <span className="num" style={{ color: "var(--muted)" }}>{s.거리}m · 도보 {s.도보}분</span>
                    </div>
                  ))}
                  {buses.length === 0 && <p style={{ color: "var(--muted)", fontSize: 12 }}>—</p>}
                </div>
              </div>
              <div className="kv-grid" style={{ paddingTop: 0 }}>
                <EnumField label="유동인구" enumKey="float_pop" value={b.float_pop as string}
                  onSave={(v) => editField.mutate({ field: "float_pop", value: v })} onRevert={() => onRevert("float_pop")} />
              </div>
            </div>
            )}
        </div>

        {/* 우측 고정 사이드바(§4) */}
        <Sidebar pk={pk} />
      </div>

      {/* 공통 주의사항 — 추정값 안내(필드명 대신 화면 하단 고지. 유저 오버레이 시 라벨 왜곡 방지) */}
      <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.55, padding: "0 4px" }}>
        ※ 매매가·임대료·보증금·수익률 등 일부 값은 공공데이터 기반 <b style={{ fontWeight: 600 }}>추정치</b>이며, 실거래가·감정평가가 아닌
        <b style={{ fontWeight: 600 }}> 법적 효력 없는 참고용</b> 정보입니다. 실제 값은 직접 입력해 보정할 수 있습니다.
      </div>

      {/* 하단 툴바(§5) */}
      <div className="panel" style={{ position: "sticky", bottom: 0, display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", zIndex: 20 }}>
        <button className="btn" onClick={async () => {
          if (confirm("팀 오버레이 전체를 마스터 원본으로 되돌립니다. 계속할까요?")) {
            const r = await overlaysApi.revertAll(pk);
            alert(`${r.reverted}개 수정값을 되돌렸습니다`);
            qc.invalidateQueries({ queryKey: ["building", pk] });
          }
        }}>↺ 전체 되돌리기</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>단위 전환</span>
        <div style={{ display: "flex" }}>
          <button className={`btn ${unit === "py" ? "primary" : ""}`} style={{ borderRadius: "6px 0 0 6px" }} onClick={() => setUnit("py")}>평</button>
          <button className={`btn ${unit === "m2" ? "primary" : ""}`} style={{ borderRadius: "0 6px 6px 0", borderLeft: 0 }} onClick={() => setUnit("m2")}>㎡</button>
        </div>
      </div>

      {/* 매물 분석 검토(S02b) — comp curation + 실시간 미리보기 */}
      {reportOpen && (
        <ReportModal pk={pk} credits={credits.data?.total}
          onClose={() => setReportOpen(false)}
          onDone={(m) => { setReportOpen(false); setGenState(m); qc.invalidateQueries({ queryKey: ["credits"] }); }} />
      )}

      {/* 브리핑 생성 — 중개인 코멘트를 받아 스냅샷에 함께 굳힌다 */}
      {briefOpen && (
        <BriefingModal current={String(b.briefing_comment ?? "")} busy={briefing.isPending}
          onClose={() => setBriefOpen(false)}
          onSubmit={(c) => { setBriefOpen(false); briefing.mutate(c); }} />
      )}

    </div>
  );
}

/* 투자분석: 자기자본·대출금리 → 레버리지(대출액·LTV·이자·자기자본수익률). 매매가 기준 대출액 자동. */
function InvestCalc({ price, yearRent }: { price: number | null; yearRent: number }) {
  const [equity, setEquity] = useState("");                 // 콤마 포함 원 문자열(KV money와 동일)
  const [rate, setRate] = useState("");
  const eq = Number(equity.replace(/,/g, "")) || 0;         // 자기자본(원)
  const r = parseFloat(rate) || 0;                          // 대출금리(연 %)
  const loan = price && eq ? Math.max(0, price - eq) : 0;   // 대출액 = 매매가 − 자기자본
  const ltv = price && loan ? (loan / price) * 100 : null;
  const annInt = Math.round(loan * (r / 100));              // 연 이자
  const annNet = yearRent - annInt;                          // 연 순수익(임대료 − 이자)
  const roe = eq > 0 ? (annNet / eq) * 100 : null;          // 자기자본수익률(ROE)
  const row = (k: string, v: React.ReactNode, strong?: boolean) => (
    <div className="kv"><span className="k">{k}</span>
      <span className="v num" style={{ color: strong ? "var(--signal)" : undefined }}>{v}</span></div>
  );
  return (
    <div className="kv-grid">
      {/* 자기자본 = 매매가와 동일한 KV money(클릭→편집·원 입력·억 환산·↺). 저장 대신 로컬 상태에 반영 */}
      <KV label="자기자본" field="equity" value={eq ? won(eq) : ""} editable money
        current={equity} parse={(v) => v} validate={vNonNeg}
        onSave={(_f, v) => setEquity(v)} onRevert={() => setEquity("")} />
      {/* 대출 금리 = 건폐율·용적률 등 %필드와 동일한 KV(클릭→편집·% 표시·↺) */}
      <KV label="대출 금리(연)" field="rate" value={rate !== "" ? rate : ""} unit="%" editable
        current={rate} validate={vNonNeg} onSave={(_f, v) => setRate(v)} onRevert={() => setRate("")} />
      {row("대출액", loan ? `${won(loan)}${ltv != null ? `  ·  LTV ${ltv.toFixed(0)}%` : ""}` : (eq && price ? "0 (전액 자기자본)" : "—"))}
      {row("연 이자", annInt ? won(annInt) : "—")}
      {row("연 순수익", eq && price ? won(annNet) : "—")}
      {row("자기자본 수익률", roe != null && price ? `${roe.toFixed(1)}%` : "—", true)}
    </div>
  );
}

/* 층별임대 셀 — 클릭 시 인라인 입력, blur=자동저장. 표시값(render)과 편집값(edit) 분리. */
function RentCell({ edit, render, ph, num, width = 66, onSave }: {
  edit: string; render: React.ReactNode; ph?: string; num?: boolean; width?: number; onSave: (v: string) => void;
}) {
  const [on, setOn] = useState(false);
  const [val, setVal] = useState("");
  if (on) return (
    <input className="input" style={{ width, padding: "3px 6px", fontSize: 12 }} autoFocus placeholder={ph} value={val}
      onChange={(e) => setVal(num ? e.target.value.replace(/[^\d.]/g, "") : e.target.value)}
      onBlur={() => { setOn(false); if (val !== edit) onSave(val); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setOn(false); }} />
  );
  return <span style={{ cursor: "pointer", display: "inline-block", minWidth: 28, minHeight: 15 }} title="클릭 = 수정(자동저장)"
    onClick={() => { setVal(edit); setOn(true); }}>{render}</span>;
}

/* 층별임대 행 — 셀 클릭=인라인 자동저장 · 호버 ×=삭제 · 빈(draft) 행에 입력=추가. 모듈 스코프(리마운트 방지). */
type RentForm = { floor: string; unit_no: string; use: string; area: string; deposit: string; rent: string; maintenance: string; is_vacant: boolean | null };
const _a = (v: number | null | undefined, unit: "py" | "m2") =>
  v != null ? String(+(unit === "py" ? v / P : v).toFixed(1)) : "";
const toForm = (r: FloorRent, unit: "py" | "m2"): RentForm => ({
  floor: r.floor, unit_no: r.unit_no, use: r.use ?? "",
  area: _a(r.contract_area, unit),
  deposit: r.deposit ? String(Math.round(r.deposit / 1e4)) : "",
  rent: r.rent ? String(Math.round(r.rent / 1e4)) : "",
  maintenance: r.maintenance ? String(Math.round(r.maintenance / 1e4)) : "",
  is_vacant: r.is_vacant ?? null,   // 기본 미지정
});
function RentRow({ pk, r, unit, eok, refresh, isDraft, onSaved, hidden, isPrefill, onAddUnit, onDelete }: {
  pk: string; r: FloorRent; unit: "py" | "m2"; eok: (n?: number | null) => string;
  refresh: () => void; isDraft?: boolean; onSaved?: () => void; hidden?: boolean; isPrefill?: boolean;
  onAddUnit?: () => void; onDelete?: () => void;   // 구조 편집(0029) — 대장 구조 밖의 층·호실 조정
}) {
  const [f, setF] = useState<RentForm>(toForm(r, unit));
  const [hover, setHover] = useState(false);
  const man = (s: string) => eok(Math.round((parseFloat(s) || 0) * 1e4));   // 만원문자열 → 표시(0=빈칸)
  const dispArea = f.area ? `${f.area}${unit === "py" ? "평" : "㎡"}` : "";

  async function commit(nf: RentForm) {
    setF(nf);
    if (!nf.floor.trim()) return;   // 층은 필수(호실은 선택 — 프리필은 호실 없음). 미완 시 저장 보류
    if (!isDraft && r.id != null && (nf.floor !== r.floor || nf.unit_no !== r.unit_no)) await rentsApi.del(pk, r.id);
    await rentsApi.upsert(pk, {
      floor: nf.floor.trim(), unit_no: nf.unit_no.trim(), use: nf.use || null,
      // 면적은 계약면적 하나뿐(0035) — 대장이 주는 층별면적은 바닥면적이라 여기로 들어간다.
      contract_area: nf.area ? (unit === "py" ? parseFloat(nf.area) * P : parseFloat(nf.area)) : null,
      deposit: Math.round((parseFloat(nf.deposit) || 0) * 1e4),
      rent: Math.round((parseFloat(nf.rent) || 0) * 1e4),
      maintenance: Math.round((parseFloat(nf.maintenance) || 0) * 1e4),
      is_vacant: nf.is_vacant,
    } as FloorRent);
    refresh();
    if (isDraft) onSaved?.();   // 저장되면 새 빈 draft 행으로 리셋
  }
  const set = (k: keyof RentForm) => (v: string) => commit({ ...f, [k]: v });
  async function del() { if (r.id != null) { await rentsApi.del(pk, r.id); refresh(); } else onSaved?.(); }
  function cycleVacancy() {   // 3값 순환 미지정→임대중→공실→미지정. 값은 보존(만실 총계 근거·공실제외는 플래그로 제외). data-overview §G4
    const next = f.is_vacant == null ? false : f.is_vacant === false ? true : null;
    commit({ ...f, is_vacant: next });
  }
  const vac = f.is_vacant;   // null 미지정 · false 임대중 · true 공실
  const vLabel = vac == null ? "미지정" : vac ? "공실" : "임대중";
  const vColor = vac == null ? "var(--muted)" : vac ? "var(--up)" : "var(--green)";

  // 빈 입력(draft) 행은 셀이 전부 비어 보여서 × 하나만 떠 있는 정체불명 행이었다.
  // 무엇을 넣는 자리인지 흐린 글씨로 알려주고, 아무것도 안 쳤으면 지우기 버튼도 숨긴다.
  const draftEmpty = Boolean(isDraft) && !(f.floor || f.unit_no || f.use || f.area || f.deposit || f.rent || f.maintenance);
  const ghost = (val: string, ph: string, node?: React.ReactNode) =>
    isDraft && !val ? <span style={{ color: "var(--muted)", fontWeight: 400 }}>{ph}</span> : (node ?? val);

  return (
    <tr onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...(hidden ? { display: "none" } : {}), ...(isDraft ? { background: "var(--surface-2)" } : {}) }}>
      <td><RentCell edit={f.floor} render={ghost(f.floor, "1F")} ph="1F" width={46} onSave={set("floor")} /></td>
      <td><RentCell edit={f.unit_no} render={ghost(f.unit_no, "101")} ph="101" width={46} onSave={set("unit_no")} /></td>
      <td><RentCell edit={f.use} render={ghost(f.use, "용도")} ph="용도" width={72} onSave={set("use")} /></td>
      <td className="num"><RentCell edit={f.area} render={ghost(f.area, "계약", dispArea)} ph={unit === "py" ? "평" : "㎡"} num onSave={set("area")} /></td>
      <td className="num"><RentCell edit={f.deposit} render={ghost(f.deposit, "보증금", man(f.deposit))} ph="만원" num onSave={set("deposit")} /></td>
      <td className="num"><RentCell edit={f.rent} render={ghost(f.rent, "임대료", man(f.rent))} ph="만원" num onSave={set("rent")} /></td>
      <td className="num"><RentCell edit={f.maintenance} render={ghost(f.maintenance, "관리비", man(f.maintenance))} ph="만원" num onSave={set("maintenance")} /></td>
      <td style={{ whiteSpace: "nowrap" }}>
        {!isDraft && (   // 프리필 행도 지정 가능 — 누르면 팀 행으로 전환(commit upsert). 미지정→임대중→공실 순환
          <button className="btn" style={{ padding: "2px 9px", fontSize: 12, color: vColor }}
            onClick={cycleVacancy} title="클릭 = 미지정→임대중→공실">{vLabel}</button>
        )}
        {!isDraft && onAddUnit && (
          <button className="btn" style={{ padding: "2px 7px", fontSize: 12, marginLeft: 6, visibility: hover ? "visible" : "hidden" }}
            onClick={(e) => { e.stopPropagation(); onAddUnit(); }} title="이 층에 호실 추가">＋</button>
        )}
        {(isDraft ? !draftEmpty : (onDelete || (!isPrefill && r.id != null))) && (
          <button className="btn" style={{ padding: "2px 7px", fontSize: 12, marginLeft: 6, color: "var(--up)", visibility: hover || isDraft ? "visible" : "hidden" }}
            onClick={(e) => { e.stopPropagation(); (onDelete ?? del)(); }}
            title={isDraft ? "입력 지우기" : "이 호실 삭제 (층에 하나뿐이면 층이 사라집니다)"}>×</button>
        )}
      </td>
    </tr>
  );
}

/* 층별임대 표 — 저장버튼 없음(자동저장) · 하단 빈 행에 입력=추가 · 행 호버 ×=삭제 */
function RentTable({ pk, items, total, hiddenFloors, unit, refresh, eok }: {
  pk: string; items: FloorRent[]; total?: Record<string, number>; hiddenFloors: string[];
  unit: "py" | "m2"; refresh: () => void; eok: (n?: number | null) => string;
}) {
  const [draftKey, setDraftKey] = useState(0);
  const [hover, setHover] = useState(false);
  const [showAllFloors, setShowAllFloors] = useState(false);              // 5층 초과 시 더보기
  const [openFloors, setOpenFloors] = useState<Set<string>>(new Set());   // 다호실 층 접고펴기
  const toggleFloor = (f: string) => setOpenFloors((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; });
  const outline = useQuery({ queryKey: ["floor-outline", pk], queryFn: () => rentsApi.outline(pk) });
  // 호실단위: 팀이 한 층에 K개 입력하면 그 층 마스터 호실(seq) 앞 K개만 숨김 — 나머지 호실은 마스터로 표시(백엔드 총액과 일치).
  const sfloor = (fl?: string): number | null => {
    if (!fl) return null;
    const n = parseInt(fl.replace(/\D/g, ""), 10);
    if (/지하|^\s*B/i.test(fl)) return isNaN(n) ? -1 : -n;
    return isNaN(n) ? null : n;
  };
  // 층 단위 인수(0029): 그 층에 팀 입력이 하나라도 있으면 그 층 대장 프리필은 전부 대체된다.
  // 예전엔 '앞 K개'만 대체해서, 2호실을 하나로 합쳐 입력해도 나머지 1호실이 계속 남았다.
  const teamFloors = new Set(items.map((i) => sfloor(i.floor)).filter((f): f is number => f != null));
  const hiddenSf = new Set(hiddenFloors.map(sfloor).filter((f): f is number => f != null));
  const prefill = (outline.data ?? []).filter((o) => {
    if (!o.floor) return false;
    const f = sfloor(o.floor);
    return f == null || (!teamFloors.has(f) && !hiddenSf.has(f));
  });
  // ── 구조 편집 ──────────────────────────────────────────────────
  // 대장 구조를 그대로 못 쓰는 건물이 많다(2호실을 하나로 합쳐 쓰거나, 대장에만 있는 층이거나).
  // 프리필 행을 건드리는 순간 그 층을 팀이 인수한다 = 그 층 프리필을 팀 행으로 확정해두고 편집.
  const [busy, setBusy] = useState(false);
  const outlineOf = (floor: string) =>
    (outline.data ?? []).filter((o) => o.floor && sfloor(o.floor) === sfloor(floor));

  /** 그 층을 팀 행으로 확정(이미 팀 행이 있으면 아무것도 안 함). skipIdx=제외할 프리필 순번 */
  async function adoptFloor(floor: string, skipIdx?: number) {
    const sf = sfloor(floor);
    if (sf != null && teamFloors.has(sf)) return;
    const rows = outlineOf(floor);
    await Promise.all(rows.map((o, i) =>
      i === skipIdx ? null : rentsApi.upsert(pk, {
        floor: o.floor ?? floor, unit_no: String(i + 1),
        use: o.use ?? undefined, contract_area: o.floor_area ?? undefined,
        deposit: o.deposit_est ?? 0, rent: o.rent_est ?? 0, maintenance: 0, is_vacant: null,
      } as FloorRent)).filter(Boolean));
  }

  /** 호실 추가 — 그 층을 인수한 뒤 빈 호실 한 칸을 만든다. */
  async function addUnit(floor: string) {
    if (busy) return;
    setBusy(true);
    try {
      await adoptFloor(floor);
      const used = new Set([...items.filter((i) => sfloor(i.floor) === sfloor(floor)).map((i) => i.unit_no),
                            ...outlineOf(floor).map((_, i) => String(i + 1))]);
      let n = 1; while (used.has(String(n))) n++;
      await rentsApi.upsert(pk, { floor, unit_no: String(n), deposit: 0, rent: 0, maintenance: 0, is_vacant: null } as FloorRent);
      refresh();
    } finally { setBusy(false); }
  }

  /** 층 삭제 — 대장엔 있지만 실제로는 없는 층. 팀 입력도 함께 정리된다(백엔드). */
  async function removeFloor(floor: string) {
    if (busy || !confirm(`${floor}을(를) 이 건물에서 없앨까요? 입력한 임대정보도 함께 지워집니다.`)) return;
    setBusy(true);
    try { await rentsApi.hideFloor(pk, floor, true); refresh(); } finally { setBusy(false); }
  }

  async function restoreFloor(floor: string) {
    setBusy(true);
    try { await rentsApi.hideFloor(pk, floor, false); refresh(); } finally { setBusy(false); }
  }

  /** 프리필 행 삭제 = 그 층 인수하면서 그 행만 뺀다. 그 층에 행이 하나뿐이면 층 삭제와 같다. */
  async function removePrefillRow(floor: string, idx: number) {
    if (busy) return;
    if (outlineOf(floor).length <= 1) return removeFloor(floor);
    setBusy(true);
    try { await adoptFloor(floor, idx); refresh(); } finally { setBusy(false); }
  }

  /** 행 삭제 — 그 층의 마지막 행이면 층째로 없앤다. 안 그러면 대장 프리필이 되살아나 혼란스럽다. */
  function rowDelete(floor: string, dr: { r: FloorRent; isPrefill?: boolean }, idxInFloor: number, rowsInFloor: number) {
    return async () => {
      if (busy) return;
      if (dr.isPrefill) return removePrefillRow(floor, idxInFloor);
      if (rowsInFloor <= 1) return removeFloor(floor);
      if (dr.r.id == null) return;
      setBusy(true);
      try { await rentsApi.del(pk, dr.r.id); refresh(); } finally { setBusy(false); }
    };
  }

  const blank: FloorRent = { floor: "", unit_no: "", deposit: 0, rent: 0, maintenance: 0, is_vacant: null };
  // 층별 그룹핑: 팀입력+프리필을 한 배열로 → 층별 그룹 → 서명층수 내림차순. 다호실 층만 접고펴기.
  type DRow = { r: FloorRent; isPrefill?: boolean; key: string };
  const allRows: DRow[] = [
    ...items.map((r) => ({ r, key: (r.id ?? `${r.floor}-${r.unit_no}`).toString() })),
    // 대장 층별개요가 주는 면적은 그 층의 바닥면적이라 계약면적 칸으로 들어간다(0035).
    // 전용면적은 우리 데이터에 없어서 개념째 뺐다 — 못 채우는 칸은 오해만 만든다.
    ...prefill.map((o, i) => ({ isPrefill: true, key: `pf-${o.floor}-${i}`,
      r: { floor: o.floor ?? "", unit_no: "", use: o.use ?? undefined, contract_area: o.floor_area ?? undefined,
           deposit: o.deposit_est ?? 0, rent: o.rent_est ?? 0, maintenance: 0, is_vacant: null } as FloorRent })),
  ];
  const groups = new Map<string, DRow[]>();
  allRows.forEach((dr) => { const f = dr.r.floor || "—"; if (!groups.has(f)) groups.set(f, []); groups.get(f)!.push(dr); });
  const sortedGroups = [...groups.entries()].sort((a, b) => (sfloor(b[0]) ?? -999) - (sfloor(a[0]) ?? -999));
  const shownGroups = showAllFloors ? sortedGroups : sortedGroups.slice(0, 5);   // 층수 많으면 5층까지만
  return (
    <div className="panel">
      <div className="sec-head">층별 임대정보
        {(items.length > 0 || hiddenFloors.length > 0) && (
          <button className="btn" style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 12 }}
            onClick={async () => {
              if (!confirm("입력한 층별 임대정보를 모두 되돌릴까요? (대장 구조로 복원)")) return;
              // 없앤 층(0029)도 함께 되살린다 — 구조를 되돌리는데 층이 사라진 채 남으면 안 된다.
              await Promise.all([
                ...items.filter((i) => i.id != null).map((i) => rentsApi.del(pk, i.id!)),
                ...hiddenFloors.map((f) => rentsApi.hideFloor(pk, f, false)),
              ]);
              refresh();
            }}>↺ 되돌리기</button>
        )}
      </div>
      <table className="wf" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <thead><tr><th>층</th><th>호실</th><th>용도</th><th className="num">계약({unit === "py" ? "평" : "㎡"})</th><th className="num">보증금</th><th className="num">임대료</th><th className="num">관리비</th><th>상태</th></tr></thead>
        <tbody>
          {/* 층별 그룹: 1호실=행 그대로, 다호실=접이식 헤더(층·호실수·합계). 프리필 면적은 계약 컬럼(바닥면적). */}
          {shownGroups.map(([floor, rows]) => {
            if (rows.length === 1)
              return <RentRow key={rows[0].key} pk={pk} r={rows[0].r} unit={unit} eok={eok} refresh={refresh}
                isPrefill={rows[0].isPrefill} onAddUnit={() => addUnit(floor)}
                onDelete={rowDelete(floor, rows[0], 0, 1)} />;
            const open = openFloors.has(floor);
            const sD = rows.reduce((s, dr) => s + (dr.r.deposit || 0), 0);
            const sR = rows.reduce((s, dr) => s + (dr.r.rent || 0), 0);
            const sM = rows.reduce((s, dr) => s + (dr.r.maintenance || 0), 0);
            return (
              <Fragment key={floor}>
                <tr onClick={() => toggleFloor(floor)} style={{ cursor: "pointer", background: "var(--surface-2)", fontWeight: 600 }}>
                  <td><span style={{ color: "var(--muted)", marginRight: 4 }}>{open ? "▾" : "▸"}</span>{floor}</td>
                  <td colSpan={4} style={{ color: "var(--muted)", fontWeight: 400 }}>{rows.length}호실{open ? "" : " · 펼치기"}</td>
                  <td className="num">{eok(sD)}</td>
                  <td className="num">{eok(sR)}</td>
                  <td className="num">{eok(sM)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn" style={{ padding: "2px 7px", fontSize: 12 }}
                      onClick={(e) => { e.stopPropagation(); addUnit(floor); }} title="이 층에 호실 추가">＋</button>
                    <button className="btn" style={{ padding: "2px 7px", fontSize: 12, marginLeft: 6, color: "var(--up)" }}
                      onClick={(e) => { e.stopPropagation(); removeFloor(floor); }} title="이 층을 없앰">×</button>
                  </td>
                </tr>
                {open && rows.map((dr, i) => <RentRow key={dr.key} pk={pk} r={dr.r} unit={unit} eok={eok} refresh={refresh}
                  isPrefill={dr.isPrefill} onAddUnit={() => addUnit(floor)}
                  onDelete={rowDelete(floor, dr, i, rows.length)} />)}
              </Fragment>
            );
          })}
          <RentRow key={`draft-${draftKey}`} pk={pk} r={blank} unit={unit} eok={eok} refresh={refresh} isDraft hidden={!hover && items.length > 0} onSaved={() => setDraftKey((k) => k + 1)} />
          {total && items.length > 0 && (
            <tr style={{ background: "var(--surface-2)", fontWeight: 700 }}>
              <td colSpan={5}>합계</td>
              <td className="num">{eok(total.deposit)}</td>
              <td className="num">{eok(total.rent)}</td>
              <td className="num">{eok(total.maintenance)}</td>
              <td>공실 {total.vacant_count}</td>
            </tr>
          )}
        </tbody>
      </table>
      {hiddenFloors.length > 0 && (
        <div style={{ padding: "0 14px 10px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>없앤 층</span>
          {hiddenFloors.map((f) => (
            <button key={f} className="btn" style={{ padding: "2px 9px", fontSize: 11.5 }}
              disabled={busy} onClick={() => restoreFloor(f)} title="대장 구조로 되살리기">{f} ↺</button>
          ))}
        </div>
      )}
      {sortedGroups.length > 5 && (
        <div style={{ padding: "0 14px 12px" }}>
          <button className="btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => setShowAllFloors((v) => !v)}>
            {showAllFloors ? "접기" : `더보기 (${sortedGroups.length - 5})`}
          </button>
        </div>
      )}
    </div>
  );
}
