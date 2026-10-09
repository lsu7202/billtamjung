import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { statusesApi, type StatusKind } from "../../shared/api/endpoints";
import { useEnums } from "../../shared/hooks/useEnums";
import { parseAmount, seedAmount } from "../building/KV";
import { won } from "../../shared/format";

/** 상태(0199, 대표 09-29) — 사무소가 만든 상태를 손으로 고른다(부기사). 자동 판정은 없다.
 *  보류는 사유를 하나 받고(0201), 화면엔 「보류」 대신 **사유만** 상태 색(빨강)으로 선다. */
export function useStatuses(kind: StatusKind) {
  return useQuery({ queryKey: ["statuses", kind], queryFn: () => statusesApi.list(kind), staleTime: 60_000 });
}

/** 상태를 고를 때 딸려 가는 값 — 완료면 매각일 · 매각금액, 보류면 사유 */
export interface StatusExtra { sold_on?: string | null; sold_price?: number | null; hold_reason?: string | null }

export function StatusBadge({ name, color, reason }: { name?: string | null; color?: string | null; reason?: string | null }) {
  const text = name === "보류" && reason ? reason : name;
  return (
    <span className={`stx ${name ? "" : "off"}`} style={name ? { color: color ?? undefined } : undefined}>
      <i style={{ background: name ? color ?? "#8B95A1" : "#D1D6DB" }} />{text ?? "미지정"}
    </span>
  );
}

/** 칩 줄 — 고르면 바로 저장, 고른 칩을 다시 누르면 미지정.
 *  매물 「완료」는 매각일 · 매각금액, 「보류」는 사유 목록(드롭다운)을 이어서 받는다 */
export function StatusChips({ kind, value, onPick, sold, reason }: {
  kind: StatusKind; value: number | null | undefined;
  onPick: (id: number | null, extra?: StatusExtra) => void;
  sold?: { sold_on?: string | null; sold_price?: number | null };
  reason?: string | null;
}) {
  const q = useStatuses(kind);
  const { options } = useEnums();
  const [ask, setAsk] = useState<null | { id: number; what: "done" | "hold" }>(null);
  const [on, setOn] = useState(sold?.sold_on ?? new Date().toISOString().slice(0, 10));
  const [price, setPrice] = useState(seedAmount(sold?.sold_price));
  const list = q.data ?? [];
  const cur = list.find((s) => s.id === value);
  const reasons = options(`hold_reason_${kind}`);
  return (
    <span className="stx-chips">
      {list.map((s) => (
        <button key={s.id} type="button" className={`um-chip stx-chip ${value === s.id ? "on" : ""}`}
          style={value === s.id ? { background: `${s.color}1A`, color: s.color } : undefined}
          onClick={() => {
            if (s.name === "보류") { setAsk(ask?.what === "hold" ? null : { id: s.id, what: "hold" }); return; }
            if (value === s.id) { setAsk(null); onPick(null); return; }
            if (kind === "listing" && s.name === "완료") { setAsk({ id: s.id, what: "done" }); return; }
            setAsk(null); onPick(s.id);
          }}>
          <i style={{ background: s.color }} />{s.name === "보류" && value === s.id && reason ? reason : s.name}</button>
      ))}
      {ask?.what === "hold" && (
        <span className="stx-menu">
          {reasons.map((o) => (
            <button key={o.code} type="button" className={value === ask.id && reason === o.code ? "on" : ""}
              onClick={() => { onPick(ask.id, { hold_reason: o.code }); setAsk(null); }}>{o.label}</button>
          ))}
          <button type="button" className="dim" onClick={() => { onPick(ask.id, { hold_reason: null }); setAsk(null); }}>사유 없이</button>
          {value === ask.id && (
            <button type="button" className="dim" onClick={() => { onPick(null); setAsk(null); }}>보류 풀기</button>
          )}
        </span>
      )}
      {ask?.what === "done" && (
        <span className="stx-sold">
          <input type="date" className="um-in num" value={on} onChange={(e) => setOn(e.target.value)} />
          <span className="ad-num"><input className="um-in num" style={{ width: "7ch" }} value={price} placeholder="매각금액"
            onChange={(e) => setPrice(e.target.value)} />억</span>
          {price.trim() && parseAmount(price) ? <span className="dim num">{won(parseAmount(price))}원</span> : null}
          <button type="button" className="um-chip on" onClick={() => {
            onPick(ask.id, { sold_on: on || null, sold_price: parseAmount(price) }); setAsk(null);
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
  return async (lid: number, id: number | null, extra?: StatusExtra) => {
    await statusesApi.setListing(lid, { status_id: id, ...(extra ?? {}) });
    qc.invalidateQueries({ queryKey: ["sellers"] });
    qc.invalidateQueries({ queryKey: ["statuses", "listing"] });
  };
}
