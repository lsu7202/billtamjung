import { useState } from "react";
import { createPortal } from "react-dom";
import {
  listingsApi, overlaysApi,
  type Seller,
} from "../../shared/api/endpoints";
import {dongAddr, wonShort } from "../../shared/format";
import { useEnums } from "../../shared/hooks/useEnums";
import { Chips } from "../building/EnumField";
import { Icon } from "../../shared/ui/Icon";
import { parseAmount, seedAmount } from "../building/KV";
import { StateChip, cellCls } from "./StageRail";
import "./sales.css";

/** 정보 창 — 접촉·의사 창과 같은 본(2026-08-18).
 *
 *  칩 「정보」 하나, 색이 상태다:
 *    초록 = 물어봐야 아는 셋(명도·용도변경·멸실)이 다 찼다(확인중도 값 — 물어봤다는 사실)
 *    노랑 = 일부만 찼거나 최근 움직임 · 빨강 = 정지 사유 · 회색 = 시작 전
 *
 *  값이 「가능·불가·확인중」처럼 칸끼리 겹쳐서 여기만 라벨을 쓴다(프로필 탭과 같은 어법).
 *
 *  **정지가 없는 칸이다**(2026-08-20) — 정지는 「상대 때문에 못 간다」는 말이다(연락두절·
 *  매도의사 없음). 정보는 내가 캐면 되는 일이라 못 갈 이유가 없다 — 안 채운 것뿐이다.
 *  노후도·입지·활용도 걷었다 — 우리가 산정하는 값이지 소유자에게 캐는 값이 아니다.
 */
const GATE = [
  { key: "meongdo", label: "명도" },
  { key: "use_change", label: "용도변경" },
  { key: "myeolsil", label: "멸실" },
] as const;

export function InfoModal({ pk, addr, lastOn, row, onDetail, onClose, onSaved }: {
  pk: string;
  addr: string | null;
  /** 이 칸의 최근 움직임 — 색 판정의 근거(서버 cell_last_on) */
  lastOn?: string | null;
  row: Seller;
  /** 정본(건물 상세)으로 가는 길 — 임대내역·가격은 여기서 안 고친다(두 벌 금지) */
  onDetail: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { options } = useEnums();
  const [busy, setBusy] = useState(false);
  const init: Record<string, string | null> = {};
  for (const f of GATE) init[f.key] =
    (row as unknown as Record<string, string | null>)[f.key] ?? null;
  const [v, setV] = useState<Record<string, string | null>>(init);
  // 임대내역 — 표가 아니라 **일의 상태**(0100): 미지정=안 물어봄 · 확인중=물어봤는데 아직 ·
  // 받음=됐다(서류로 받아둔 것과 입력은 별개라 사람이 찍는다). 실제 입력(floor_rents)은
  // 파생 pill 로 따로 선다 — 상태와 데이터를 한 칩에 욱여넣지 않는다.
  const [rentChk, setRentChk] = useState<string | null>(row.rent_check ?? null);
  // 가격 — 전화로 캐는 값이라 이 창에서 바로 고친다(오버레이 sale_price·ask_price —
  // S02 와 같은 저장소, 문만 둘). 클릭-편집: 눌러야 입력이 열리고 벗어나면 닫힌다.
  const [lp, setLp] = useState<number | null>(row.list_price ?? null);
  const [ap, setAp] = useState<number | null>(row.ask_price ?? null);
  const [pEdit, setPEdit] = useState<null | "sale" | "ask">(null);
  const [pTxt, setPTxt] = useState("");
  const closePrice = () => {
    if (pEdit === null) return;
    // 빈 칸으로 두고 나가면 **지운 것**이다 — 예전엔 저장 안 하고 화면만 비워
    //   창을 닫으면 옛 값이 되살아났다(2026-08-20 버그).
    const n = pTxt.trim() ? parseAmount(pTxt) : null;
    if (pEdit === "sale") { setLp(n); void putPrice("sale_price", n); }
    else { setAp(n); void putPrice("ask_price", n); }
    setPEdit(null);
  };
  // 칩이 고른 상태(2026-08-18) — 누르면 순서대로. 저장할 때 확정된다:
  //   pre=시작 전(값 비움+표식) · go=진행 중(커밋 한 줄) · ok=완료(강제 선언) · stop=정지 사유 탭
  const [mode, setMode] = useState<null | "pre" | "go" | "stop">(null);


  // 상태 — 전부 파생(화면 값 기준). 초록 = 게이트 셋의 **답을 다 안다**.
  // 확인중은 물어봤다는 사실이지 답이 아니다 — 시도(노랑)로 센다(0091과 같은 규칙).
  const filled = GATE.filter((f) => !!v[f.key] && v[f.key] !== "확인중").length;
  const asked = [...GATE].some((f) => !!v[f.key]);

  // 노랑 = **부분 채움**(2026-08-18) — 커밋이 아니라 값이 말한다(하다 만 것)
  const recent = filled > 0 || asked;


  /** 값 하나를 그 자리에서 저장한다(2026-08-20) — 창 바닥은 [닫기] 하나다 */
  const put = async (patch: Record<string, string | null>) => {
    await listingsApi.patchBiz(pk, patch);
    onSaved();
  };
  /** 가격 오버레이 — **빈 값은 지움**이다(빈 문자열을 보낸다). 지운 값이 되살아나면 버그다 */
  const putPrice = async (key: "sale_price" | "ask_price", won: number | null) => {
    await overlaysApi.put(pk, key, won != null ? String(won) : "");
    onSaved();
  };

  const close = async () => {
    if (busy) return;
    setBusy(true);
    try { onSaved(); onClose(); } finally { setBusy(false); }
  };

  const fieldRow = (f: { key: string; label: string }) => (
    <div className="gm-row lab" key={f.key} data-fk={f.key}>
      <span className="gm-lab">{f.label}</span>
      <div className="gm-body wrap np-chips">
        <Chips mode="inline" opts={options(f.key)} cur={v[f.key] ?? "미지정"}
          onSelect={(x) => { const nv = x === "미지정" ? null : x;
                             setV((p) => ({ ...p, [f.key]: nv })); void put({ [f.key]: nv }); }} />
      </div>
    </div>
  );

  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm gm-wide" onClick={(e) => e.stopPropagation()}>
        <div className="gm-title-fix gm-title-row">
          {dongAddr(addr)}
          <StateChip label="정보"
            cls={(filled === GATE.length) ? "ok"                       // 값이 만든 완료가 최우선 —
              : mode === "go" ? "doing" : mode === "pre" ? "" : cellCls({
              done: false, stopped: false,
              lastOn: lastOn, local: recent })}
            onPick={(st) => {
              // 이 칸엔 정지가 없다 — 빨강은 건너뛴다(고를 수 없는 상태를 칩이 만들지 않게)
              if (st === "stop") return;
              setMode(st);
              if (st === "pre") { setV((x) => ({ ...x, meongdo: null, use_change: null, myeolsil: null }));  }
            }} />
        </div>

        <div className="gm-tabs">

          <div className="gm-tabbody">
            <>
              <div className="tm-call">
                {GATE.map(fieldRow)}
                {/* 아래 둘은 정본이 딴 곳이다 — 여기선 읽고, 누르면 정본으로 간다(두 벌 금지):
                    임대내역·가격=건물 상세(S02) */}
                <div className="gm-row lab">
                  <span className="gm-lab">임대내역</span>
                  <div className="gm-body wrap np-chips">
                    <Chips mode="inline"
                      opts={[{ code: "확인중", label: "확인중" }, { code: "받음", label: "받음" }]}
                      cur={rentChk ?? "미지정"}
                      onSelect={(x) => { const nv = x === "미지정" ? null : x;
                                         setRentChk(nv); void put({ rent_check: nv }); }} />
                    {!!row.rent_n && (
                      <button className="gm-fact num" onClick={onDetail}>
                        {row.rent_n}건 · 공실 {row.rent_vac ?? 0}
                        <Icon name="external" size={11} /></button>
                    )}
                  </div>
                </div>
                <div className="gm-row lab">
                  <span className="gm-lab">가격</span>
                  <div className="gm-body">
                    {/* 둘 다 늘 선다 — 빈 자리(—)가 곧 「아직 못 받았다」는 할 일이다.
                        누르면 그 자리에서 입력이 열린다(억 단위 — 150 · 148.5) */}
                    {([["sale", "매매가", lp], ["ask", "매도희망", ap]] as const).map(([k, lab, val]) =>
                      pEdit === k ? (
                        <input key={k} className="gm-in num gm-fact-in" autoFocus value={pTxt}
                          onChange={(e) => setPTxt(e.target.value)}
                          onBlur={closePrice}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing) return;
                            if (e.key === "Enter") { e.preventDefault(); closePrice(); }
                          }} />
                      ) : (
                        <button key={k} className="gm-fact num"
                          onClick={() => { setPEdit(k); setPTxt(val != null ? seedAmount(val) : ""); }}>
                          {lab} {val != null ? wonShort(val) : "—"}</button>
                      ))}
                  </div>
                </div>
              </div>
            </>
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
