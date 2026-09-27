import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { negoWord } from "../sales/words";
import { proposalsApi } from "../../shared/api/endpoints";
import { Icon } from "../../shared/ui/Icon";
import "./report.css";

/** 브리핑 자료 — 만들기 전에 보낼 매수자를 고른다.
 *
 *  브리핑은 사실만 담는 자료라 수치는 전부 마스터·매물 줄에서 나온다. 중개인 코멘트 칸은
 *  2026-09-17 에 없앴다(대표: 「브리핑 코멘트도 이제 필요없어보임」).
 */
export function BriefingModal({ pk, busy, onClose, onSubmit }: {
  pk: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (buyerIds: number[]) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);

  // 보낼 대상을 여기서 고르면 제안이 자동으로 생긴다 — 만들고 나서 따로 기록하지 않는다.
  // 후보는 **이 매물에 이미 담긴 사람**이다. 보낼 사람은 담아둔 사람이지, 조건이 맞는 남이 아니다.
  const cand = useQuery({ queryKey: ["proposals", "pk", pk], queryFn: () => proposalsApi.list({ building_pk: pk }) });
  // 접은 짝(보류)과 죽은 짝은 뺀다 — 안 산다고 한 사람에게 다시 보내지 않는다
  const list = (cand.data ?? []).filter((p) => !p.stop_id && !p.dropped_at);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="modal-bg open" onClick={() => !busy && onClose()}>
      <div className="gmodal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="gm-head">
          <h2>브리핑 자료</h2>
          <button className="gm-x" disabled={busy} onClick={onClose}><Icon name="close" size={16} /></button>
        </div>

        <div className="gm-body one">
          {list.length > 0 ? (
            <>
              <div className="gm-sec">보낼 매수자</div>
              <div className="bm-buyers">
                {list.map((b) => (
                  <button key={b.buyer_id} type="button" disabled={busy}
                    className={picked.includes(b.buyer_id) ? "on" : ""} onClick={() => toggle(b.buyer_id)}>
                    {b.buyer_name}<em>{negoWord(b)}</em>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="gm-sec">이 매물에 담긴 매수자가 없습니다</div>
          )}
        </div>

        <div className="gm-foot">
          <span className="sp" />
          {picked.length > 0 && <span className="gm-msg">매수자 {picked.length}명에게 제안으로 기록</span>}
          <button className="gm-go" disabled={busy} onClick={() => onSubmit(picked)}>
            {busy ? "만드는 중…" : "만들기"}</button>
        </div>
      </div>
    </div>
  );
}
