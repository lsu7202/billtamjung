import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { authApi, listingsApi, searchApi, type Suggestion } from "../../shared/api/endpoints";
import { dongAddr } from "../../shared/format";
import { Icon } from "../../shared/ui/Icon";

/** 매물 등록(10-02 · 10-04 고객 등록과 같은 꼴) — 그리드 줄 하나(주소) + 아래 「등록」.
 *  주소를 적으면 줄 아래에 맞는 건물이 뜨고, 고르면 칸이 채워진다. 등록하면 매물이 생기고(담은 사람이 담당) 그 매물의 판이 열린다.
 *  가격 · 유형 · 소유자는 판에서 채운다 — 입력 서식은 판 한 곳에만 둔다 */
export function AddListing({ onClose, onSaved }: { onClose: () => void; onSaved: (lid: number) => void }) {
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = q.trim();
  const sug = useQuery({ queryKey: ["suggest", t], enabled: t.length >= 2 && !pick, queryFn: () => searchApi.suggest(t) });
  // 매물은 지번에 선다(0255) — 건물이 선 땅이든 나대지든 지번이 있으면 고른다
  const hits = (sug.data ?? []).filter((x) => (x.kind === "building" || x.kind === "vacant") && x.pnu).slice(0, 8);

  const choose = (h: Suggestion) => { setPick(h); setQ(dongAddr(h.addr)); setErr(null); };
  const save = async () => {
    const h = pick ?? (hits.length === 1 ? hits[0] : null);   // 맞는 건물이 하나뿐이면 고르지 않아도 그것으로
    if (!h?.pnu) { setErr("주소를 적고 목록에서 땅을 고르세요"); return; }
    if (busy || !me.data?.account_id) return;
    setBusy(true); setErr(null);
    try { const r = await listingsApi.claim(h.pnu, me.data.account_id); onSaved(r.listing_id); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="lx-addm" onClick={(e) => e.stopPropagation()}>
        <div className="lx-addm-h"><b>매물 등록</b><span className="sp" />
          <button className="lx-addm-x" title="닫기" onClick={onClose}><Icon name="close" size={18} /></button></div>
        <div className="cx-addf">
          <div className="lgx-r"><span className="lgx-k">주소</span>
            <div className="lgx-v"><input autoFocus className="lgx-in" value={q} placeholder="주소 또는 지명"
              onChange={(e) => { setQ(e.target.value); setPick(null); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") onClose();
                if (e.key === "Enter" && !e.nativeEvent.isComposing) { if (!pick && hits[0]) choose(hits[0]); else save(); }
              }} /></div></div>
          {/* 맞는 건물 — 고르면 주소 칸이 채워지고 목록은 접힌다 */}
          {!pick && t.length >= 2 && (
            <div className="lx-addm-list">
              {hits.map((h) => (
                <button key={h.pnu!} onClick={() => choose(h)}>{dongAddr(h.addr)}
                  <span>{h.addr.replace("서울특별시 ", "")}</span></button>
              ))}
              {!sug.isFetching && hits.length === 0 && <div className="lx-addm-none">맞는 건물이 없습니다</div>}
            </div>
          )}
          {pick && <div className="lgx-r"><span className="lgx-k">건물</span>
            <div className="lgx-v iq-v"><b>{pick.addr.replace("서울특별시 ", "")}</b></div></div>}
          {err && <div className="lgx-err">{err}</div>}
          <button className="cx-addb" disabled={busy} onClick={save}>{busy ? "…" : "등록"}</button>
        </div>
      </div>
    </div>
  ), document.body);
}
