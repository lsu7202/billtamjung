import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { SeriesBlock } from "./SeriesBlock";

/** 필지 셀렉터(S02 §3.6) — 다필지 탭 전환 · 토지/규제/공시지가가 선택 필지 값으로 · 건물 요약(OR 집계).
 * 규제 2레벨: 건물 요약(전 필지 OR) + 필지 상세.
 */
interface Parcel {
  role: string; pnu: string; area: number | null;
  jimok?: string; land_use?: string; slope?: string; shape?: string; road_frontage?: string;
  use_zone?: string; legal_bcr?: string; legal_far?: string; gongsi_latest?: number | null;
  gongsi_series: [number, number][];
  regs: Record<string, string>;
}
interface ParcelsResp { parcels: Parcel[]; reg_summary: Record<string, string>; count: number }

const REG_ALL = ["고도지구", "지구단위계획", "정비구역", "경관지구", "방화지구", "문화재보존"];
const eok = (n?: number | null) => (n == null ? "—" : `${(n / 1e8).toFixed(1)}억`);
const man = (n?: number | null) => (n == null ? "—" : `${Math.round(n / 1e4).toLocaleString()}만/㎡`);

export function ParcelBlock({ pk }: { pk: string }) {
  const [sel, setSel] = useState(0);
  const q = useQuery<ParcelsResp>({
    queryKey: ["parcels", pk],
    queryFn: () => api<ParcelsResp>(`/buildings/${pk}/parcels`),
  });
  const parcels = q.data?.parcels ?? [];
  const p = parcels[sel];

  const totalGongsi = useMemo(() => {
    if (!p?.gongsi_latest || !p.area) return null;
    return p.gongsi_latest * p.area;   // 총공시지가 = 단가 × 그 필지 면적(합산 아님)
  }, [p]);

  if (q.isLoading) return null;
  if (parcels.length === 0) return null;

  const summary = q.data?.reg_summary ?? {};
  const applied = Object.keys(summary);

  return (
    <div className="panel">
      <div className="sec-head">토지정보 · 규제
        <small style={{ color: "var(--muted)", fontWeight: 400 }}>
          {parcels.length > 1 ? `다필지 ${parcels.length}개 · 필지별 값(합산 안 함)` : "단일 필지"}
        </small>
      </div>

      {/* 필지 탭(다필지) */}
      {parcels.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 14px 10px" }}>
          {parcels.map((pc, i) => (
            <button key={pc.pnu} className={`btn ${i === sel ? "primary" : ""}`} style={{ fontSize: 12, padding: "4px 10px" }}
              onClick={() => setSel(i)}>
              {pc.pnu.slice(-8)}{pc.role === "대표" && <span style={{ opacity: .7, marginLeft: 4 }}>대표</span>}
            </button>
          ))}
        </div>
      )}

      {/* 토지정보(선택 필지) */}
      <div className="kv-grid">
        <div className="kv"><span className="k">지목</span><span className="v">{p.jimok ?? "—"}</span></div>
        <div className="kv"><span className="k">토지면적</span><span className="v num">{p.area ? `${p.area.toLocaleString()}㎡` : "—"}</span></div>
        <div className="kv"><span className="k">용도지역</span><span className="v">{p.use_zone ?? "—"}</span></div>
        <div className="kv"><span className="k">토지이용상황</span><span className="v">{p.land_use ?? "—"}</span></div>
        <div className="kv"><span className="k">지형형상</span><span className="v">{p.shape ?? "—"}</span></div>
        <div className="kv"><span className="k">도로접면</span><span className="v">{p.road_frontage ?? "—"}</span></div>
        <div className="kv"><span className="k">법정 건폐/용적</span><span className="v num">{p.legal_bcr ?? "—"} / {p.legal_far ?? "—"}</span></div>
        <div className="kv"><span className="k">지세</span><span className="v">{p.slope ?? "—"}</span></div>
      </div>

      {/* 규제 2레벨: 건물 요약(OR 집계) + 필지 상세 */}
      <div className="sec-head" style={{ fontSize: 13 }}>규제·특례</div>
      <div style={{ padding: "0 14px 8px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, marginRight: 2 }}>건물 요약</span>
        {applied.length === 0
          ? <span style={{ color: "var(--green)", fontSize: 12, fontWeight: 700 }}>규제 사항 없음 — 전 필지 해당 없음</span>
          : <>
            {applied.map((k) => <span key={k} className="tag stale" title={summary[k]}>{k}</span>)}
            <span style={{ color: "var(--muted)", fontSize: 12 }}>· 그 외 해당 없음</span>
          </>}
      </div>
      <div className="kv-grid" style={{ paddingTop: 0 }}>
        {REG_ALL.map((r) => (
          <div key={r} className="kv"><span className="k">{r}</span>
            <span className="v" style={p.regs[r] ? { color: "var(--up)" } : { color: "var(--muted)" }}>
              {p.regs[r] ?? "해당 없음"}
            </span></div>
        ))}
      </div>

      {/* 공시지가(선택 필지) 시계열 + 총공시지가 */}
      <div style={{ borderTop: "1px solid var(--line)" }}>
        <SeriesBlock title="공시지가" color="#1E5AF0" unitLabel="원/㎡"
          points={p.gongsi_series.map(([y, v]) => ({ x: String(y), y: v }))}
          fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}만`} />
      </div>
      <div className="kv-grid" style={{ paddingTop: 0 }}>
        <div className="kv"><span className="k">최신 공시지가</span><span className="v num" style={{ color: "var(--signal)" }}>{man(p.gongsi_latest)}</span></div>
        <div className="kv"><span className="k">총공시지가</span><span className="v num" style={{ color: "var(--signal)" }}>{eok(totalGongsi)} <small style={{ color: "var(--muted)", fontWeight: 400 }}>= 단가 × {p.area ?? "—"}㎡</small></span></div>
      </div>
    </div>
  );
}
