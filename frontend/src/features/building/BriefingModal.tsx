import { useState } from "react";
import { Icon } from "../../shared/ui/Icon";
import "./report.css";

/** 브리핑 생성 전 — 중개인 코멘트를 받는다.
 *
 *  브리핑은 사실만 담는 자료라 수치는 전부 마스터·오버레이에서 나온다. 그래도 입지·활용처럼
 *  표에 안 들어가는 판단은 담당자만 안다. 그걸 넣을 자리가 여기 하나뿐이라 생성 직전에 묻는다.
 *  저장은 건물 오버레이(briefing_comment)라 팀이 공유하고, 다음 생성 때 그대로 다시 뜬다.
 */
export function BriefingModal({ current, busy, onClose, onSubmit }: {
  current: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (comment: string) => void;
}) {
  const [text, setText] = useState(current);
  const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);

  return (
    <div className="modal-bg open" onClick={() => !busy && onClose()}>
      <div className="rmodal" style={{ width: "min(620px,100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="rm-head">
          <h2>브리핑 자료 만들기</h2>
          <button className="rm-x" disabled={busy} onClick={onClose}><Icon name="close" size={16} /></button>
        </div>

        <div className="rm-body" style={{ padding: 18, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 700 }}>중개인 코멘트</label>
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={6} disabled={busy}
            placeholder={"한 줄에 하나씩\n예) 종로3가역 도보 2분 · 대로변 코너 입지"}
            style={{
              width: "100%", padding: "10px 12px", fontSize: 13.5, lineHeight: 1.7,
              border: "1px solid var(--line)", borderRadius: 6, resize: "vertical", fontFamily: "inherit",
            }} />
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            건물 개요 아래에 {lines.length ? `${lines.length}줄` : "줄 단위"}로 들어갑니다. 비워 두면 표시하지 않습니다.
          </div>
        </div>

        <div className="rm-foot">
          <span className="note">크레딧 10이 소모됩니다.</span>
          <button className="btn" disabled={busy} onClick={onClose}>취소</button>
          <button className="btn primary" disabled={busy} onClick={() => onSubmit(lines.join("\n"))}>
            {busy ? "만드는 중…" : "만들기"}
          </button>
        </div>
      </div>
    </div>
  );
}
