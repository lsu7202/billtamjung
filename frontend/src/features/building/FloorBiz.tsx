import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rentsApi, type Tenant } from "../../shared/api/endpoints";
import { useUnit } from "../../shared/hooks/useUnit";
import { floorName } from "../../shared/format";
import "./sheet.css";
import { TenancyHistory } from "./TenancyHistory";

/** 층별 현황(10-01) — 상세보기와 사이드바가 같이 쓴다.
 *  업체마다 한 줄: 층 | 업종 나무 | 업체. 머리 줄(층 · 업종 · 업체)은 두지 않는다 — 모양만 봐도 읽힌다.
 *  한 층에 업체가 여럿이면 층을 줄마다 다시 쓴다(「외 N」으로 줄이지 않는다). 층을 모르면 「-」.
 *  업체가 없는 층도 한 줄 선다(업종 · 업체 빈칸). 대장 값(용도 · 바닥면적 · 전유부)은 「층별 대장 보기」 뒤 — full 일 때만 */
const cat = (t: Tenant) => (t.cat_nodes?.length ? t.cat_nodes.slice(-2).join(" › ") : t.biz ?? "");

export function FloorBiz({ pk, full = false }: { pk: string; /** 상세보기 — 「층별 대장 보기」까지 */ full?: boolean }) {
  const q = useQuery({ queryKey: ["floor-info", pk], queryFn: () => rentsApi.info(pk) });
  const { area } = useUnit();
  const [ledger, setLedger] = useState(false);
  const [hist, setHist] = useState(false);
  const [rooms, setRooms] = useState<string | null>(null);
  if (q.isLoading) return null;
  const floors = q.data?.floors ?? [];
  const unknown = q.data?.unknown ?? [];
  type Row = { floor: string; t: Tenant | null };
  const rows: Row[] = [
    ...floors.flatMap((g): Row[] => (g.ledger.length ? g.ledger.map((t) => ({ floor: g.floor, t })) : [{ floor: g.floor, t: null }])),
    ...unknown.map((t): Row => ({ floor: "-", t })),
  ];
  return (
    <div className="fb">
      {rows.length === 0 && <div className="sh-empty">층별 정보 없음</div>}
      {rows.map((r, i) => (
        <div key={i} className="fb-r"><span className="fb-f">{floorName(r.floor)}</span><span className="fb-c">{r.t ? cat(r.t) : ""}</span>
          <span className="fb-n">{r.t?.name ?? ""}</span></div>
      ))}
      {full && floors.length > 0 && (
        <button className={`sh-more ${ledger ? "on" : ""}`} onClick={() => setLedger(!ledger)}>
          {ledger ? "층별 대장 접기" : "층별 대장 보기"} <i>{ledger ? "▴" : "›"}</i></button>
      )}
      {full && ledger && (
        <div className="sh-tbl g3">
          <div className="sh-tr head"><span>층</span><span>대장 용도</span><span>바닥면적</span></div>
          {floors.map((g) => (
            <div key={g.floor}>
              <div className="sh-tr"><span>{floorName(g.floor)}</span><span>{g.uses.join(" · ")}</span>
                <span>{area(g.floor_area, 0)}{g.rooms.length > 0 && (
                  <button className="fb-room" onClick={() => setRooms(rooms === g.floor ? null : g.floor)}>전유부 {g.rooms.length}</button>)}</span></div>
              {rooms === g.floor && g.rooms.map((r, i) => (
                <div key={i} className="sh-tr sub"><span></span><span>호실 {i + 1}</span>
                  <span>전용 {area(r.excl_area, 1)}{r.common_area != null ? ` · 공용 ${area(r.common_area, 1)}` : ""}</span></div>
              ))}
            </div>
          ))}
        </div>
      )}
      {full && (
        <button className={`sh-more ${hist ? "on" : ""}`} onClick={() => setHist(!hist)}>
          {hist ? "과거 입주 이력 접기" : "과거 입주 이력 보기"} <i>{hist ? "▴" : "›"}</i></button>
      )}
      {full && hist && <TenancyHistory pk={pk} bare />}
    </div>
  );
}
