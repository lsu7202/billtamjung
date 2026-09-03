import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { negoWord } from "../sales/words";
import { proposalsApi } from "../../shared/api/endpoints";
import { Icon } from "../../shared/ui/Icon";
import "./report.css";

/** 브리핑 자료 — 만들기 전에 중개인 코멘트를 받는다.
 *
 *  브리핑은 사실만 담는 자료라 수치는 전부 마스터·오버레이에서 나온다. 그래도 입지·활용처럼
 *  표에 안 들어가는 판단은 담당자만 안다. 그걸 넣을 자리가 여기 하나뿐이라 생성 직전에 묻는다.
 *  저장은 건물 오버레이(briefing_comment)라 팀이 공유하고, 다음 생성 때 그대로 다시 뜬다.
 *
 *  2026-08-28 개편. 예전엔 여섯 줄짜리 textarea 에 「한 줄에 하나씩」이라 적어 두고,
 *  그 아래 「건물 개요 아래에 N줄로 들어갑니다」라고 또 설명했다. 규칙이 시키는 대로
 *  **한 줄 기록은 pill 입력줄**로 바꿨다 — 치고 엔터면 줄이 서고, 줄마다 지우개가 붙는다.
 *  줄이 눈앞에 서니 「한 줄에 하나씩」도 「N줄로 들어갑니다」도 적을 필요가 없다.
 */
export function BriefingModal({ pk, current, busy, onClose, onSubmit }: {
  pk: string;
  current: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (comment: string, buyerIds: number[]) => void;
}) {
  const [lines, setLines] = useState<string[]>(
    current.split("\n").map((x) => x.trim()).filter(Boolean));
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<number[]>([]);

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    setLines((l) => [...l, v]);
    setDraft("");
  };

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
          <div className="gm-sec">중개인 코멘트</div>
          <div className="gm-lines">
            {lines.map((t, i) => (
              <div key={`${t}-${i}`} className="orow">
                <span className="who">{t}</span><span className="cap" />
                <button className="gm-del" title="지우기" disabled={busy}
                  onClick={() => setLines((l) => l.filter((_, j) => j !== i))}>
                  <Icon name="close" size={13} /></button>
              </div>
            ))}
          </div>
          <div className="gm-line">
            <input className="gm-pill" value={draft} disabled={busy}
              placeholder="한 줄씩 — 「종로3가역 도보 2분」 「대로변 코너」"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <button className="gm-add" disabled={busy || !draft.trim()} onClick={add} title="줄 추가">
              <Icon name="plus" size={15} /></button>
          </div>

          {list.length > 0 && (
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
          )}
        </div>

        <div className="gm-foot">
          <span className="gm-cost">크레딧 <b>10</b></span>
          <span className="sp" />
          {picked.length > 0 && <span className="gm-msg">매수자 {picked.length}명에게 제안으로 기록</span>}
          <button className="gm-go" disabled={busy} onClick={() => onSubmit(lines.join("\n"), picked)}>
            {busy ? "만드는 중…" : "만들기"}</button>
        </div>
      </div>
    </div>
  );
}
