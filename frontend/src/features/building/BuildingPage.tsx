import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  buildingsApi, overlaysApi, rentsApi, reportsApi, extrasApi, listingsApi, creditsApi, seriesApi, FloorRent,
} from "../../shared/api/endpoints";
import { PhotoPanel } from "../../shared/map/PhotoPanel";
import { MarketTrend } from "./MarketTrend";
import { MarketBlock } from "./MarketBlock";
import { Sidebar } from "./Sidebar";
import { ParcelBlock } from "./ParcelBlock";
import { EnumField } from "./EnumField";
import { KV, FloorsRow, vRate100, vNonNeg, vPos, vYmd, vInt } from "./KV";

/** S02 매물 상세 — 목업 전체 구조:
 * 헤더지표 · 사진(지도/로드뷰) · 표시범위 · 금액 · 투자분석 · 층별임대 · 상세정보
 * · 건물 · 토지 · 시계열(공시지가/매각/광고) · 입지 · 주변시세(S03) · 우측 4탭 · 하단 툴바
 */

const P = 3.305785;
type Scope = "all" | "deal" | "land";

export function BuildingPage() {
  const { pk = "" } = useParams();
  const qc = useQueryClient();
  const [scope, setScope] = useState<Scope>("all");
  const [unit, setUnit] = useState<"py" | "m2">("py");
  const [investOpen, setInvestOpen] = useState(false);

  const building = useQuery({ queryKey: ["building", pk], queryFn: () => buildingsApi.get(pk) });
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
  const [genModal, setGenModal] = useState<"briefing" | "analysis" | null>(null);
  const [incMarket, setIncMarket] = useState(true);
  const [genState, setGenState] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  async function generate(kind: "briefing" | "analysis") {
    setGenBusy(true);
    setGenState("생성 중… 완료되면 자동 보관됩니다");
    try {
      const { report_id } = await reportsApi.create(pk, kind, { include_market: incMarket });
      for (let i = 0; i < 40; i++) {
        const r = await reportsApi.get(report_id);
        if (r.status === "done") { setGenState(`✓ 완료 — 내 산출물 보관 (크레딧 ${r.credits_spent})`); qc.invalidateQueries({ queryKey: ["credits"] }); return; }
        if (r.status === "failed") { setGenState(`실패: ${r.failed_reason ?? ""} (미차감)`); return; }
        await new Promise((res) => setTimeout(res, 500));
      }
      setGenState("대기 초과 — 내 산출물에서 확인");
    } finally { setGenBusy(false); }
  }

  // ── 파생값 ──
  const b = (building.data ?? {}) as Record<string, any>;
  const total = rents.data?.total;
  // 매매가 = ✏️ sale_price 오버레이(수기)뿐. 기본값 미지정=0 → 추정 안 함(실거래≠매매가, data-overview.md:174).
  // 실거래·광고가는 각자 시계열 섹션에 별도 표시. 매매가 미입력 시 수익률·평단가는 계산 불가(—).
  const price = b.sale_price != null && b.sale_price !== "" ? Number(b.sale_price) : null;
  const landP = b.land_area ? Number(b.land_area) / P : null;
  const totalP = b.total_area ? Number(b.total_area) / P : null;
  const buildP = b.build_area ? Number(b.build_area) / P : null;
  // 🔀 파생값(data-overview §수정모드): 오버레이 직접입력이 있으면 그 값, 없으면 자동집계.
  const ovr = (field: string, computed: number | null): number | null => {
    const o = b[field];
    return o != null && o !== "" ? Number(o) : computed;
  };
  const tDeposit = ovr("total_deposit", total ? total.deposit : null);
  const tRent = ovr("total_rent", total ? total.rent : null);
  const tMaint = ovr("total_maintenance", total ? total.maintenance : null);
  const yearRent = tRent != null ? tRent * 12 : 0;                                   // 수익률·투자분석에 override 반영
  const roiComputed = price && yearRent ? (yearRent / price) * 100 : null;           // F-10 만실 단순형
  const roiFull = ovr("roi_full", roiComputed);
  const roiExVac = ovr("roi_exvac", null);   // 공실제외 F-14: 베타는 공실데이터 없어 자동계산 보류 → 직접입력만
  const ppLand = ovr("price_per_land", price && landP ? price / landP : null);
  const ppTotal = ovr("price_per_total", price && totalP ? price / totalP : null);

  const area = (m2?: number | string | null) => {
    const v = typeof m2 === "string" ? parseFloat(m2) : m2;
    if (v == null || Number.isNaN(v)) return "";
    return unit === "py" ? `${(v / P).toFixed(1)}평` : `${v.toLocaleString(undefined, { maximumFractionDigits: 20 })}㎡`;   // ㎡=원값 그대로
  };
  const eok = (n?: number | null) => {   // 억+만 정밀표기(목업 "1억 8,400만") · 0=빈칸
    if (n == null || Number(n) === 0) return "";
    const m = Math.round(Number(n) / 1e4) * 1e4;   // 만 단위 반올림
    const e = Math.floor(m / 1e8), man = Math.round((m % 1e8) / 1e4);
    return e && man ? `${e}억 ${man.toLocaleString()}만` : e ? `${e}억` : `${man.toLocaleString()}만`;
  };
  // 🔀 직접입력 단위: 금액=억(저장 원), 집계금액=만원(저장 원), 율=% 그대로
  const seedEok = (n: number | null) => (n != null ? +(n / 1e8).toFixed(2) : "");
  const parseEok = (v: string) => String(Math.round(parseFloat(v) * 1e8));
  const seedMan = (n: number | null) => (n != null ? Math.round(n / 1e4) : "");
  const parseMan = (v: string) => String(Math.round(parseFloat(v) * 1e4));
  const ymdDisp = (v: unknown) => (v ? String(v).replace(/-/g, "/") : "");                    // 저장 YYYY-MM-DD → 표시 YYYY/MM/DD
  const parseYmd = (v: string) => { const d = v.replace(/\D/g, ""); return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : v; };   // 입력 → 저장 ISO

  if (building.isLoading) return <p>불러오는 중…</p>;
  if (building.isError) return <p>건물을 찾을 수 없습니다</p>;

  const show = (grp: Scope) => scope === "all" || scope === grp;

  // 인라인 편집 저장/되돌리기 핸들러(KV는 최상위 컴포넌트 = 리마운트 버그 방지)
  const onSave = (field: string, value: string) => editField.mutate({ field, value });
  const onRevert = (field: string) => revert.mutate(field);
  // 면적: 편집 seed=현재 단위, 저장=㎡
  const areaSeed = (m2: unknown) => (m2 != null && m2 !== "" ? +(unit === "py" ? Number(m2) / P : Number(m2)).toFixed(1) : "");
  const areaParse = (v: string) => String(unit === "py" ? parseFloat(v) * P : parseFloat(v));   // ㎡ 저장은 반올림 없이 원값

  const metric = (k: string, v: React.ReactNode) => (
    <div style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 13px", minWidth: 84, textAlign: "right" }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{k}</div>
      <div className="num" style={{ fontSize: 15, fontWeight: 800 }}>{v}</div>
    </div>
  );

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
          <h2 style={{ margin: 0, fontSize: 20 }}>
            {b.addr}
            <button className="btn" style={{ marginLeft: 10 }} onClick={() => extrasApi.favToggle(pk)}>★</button>
          </h2>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, display: "flex", gap: 14 }}>
            {(listing.data?.listing_no as string) && <span>매물번호 <b>{String(listing.data?.listing_no)}</b></span>}
            {(listing.data?.received_on as string) && <span>접수일 <b>{String(listing.data?.received_on).slice(0, 10)}</b></span>}
            {Boolean(listing.data?.registered) && <span>담당 <b>나</b></span>}
            <span>{String(b.road_addr ?? "")}</span>
          </div>
        </div>
        <div className="hdr-metrics" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {metric("매매가", price ? eok(price) : "")}
          {metric("수익률(만실/공실제외)", roiFull != null ? `${roiFull.toFixed(1)}%${roiExVac != null ? ` / ${roiExVac.toFixed(1)}%` : ""}` : "")}
          {metric("평단가(대지)", ppLand ? eok(ppLand) : "")}
          {metric("면적 (평)", `${landP ? landP.toFixed(1) : ""} / ${totalP ? totalP.toFixed(1) : ""} / ${buildP ? buildP.toFixed(1) : ""}`)}
          {metric("층수", `B${b.floors_below ?? ""}F/${b.floors_above ?? ""}F`)}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" onClick={() => { setGenModal("briefing"); setGenState(null); }}>브리핑 자료 (10)</button>
          <button className="btn primary" onClick={() => { setGenModal("analysis"); setGenState(null); }}>매물 분석하기 (30)</button>
        </div>
      </div>
      {genState && !genModal && <div className="panel" style={{ padding: "10px 16px", fontSize: 13 }}>{genState}</div>}
      {saveErr && <div className="panel" style={{ padding: "10px 16px", fontSize: 13, color: "var(--up)", display: "flex", alignItems: "center" }}>{saveErr}<button className="btn" style={{ marginLeft: "auto", padding: "2px 10px" }} onClick={() => setSaveErr(null)}>닫기</button></div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 14 }}>
          {typeof b.lng === "number" && typeof b.lat === "number" && (
            <PhotoPanel lng={b.lng} lat={b.lat} pk={pk} />
          )}

          {/* 표시범위 토글(§3.3) */}
          <div style={{ display: "flex", gap: 0, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)", marginRight: 10 }}>표시 범위</span>
            {(["all", "deal", "land"] as Scope[]).map((s, i) => (
              <button key={s} className={`btn ${scope === s ? "primary" : ""}`}
                style={{ borderRadius: i === 0 ? "6px 0 0 6px" : i === 2 ? "0 6px 6px 0" : 0, borderLeft: i > 0 ? 0 : undefined }}
                onClick={() => setScope(s)}>
                {s === "all" ? "전체" : s === "deal" ? "매물" : "건물·토지"}
              </button>
            ))}
          </div>

          {/* 금액정보(§3.4) */}
          {show("deal") && (
            <div className="panel">
              <div className="sec-head">금액정보</div>
              <div className="kv-grid">
                {/* 🔀 파생값: 자동집계 표시 + 직접입력 override 가능(data-overview §수정모드). ↺=집계값 복원 */}
                <KV label="매매가" field="sale_price" value={price != null ? eok(price) : ""}
                  editable current={seedEok(price)} parse={parseEok} validate={vPos}
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
                <KV label="총공실" value={total ? (total.vacant_count > 0 ? `있음 (${total.vacant_count}실)` : "없음") : "미지정"} />
              </div>
            </div>
          )}

          {/* 투자분석(§3.4a) 접이식 */}
          {show("deal") && (
            <div className="panel">
              <div className="sec-head">투자 분석 <small style={{ color: "var(--muted)", fontWeight: 400 }}>레버리지 · 내 가정값</small>
                <button className="btn" onClick={() => setInvestOpen(!investOpen)}>{investOpen ? "− 접기" : "＋ 펼치기"}</button>
              </div>
              {investOpen && <InvestCalc price={price} yearRent={yearRent} />}
            </div>
          )}

          {/* 층별 임대정보(§3.5) + 호실 추가 */}
          {show("deal") && (
            <RentTable pk={pk} items={rents.data?.items ?? []} total={total} unit={unit}
              refresh={() => qc.invalidateQueries({ queryKey: ["rents", pk] })} eok={eok} />
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

          {/* 건물정보(§3.6) */}
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

          {/* 토지정보 · 규제 · 공시지가 = 필지 셀렉터(§3.6 · 다필지·규제 2레벨) */}
          {show("land") && <ParcelBlock pk={pk} useZoneMix={b.use_zone_mix} unit={unit} />}

          {/* 시세 추이 통합(§3.7): 총공시지가·실거래·광고 팀 오버레이 · 겹쳐 비교(전부 원) · 표에서 행추가·수정 */}
          {show("deal") && (
            <MarketTrend pk={pk} fmt={(v) => eok(v)}
              data={series.data ?? { gongsi: [], real: [], ad: [] }}
              refresh={() => qc.invalidateQueries({ queryKey: ["series", pk] })} />
          )}

          {/* 입지정보(§3.8) — 실적재 지하철·버스 */}
          {show("land") && (
            <div className="panel">
              <div className="sec-head">입지정보</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, padding: "0 14px 14px" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>🚇 주변 지하철</div>
                  {subways.slice(0, 4).map((s, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
                      <span><b style={{ color: "var(--signal)" }}>{s.호선}</b> {s.역명}</span>
                      <span className="num" style={{ color: "var(--muted)" }}>{s.거리}m · 도보 {s.도보}분</span>
                    </div>
                  ))}
                  {subways.length === 0 && <p style={{ color: "var(--muted)", fontSize: 12 }}>—</p>}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>🚌 주변 버스정류소</div>
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
                <EnumField label="유동인구 (수기)" enumKey="float_pop" value={b.float_pop as string}
                  onSave={(v) => editField.mutate({ field: "float_pop", value: v })} onRevert={() => onRevert("float_pop")} />
              </div>
            </div>
          )}

          {/* 주변시세(S03 §3.9) */}
          {show("deal") && typeof b.lng === "number" && typeof b.lat === "number" && (
            <MarketBlock lng={b.lng} lat={b.lat} />
          )}
        </div>

        {/* 우측 고정 사이드바(§4) */}
        <Sidebar pk={pk} />
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

      {/* 보고서 생성 옵션 모달(§R) */}
      {genModal && (
        <div className="modal-bg open" onClick={() => !genBusy && setGenModal(null)}>
          <div className="modal" style={{ width: "min(560px,100%)" }} onClick={(e) => e.stopPropagation()}>
            <h3>{genModal === "briefing" ? "브리핑 자료" : "매물 분석 보고서"} 생성
              <small style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400, marginLeft: 8 }}>{String(b.addr ?? "")}</small>
              <span className="right"><button className="btn" disabled={genBusy} onClick={() => setGenModal(null)}>닫기</button></span>
            </h3>
            <div className="kv-grid" style={{ gridTemplateColumns: "1fr" }}>
              <div className="kv"><span className="k">크레딧</span><span className="v"><b>{genModal === "briefing" ? 10 : 30}</b> 소모 · 잔액 {credits.data?.total ?? "…"}</span></div>
              <div className="kv"><span className="k">주변 임대시세</span>
                <span style={{ display: "flex" }}>
                  <button className={`btn ${incMarket ? "primary" : ""}`} style={{ borderRadius: "6px 0 0 6px" }} onClick={() => setIncMarket(true)}>포함</button>
                  <button className={`btn ${!incMarket ? "primary" : ""}`} style={{ borderRadius: "0 6px 6px 0", borderLeft: 0 }} onClick={() => setIncMarket(false)}>제외</button>
                </span>
              </div>
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0" }}>완료되면 자동 다운로드 · 창을 닫아도 생성은 계속되며 <b>내 산출물</b>에서 받을 수 있습니다.</p>
            {genState && <div style={{ fontSize: 13, padding: "8px 0", color: genState.startsWith("실패") ? "var(--up)" : "var(--ink)" }}>{genState}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
              <button className="btn primary" disabled={genBusy} onClick={() => generate(genModal)}>{genBusy ? "생성 중…" : "생성하기"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* 투자분석: 자기자본·이자 → 자기자본수익률 */
function InvestCalc({ price, yearRent }: { price: number | null; yearRent: number }) {
  const [equity, setEquity] = useState("");
  const [interest, setInterest] = useState("");
  const eq = parseFloat(equity) * 1e8 || 0;         // 억 입력
  const mi = parseFloat(interest) * 1e4 || 0;       // 만원/월 입력
  const roe = eq > 0 ? ((yearRent - mi * 12) / eq) * 100 : null;
  return (
    <div className="kv-grid">
      <div className="kv"><span className="k">자기자본</span>
        <span><input className="input" style={{ maxWidth: 100, padding: "3px 8px", textAlign: "right" }} value={equity} onChange={(e) => setEquity(e.target.value)} /> 억</span></div>
      <div className="kv"><span className="k">대출 이자(월)</span>
        <span><input className="input" style={{ maxWidth: 100, padding: "3px 8px", textAlign: "right" }} value={interest} onChange={(e) => setInterest(e.target.value)} /> 만</span></div>
      <div className="kv"><span className="k">자기자본 수익률</span>
        <span className="v num" style={{ color: "var(--signal)" }}>{roe != null && price ? `${roe.toFixed(1)}%` : ""}</span></div>
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
type RentForm = { floor: string; unit_no: string; use: string; area: string; deposit: string; rent: string; maintenance: string; is_vacant: boolean };
const toForm = (r: FloorRent, unit: "py" | "m2"): RentForm => ({
  floor: r.floor, unit_no: r.unit_no, use: r.use ?? "",
  area: r.contract_area != null ? String(+(unit === "py" ? r.contract_area / P : r.contract_area).toFixed(1)) : "",
  deposit: r.deposit ? String(Math.round(r.deposit / 1e4)) : "",
  rent: r.rent ? String(Math.round(r.rent / 1e4)) : "",
  maintenance: r.maintenance ? String(Math.round(r.maintenance / 1e4)) : "",
  is_vacant: r.is_vacant ?? false,
});
function RentRow({ pk, r, unit, eok, refresh, isDraft, onSaved, hidden }: {
  pk: string; r: FloorRent; unit: "py" | "m2"; eok: (n?: number | null) => string;
  refresh: () => void; isDraft?: boolean; onSaved?: () => void; hidden?: boolean;
}) {
  const [f, setF] = useState<RentForm>(toForm(r, unit));
  const [hover, setHover] = useState(false);
  const man = (s: string) => eok(Math.round((parseFloat(s) || 0) * 1e4));   // 만원문자열 → 표시(0=빈칸)
  const dispArea = f.area ? `${f.area}${unit === "py" ? "평" : "㎡"}` : "";

  async function commit(nf: RentForm) {
    setF(nf);
    if (!nf.floor.trim() || !nf.unit_no.trim()) return;   // 키(층·호실) 미완 = 자동저장 보류(draft 유지)
    if (!isDraft && r.id != null && (nf.floor !== r.floor || nf.unit_no !== r.unit_no)) await rentsApi.del(pk, r.id);
    await rentsApi.upsert(pk, {
      floor: nf.floor.trim(), unit_no: nf.unit_no.trim(), use: nf.use || null,
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
  function toggleVacant() {
    const nv = !f.is_vacant;
    commit({ ...f, is_vacant: nv, deposit: nv ? "" : f.deposit, rent: nv ? "" : f.rent });   // 공실=보증금·임대료 0
  }

  return (
    <tr onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...(hidden ? { display: "none" } : {}), ...(isDraft ? { background: "var(--surface-2)" } : {}) }}>
      <td><RentCell edit={f.floor} render={f.floor} ph="1F" width={46} onSave={set("floor")} /></td>
      <td><RentCell edit={f.unit_no} render={f.unit_no} ph="101" width={46} onSave={set("unit_no")} /></td>
      <td><RentCell edit={f.use} render={f.use} ph="용도" width={72} onSave={set("use")} /></td>
      <td className="num">{r.exclusive_area != null ? (unit === "py" ? `${(r.exclusive_area / P).toFixed(1)}평` : `${r.exclusive_area}㎡`) : ""}</td>
      <td className="num"><RentCell edit={f.area} render={dispArea} ph={unit === "py" ? "평" : "㎡"} num onSave={set("area")} /></td>
      <td className="num"><RentCell edit={f.deposit} render={man(f.deposit)} ph="만원" num onSave={set("deposit")} /></td>
      <td className="num"><RentCell edit={f.rent} render={man(f.rent)} ph="만원" num onSave={set("rent")} /></td>
      <td className="num"><RentCell edit={f.maintenance} render={man(f.maintenance)} ph="만원" num onSave={set("maintenance")} /></td>
      <td style={{ whiteSpace: "nowrap" }}>
        {!isDraft && (
          <button className="btn" style={{ padding: "2px 9px", fontSize: 12, color: f.is_vacant ? "var(--up)" : "var(--green)" }}
            onClick={toggleVacant}>{f.is_vacant ? "공실" : "임대중"}</button>
        )}
        <button className="btn" style={{ padding: "2px 7px", fontSize: 12, marginLeft: 6, color: "var(--up)", visibility: hover || isDraft ? "visible" : "hidden" }}
          onClick={del} title={isDraft ? "입력 지우기" : "삭제"}>×</button>
      </td>
    </tr>
  );
}

/* 층별임대 표 — 저장버튼 없음(자동저장) · 하단 빈 행에 입력=추가 · 행 호버 ×=삭제 */
function RentTable({ pk, items, total, unit, refresh, eok }: {
  pk: string; items: FloorRent[]; total?: Record<string, number>; unit: "py" | "m2"; refresh: () => void;
  eok: (n?: number | null) => string;
}) {
  const [draftKey, setDraftKey] = useState(0);
  const [hover, setHover] = useState(false);
  const blank: FloorRent = { floor: "", unit_no: "", deposit: 0, rent: 0, maintenance: 0, is_vacant: false };
  return (
    <div className="panel">
      <div className="sec-head">층별 임대정보</div>
      <table className="wf" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <thead><tr><th>층</th><th>호실</th><th>용도</th><th className="num">전용({unit === "py" ? "평" : "㎡"})</th><th className="num">계약({unit === "py" ? "평" : "㎡"})</th><th className="num">보증금</th><th className="num">임대료</th><th className="num">관리비</th><th>상태</th></tr></thead>
        <tbody>
          {items.map((r) => <RentRow key={r.id ?? `${r.floor}-${r.unit_no}`} pk={pk} r={r} unit={unit} eok={eok} refresh={refresh} />)}
          <RentRow key={`draft-${draftKey}`} pk={pk} r={blank} unit={unit} eok={eok} refresh={refresh} isDraft hidden={!hover} onSaved={() => setDraftKey((k) => k + 1)} />
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
    </div>
  );
}

/* 광고 정보 입력(집단지성 §3.7) */
