import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  buildingsApi, overlaysApi, rentsApi, reportsApi, extrasApi, listingsApi, creditsApi, FloorRent,
} from "../../shared/api/endpoints";
import { PhotoPanel } from "../../shared/map/PhotoPanel";
import { SeriesBlock } from "./SeriesBlock";
import { MarketBlock } from "./MarketBlock";
import { Sidebar } from "./Sidebar";
import { ParcelBlock } from "./ParcelBlock";
import { EnumField } from "./EnumField";

/** S02 매물 상세 — 목업 전체 구조:
 * 헤더지표 · 사진(지도/로드뷰) · 표시범위 · 금액 · 투자분석 · 층별임대 · 상세정보
 * · 건물 · 토지 · 시계열(공시지가/매각/광고) · 입지 · 주변시세(S03) · 우측 4탭 · 하단 툴바
 */

const P = 3.305785;
type Scope = "all" | "deal" | "land";

/* 인라인 편집 범위검증(§3.4 "타입별 검증") · 면적/날짜는 대장 표시전용이라 편집 필드는 율·금액 */
type Validate = (v: string) => string | null;
const vRate100: Validate = (v) => { const n = parseFloat(v); if (Number.isNaN(n)) return "숫자를 입력하세요"; if (n < 0 || n > 100) return "0~100% 범위"; return null; };
const vNonNeg: Validate = (v) => { const n = parseFloat(v); if (Number.isNaN(n)) return "숫자를 입력하세요"; if (n < 0) return "0 이상 값"; return null; };
const vPos: Validate = (v) => { const n = parseFloat(v); if (Number.isNaN(n)) return "숫자를 입력하세요"; if (n <= 0) return "0보다 커야 함"; return null; };
const todayYmd = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
const vYmd: Validate = (v) => { if (!/^\d{8}$/.test(v.replace(/-/g, ""))) return "YYYYMMDD 형식"; if (v.replace(/-/g, "") > todayYmd()) return "미래 날짜 불가"; return null; };

/* 마스터 표시 + 유저 오버레이 인라인 편집(값 클릭→수정→자동저장·검증·↺되돌리기). 최상위=편집 중 리마운트 방지 */
interface KVProps {
  label: string; field?: string; value: React.ReactNode; unit?: string; editable?: boolean; calc?: boolean;
  validate?: Validate; current?: unknown; parse?: (v: string) => string;   // parse: 입력→저장값 변환(평→㎡·억→원)
  onSave?: (field: string, value: string) => void; onRevert?: (field: string) => void;
}
function KV({ label, field, value, unit: u, editable, calc, validate, current, parse, onSave, onRevert }: KVProps) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  function commit() {
    const e = validate && val ? validate(val) : null;
    if (e) { setErr(e); return; }                   // 오류 → 저장 안 함, 편집 유지
    setErr(null); setEditing(false);
    if (val && field) onSave?.(field, parse ? parse(val) : val);
  }
  if (editable && field && editing) {
    return (
      <div className="kv"><span className="k">{label}</span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <input className="input" style={{ maxWidth: 110, padding: "3px 8px", borderColor: err ? "var(--up)" : undefined }} autoFocus value={val}
            onChange={(e) => { setVal(e.target.value); if (err) setErr(null); }}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setErr(null); setEditing(false); } }} />
          {err && <span style={{ fontSize: 10, color: "var(--up)" }}>{err}</span>}
        </span>
      </div>
    );
  }
  return (
    <div className="kv"><span className="k">{label}</span>
      <span className="v num" style={{ ...(editable ? { cursor: "pointer" } : {}), ...(calc ? { color: "var(--signal)" } : {}) }}
        onClick={editable && field ? () => { setVal(String(current ?? "")); setErr(null); setEditing(true); } : undefined}
        title={editable ? "클릭 = 수정(자동저장)" : undefined}>
        {value}{u}
        {editable && field && (
          <button className="btn" style={{ marginLeft: 6, padding: "0 6px", fontSize: 11 }}
            onClick={(e) => { e.stopPropagation(); onRevert?.(field); }} title="마스터 원본으로 되돌리기">↺</button>
        )}
      </span>
    </div>
  );
}

export function BuildingPage() {
  const { pk = "" } = useParams();
  const qc = useQueryClient();
  const [scope, setScope] = useState<Scope>("all");
  const [unit, setUnit] = useState<"py" | "m2">("py");
  const [investOpen, setInvestOpen] = useState(false);

  const building = useQuery({ queryKey: ["building", pk], queryFn: () => buildingsApi.get(pk) });
  const rents = useQuery({ queryKey: ["rents", pk], queryFn: () => rentsApi.list(pk) });
  const ads = useQuery({ queryKey: ["ads", pk], queryFn: () => extrasApi.adPrices(pk) });
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
  const adSeries = useMemo(() => (ads.data ?? []).filter((a) => a.price != null)
    .map((a) => ({ x: a.observed_on, y: a.price as number })).reverse(), [ads.data]);
  const latestAd = adSeries.length ? adSeries[adSeries.length - 1].y : null;
  // 매매가 = 사용자 입력(✏️ sale_price 오버레이) 우선. 미입력이면 광고가/실거래 기반 '추정'(실거래가≠매매가)
  const saleOverlay = b.sale_price != null && b.sale_price !== "" ? Number(b.sale_price) : null;
  const estPrice = latestAd ?? (b.last_sale_price ? Number(b.last_sale_price) : null);
  const price = saleOverlay ?? estPrice;               // 수익률·평단가 계산용
  const priceIsEst = saleOverlay == null;              // 매매가 미입력 → 추정치 표시
  const landP = b.land_area ? Number(b.land_area) / P : null;
  const totalP = b.total_area ? Number(b.total_area) / P : null;
  const yearRent = total ? total.rent * 12 : 0;
  const roiNow = price && yearRent ? (yearRent / price) * 100 : null;                 // 수익률(만실) F-10 단순형(베타=공실데이터 없어 현재≈만실). 공실제외는 데이터 연동 후
  const pricePerLand = price && landP ? price / landP : null;

  const area = (m2?: number | string | null) => {
    const v = typeof m2 === "string" ? parseFloat(m2) : m2;
    if (v == null || Number.isNaN(v)) return "—";
    return unit === "py" ? `${(v / P).toFixed(1)}평` : `${v.toLocaleString(undefined, { maximumFractionDigits: 20 })}㎡`;   // ㎡=원값 그대로
  };
  const eok = (n?: number | null) => (n == null ? "—" : n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${Math.round(n / 1e4).toLocaleString()}만`);

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
          {metric("매매가", price ? <>{eok(price)}{priceIsEst && <small style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}> 추정</small>}</> : "—")}
          {metric("수익률(만실)", roiNow ? `${roiNow.toFixed(1)}%` : "—")}
          {metric("평단가(대지)", pricePerLand ? eok(pricePerLand) : "—")}
          {metric("면적 (평)", `${landP ? landP.toFixed(1) : "—"} / ${totalP ? totalP.toFixed(1) : "—"} / —`)}
          {metric("층수", `B${b.floors_below ?? "—"}F/${b.floors_above ?? "—"}F`)}
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
                <KV label="매매가" field="sale_price" value={price != null ? `${eok(price)}${priceIsEst ? " (추정)" : ""}` : "—"}
                  editable current={price != null ? +(price / 1e8).toFixed(2) : ""} parse={(v) => String(Math.round(parseFloat(v) * 1e8))} validate={vPos}
                  onSave={onSave} onRevert={onRevert} />
                <KV label="수익률(만실)" value={roiNow ? `${roiNow.toFixed(2)}%` : "—"} calc />
                <KV label="대지 평단가" value={pricePerLand ? eok(pricePerLand) : "—"} calc />
                <KV label="연면적 평단가" value={price && totalP ? eok(price / totalP) : "—"} calc />
                <KV label="총보증금" value={total ? eok(total.deposit) : "—"} />
                <KV label="총임대료" value={total ? eok(total.rent) : "—"} />
                <KV label="총관리비" value={total ? eok(total.maintenance) : "—"} />
                <KV label="총공실" value={total ? (total.vacant_count > 0 ? `${total.vacant_count}실` : "없음") : "—"} />
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
              <div className="sec-head">상세정보 <small style={{ color: "var(--muted)", fontWeight: 400 }}>사적 판단 태그 · 선택 즉시 저장</small></div>
              <div className="kv-grid">
                {([["명도", "meongdo"], ["입지", "ipji"], ["용도변경", "use_change"],
                   ["등급", "grade"], ["멸실", "myeolsil"], ["노후도", "nohudo"], ["건물용도", "building_use"]] as const).map(([lbl, f]) => (
                  <EnumField key={f} label={lbl} enumKey={f} value={b[f] as string}
                    onSave={(v) => editField.mutate({ field: f, value: v })} />
                ))}
              </div>
            </div>
          )}

          {/* 건물정보(§3.6) */}
          {show("land") && (
            <div className="panel">
              <div className="sec-head">건물정보 <small style={{ color: "var(--muted)", fontWeight: 400 }}>값 클릭 = 수정 · ↺ = 되돌리기</small></div>
              <div className="kv-grid">
                <KV label="대지면적" field="land_area" value={area(b.land_area)} editable current={areaSeed(b.land_area)} parse={areaParse} validate={vPos} onSave={onSave} onRevert={onRevert} />
                <KV label="연면적" field="total_area" value={area(b.total_area)} editable current={areaSeed(b.total_area)} parse={areaParse} validate={vPos} onSave={onSave} onRevert={onRevert} />
                <KV label="건축면적" field="build_area" value={area(b.build_area)} editable current={areaSeed(b.build_area)} parse={areaParse} validate={vPos} onSave={onSave} onRevert={onRevert} />
                <KV label="지상 층수" field="floors_above" value={b.floors_above ?? "—"} unit="층" editable current={b.floors_above} validate={vNonNeg} onSave={onSave} onRevert={onRevert} />
                <KV label="지하 층수" field="floors_below" value={b.floors_below ?? "—"} unit="층" editable current={b.floors_below} validate={vNonNeg} onSave={onSave} onRevert={onRevert} />
                <KV label="주용도" value={String(b.main_use_name ?? "—")} />
                <KV label="기타용도" field="etc_use" value={String(b.etc_use ?? "—")} editable current={b.etc_use} onSave={onSave} onRevert={onRevert} />
                <KV label="구조" field="structure" value={String(b.structure ?? "—")} editable current={b.structure} onSave={onSave} onRevert={onRevert} />
                <KV label="건폐율" field="bcr" value={b.bcr ?? "—"} unit="%" editable validate={vRate100} current={b.bcr} onSave={onSave} onRevert={onRevert} />
                <KV label="용적률" field="far" value={b.far ?? "—"} unit="%" editable validate={vNonNeg} current={b.far} onSave={onSave} onRevert={onRevert} />
                <KV label="사용승인일" field="approval_ymd" value={String(b.approval_ymd ?? "—")} editable current={b.approval_ymd} validate={vYmd} onSave={onSave} onRevert={onRevert} />
                <KV label="최근 대수선" field="remodel_ymd" value={String(b.remodel_ymd ?? "—")} editable current={b.remodel_ymd} validate={vYmd} onSave={onSave} onRevert={onRevert} />
              </div>
            </div>
          )}

          {/* 토지정보 · 규제 · 공시지가 = 필지 셀렉터(§3.6 · 다필지·규제 2레벨) */}
          {show("land") && <ParcelBlock pk={pk} />}

          {/* 매각·광고 시계열(§3.7) */}
          {show("deal") && (
            <SeriesBlock title="실거래가" color="var(--c-real)" unitLabel="실거래가"
              points={(b.sales_history ?? []).map((s: { ym: string; price: number }) => ({ x: `${s.ym.slice(0, 4)}/${s.ym.slice(4)}`, y: s.price }))}
              fmt={(v) => eok(v)} />
          )}
          {show("deal") && (
            <SeriesBlock title="광고" color="var(--c-ad)" dashed unitLabel="광고가"
              points={adSeries} fmt={(v) => eok(v)}
              extra={<AdInput pk={pk} refresh={() => qc.invalidateQueries({ queryKey: ["ads", pk] })} />} />
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
                <KV label="유동인구 (수기)" field="float_pop" value={String(b.float_pop ?? "미지정")} editable current={b.float_pop} onSave={onSave} onRevert={onRevert} />
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
        <span><input className="input" style={{ maxWidth: 100, padding: "3px 8px", textAlign: "right" }} placeholder="50" value={equity} onChange={(e) => setEquity(e.target.value)} /> 억</span></div>
      <div className="kv"><span className="k">대출 이자(월)</span>
        <span><input className="input" style={{ maxWidth: 100, padding: "3px 8px", textAlign: "right" }} placeholder="1,600" value={interest} onChange={(e) => setInterest(e.target.value)} /> 만</span></div>
      <div className="kv"><span className="k">자기자본 수익률</span>
        <span className="v num" style={{ color: "var(--signal)" }}>{roe != null && price ? `${roe.toFixed(1)}%` : "—"}</span></div>
    </div>
  );
}

/* 층별임대 표 + 호실 추가·공실 토글 */
function RentTable({ pk, items, total, unit, refresh, eok }: {
  pk: string; items: FloorRent[]; total?: Record<string, number>; unit: "py" | "m2"; refresh: () => void;
  eok: (n?: number | null) => string;
}) {
  const toM2 = (v: number) => (unit === "py" ? v * P : v);           // 입력(현재단위) → 저장 ㎡
  const fromM2 = (m2: number) => (unit === "py" ? `${(m2 / P).toFixed(1)}평` : `${m2.toLocaleString()}㎡`);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ floor: "", unit_no: "", contract_area: "", deposit: "", rent: "", maintenance: "" });
  async function save() {
    if (!f.floor || !f.unit_no) { setErr("층·호실은 필수입니다"); return; }
    if (f.contract_area && parseFloat(f.contract_area) <= 0) { setErr("계약면적은 0보다 커야 합니다"); return; }
    for (const [k, lbl] of [["deposit", "보증금"], ["rent", "임대료"], ["maintenance", "관리비"]] as const) {
      if (f[k] && parseFloat(f[k]) < 0) { setErr(`${lbl}는 0 이상이어야 합니다`); return; }
    }
    setErr(null);
    await rentsApi.upsert(pk, {
      floor: f.floor, unit_no: f.unit_no,
      contract_area: f.contract_area ? toM2(parseFloat(f.contract_area)) : null,   // 저장은 ㎡(§5.3)
      deposit: Math.round((parseFloat(f.deposit) || 0) * 1e4),
      rent: Math.round((parseFloat(f.rent) || 0) * 1e4),
      maintenance: Math.round((parseFloat(f.maintenance) || 0) * 1e4),
      is_vacant: false,
    } as FloorRent);
    setF({ floor: "", unit_no: "", contract_area: "", deposit: "", rent: "", maintenance: "" });
    setAdding(false);
    refresh();
  }
  async function toggleVacant(r: FloorRent) {
    await rentsApi.upsert(pk, { ...r, is_vacant: !r.is_vacant, deposit: r.is_vacant ? r.deposit : 0, rent: r.is_vacant ? r.rent : 0 });
    refresh();
  }
  const In = (k: keyof typeof f, ph: string, w = 70) => (
    <input className="input" style={{ width: w, padding: "3px 6px", fontSize: 12 }} placeholder={ph}
      value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
  );
  return (
    <div className="panel">
      <div className="sec-head">층별 임대정보
        {err && <span style={{ color: "var(--up)", fontSize: 11, fontWeight: 400, marginLeft: 10 }}>{err}</span>}
        <button className="btn" onClick={() => { setAdding(!adding); setErr(null); }}>＋ 호실 추가</button>
      </div>
      <table className="wf">
        <thead><tr><th>층</th><th>호실</th><th className="num">계약면적({unit === "py" ? "평" : "㎡"})</th><th className="num">보증금</th><th className="num">임대료</th><th className="num">관리비</th><th>상태</th></tr></thead>
        <tbody>
          {items.map((r) => (
            <tr key={`${r.floor}-${r.unit_no}`}>
              <td>{r.floor}</td><td>{r.unit_no}</td>
              <td className="num">{r.contract_area != null ? fromM2(r.contract_area) : "—"}</td>
              <td className="num">{eok(r.deposit)}</td>
              <td className="num">{eok(r.rent)}</td>
              <td className="num">{eok(r.maintenance)}</td>
              <td><button className="btn" style={{ padding: "2px 10px", fontSize: 12, color: r.is_vacant ? "var(--up)" : "var(--green)" }}
                onClick={() => toggleVacant(r)}>{r.is_vacant ? "공실" : "임대중"}</button></td>
            </tr>
          ))}
          {adding && (
            <tr style={{ background: "var(--signal-bg)" }}>
              <td>{In("floor", "1F", 50)}</td><td>{In("unit_no", "101", 50)}</td>
              <td className="num">{In("contract_area", unit === "py" ? "평" : "㎡")}</td>
              <td className="num">{In("deposit", "만원")}</td>
              <td className="num">{In("rent", "만원")}</td>
              <td className="num">{In("maintenance", "만원")}</td>
              <td><button className="btn primary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={save}>저장</button></td>
            </tr>
          )}
          {items.length === 0 && !adding && (
            <tr><td colSpan={7} style={{ color: "var(--muted)", textAlign: "center", padding: 18 }}>임대 정보가 없습니다 — ＋ 호실 추가로 입력</td></tr>
          )}
          {total && items.length > 0 && (
            <tr style={{ background: "var(--surface-2)", fontWeight: 700 }}>
              <td colSpan={3}>합계</td>
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
function AdInput({ pk, refresh }: { pk: string; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [mine, setMine] = useState(false);
  return (
    <span style={{ position: "relative" }}>
      <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setOpen(!open)}>광고 정보 입력</button>
      {open && (
        <span style={{ position: "absolute", right: 0, top: "110%", zIndex: 30, background: "#fff", border: "1px solid var(--line-2)", borderRadius: 8, boxShadow: "var(--shadow-lg)", padding: 12, display: "grid", gap: 8, width: 210 }}>
          <input className="input" placeholder="광고가 (억)" value={price} onChange={(e) => setPrice(e.target.value)} />
          <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> 내가 낸 광고
          </label>
          <button className="btn primary" style={{ fontSize: 12 }} onClick={async () => {
            const v = parseFloat(price);
            if (!v) return;
            await extrasApi.adPriceAdd(pk, new Date().toISOString().slice(0, 10), Math.round(v * 1e8), mine);
            setPrice(""); setOpen(false); refresh();
          }}>등록 (시장 공개 정보)</button>
        </span>
      )}
    </span>
  );
}
