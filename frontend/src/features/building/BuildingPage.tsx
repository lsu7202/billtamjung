import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  buildingsApi, overlaysApi, rentsApi, reportsApi, extrasApi, FloorRent,
} from "../../shared/api/endpoints";

const won = (n?: number) => (n == null ? "—" : n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${(n / 1e4).toLocaleString()}만`);

/** S02 매물 상세 — 병합값 표시 · 인라인 수정(자동저장) · 층별임대 · 보고서 생성 */
export function BuildingPage() {
  const { pk = "" } = useParams();
  const qc = useQueryClient();

  const building = useQuery({ queryKey: ["building", pk], queryFn: () => buildingsApi.get(pk) });
  const rents = useQuery({ queryKey: ["rents", pk], queryFn: () => rentsApi.list(pk) });
  const wiki = useQuery({ queryKey: ["wiki", pk], queryFn: () => extrasApi.wikiList(pk) });

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
    setGenState("생성 중…");
    const { report_id } = await reportsApi.create(pk, kind);
    for (let i = 0; i < 40; i++) {
      const r = await reportsApi.get(report_id);
      if (r.status === "done") { setGenState(`완료 — 내 산출물 자동 보관됨 (크레딧 ${r.credits_spent} 소모)`); qc.invalidateQueries({ queryKey: ["credits"] }); return; }
      if (r.status === "failed") { setGenState(`실패: ${r.failed_reason ?? ""} (크레딧 미차감)`); return; }
      await new Promise((res) => setTimeout(res, 500));
    }
    setGenState("대기 초과 — 내 산출물에서 확인하세요");
  }

  if (building.isLoading) return <p>불러오는 중…</p>;
  if (building.isError) return <p>건물을 찾을 수 없습니다</p>;
  const b = building.data as Record<string, string | number | null>;

  // 인라인 수정 가능한 공공 필드(레지스트리 editable — far 예시)
  function EditableKV({ label, field, unit }: { label: string; field: string; unit?: string }) {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(String(b[field] ?? ""));
    return (
      <div className="kv">
        <span className="k">{label}</span>
        {editing ? (
          <input
            className="input" style={{ maxWidth: 120, padding: "3px 8px" }} autoFocus value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => { setEditing(false); if (val !== String(b[field] ?? "")) editField.mutate({ field, value: val }); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
          />
        ) : (
          <span className="v" style={{ cursor: "pointer" }} onClick={() => { setVal(String(b[field] ?? "")); setEditing(true); }} title="클릭 = 수정(자동저장)">
            {b[field] ?? "—"}{unit}
            <button className="btn" style={{ marginLeft: 6, padding: "0 6px", fontSize: 11 }}
              onClick={(e) => { e.stopPropagation(); revert.mutate(field); }} title="마스터 원본으로 되돌리기">↺</button>
          </span>
        )}
      </div>
    );
  }

  const total = rents.data?.total;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* 헤더 */}
      <div className="panel" style={{ padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>
          {b.addr}
          <button className="btn" style={{ marginLeft: 10 }} onClick={() => extrasApi.favToggle(pk)}>★</button>
        </h2>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" onClick={() => generate("briefing")}>브리핑 자료 (10)</button>
          <button className="btn primary" onClick={() => generate("analysis")}>매물 분석하기 (30)</button>
        </div>
      </div>
      {genState && <div className="panel" style={{ padding: "10px 16px", fontSize: 13 }}>{genState}</div>}

      {/* 건물정보(인라인 수정 데모: far) */}
      <div className="panel">
        <div className="sec-head">건물정보 <small style={{ color: "var(--muted)", fontWeight: 400 }}>값 클릭 = 수정 · ↺ = 되돌리기</small></div>
        <div className="kv-grid">
          <div className="kv"><span className="k">대지면적</span><span className="v num">{b.land_area ?? "—"}㎡</span></div>
          <div className="kv"><span className="k">연면적</span><span className="v num">{b.total_area ?? "—"}㎡</span></div>
          <div className="kv"><span className="k">층수</span><span className="v">지상 {b.floors_above ?? "—"} · 지하 {b.floors_below ?? "—"}</span></div>
          <EditableKV label="용적률" field="far" unit="%" />
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
                <td className="num">{won(r.deposit)}</td>
                <td className="num">{won(r.rent)}</td>
                <td className="num">{won(r.maintenance)}</td>
                <td>{r.is_vacant ? "공실" : "임대중"}</td>
              </tr>
            ))}
            {total && (
              <tr style={{ background: "var(--surface-2)", fontWeight: 700 }}>
                <td colSpan={3}>합계</td>
                <td className="num">{won(total.deposit)}</td>
                <td className="num">{won(total.rent)}</td>
                <td className="num">{won(total.maintenance)}</td>
                <td>공실 {total.vacant_count}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 위키 */}
      <div className="panel">
        <div className="sec-head">위키 · 집단지성 특이사항</div>
        <div style={{ padding: "0 14px 14px" }}>
          {(wiki.data ?? []).map((w) => (
            <div key={String(w.id)} style={{ borderTop: "1px solid var(--line)", padding: "8px 0", fontSize: 13 }}>
              <b style={{ color: "var(--signal)" }}>{String(w.category ?? "일반")}</b> {String(w.body)}
              <span style={{ color: "var(--muted)", marginLeft: 8 }}>👍 {String(w.votes)}</span>
            </div>
          ))}
          {(wiki.data ?? []).length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>아직 등록된 특이사항이 없습니다</p>}
        </div>
      </div>
    </div>
  );
}
