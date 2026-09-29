import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { statusesApi, type StatusKind } from "../../shared/api/endpoints";
import { parseAmount, seedAmount } from "../building/KV";
import { won } from "../../shared/format";

/** 상태(0199, 대표 09-29) — 사무소가 만든 상태를 손으로 고른다(부기사). 자동 판정은 없다.
 *  배지는 그 상태의 색 점 + 이름, 미지정은 회색 「미지정」. */
export function useStatuses(kind: StatusKind) {
  return useQuery({ queryKey: ["statuses", kind], queryFn: () => statusesApi.list(kind), staleTime: 60_000 });
}

export function StatusBadge({ name, color }: { name?: string | null; color?: string | null }) {
  return (
    <span className={`stx ${name ? "" : "off"}`}>
      <i style={{ background: name ? color ?? "#8B95A1" : "#D1D6DB" }} />{name ?? "미지정"}
    </span>
  );
}

/** 칩 줄 — 고르면 바로 저장, 고른 칩을 다시 누르면 미지정. 매물은 「완료」를 고를 때 매각일 · 매각금액을 받는다 */
export function StatusChips({ kind, value, onPick, sold }: {
  kind: StatusKind; value: number | null | undefined;
  onPick: (id: number | null, sold?: { sold_on: string | null; sold_price: number | null }) => void;
  sold?: { sold_on?: string | null; sold_price?: number | null };
}) {
  const q = useStatuses(kind);
  const [ask, setAsk] = useState<number | null>(null);         // 완료 — 매각일 · 매각금액 묻는 중
  const [on, setOn] = useState(sold?.sold_on ?? new Date().toISOString().slice(0, 10));
  const [price, setPrice] = useState(seedAmount(sold?.sold_price));
  const list = q.data ?? [];
  const cur = list.find((s) => s.id === value);
  return (
    <span className="stx-chips">
      {list.map((s) => (
        <button key={s.id} type="button" className={`um-chip stx-chip ${value === s.id ? "on" : ""}`}
          style={value === s.id ? { background: `${s.color}1A`, color: s.color } : undefined}
          onClick={() => {
            if (value === s.id) { setAsk(null); onPick(null); return; }
            if (kind === "listing" && s.name === "완료") { setAsk(s.id); return; }
            setAsk(null); onPick(s.id);
          }}>
          <i style={{ background: s.color }} />{s.name}</button>
      ))}
      {ask != null && (
        <span className="stx-sold">
          <input type="date" className="um-in num" value={on} onChange={(e) => setOn(e.target.value)} />
          <span className="ad-num"><input className="um-in num" style={{ width: "7ch" }} value={price} placeholder="매각금액"
            onChange={(e) => setPrice(e.target.value)} />억</span>
          {price.trim() && parseAmount(price) ? <span className="dim num">{won(parseAmount(price))}원</span> : null}
          <button type="button" className="um-chip on" onClick={() => {
            onPick(ask, { sold_on: on || null, sold_price: parseAmount(price) }); setAsk(null);
          }}>완료로</button>
        </span>
      )}
      {cur?.name === "완료" && ask == null && (sold?.sold_on || sold?.sold_price) && (
        <span className="dim num">{sold?.sold_on ?? ""}{sold?.sold_price ? ` · ${won(sold.sold_price)}` : ""}</span>
      )}
    </span>
  );
}

/** 매물 상태 저장 — 목록 · 모달이 같이 쓴다 */
export function useSetListingStatus() {
  const qc = useQueryClient();
  return async (pk: string, id: number | null, sold?: { sold_on: string | null; sold_price: number | null }) => {
    await statusesApi.setListing(pk, { status_id: id, ...(sold ?? {}) });
    qc.invalidateQueries({ queryKey: ["sellers"] });
    qc.invalidateQueries({ queryKey: ["statuses", "listing"] });
  };
}
export function useSetBuyerStatus() {
  const qc = useQueryClient();
  return async (id: number, sid: number | null) => {
    await statusesApi.setBuyer(id, sid);
    qc.invalidateQueries({ queryKey: ["buyers"] });
    qc.invalidateQueries({ queryKey: ["statuses", "buyer"] });
  };
}
