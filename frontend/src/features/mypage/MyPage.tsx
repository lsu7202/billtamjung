import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { creditsApi, reportsApi, savedApi } from "../../shared/api/endpoints";
import { openDetail } from "../../shared/map/geo";

/** S0M 마이페이지 — 크레딧(잔액·사용내역) · 내 산출물(stale·재생성) · 저장한 검색조건 */

const TYPE_LABEL: Record<string, string> = { grant: "지급", spend: "소비", earn: "적립", expire: "소멸", adjust: "조정" };

export function MyPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const credits = useQuery({ queryKey: ["credits"], queryFn: creditsApi.balance });
  const entries = useQuery({ queryKey: ["credit-entries"], queryFn: creditsApi.entries });
  const reports = useQuery({ queryKey: ["reports"], queryFn: reportsApi.list, refetchInterval: 3000 });
  const saved = useQuery({ queryKey: ["saved"], queryFn: savedApi.list });

  const regen = useMutation({
    mutationFn: (r: { building_pk: string; kind: "briefing" | "analysis" }) => reportsApi.create(r.building_pk, r.kind),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); qc.invalidateQueries({ queryKey: ["credits"] }); },
  });
  const delSaved = useMutation({
    mutationFn: (id: number) => savedApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved"] }),
  });

  const c = credits.data;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* 크레딧 요약 */}
      <div className="panel">
        <div className="sec-head">크레딧</div>
        <div style={{ display: "flex", gap: 30, padding: "0 14px 16px" }}>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>사용 가능 잔액</div>
            <div className="num" style={{ fontSize: 30, fontWeight: 800 }}>{c?.total ?? "…"}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>이번 달 잔여 {c?.monthly ?? 0} + 이월 {c?.earned ?? 0}</div></div>
          <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 30 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>검색</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>무제한 · 무크레딧</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>크레딧은 보고서에만 소모</div></div>
        </div>
      </div>

      {/* 내 산출물 */}
      <div className="panel">
        <div className="sec-head">내 산출물</div>
        <table className="wf">
          <thead><tr><th>생성일</th><th>종류</th><th>매물</th><th className="num">크레딧</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {(reports.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="num">{new Date(r.created_at).toLocaleDateString("ko")}</td>
                <td>{r.kind === "analysis" ? "매물분석" : "브리핑"}</td>
                <td style={{ cursor: "pointer" }} onClick={() => openDetail(r.building_pk)}>{r.addr ?? r.building_pk}</td>
                <td className="num">{r.credits_spent ?? "—"}</td>
                <td>{r.status === "done"
                  ? <span className={`tag ${r.is_stale ? "stale" : "fresh"}`}>{r.is_stale ? "데이터 변경됨" : "최신"}</span>
                  : <span style={{ color: "var(--muted)" }}>{r.status === "failed" ? "실패" : "생성 중…"}</span>}</td>
                <td style={{ textAlign: "right" }}>
                  {r.status === "done" && <>
                    {r.kind === "analysis" && <button className="btn" style={{ marginRight: 6 }}
                      onClick={() => nav(`/reports/${r.id}`)}>웹으로 보기</button>}
                    <button className="btn" style={{ marginRight: 6 }}
                      onClick={() => reportsApi.download(r.id, r.kind).catch((e) => alert(String(e.message ?? e)))}>PPT 받기</button>
                    {r.is_stale && <button className="btn primary" disabled={regen.isPending}
                      onClick={() => regen.mutate({ building_pk: r.building_pk, kind: r.kind })}>
                      재생성 ({r.kind === "analysis" ? 30 : 10})</button>}
                  </>}
                </td>
              </tr>
            ))}
            {(reports.data ?? []).length === 0 && (
              <tr><td colSpan={6} style={{ color: "var(--muted)", textAlign: "center", padding: 24 }}>
                아직 생성한 산출물이 없습니다 — 매물 상세에서 보고서를 생성해 보세요</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>
        {/* 크레딧 사용내역 */}
        <div className="panel">
          <div className="sec-head">크레딧 사용내역</div>
          <table className="wf">
            <thead><tr><th>일시</th><th>항목</th><th className="num">변동</th></tr></thead>
            <tbody>
              {(entries.data ?? []).map((e, i) => (
                <tr key={i}>
                  <td className="num" style={{ fontSize: 12 }}>{new Date(e.occurred_at).toLocaleString("ko", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{TYPE_LABEL[e.type] ?? e.type} <span style={{ color: "var(--muted)", fontSize: 12 }}>{e.reason}</span></td>
                  <td className="num" style={{ color: e.amount >= 0 ? "var(--green)" : "var(--up)", fontWeight: 700 }}>
                    {e.amount >= 0 ? "+" : ""}{e.amount}</td>
                </tr>
              ))}
              {(entries.data ?? []).length === 0 && <tr><td colSpan={3} style={{ color: "var(--muted)", textAlign: "center", padding: 18 }}>내역이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>

        {/* 저장한 검색조건 */}
        <div className="panel">
          <div className="sec-head">저장한 검색조건</div>
          <div style={{ padding: "0 14px 14px" }}>
            {(saved.data ?? []).map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                <span style={{ cursor: "pointer", fontWeight: 600 }} onClick={() => nav("/search")}>{s.name}</span>
                <button className="btn" style={{ padding: "2px 8px", fontSize: 11, color: "var(--up)" }} onClick={() => delSaved.mutate(s.id)}>삭제</button>
              </div>
            ))}
            {(saved.data ?? []).length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>저장한 조건이 없습니다 — 검색에서 조건을 저장하세요</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
