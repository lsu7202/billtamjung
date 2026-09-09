/** 검색 결과 — 답 안에서 「찾은 목록」을 그리는 조각. 정본 10-AI-어시스턴트 §12 · §13
 *
 *  모델이 `/search` 를 부르면 도구가 `{"t":"ui","name":"search_result","props":{filters,polygon}}` 를
 *  딸려 낸다(§13 도구가 부품을 딸려 낸다). 여기서 **같은 조건으로 같은 API 를 다시 부른다.**
 *  검색 화면과 같은 엔진이라 같은 줄이 나온다. 채팅은 37동, 화면은 35동이 되면 안 된다(§3-1).
 *
 *  줄 마크업은 검색 화면의 `.ml-row` 그대로다. 같은 것은 같게 생겨야 한다. */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { api } from "../../../shared/api/client";
import { py, shortAddr } from "./BuildingCard";
import "../../search/search.css";

interface Row { building_pk: string; addr: string; floors_above?: number | null; total_area?: number | null; use_zone?: string | null; col?: string }
interface Col { total: number; items: Row[] }
interface Out { mine: Col; normal: Col }

const SHOW = 10;

export function SearchResult({ filters, polygon }: { filters: Record<string, unknown>; polygon?: unknown }) {
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["as-search", filters, polygon],
    queryFn: () => api<Out>("/search", { method: "POST", body: JSON.stringify({ filters, polygon: polygon ?? null, per_page: SHOW }) }),
    staleTime: 60_000,
  });
  const d = q.data;
  if (!d) return <div className="as-sr as-sr-wait" />;
  const rows = [...(d.mine?.items ?? []), ...(d.normal?.items ?? [])].slice(0, SHOW);
  const total = (d.mine?.total ?? 0) + (d.normal?.total ?? 0);
  return (
    <div className="as-sr">
      <div className="as-srh"><b>{total.toLocaleString()}동</b>{total > rows.length && <span>앞 {rows.length}동</span>}</div>
      {rows.map((r) => (
        <div key={r.building_pk} className="ml-row" onClick={() => nav(`/buildings/${r.building_pk}`)}>
          <span className="ml-a">{shortAddr(r.addr)}
            {r.col === "mine" && <span className="ml-tag mine">내</span>}
          </span>
          <span className="ml-nums" style={{ fontWeight: 600 }}>
            {[r.use_zone, r.floors_above != null ? `${r.floors_above}층` : null, py(r.total_area)].filter(Boolean).join(" · ")}
          </span>
        </div>
      ))}
      {rows.length === 0 && <div className="sel-empty">조건에 맞는 건물이 없습니다</div>}
      {/* **걸린 조건을 그대로 들고 간다.** 그냥 /search 로 보내면 조건이 통째로 날아가
          사용자가 처음부터 다시 건다(2026-09-09 대표). 검색 화면은 state.applyCond 로 받는다 */}
      <button className="as-srx"
              onClick={() => nav("/search", { state: { applyCond: { filters, polygon } } })}>
        검색 화면에서 열기
      </button>
    </div>
  );
}
