import { Loading } from "../../shared/ui/Spinner";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { reportsApi, CompFields, ReportComp } from "../../shared/api/endpoints";
import "./report.css";
import { Icon } from "../../shared/ui/Icon";

/* value_score 점수표 라벨(정본=백엔드) 미러 — 편집 드롭다운 옵션 */
const ROAD = ["광대소각", "광대세각", "광대로한면", "중로각지", "중로한면", "소로각지", "소로한면", "세로각지(가)", "세로한면(가)", "세로각지(불)", "세로한면(불)", "맹지"];
const ZONE = ["중심상업지역", "일반상업지역", "근린상업지역", "준주거지역", "유통상업지역", "준공업지역", "제3종일반주거지역", "제2종일반주거지역", "일반공업지역", "제1종일반주거지역", "전용공업지역", "제2종전용주거지역", "제1종전용주거지역", "자연녹지지역", "생산녹지지역", "보전녹지지역", "도시지역미지정"];
const SHAPE = ["정방형", "가로장방", "세로장방", "사다리형", "부정형", "자루형"];
const SLOPE = ["평지", "완경사", "고지", "저지", "급경사"];
const ELEV = ["있음", "없음"];
const FLOAT = ["매우높음", "높음", "보통", "낮음", "매우낮음"];

const eok = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v / 1e8).toFixed(d)}억`);

type Props = { pk: string; credits?: number; onClose: () => void; onDone: (msg: string) => void };

export function ReportModal({ pk, credits, onClose, onDone }: Props) {
  const nav = useNavigate();
  // gcTime 0: 닫을 때 캐시 폐기 — 상권(market_area) 변경 후 재오픈 시 옛 캐시가 inited 가드에
  // 잠겨 미리보기(적정가)가 이전 반경 기준으로 굳는 버그 방지. 열 때마다 서버 기준으로 신선하게.
  const { data, isLoading } = useQuery({
    queryKey: ["report-comps", pk], queryFn: () => reportsApi.comps(pk),
    gcTime: 0, refetchOnWindowFocus: false,
  });
  const [exclude, setExclude] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, CompFields>>({});
  const [includeMarket, setIncludeMarket] = useState(false);   // 기본 OFF = 검색 핀(배치)과 동일 수익률 · ON=주변임대 적용(명시적)
  const [preview, setPreview] = useState(data?.preview ?? null);
  const [compScores, setCompScores] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const inited = useRef(false);

  useEffect(() => {
    if (inited.current || !data) return;
    inited.current = true;
    setExclude(new Set(data.comps.filter((c) => c.is_outlier).map((c) => c.building_pk)));
    setPreview(data.preview);
  }, [data]);

  // 편집·제외·토글 → 350ms 디바운스 재산출(크레딧 미차감)
  useEffect(() => {
    if (!inited.current) return;
    const t = setTimeout(async () => {
      try {
        const r = await reportsApi.preview({ building_pk: pk, exclude: [...exclude], overrides, include_market: includeMarket });
        setPreview(r.preview);
        setCompScores(r.comp_scores);
      } catch { /* 미리보기 실패는 조용히 — 값 유지 */ }
    }, 350);
    return () => clearTimeout(t);
  }, [exclude, overrides, includeMarket, pk]);

  const setField = (bpk: string, k: keyof CompFields, v: string) =>
    setOverrides((o) => ({ ...o, [bpk]: { ...o[bpk], [k]: v } }));
  const resetComp = (bpk: string) => setOverrides((o) => { const n = { ...o }; delete n[bpk]; return n; });
  const toggleInc = (bpk: string) => setExclude((s) => { const n = new Set(s); n.has(bpk) ? n.delete(bpk) : n.add(bpk); return n; });
  const fval = (c: ReportComp, k: keyof CompFields) => overrides[c.building_pk]?.[k] ?? c.fields[k] ?? "";

  async function generate() {
    setBusy(true); setMsg("생성 중… 완료되면 자동 보관됩니다");
    try {
      const { report_id } = await reportsApi.create(pk, "analysis", { exclude: [...exclude], overrides, include_market: includeMarket });
      for (let i = 0; i < 60; i++) {
        const r = await reportsApi.get(report_id);
        if (r.status === "done") { onDone(`✓ 빌탐정 리포트 완료 — 내 산출물 보관 (크레딧 ${r.credits_spent})`); nav(`/reports/${report_id}`); return; }
        if (r.status === "failed") { setMsg(`실패: ${r.failed_reason ?? ""} (미차감)`); setBusy(false); return; }
        await new Promise((res) => setTimeout(res, 500));
      }
      onDone("대기 초과 — 내 산출물에서 확인하세요");
    } catch (e) { setMsg(`오류: ${String(e)}`); setBusy(false); }
  }

  const s = data?.subject;
  const nego = preview?.fair_price != null && preview?.ask_price != null ? preview.fair_price - preview.ask_price : null;

  return (
    <div className="modal-bg open" onClick={() => !busy && onClose()}>
      <div className="rmodal" onClick={(e) => e.stopPropagation()}>
        <div className="rm-head">
          <h2>빌탐정 리포트 · 검토</h2>
          <span className="addr">{s?.addr ?? ""}</span>
          <button className="rm-x" disabled={busy} onClick={onClose}><Icon name="close" size={16} /></button>
        </div>

        {isLoading || !data || !s ? (
          <Loading label="주변 사례 불러오는 중" minHeight={220} />
        ) : (
          <div className="rm-body">
            {/* 상권 지도(읽기전용) */}
            <div className="zone-area">
              <ZoneMap subject={s} comps={data.comps} rentPins={data.rent_pins} />
              <div className="zone-cap">
                중심 본매물 · {s.polygon ? "그린 영역" : <>반경 <b>{s.radius_m}m</b></>} · 실거래 <b>{data.counts.sale}</b>건 · 임대 <b>{data.counts.rent}</b>건
                <small>영역·반경은 매물 상세(S02)에서 설정</small>
              </div>
            </div>

            {/* 좌: 주변 실거래사례 + 주변임대 */}
            <div>
              <div className="rsec">
                <div className="rsec-h">주변 실거래사례 <small>행 클릭 → 가치점수 입력 편집</small></div>
                <div className="cmp-list">
                  <div className="cmp-main" style={{ cursor: "default", color: "var(--muted)", fontWeight: 600, borderBottom: "1px solid var(--line-2)" }}>
                    <span>포함</span><span>주소</span><span className="num">거리</span><span className="num">실거래가</span><span className="num">평단가</span><span></span>
                  </div>
                  {data.comps.map((c) => {
                    const inc = !exclude.has(c.building_pk);
                    const sc = compScores[c.building_pk] ?? c.score;
                    const isOpen = open === c.building_pk;
                    return (
                      <div key={c.building_pk} className={`cmp-row${isOpen ? " open" : ""}${inc ? "" : " off"}`}>
                        <div className="cmp-main" onClick={() => setOpen(isOpen ? null : c.building_pk)}>
                          <span onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={inc} onChange={() => toggleInc(c.building_pk)} /></span>
                          <span className="addr">{c.addr.replace("서울특별시 ", "")}{c.is_outlier && <span className="badge-out">이상치</span>}</span>
                          <span className="num">{Math.round(c.dist_m)}m</span>
                          <span className="num">{eok(c.price, 0)}</span>
                          <span className="num">{eok(c.per_area, 2)}</span>
                          <span className="exp">▸</span>
                        </div>
                        {isOpen && (
                          <div className="cmp-edit">
                            <Sel label="도로접면" opts={ROAD} v={fval(c, "road_frontage") as string} on={(v) => setField(c.building_pk, "road_frontage", v)} />
                            <Inp label="역과의거리(m)" v={String(fval(c, "station_dist") ?? "")} on={(v) => setField(c.building_pk, "station_dist", v.replace(/[^0-9]/g, ""))} />
                            <Sel label="용도지역" opts={ZONE} v={firstZone(fval(c, "use_zone") as string)} on={(v) => setField(c.building_pk, "use_zone", v)} full />
                            <Sel label="지형형상" opts={SHAPE} v={fval(c, "shape") as string} on={(v) => setField(c.building_pk, "shape", v)} />
                            <Inp label="사용승인일(YYYY/MM)" v={String(fval(c, "approval_ym") ?? "")} on={(v) => setField(c.building_pk, "approval_ym", v)} />
                            <Sel label="엘리베이터" opts={ELEV} v={fval(c, "elevator") as string} on={(v) => setField(c.building_pk, "elevator", v)} />
                            <Inp label="대수선(YYYY/MM·없음)" v={String(fval(c, "remodel_ym") ?? "")} on={(v) => setField(c.building_pk, "remodel_ym", v)} />
                            <Sel label="경사도" opts={SLOPE} v={fval(c, "slope") as string} on={(v) => setField(c.building_pk, "slope", v)} />
                            <div className="f">
                              <label>유동인구
                                <i className="info-i">i<span className="info-pop">도로접면·역거리 기반 <b>시스템 추정값</b>입니다. 가치점수에는 반영되지 않으며, 실제와 다르면 참고용으로만 조정하세요.</span></i>
                              </label>
                              <select value={(fval(c, "float_pop") as string) || "보통"} onChange={(e) => setField(c.building_pk, "float_pop", e.target.value)}>
                                {FLOAT.map((o) => <option key={o}>{o}</option>)}
                              </select>
                            </div>
                            <div className="foot">
                              <span style={{ marginRight: "auto", fontSize: 12, color: "var(--muted)" }}>가치점수 <b style={{ fontFamily: "var(--mono)", color: "var(--signal-ink)", fontSize: 14 }}>{sc}</b></span>
                              <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => resetComp(c.building_pk)}>이 매물 초기화</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {data.comps.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>영역 내 최근 5년 매각사례 없음</div>}
                </div>
              </div>

              <div className="rsec">
                <div className="rsec-h">주변임대시세</div>
                <div style={{ padding: "11px 13px", fontSize: 13 }}>
                  <label className="toggle"><input type="checkbox" checked={includeMarket} onChange={(e) => setIncludeMarket(e.target.checked)} /> 주변임대시세 포함 (예상수익률 산출)</label>
                </div>
              </div>
            </div>

            {/* 우: 실시간 미리보기 + 크레딧 */}
            <div className="rcol">
              <div className="preview">
                <div className="ph">실시간 산출 미리보기</div>
                <div className="pv-row"><span className="k">가치점수</span><span className="v">{preview?.score ?? "—"}<span className="pv-grade">{preview?.grade ?? ""}</span></span></div>
                <div className="pv-row"><span className="k">매도희망가</span><span className="v">{eok(preview?.ask_price)}</span></div>
                <div className="pv-row"><span className="k">적정매매가</span><span className="v">{eok(preview?.fair_price)}</span></div>
                <div className="pv-row"><span className="k">협의 필요금액</span><span className="v" style={{ color: nego != null && nego < 0 ? "var(--down)" : "var(--up)" }}>{nego == null ? "—" : `${nego < 0 ? "−" : "+"}${eok(Math.abs(nego))}`}</span></div>
                <div className="pv-row"><span className="k">예상수익률</span><span className="v">{preview?.expected_roi ?? "—"}<small>%</small></span></div>
              </div>
              <div className="credit-box">
                <div className="cb-h">크레딧</div>
                <div className="cb-row"><span className="k">현재 보유 크레딧</span><span className="num">{credits ?? "…"}</span></div>
                <div className="cb-row"><span className="k">차감 예정 <small>빌탐정 리포트</small></span><span className="num minus">−30</span></div>
                <div className="cb-row total"><span className="k">예상 잔여 크레딧</span><span className="num">{credits != null ? credits - 30 : "…"}</span></div>
              </div>
            </div>
          </div>
        )}

        <div className="rm-foot">
          <span className="note">{msg ?? "본매물 값은 매물 상세(S02)에서 편집 · 여기선 주변사례를 조정합니다"}</span>
          <button className="btn" disabled={busy} onClick={onClose}>취소</button>
          <button className="btn primary" disabled={busy || !data} onClick={generate}>{busy ? "생성 중…" : "생성 확정 (크레딧 30)"}</button>
        </div>
      </div>
    </div>
  );
}

const firstZone = (v: string) => (v || "").split("%")[0].replace(/[0-9\s+]+$/, "").trim() || v;

function Sel({ label, opts, v, on, full }: { label: string; opts: string[]; v: string; on: (v: string) => void; full?: boolean }) {
  const has = opts.includes(v);
  return (
    <div className={`f${full ? " zone-multi" : ""}`}>
      <label>{label}</label>
      <select value={has ? v : ""} onChange={(e) => on(e.target.value)}>
        {!has && <option value="">미지정</option>}
        {opts.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}
function Inp({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return <div className="f"><label>{label}</label><input value={v} onChange={(e) => on(e.target.value)} /></div>;
}

type Subject = { center: { lng: number; lat: number } | null; radius_m: number; polygon: boolean };

/* 상권 미니맵 — 미터공간 SVG viewBox로 자동 스케일(반경=원, 폴리곤=최대거리). 읽기전용. */
function ZoneMap({ subject, comps, rentPins }: { subject: Subject; comps: ReportComp[]; rentPins: { lng: number; lat: number }[] }) {
  const c = subject.center;
  const R = useMemo(() => {
    if (!subject.polygon) return subject.radius_m;
    const maxD = Math.max(100, ...comps.map((x) => x.dist_m), ...rentPins.map(() => 0));
    return maxD * 1.15;
  }, [subject, comps, rentPins]);
  if (!c) return <div className="zone-map" />;
  const toR = Math.PI / 180;
  const proj = (lng: number, lat: number): [number, number] => [
    (lng - c.lng) * Math.cos(c.lat * toR) * 111320,
    -(lat - c.lat) * 111320,
  ];
  const pinR = R * 0.018, cross = R * 0.9;
  return (
    <div className="zone-map">
      <svg width="100%" height="100%" viewBox={`${-cross} ${-cross} ${2 * cross} ${2 * cross}`} preserveAspectRatio="xMidYMid meet">
        {!subject.polygon && <circle cx={0} cy={0} r={subject.radius_m} fill="rgba(30,90,240,.06)" stroke="var(--signal)" strokeWidth={R * 0.006} strokeDasharray={`${R * 0.03} ${R * 0.02}`} />}
        {rentPins.map((p, i) => { const [x, y] = proj(p.lng, p.lat); return <circle key={`r${i}`} cx={x} cy={y} r={pinR} fill="#0E805B" stroke="#fff" strokeWidth={pinR * 0.35} />; })}
        {comps.map((p) => { const [x, y] = proj(p.lng, p.lat); return <circle key={p.building_pk} cx={x} cy={y} r={pinR} fill="#C2571C" stroke="#fff" strokeWidth={pinR * 0.35} />; })}
        <circle cx={0} cy={0} r={pinR * 1.25} fill="#262320" stroke="#fff" strokeWidth={pinR * 0.4} />
      </svg>
      <div className="zm-legend"><span><b style={{ background: "#C2571C" }} />실거래사례</span><span><b style={{ background: "#0E805B" }} />임대사례</span></div>
    </div>
  );
}
