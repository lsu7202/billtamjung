import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildingsApi } from "../../shared/api/endpoints";
import { useIsBroker } from "../../shared/store/auth";
import { wonAcc } from "../../shared/format";

/** 시장 호가 — 크롤링 매물(S05 §7). 광고가 아니라 **중개사 참고 자료**라 고객에겐 안 선다(API 도 403).
 *  임대 내역(매물 모달)과 층별 정보(건물 상세) 아래에 같은 부품으로 붙는다.
 *  접혀 있고, 줄을 누르면 편다. 날짜 · 게시자를 모르는 줄(첫 적재분)은 「—」. */
export function MarketAsks({ pk, unit = "py" }: { pk: string; unit?: "py" | "m2" }) {
  const broker = useIsBroker();
  const q = useQuery({ queryKey: ["bCrawl", pk], queryFn: () => buildingsApi.crawl(pk), enabled: broker && !pk.startsWith("P") });
  const [open, setOpen] = useState(false);
  const rows = q.data ?? [];
  if (!broker || rows.length === 0) return null;
  const area = (m2: number | null) =>
    m2 == null ? "—" : `${(unit === "py" ? m2 / 3.305785 : m2).toFixed(1)}${unit === "py" ? "평" : "㎡"}`;
  const won = (v: number | null) => (v == null ? "—" : wonAcc(v) || "0");
  return (
    <div className="mk">
      <button className={`mk-h ${open ? "on" : ""}`} onClick={() => setOpen(!open)}>
        시장 호가 <b className="num">{rows.length}</b><i>›</i></button>
      {open && (
        <div className="mk-t">
          <div className="mk-r hd"><span>구분</span><span>층</span><span>계약면적</span><span>보증금</span><span>월세 · 매매가</span><span>확인일</span></div>
          {rows.map((r) => (
            <div key={r.id} className="mk-r num">
              <span className="d">{r.deal}</span>
              <span>{r.floor ? `${r.floor}층` : "—"}</span>
              <span>{area(r.contract_area)}</span>
              <span>{r.deal === "임대" ? won(r.deposit) : "—"}</span>
              <span>{r.deal === "임대" ? won(r.rent) : won(r.price)}</span>
              <span className="d">{r.last_seen ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
