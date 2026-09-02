import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  convertApi, listingsApi, stopsApi, type Stop,
} from "../../shared/api/endpoints";
import { dongAddr, md } from "../../shared/format";
import { useEnums } from "../../shared/hooks/useEnums";
import { Chips } from "../building/EnumField";
import { StopFields, StopDraft, emptyStopDraft, saveStop } from "./StopModal";
import { StateChip, cellCls } from "./StageRail";
import "./sales.css";

/** 접촉 창 — 소유자 창과 같은 본(2026-08-18).
 *
 *  칩은 「접촉」 하나, 색이 상태다(글씨를 늘리지 않는다):
 *    초록 = 닿았다(통화됨 또는 물어봐야 아는 값이 찍힘 — 서버 파생 s2_touch)
 *    빨강 = 정지(사유가 골라져 있다 — 연락두절 등)
 *    노랑 = 최근 7일 움직임 · 회색 = 시작 전(노랑 칩을 눌러 손으로도 되돌린다)
 *
 *  장부는 **접촉 관련 줄만** — 이 창의 메모(kind=접촉)·통화 칩(kind=통화)·「접촉 …」 자동 줄.
 *  다른 창의 커밋은 여기 안 선다(창의 커밋은 그 창의 것).
 */

export function TouchModal({ pk, addr, lastOn, touched, callResult,
                             intent, urgency, sellOn, sellVague, ownerBuyerId,
                             stop, onClose, onSaved }: {
  pk: string;
  addr: string | null;
  /** 의사 — 합친 칸의 완료 근거(0125). 원함이면 이 칸은 끝이다 */
  intent?: string | null;
  urgency?: string | null;
  sellOn?: string | null;
  sellVague?: string | null;
  /** 매수도 원함 — 명단에 올라가 있으면 그 id */
  ownerBuyerId?: number | null;
  /** 이 칸의 최근 움직임 — 색 판정의 근거(서버 cell_last_on) */
  lastOn?: string | null;
  /** 서버 파생 s2_touch — 통화됨 또는 물어봐야 아는 값이 찍혔다 */
  touched: boolean;
  /** 마지막 통화 결과(listings.call_result) — 통화 탭의 초기값 */
  callResult: string | null;
  /** 접촉 칸의 열린 정지(stage=touch)만 */
  stop?: Stop | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { options } = useEnums();
  const [busy, setBusy] = useState(false);
  const [sd, setSd] = useState<StopDraft>(() => emptyStopDraft(stop));
  const [pick, setPick] = useState<string | null>(callResult ?? null);
  const [iv, setIv] = useState<string | null>(intent ?? null);
  const [uv, setUv] = useState<string | null>(urgency ?? null);
  const [when, setWhen] = useState<string | null>(sellVague ?? null);
  const [whenOn, setWhenOn] = useState<string>(sellOn ? sellOn.slice(0, 10) : "");
  const [buyToo, setBuyToo] = useState(!!ownerBuyerId);
  // 칩이 고른 상태(2026-08-18) — 누르면 순서대로. 저장할 때 확정된다:
  //   pre=시작 전(값 비움+표식) · go=진행 중(커밋 한 줄) · ok=완료(강제 선언) · stop=정지 사유 탭
  const [mode, setMode] = useState<null | "pre" | "go" | "stop">(null);

  // 기록 초안 — 엔터는 줄을 쌓기만, 커밋은 [저장]에서만 태어난다(소유자 창과 같은 규칙)

  // 상태 — 전부 파생. 초록 = 닿았다(서버 파생 또는 지금 고른 「통화됨」).
  // 부재중·전원꺼짐… 은 **시도**다 — 고르는 순간 노랑(진행 중), 저장하면 장부 한 줄로 남는다.
  // 초록은 화면 값이 우선 — 결과를 지우면(되돌리기) 그 자리에서 회색으로 내려온다.
  // (서버 파생 touched 는 결과가 그대로일 때만 근거가 된다)
  // 합친 칸(0125): 완료 = 팔 생각을 안다(원함) · 노랑 = 말은 됐다 · 회색 채움 = 걸었는데 안 됐다
  const ok = iv === "원함";
  const talked = pick === "통화됨" || (touched && pick === callResult) || !!iv || !!uv;
  const failed = !ok && !!sd.reason;
  const pill = useRef<HTMLInputElement>(null);

  // 되돌리기 — 「접촉 시작 전」 표식 줄 이후의 움직임만 노랑으로 센다
  // 노랑 = **부분 채움**(2026-08-18) — 커밋이 아니라 값이 말한다(하다 만 것)
  const recent = !!pick || !!iv || !!uv || !!when || !!whenOn;


  /** 값 하나를 그 자리에서 저장한다(2026-08-20) — 창은 [닫기] 하나뿐이다.
   *  「저장을 눌러야 남는다」는 약속을 없앴다: 누르는 순간이 곧 저장이다. */
  const put = async (patch: Record<string, string | null>) => {
    await listingsApi.patchBiz(pk, patch);
    onSaved();
  };

  /** 닫기 — 정지 그룹은 초안이라 여기서 매듭짓는다(사유가 있으면 세우고, 없으면 깨운다) */
  const close = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (failed) await saveStop({ type: "listing", id: pk }, "touch", sd);
      if (!failed && stop) await stopsApi.release(stop.id);
      // 통화 결과가 바뀌었으면 필드와 장부를 같이 쓴다 — 지움(null)도 저장이다(되돌리기)
      onSaved();
      onClose();
    } finally { setBusy(false); }
  };


  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm gm-wide" onClick={(e) => e.stopPropagation()}>
        <div className="gm-title-fix gm-title-row">
          {dongAddr(addr)}
          <StateChip label="접촉"
            cls={ok ? "ok"
              : (mode === "stop" || failed) ? "hold"
              : talked ? "doing"
              : mode === "go" ? "doing" : mode === "pre" ? "" : cellCls({
              done: false, stopped: failed,
              lastOn: lastOn, local: recent })}
            onPick={(st) => {
              setMode(st);
              // 정지 그룹은 늘 화면 아래에 있다 — 칩에서 빨강을 골라도 따로 열 것이 없다
              if (st === "stop") return;
              if (st === "pre") { setPick(null); }
            }} />
        </div>

        <div className="gm-tabs">
          <div className="gm-tabbody">
            <>
              {/* 통화 결과가 흐름의 입구다 — 통화됨이면 무슨 얘기였는지 바로 아래에 적는다.
                  부재중·전원꺼짐… 은 시도(노랑). 끝내 안 되면 왼쪽 정지 사유로(빨강). */}
              <div className="tm-call">
                <div className="gm-row lab">
                  <span className="gm-lab">통화</span>
                  <div className="gm-body wrap np-chips">
                <Chips mode="inline" opts={options("call_result")} cur={pick ?? "미지정"}
                  onSelect={(v) => {
                    const nv = v === "미지정" ? null : v;
                    setPick(nv); void put({ call_result: nv });
                    if (nv === "통화됨") pill.current?.focus();
                  }} />
                  </div>
                </div>
                {/* 통화가 되면 그 자리에서 묻는 것들 — 창을 또 열지 않는다(0125에서 합쳤다).
                    「원치 않음」은 값이 아니라 **정지**다(왼쪽 정지 사유). */}
                <div className="gm-row lab">
                  <span className="gm-lab">의사</span>
                  <div className="gm-body wrap np-chips">
                    <Chips mode="inline" opts={options("intent")} cur={iv ?? "미지정"}
                      onSelect={(v) => { const nv = v === "미지정" ? null : v;
                                         setIv(nv); void put({ intent: nv }); }} />
                  </div>
                </div>
                <div className="gm-row lab">
                  <span className="gm-lab">급함</span>
                  <div className="gm-body wrap np-chips">
                    <Chips mode="inline" opts={options("urgency")} cur={uv ?? "미지정"}
                      onSelect={(v) => { const nv = v === "미지정" ? null : v;
                                         setUv(nv); void put({ urgency: nv }); }} />
                  </div>
                </div>
                <div className="gm-row lab">
                  <span className="gm-lab">시기</span>
                  <div className="gm-body wrap np-chips im-when">
                    <Chips mode="inline" opts={options("sell_vague")} cur={when ?? "미지정"}
                      onSelect={(v) => { const nv = v === "미지정" ? null : v;
                                         setWhen(nv); if (nv) setWhenOn("");
                                         void put({ sell_vague: nv, ...(nv ? { sell_on: null } : {}) }); }} />
                    <label className="gm-date num">
                      {whenOn ? md(whenOn) : "날짜로"}
                      <input type="date" value={whenOn}
                        onChange={(e) => { const v = e.target.value; setWhenOn(v);
                                           if (v) setWhen(null);
                                           void put({ sell_on: v || null, ...(v ? { sell_vague: null } : {}) }); }} />
                    </label>
                  </div>
                </div>
                <div className="gm-row lab">
                  <span className="gm-lab">전환</span>
                  <div className="gm-body wrap np-chips">
                    <Chips mode="inline" opts={[{ code: "매수도 원함", label: "매수도 원함" }]}
                      cur={buyToo ? "매수도 원함" : "미지정"}
                      onSelect={async (x) => {
                        const on = x === "매수도 원함";
                        setBuyToo(on);
                        if (on && !ownerBuyerId) await convertApi.ownerToBuyer(pk);
                        if (!on && ownerBuyerId) await convertApi.ownerFromBuyer(pk);
                        onSaved();
                      }} />
                  </div>
                </div>
              </div>
            </>

            {/* 정지 — **한 화면 아래 그룹**(2026-08-20). 탭으로 숨기면 「왜 멈췄나」가
                다른 방에 갇힌다. 값과 같은 화면에서 이어 읽힌다. */}
            {(
              <div className="mm-stop">
                <div className="gm-sep">정지 — 지금은 못 간다</div>
                <StopFields stage="touch" full d={sd} onChange={setSd} />
              </div>
            )}
          </div>
        </div>

        <div className="gm-foot">
          <span className="sp" />
          <button className="gm-ghost quiet" disabled={busy} onClick={close}>{busy ? "…" : "닫기"}</button>
        </div>
      </div>
    </div>
  ), document.body);
}
