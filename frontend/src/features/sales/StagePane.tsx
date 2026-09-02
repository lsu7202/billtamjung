import { useState } from "react";
import { createPortal } from "react-dom";
import { listingsApi, stopsApi, type Seller, type Stop, type StopStage } from "../../shared/api/endpoints";
import { StopFields, StopDraft, emptyStopDraft, saveStop } from "./StopModal";
import { useEnums } from "../../shared/hooks/useEnums";
import { Chips } from "../building/EnumField";
import "./sales.css";

/** 단계 창 — **한 벌로 여러 칸을 낸다**(S04b §7.1).
 *
 *  창이 12개가 되면 「등록 창과 편집 창의 필드가 다르다」는 버그가 12배로 벌어진다.
 *  그래서 **필드 정의는 여기 한 곳**(`F`)에 두고, 창은 「어느 키를 보여줄지」의 목록(`PANE`)만 갖는다.
 *  필드를 늘릴 때 두 군데 이상 적지 않는다.
 *
 *  어법은 `kind`에서 자동으로 결정된다 — `enum`→칩. CLAUDE.md의 어법 표를 코드로 굳히는 셈이다.
 *  (money·when·text 는 쓰는 칸이 생길 때 넣는다 — 지금 네 창은 전부 칩이다.)
 */
type Kind = "enum";
interface FieldDef { label: string; kind: Kind; enumKey: string; icon: string }

const USER = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0";
const TAG = "M4 12V5.5A1.5 1.5 0 0 1 5.5 4H12l8 8-7.5 7.5L4 12ZM8 8h.01";
const KEY = "M15 7a4 4 0 1 1-3.5 5.9L9 15.5V18H6v3H3v-4l6.1-6.1A4 4 0 0 1 15 7Z";
const BOOM = "M12 3v4M5 6l2.5 2.5M19 6l-2.5 2.5M12 11a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z";
const HOUSE = "M4 10 12 4l8 6v10H4V10Z";
const PIN = "M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10ZM12 9v.01";
const MEGA = "M4 10v4l10 4V6L4 10ZM14 8h3a3 3 0 0 1 0 6h-3";
const FIRE = "M12 3c3 4 5 6 5 9a5 5 0 1 1-10 0c0-3 2-5 5-9Z";

/** 필드의 정본 — **여기 말고 어디에도 적지 않는다** */
const F: Record<string, FieldDef> = {
  // 의사 창 — 전화로만 알 수 있는 것(S04b §3). 데이터에 없고 사람 머릿속에만 있다.
  intent:     { label: "매도 의사", kind: "enum", enumKey: "intent",      icon: USER },
  urgency:    { label: "급한 정도", kind: "enum", enumKey: "urgency",     icon: FIRE },
  // 정보 창 — 「물어서 아는 것」과 「밖에서 아는 것」이 다르다(§3.3)
  meongdo:    { label: "명도",     kind: "enum", enumKey: "meongdo",     icon: KEY },
  use_change: { label: "용도변경",  kind: "enum", enumKey: "use_change",  icon: TAG },
  myeolsil:   { label: "멸실",     kind: "enum", enumKey: "myeolsil",    icon: BOOM },
  nohudo:     { label: "노후도",    kind: "enum", enumKey: "nohudo",      icon: HOUSE },
  ipji:       { label: "입지",     kind: "enum", enumKey: "ipji",        icon: PIN },
  // 노출 창 — 광고는 **경쟁 정보**다(§3.5). 우리가 올리지 않아도 알아야 한다.
  ad_status:  { label: "광고 상태", kind: "enum", enumKey: "ad_status",   icon: MEGA },
  ad_off:     { label: "내린 사유", kind: "enum", enumKey: "ad_off",      icon: MEGA },
};

/** 창 = 줄 배열. 한 줄에 칩 여러 개.
 *  `gate`는 그 칸의 「끝났다 =」 조건에 들어가는 필드 — 창 머리의 「2/3」이 이걸 센다. */
export const PANE: Partial<Record<StopStage, {
  title: string; rows: string[][]; gate: string[]; sep?: Record<number, string>;
}>> = {
  intent: { title: "의사 확인", rows: [["intent"], ["urgency"]], gate: ["intent"] },
  info: {
    title: "정보",
    rows: [["meongdo"], ["use_change"], ["myeolsil"], ["nohudo", "ipji"]],
    gate: ["meongdo", "use_change", "myeolsil"],
    // 넷째 줄부터는 광고·현장에서 얻는 값이라 단계 판정에 안 들어간다(§3.3)
    sep: { 3: "밖에서 아는 것" },
  },
  match: { title: "노출", rows: [["ad_status"], ["ad_off"]], gate: ["ad_status"] },
};

export function StagePane({ stage, row, stop, onClose, onSaved }: {
  stage: StopStage;
  row: Seller;
  /** 이 매물의 열린 멈춤 — [멈춤] 칩이 곧 상태다(별도 창 없음·2026-08-17) */
  stop?: Stop | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const pane = PANE[stage];
  const { options } = useEnums();
  const [v, setV] = useState<Record<string, string | null>>(() => {
    const init: Record<string, string | null> = {};
    for (const k of Object.keys(F)) init[k] = (row as unknown as Record<string, string | null>)[k] ?? null;
    return init;
  });
  const [busy, setBusy] = useState(false);
  // [멈춤] 칩 = 상태 토글. 이 칸의 멈춤이면 켜진 채 프리필 — 끄고 저장하면 풀린다
  const mine = stop && stop.stage === stage ? stop : null;
  const [hold, setHold] = useState(!!mine);
  const [sd, setSd] = useState<StopDraft>(() => emptyStopDraft(mine));
  if (!pane) return null;

  const filled = pane.gate.filter((k) => v[k] && v[k] !== "미지정").length;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 칩이 곧 상태 — 켠 채 저장=멈춤(덮어씀) · 끈 채 저장=이 칸의 멈춤을 푼다
      if (hold) {
        await saveStop({ type: "listing", id: row.building_pk }, stage, sd);
        onSaved(); onClose(); return;
      }
      if (mine) await stopsApi.release(mine.id);
      // 창 단위로 한 번에 보낸다 — 장부에도 한 줄로 묶여 남는다(§7.5)
      const keys = pane.rows.flat();
      const body: Record<string, string | null> = {};
      for (const k of keys) body[k] = v[k] === "미지정" ? null : v[k];
      await listingsApi.patchBiz(row.building_pk, body);
      onSaved(); onClose();
    } finally { setBusy(false); }
  };

  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm" onClick={(e) => e.stopPropagation()}>
        <div className="gm-title-fix">
          {pane.title}
          {/* 채움 표시 — 필드가 늘어도 「안 찍은 게 몇 개인지」가 항상 보인다(§7.4) */}
          <span className="gm-fill num">{filled}/{pane.gate.length}</span>
        </div>

        {pane.rows.map((keys, i) => (
          <div key={i}>
            {pane.sep?.[i] && <div className="gm-sep"><span>{pane.sep[i]}</span></div>}
            <div className="gm-row">
              <svg className="gm-i" viewBox="0 0 24 24" width="17" height="17" aria-hidden
                fill="none" stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round" strokeLinejoin="round">
                <path d={F[keys[0]].icon} />
              </svg>
              <div className="gm-body wrap np-chips">
                {keys.map((k) => (
                  <Chips key={k} mode="inline" opts={options(F[k].enumKey)}
                    cur={v[k] ?? "미지정"}
                    // 함수형으로 갱신한다 — `{...v}`는 렌더 시점의 v를 붙잡아서
                    // 칩을 연달아 누르면 **앞의 선택이 사라진다**(같은 렌더의 낡은 v를 덮는다).
                    onSelect={(x) => setV((p) => ({ ...p, [k]: x === "미지정" ? null : x }))} />
                ))}
              </div>
            </div>
          </div>
        ))}

        {/* 멈춤 — 칩이 곧 상태(소유자 창과 같은 패턴). 켜면 사유·언제 다시가 펼쳐진다 */}
        <div className="gm-row">
          <span className="gm-i" />
          <div className="gm-body">
            <span className="chips-in">
              <button className={hold ? "on hold" : "hold"}
                onClick={() => setHold(!hold)}>보류</button>
            </span>
          </div>
        </div>
        {hold && <StopFields stage={stage} d={sd} onChange={setSd} />}

        <div className="gm-foot">
          <span className="sp" />
          <button className="gm-ghost quiet" onClick={onClose}>취소</button>
          <button className="gm-save" disabled={busy} onClick={save}>
            {busy ? "…" : hold ? "보류" : "저장"}</button>
        </div>
      </div>
    </div>
  ), document.body);
}
