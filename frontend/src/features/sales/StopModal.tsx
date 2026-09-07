import { useState } from "react";
import { createPortal } from "react-dom";
import { stopsApi, StopStage, Stop } from "../../shared/api/endpoints";
import { useEnums } from "../../shared/hooks/useEnums";
import { Chips } from "../building/EnumField";
import "./sales.css";

/** 보류 창 — **어느 칸에서 눌러도 같은 모양**. 사유 칩만 칸별로 달라진다(S04b §2.3).
 *
 *  왜 하나로 합쳤나: 「실패」는 칸마다 생긴다 — 연락처 못 캠 · 연락두절 · 안 판다 ·
 *  진행불가 · 매수자 없음 · 보류. 그런데 전부 같은 말이다:
 *  **지금은 안 본다 + 그 이유.** 칸마다 창을 만들면 일곱 개가 된다.
 *
 *  **철회와 다르다.** 철회는 죽은 것이고 이건 살아 있는 채로 멈춘 것이다.
 *  철회로 밀면 영영 안 뜨고, 그냥 두면 매일 재촉이 뜬다 — 지금까지 이 둘뿐이었다.
 *
 *  **깨울 날짜는 두지 않는다**(0140). 예전엔 「언제 다시 볼까」를 다섯 갈래로 같이 물었는데
 *  아무도 안 썼다. 다시 볼 일이 정해져 있으면 그건 일정이지 보류가 아니다.
 *
 *  **메모 칸도 없앴다**(0159). 「사유가 곧 상태」인데 옆에 자유 글칸을 두면 규칙이 둘이 된다.
 *  칩으로 못 고를 것이 있으면 그건 **사유 목록이 모자란 것**이다 — 그래서 갈래마다 「기타」를 뒀다.
 *  무엇이 자주 걸리는지는 값으로 세면 되고, 「기타」가 쌓이면 그때 사유를 새로 만든다.
 *  자유 글은 셀 수 없다. (칸 `app.stops.note` 는 남긴다 — 이미 적힌 글을 지우지 않는다.)
 */
// 줄머리는 라벨로 통일했다(2026-08-18 — 아이콘만으론 무슨 칸인지 안 읽혔다)

/** 칸 이름 — 창 제목에 쓴다. 사유 enum 키도 이 코드로 만든다(stop_reason_<stage>) */
export const STAGE_LABEL: Record<StopStage, string> = {
  owner: "소유자", touch: "접촉", intent: "의사 확인", info: "정보",
  asset: "자료", match: "합의", find: "살 물건 찾기", deal: "매물",
};

/** 보류 초안 — 부모가 들고 있다가 저장 때 stopsApi.open 으로 보낸다 */
export interface StopDraft {
  reason: string | null;
  /** 옛 값만 실어 나른다 — 새로 적는 자리는 없다(0159) */
  note: string;
}
export const emptyStopDraft = (cur?: Stop | null): StopDraft => ({
  reason: cur?.reason ?? null,
  note: cur?.note ?? "",
});
export const saveStop = (target: { type: Stop["target_type"]; id: string },
                         stage: StopStage, d: StopDraft) =>
  stopsApi.open({
    target_type: target.type, target_id: target.id, stage,
    reason: d.reason, note: d.note || null,
  });

/** 보류 몸통 — **어디서 쓰든 같은 줄들**(사유 · 메모).
 *  StopModal(모달)과 소유자 찾기 창(인라인)이 이 한 벌을 공유한다 — 보류 UI 는 하나다. */
export function StopFields({ stage, d, onChange }: {
  stage: StopStage; d: StopDraft; onChange: (d: StopDraft) => void;
}) {
  const { options } = useEnums();
  const set = (p: Partial<StopDraft>) => onChange({ ...d, ...p });
  // 사유가 곧 상태다(2026-08-17) — 사유를 고르면 보류고, 미지정으로 돌리면 풀린다.
  // 별도 토글 칩을 없앤 이유: 「보류를 켜고 사유를 고른다」는 두 단계가 한 뜻의 중복이었다.
  return (<>
    <div className="gm-row lab">
      <span className="gm-lab">사유</span>
      <div className="gm-body wrap np-chips">
        <Chips mode="inline"
          opts={[{ code: "미지정", label: "미지정" }, ...options(`stop_reason_${stage}`)]}
          cur={d.reason ?? "미지정"} onSelect={(v) => set({ reason: v === "미지정" ? null : v })} />
      </div>
    </div>
  </>);
}

export function StopModal({ target, stage, cur, title, onClose, onSaved }: {
  target: { type: Stop["target_type"]; id: string };
  /** 어느 칸에서 멈추나 — 사유 목록을 고르는 키 */
  stage: StopStage;
  /** 이미 보류 중이면 그 값(수정) */
  cur?: Stop | null;
  /** 대목 — 주소나 사람 이름 */
  title: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<StopDraft>(() => emptyStopDraft(cur));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try { await saveStop(target, stage, d); onSaved(); onClose(); }
    finally { setBusy(false); }
  };
  const release = async () => {
    if (!cur || busy) return;
    setBusy(true);
    try { await stopsApi.release(cur.id); onSaved(); onClose(); } finally { setBusy(false); }
  };

  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm" onClick={(e) => e.stopPropagation()}>
        {/* 대목은 대상 — 다른 창과 같은 어법(약속=용무, 사람=이름, 매물=주소) */}
        <div className="gm-title-fix">{title}</div>
        <div className="gm-sep"><span>{STAGE_LABEL[stage]} 보류</span></div>
        <StopFields stage={stage} d={d} onChange={setD} />
        <div className="gm-foot">
          {/* 푸는 건 삭제가 아니다 — 해제 표시만 남고 「왜 멈췄었나」는 남는다 */}
          {cur && <button className="gm-ghost" onClick={release} disabled={busy}>보류 해제</button>}
          <span className="sp" />
          <button className="gm-ghost quiet" onClick={onClose}>취소</button>
          <button className="gm-save" disabled={busy} onClick={save}>
            {busy ? "…" : "저장"}</button>
        </div>
      </div>
    </div>
  ), document.body);
}

/** 보류 표시 — 줄 안에 작게. 눌러서 창을 연다.
 *  30일 넘게 멈춰 있으면 경고색으로 — 그때부터는 「잠든 것」이다. */
export function StopChip({ s, onClick }: { s: Stop; onClick?: () => void }) {
  const stale = (s.held_days ?? 0) >= 30;
  return (
    <button className={`st-chip ${stale ? "over" : ""}`} onClick={onClick}
      title={[s.reason, s.note].filter(Boolean).join(" · ")}>
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor"
        strokeWidth="2.4" strokeLinecap="round"><path d="M9 5v14M15 5v14" /></svg>
      {s.reason || "보류"}{stale ? ` ${s.held_days}일` : ""}
    </button>
  );
}
