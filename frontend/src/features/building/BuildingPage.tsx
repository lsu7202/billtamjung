import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  buildingsApi, overlaysApi, rentsApi, reportsApi, extrasApi, listingsApi, FloorRent,
} from "../../shared/api/endpoints";
import { PhotoPanel } from "../../shared/map/PhotoPanel";

/** S02 매물 상세 — 목업 구조: 헤더 지표 · 사진패널 · 금액/건물/토지정보 · 시계열 · 우측 탭 사이드바 */

const wonEok = (n?: number | string | null) => {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (v == null || Number.isNaN(v)) return "—";
  return v >= 1e8 ? `${(v / 1e8).toFixed(v >= 1e10 ? 0 : 1)}억` : `${Math.round(v / 1e4).toLocaleString()}만`;
};
const num = (n?: number | string | null, unit = "") => {
  const v = typeof n === "string" ? parseFloat(n) : n;
  return v == null || Number.isNaN(v) ? "—" : `${v.toLocaleString()}${unit}`;
};
const P = 3.305785;  // ㎡→평

export function BuildingPage() {
  const { pk = "" } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"biz" | "wiki" | "memo">("biz");

  const building = useQuery({ queryKey: ["building", pk], queryFn: () => buildingsApi.get(pk) });
  const rents = useQuery({ queryKey: ["rents", pk], queryFn: () => rentsApi.list(pk) });
  const wiki = useQuery({ queryKey: ["wiki", pk], queryFn: () => extrasApi.wikiList(pk) });
  const listing = useQuery({ queryKey: ["listing", pk], queryFn: () => listingsApi.get(pk) });
  const memos = useQuery({ queryKey: ["memos", pk], queryFn: () => extrasApi.memoList(pk) });

  const editField = useMutation({
    mutationFn: ({ field, value }: { field: string; value: string }) => overlaysApi.put(pk, field, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["building", pk] }),
  });
  const revert = useMutation({
    mutationFn: (field: string) => overlaysApi.revert(pk, field),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["building", pk] }),
  });

  const [genState, setGenState] = useState<string | null>(null);
  async function generate(kind: "briefing" | "analysis") {
    setGenState("생성 중… 완료되면 자동 보관됩니다");
    const { report_id } = await reportsApi.create(pk, kind);
    for (let i = 0; i < 40; i++) {
      const r = await reportsApi.get(report_id);
      if (r.status === "done") { setGenState(`✓ 완료 — 내 산출물 보관 (크레딧 ${r.credits_spent})`); qc.invalidateQueries({ queryKey: ["credits"] }); return; }
      if (r.status === "failed") { setGenState(`실패: ${r.failed_reason ?? ""} (미차감)`); return; }
      await new Promise((res) => setTimeout(res, 500));
    }
    setGenState("대기 초과 — 내 산출물에서 확인");
  }

  if (building.isLoading) return <p>불러오는 중…</p>;
  if (building.isError) return <p>건물을 찾을 수 없습니다</p>;
  const b = building.data as Record<string, string | number | null>;
  const total = rents.data?.total;

  const landP = b.land_area ? (Number(b.land_area) / P) : null;
  const totalP = b.total_area ? (Number(b.total_area) / P) : null;
  const pricePerLandP = b.last_sale_price && landP ? Number(b.last_sale_price) / landP : null;

  function KV({ label, field, value, unit, editable }: { label: string; field?: string; value: React.ReactNode; unit?: string; editable?: boolean }) {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState("");
    if (editable && field && editing) {
      return (
        <div className="kv"><span className="k">{label}</span>
          <input className="input" style={{ maxWidth: 120, padding: "3px 8px" }} autoFocus value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => { setEditing(false); if (val) editField.mutate({ field, value: val }); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }} />
        </div>
      );
    }
    return (
      <div className="kv"><span className="k">{label}</span>
        <span className="v num" style={editable ? { cursor: "pointer" } : undefined}
          onClick={editable && field ? () => { setVal(String(b[field] ?? "")); setEditing(true); } : undefined}
          title={editable ? "클릭 = 수정(자동저장)" : undefined}>
          {value}{unit}
          {editable && field && (
            <button className="btn" style={{ marginLeft: 6, padding: "0 6px", fontSize: 11 }}
              onClick={(e) => { e.stopPropagation(); revert.mutate(field); }} title="마스터 원본으로 되돌리기">↺</button>
          )}
        </span>
      </div>
    );
  }

  const metric = (k: string, v: React.ReactNode) => (
    <div style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 13px", minWidth: 84, textAlign: "right" }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{k}</div>
      <div className="num" style={{ fontSize: 15, fontWeight: 800 }}>{v}</div>
    </div>
  );

  const tabBtn = (t: typeof tab, label: string) => (
    <button key={t} onClick={() => setTab(t)} style={{
      flex: 1, border: 0, background: "none", padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: "pointer",
      color: tab === t ? "var(--signal)" : "var(--muted)",
      borderBottom: tab === t ? "2px solid var(--signal)" : "2px solid var(--line)",
    }}>{label}</button>
  );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* 헤더: 주소 + 대표지표(목업 hdr-metrics) */}
      <div className="panel" style={{ padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>
            {b.addr}
            <button className="btn" style={{ marginLeft: 10 }} onClick={() => extrasApi.favToggle(pk)}>★</button>
          </h2>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            {String(b.road_addr ?? "")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {metric("최근 매각", b.last_sale_price ? `${wonEok(b.last_sale_price)}` : "—")}
          {metric("평단가(대지)", pricePerLandP ? wonEok(pricePerLandP) : "—")}
          {metric("면적(평)", `${landP ? landP.toFixed(1) : "—"} / ${totalP ? totalP.toFixed(1) : "—"}`)}
          {metric("층수", `${b.floors_above ?? "—"}F/B${b.floors_below ?? "—"}`)}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" onClick={() => generate("briefing")}>브리핑 자료 (10)</button>
          <button className="btn primary" onClick={() => generate("analysis")}>매물 분석하기 (30)</button>
        </div>
      </div>
      {genState && <div className="panel" style={{ padding: "10px 16px", fontSize: 13 }}>{genState}</div>}

      {/* 본문 2단: 좌 메인 + 우 사이드바(목업 detail-body) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 14 }}>
          {typeof b.lng === "number" && typeof b.lat === "number" && (
            <PhotoPanel lng={b.lng as number} lat={b.lat as number} />
          )}

          {/* 금액정보 */}
          <div className="panel">
            <div className="sec-head">금액정보</div>
            <div className="kv-grid">
              <KV label="최근 매각액" value={wonEok(b.last_sale_price)} />
              <KV label="매각 시점" value={b.last_sale_ym ? `${String(b.last_sale_ym).slice(0, 4)}/${String(b.last_sale_ym).slice(4)}` : "—"} />
              <KV label="총보증금" value={total ? wonEok(total.deposit) : "—"} />
              <KV label="총임대료" value={total ? wonEok(total.rent) : "—"} />
              <KV label="총관리비" value={total ? wonEok(total.maintenance) : "—"} />
              <KV label="총공실" value={total ? (total.vacant_count > 0 ? `${total.vacant_count}실` : "없음") : "—"} />
            </div>
          </div>

          {/* 건물정보(실필드 · 클릭 수정) */}
          <div className="panel">
            <div className="sec-head">건물정보 <small style={{ color: "var(--muted)", fontWeight: 400 }}>값 클릭 = 수정 · ↺ = 되돌리기</small></div>
            <div className="kv-grid">
              <KV label="대지면적" value={`${num(b.land_area)}㎡ (${landP?.toFixed(1) ?? "—"}평)`} />
              <KV label="연면적" value={`${num(b.total_area)}㎡ (${totalP?.toFixed(1) ?? "—"}평)`} />
              <KV label="층수" value={`지상 ${b.floors_above ?? "—"} · 지하 ${b.floors_below ?? "—"}`} />
              <KV label="주용도" value={String(b.main_use_name ?? "—")} />
              <KV label="기타용도" value={String(b.etc_use ?? "—")} />
              <KV label="구조" value={String(b.structure ?? "—")} />
              <KV label="건폐율" field="bcr" value={num(b.bcr)} unit="%" editable />
              <KV label="용적률" field="far" value={num(b.far)} unit="%" editable />
              <KV label="사용승인일" value={String(b.approval_ymd ?? "—")} />
              <KV label="최근 대수선" value={String(b.remodel_ymd ?? "—")} />
            </div>
          </div>

          {/* 토지정보 */}
          <div className="panel">
            <div className="sec-head">토지정보</div>
            <div className="kv-grid">
              <KV label="지목" value={String(b.jimok ?? "—")} />
              <KV label="토지면적" value={`${num(b.parcel_area)}㎡`} />
              <KV label="용도지역" value={String(b.use_zone ?? "—")} />
              <KV label="토지이용상황" value={String(b.land_use ?? "—")} />
              <KV label="지형형상" value={String(b.shape ?? "—")} />
              <KV label="지세" value={String(b.slope ?? "—")} />
              <KV label="도로접면" value={String(b.road_frontage ?? "—")} />
              <KV label="역과의거리" value={b.station_dist != null ? `${num(b.station_dist)}m` : "—"} />
              <KV label="최신 공시지가" value={b.gongsi_latest ? `${Math.round(Number(b.gongsi_latest) / 1e4).toLocaleString()}만/㎡` : "—"} />
              <KV label="총공시지가" value={b.gongsi_latest && b.parcel_area ? wonEok(Number(b.gongsi_latest) * Number(b.parcel_area)) : "—"} />
            </div>
          </div>

          {/* 층별 임대정보 */}
          <div className="panel">
            <div className="sec-head">층별 임대정보</div>
            <table className="wf">
              <thead><tr><th>층</th><th>호실</th><th className="num">계약면적</th><th className="num">보증금</th><th className="num">임대료</th><th className="num">관리비</th><th>상태</th></tr></thead>
              <tbody>
                {(rents.data?.items ?? []).map((r: FloorRent) => (
                  <tr key={`${r.floor}-${r.unit_no}`}>
                    <td>{r.floor}</td><td>{r.unit_no}</td>
                    <td className="num">{r.contract_area ?? "—"}평</td>
                    <td className="num">{wonEok(r.deposit)}</td>
                    <td className="num">{wonEok(r.rent)}</td>
                    <td className="num">{wonEok(r.maintenance)}</td>
                    <td>{r.is_vacant ? "공실" : "임대중"}</td>
                  </tr>
                ))}
                {(rents.data?.items ?? []).length === 0 && (
                  <tr><td colSpan={7} style={{ color: "var(--muted)", textAlign: "center", padding: 18 }}>
                    임대 정보가 없습니다 — 조사한 층별 조건을 입력해 두세요
                  </td></tr>
                )}
                {total && (rents.data?.items ?? []).length > 0 && (
                  <tr style={{ background: "var(--surface-2)", fontWeight: 700 }}>
                    <td colSpan={3}>합계</td>
                    <td className="num">{wonEok(total.deposit)}</td>
                    <td className="num">{wonEok(total.rent)}</td>
                    <td className="num">{wonEok(total.maintenance)}</td>
                    <td>공실 {total.vacant_count}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 우측 고정 사이드바: 업무/위키/메모 탭(목업 §4) */}
        <div className="panel" style={{ position: "sticky", top: 70 }}>
          <div style={{ display: "flex" }}>
            {tabBtn("biz", "업무")}{tabBtn("wiki", "위키")}{tabBtn("memo", "메모")}
          </div>
          <div style={{ padding: 14, minHeight: 260 }}>
            {tab === "biz" && (
              <BizTab pk={pk} listing={listing.data} onChange={() => qc.invalidateQueries({ queryKey: ["listing", pk] })} />
            )}
            {tab === "wiki" && (
              <div style={{ display: "grid", gap: 8 }}>
                {(wiki.data ?? []).map((w) => (
                  <div key={String(w.id)} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, fontSize: 13 }}>
                    <b style={{ color: "var(--signal)" }}>{String(w.category ?? "일반")}</b> {String(w.body)}
                    <span style={{ color: "var(--muted)", marginLeft: 6 }}>👍 {String(w.votes)}</span>
                  </div>
                ))}
                {(wiki.data ?? []).length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>등록된 특이사항이 없습니다</p>}
                <WikiForm pk={pk} onDone={() => qc.invalidateQueries({ queryKey: ["wiki", pk] })} />
              </div>
            )}
            {tab === "memo" && (
              <MemoTab pk={pk} memos={memos.data ?? []} onDone={() => qc.invalidateQueries({ queryKey: ["memos", pk] })} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* 업무 탭: 담당자 지정(=선점)·진행상태 */
function BizTab({ pk, listing, onChange }: { pk: string; listing?: Record<string, unknown>; onChange: () => void }) {
  const registered = listing?.registered === true;
  async function claim() {
    // 자기 자신 지정 — account_id는 서버가 토큰에서 알 수 없으니 /listings/claim에서 본인 확인.
    // 베타 단순화: 담당자=본인 지정 요청(assignee=me). 백엔드는 팀원 검증.
    const me = await fetch("/api/credits", { headers: authHeader() }).then(() => null);
    void me;
    await listingsApi.claim(pk, await myAccountId());
    onChange();
  }
  async function release() {
    await listingsApi.claim(pk, null);
    onChange();
  }
  return (
    <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
      <div className="kv"><span className="k">등록 상태</span>
        <span className="v">{registered ? "내 매물" : "미등록"}</span></div>
      {registered ? (
        <button className="btn" onClick={release}>등록 해제 (담당자 비우기)</button>
      ) : (
        <button className="btn primary" onClick={claim}>내 매물로 등록 (담당자 = 나)</button>
      )}
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        담당자 지정 = 매물 등록·선점. 해제해도 조사 데이터(임대·메모)는 유지됩니다.
      </p>
    </div>
  );
}

function authHeader(): Record<string, string> { return {}; }
let _me: number | null = null;
async function myAccountId(): Promise<number> {
  if (_me != null) return _me;
  const { api } = await import("../../shared/api/client");
  const r = await api<{ account_id: number }>("/auth/me");
  _me = r.account_id;
  return _me;
}

function WikiForm({ pk, onDone }: { pk: string; onDone: () => void }) {
  const [body, setBody] = useState("");
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input className="input" placeholder="특이사항 입력 (전체 공유)" value={body} onChange={(e) => setBody(e.target.value)} />
      <button className="btn" onClick={async () => { if (!body.trim()) return; await extrasApi.wikiPost(pk, body.trim()); setBody(""); onDone(); }}>등록</button>
    </div>
  );
}

function MemoTab({ pk, memos, onDone }: { pk: string; memos: Record<string, unknown>[]; onDone: () => void }) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"team" | "secret">("team");
  return (
    <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
      {memos.map((m) => (
        <div key={String(m.id)} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
          {m.kind === "secret" && <span className="tag stale" style={{ marginRight: 6 }}>비밀</span>}
          {String(m.body)}
        </div>
      ))}
      {memos.length === 0 && <p style={{ color: "var(--muted)" }}>메모가 없습니다</p>}
      <div style={{ display: "flex", gap: 6 }}>
        <select className="input" style={{ width: 84 }} value={kind} onChange={(e) => setKind(e.target.value as "team" | "secret")}>
          <option value="team">팀</option><option value="secret">비밀</option>
        </select>
        <input className="input" placeholder="메모 입력" value={body} onChange={(e) => setBody(e.target.value)} />
        <button className="btn" onClick={async () => { if (!body.trim()) return; await extrasApi.memoAdd(pk, kind, body.trim()); setBody(""); onDone(); }}>저장</button>
      </div>
    </div>
  );
}
