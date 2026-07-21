import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { creditsApi, reportsApi } from "../../shared/api/endpoints";

/** S0M 마이페이지 — 크레딧(버킷) · 내 산출물(stale 배지·조건부 재생성) */
export function MyPage() {
  const qc = useQueryClient();
  const credits = useQuery({ queryKey: ["credits"], queryFn: creditsApi.balance });
  const reports = useQuery({ queryKey: ["reports"], queryFn: reportsApi.list, refetchInterval: 3000 });

  const regen = useMutation({
    mutationFn: (r: { building_pk: string; kind: "briefing" | "analysis" }) =>
      reportsApi.create(r.building_pk, r.kind),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["credits"] });
    },
  });

  const c = credits.data;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="panel">
        <div className="sec-head">크레딧</div>
        <div style={{ display: "flex", gap: 24, padding: "0 14px 16px" }}>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>사용 가능 잔액</div>
            <div className="num" style={{ fontSize: 28, fontWeight: 800 }}>{c?.total ?? "…"}</div></div>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>월 지급 잔여</div>
            <div className="num" style={{ fontSize: 20 }}>{c?.monthly ?? 0}</div></div>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>적립(이월)</div>
            <div className="num" style={{ fontSize: 20 }}>{c?.earned ?? 0}</div></div>
        </div>
      </div>

      <div className="panel">
        <div className="sec-head">내 산출물</div>
        <table className="wf">
          <thead><tr><th>생성일</th><th>종류</th><th>매물</th><th className="num">크레딧</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {(reports.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="num">{new Date(r.created_at).toLocaleDateString("ko")}</td>
                <td>{r.kind === "analysis" ? "매물분석" : "브리핑"}</td>
                <td>{r.addr ?? r.building_pk}</td>
                <td className="num">{r.credits_spent ?? "—"}</td>
                <td>
                  {r.status === "done" ? (
                    <span className={`tag ${r.is_stale ? "stale" : "fresh"}`}>
                      {r.is_stale ? "데이터 변경됨" : "최신"}
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>{r.status}</span>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  {r.status === "done" && (
                    <>
                      <button className="btn" style={{ marginRight: 6 }}>PPT 받기</button>
                      {r.is_stale && (
                        <button className="btn primary" disabled={regen.isPending}
                          onClick={() => regen.mutate({ building_pk: r.building_pk, kind: r.kind })}>
                          재생성 ({r.kind === "analysis" ? 30 : 10})
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {(reports.data ?? []).length === 0 && (
              <tr><td colSpan={6} style={{ color: "var(--muted)", textAlign: "center", padding: 24 }}>
                아직 생성한 산출물이 없습니다 — 매물 상세에서 보고서를 생성해 보세요
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
