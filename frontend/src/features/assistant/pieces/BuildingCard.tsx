/** 건물 카드 — 답 안에서 건물 하나를 가리키는 조각. 정본 10-AI-어시스턴트 §12 · §13
 *
 *  모델은 `{"t":"ui","name":"building_card","props":{"pk"}}` 만 낸다. 값은 **여기서 지금** 읽는다.
 *  그래서 다시 열어도 그때 값이 아니라 지금 값이고, 글자와 어긋나면 데이터가 바뀐 것이다.
 *  누르면 건물 상세로 간다. 이게 없으면 답은 글자일 뿐이다(§13). */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { api } from "../../../shared/api/client";
import { Icon } from "../../../shared/ui/Icon";

interface Detail {
  addr: string; road_addr?: string | null;
  floors_above?: number | null; floors_below?: number | null;
  total_area?: number | null; land_area?: number | null;
  approval_ymd?: string | null; approval_ymd_prec?: string | null;
  main_use_name?: string | null; use_zone?: string | null; elevator?: number | null;
}

const PY = 3.305785;
export const py = (m2?: number | null) => (m2 == null ? null : `${(m2 / PY).toFixed(1)}평`);
export const shortAddr = (a?: string | null) => (a ?? "").replace("서울특별시 ", "").replace("번지", "");

/** 준공일은 **아는 만큼만** 쓴다(0165). 정밀도가 「연」이면 「1959년」이지 「1959.01.01」이 아니다 */
export function ymd(d?: string | null, prec?: string | null): string | null {
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split("-");
  if (prec === "연") return `${y}년`;
  if (prec === "월") return `${y}년 ${Number(m)}월`;
  return `${y}.${m}.${day}`;
}

export function BuildingCard({ pk }: { pk: string }) {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["bldg", pk], queryFn: () => api<Detail>(`/buildings/${pk}`), staleTime: 60_000 });
  const d = q.data;
  return (
    <button className="as-card" onClick={() => nav(`/buildings/${pk}`)} disabled={!d}>
      <Icon name="building" size={15} />
      <span className="tx">
        <b>{d ? shortAddr(d.addr) : "…"}</b>
        {d && (
          <span className="s">
            {[d.main_use_name, d.use_zone,
              d.floors_above != null ? `${d.floors_below ? `지하 ${d.floors_below}·` : ""}지상 ${d.floors_above}층` : null,
              py(d.total_area), ymd(d.approval_ymd, d.approval_ymd_prec)]
              .filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
      <Icon name="back" size={13} style={{ transform: "rotate(180deg)", opacity: .5 }} />
    </button>
  );
}
