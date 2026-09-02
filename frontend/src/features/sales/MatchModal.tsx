import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  buyersApi, dealApi, proposalsApi, stopsApi, schedulesApi, overlaysApi,
  type Proposal, type Stop,
} from "../../shared/api/endpoints";
import { isoDay, dongAddr, md, wonShort } from "../../shared/format";
import { parseAmount, seedAmount } from "../building/KV";
import { StopFields, StopDraft, emptyStopDraft, saveStop } from "./StopModal";
import { PickModal } from "./PickModal";
import { PersonModal } from "./PersonModal";
import { SchedModal, type SchedFinal } from "./SchedModal";
import { StateChip } from "./StageRail";
import { OfferBoard } from "./OfferBoard";
import { Icon } from "../../shared/ui/Icon";
import { BuyerFace } from "./BuyerFace";
import "./sales.css";

/** 계약 창(구 매칭 · 2026-08-19) — **매물 하나의 거래를 통째로 다루는 자리**.
 *
 *  첫 탭이 계약판이다: 매매가·매도희망 → **계약 상대** → **계약가** → **계약 일정**.
 *  누구와 · 얼마에 · 언제가 한 큐에 정해진다. 매수자 탭은 값이 오가는 자리일 뿐이다.
 *
 *  매칭·브리핑·조율을 한 창으로 접었다: 「담았다 → 보여줬다 → 값이 오간다 → 맞았다」가
 *  한 흐름이고 상대가 같은 사람이라, 칸을 셋으로 쪼개면 같은 사람을 세 번 열게 된다.
 *
 *    매수자 탭    붙은 사람들. 탭을 바꾸면 그 사람과의 일이 통째로 바뀐다
 *    브리핑      무엇으로 보여줬나(방식 칩)
 *    일정        이 매물에 걸린 약속 — 만든 것이 여기 보이고, 「일정 만들기」로 잡는다
 *    가격        매도희망 · 매수희망 · 부른 값들(오간 순서대로)
 *
 *  칩 색: 회색=쌍 없음 · 노랑=담았고 오가는 중 · **초록=합의된 쌍이 있다** · 빨강=보류.
 */
const parseJson = <T,>(v: unknown): T | null =>
  typeof v === "string" ? (JSON.parse(v) as T) : ((v ?? null) as T | null);

/** 맞았나 — **채택**됐거나(0113) 이미 계약으로 넘어간 쌍이다.
 *  전에는 합의가만 있어도 맞은 것으로 봤는데, 값이 오간 것과 「이 사람과 간다」는 다르다. */
const isAgreed = (p: Proposal) =>
  p.picked_at != null || (p.nego ?? 0) >= 3;

export function MatchModal({ pk, addr, askPrice, listPrice, proposals, hasOwner, stop, onClose, onSaved }: {
  pk: string;
  addr: string | null;
  /** 소유자를 잡았나 — 계약서를 쓸 매도인이 있는가(2026-08-20) */
  hasOwner?: boolean;
  /** (쓰지 않음) 예전엔 「최근 움직임」으로 노랑을 켰다 — 계약 칸은 값이 정본이라 뺐다 */
  /** 매도희망가 — 매도자가 원하는 값(오버레이 ask_price) · 매물 하나에 하나 */
  askPrice?: number | null;
  /** 매매가 — 시장에 내건 값(오버레이 sale_price). 협상의 기준선이라 같이 보인다 */
  listPrice?: number | null;
  proposals: Proposal[];
  stop?: Stop | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sd, setSd] = useState<StopDraft>(() => emptyStopDraft(stop));
  const [mode, setMode] = useState<null | "pre" | "go" | "stop">(null);
  const [showStop, setShowStop] = useState(!!stop);
  const [booking, setBooking] = useState(false);
  // 담기 — 탭이 아니라 동작이다(＋). 창은 어디서 열든 같은 한 벌(PickModal)
  const [adding, setAdding] = useState(false);
  const all = useQuery({ queryKey: ["buyers"], queryFn: buyersApi.list });

  const alive = proposals.filter((x) => !x.dropped_at);
  const [tab, setTab] = useState<number | "board" | "sell">("sell");
  const cur = proposals.find((x) => x.id === tab) ?? null;
  const buyer = (all.data ?? []).find((x) => x.id === cur?.buyer_id) ?? null;


  // 값 부르기 — 매도(우리가 부른 값) · 매수(상대가 부른 값)
  // 가격은 둘뿐이다 — 매도자가 원하는 값(매물) · 이 매수자가 원하는 값(쌍).
  // 부르기 같은 낱말은 없앴다(어느 값인지는 라벨이 말한다). 클릭-편집 어법.
  const [pEdit, setPEdit] = useState<null | "ask" | "hope" | "list" | "pick" | "brief">(null);
  const [pTxt, setPTxt] = useState("");
  const [bookKind, setBookKind] = useState<"brief" | "sign">("brief");
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);   // 열어 볼 약속
  const nav = useNavigate();
  // 지금 탭의 매수자 — 명함이 쓰는 사람(조건·성향은 매수자에 붙어 있다)
  // 값이 바뀔 때마다 저장된 것이 곧 이력이다 — 따로 적을 것이 없다.

  const ok = alive.some(isAgreed);
  // 최고 제시가 — 매도자 탭에서 「지금 어디까지 왔나」를 한 줄로(사람이 고르는 별표는 따로)
  const bestHope = alive.reduce<number | null>(
    (a, x) => (x.hope_price != null && (a == null || x.hope_price > a) ? x.hope_price : a), null);
  const failed = !ok && !!sd.reason;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (failed) await saveStop({ type: "listing", id: pk }, "match", sd);
      if (!failed && stop) await stopsApi.release(stop.id);
      onSaved();
      onClose();
    } finally { setBusy(false); }
  };

  const scheds = cur ? (parseJson<{ id: number; title: string; cat: string | null; on: string;
    at: string | null; state: string; method?: string | null }[]>(
    (cur as { scheds?: unknown }).scheds) ?? []) : [];
  // 브리핑 줄이 데려가는 약속 — 아직 안 한 브리핑 하나(있으면 카드로 선다)
  const picked = alive.find((x) => x.picked_at) ?? null;
  const pickScheds = picked ? (parseJson<{ id: number; title: string; cat: string | null; on: string;
    at: string | null; state: string; method?: string | null }[]>(
    (picked as { scheds?: unknown }).scheds) ?? []) : [];
  // 잡혀 있는 계약 약속(예정이든 완료든) — 있으면 만들기 대신 **보기**가 선다
  const signSched = pickScheds.find((x) => x.cat === "계약") ?? null;
  // 초록은 **한 일**이 만든다 — 잡아 둔 계약 약속은 아직 일어난 일이 아니다(0116)
  const signDone = pickScheds.some((x) => x.cat === "계약" && x.state === "완료");
  const okDone = ok && signDone;
  // 계약 체크리스트(서류) — **계약 일정이 생긴 뒤에만** 뜬다. 그 전엔 채울 근거가 없다
  // 서류는 **계약 상대가 정해지면** 바로 뜬다(2026-08-20) — 일정을 잡아야 보이던 탓에
  // 「현황엔 있는데 창엔 없다」가 됐다. 계약금·신분증은 일정 전에 챙기는 것들이다.
  const docs = useQuery({ queryKey: ["deal-docs", picked?.id], enabled: !!picked,
    queryFn: () => dealApi.docs(picked!.id) });
  const papers = docs.data?.items ?? [];   // 계약·신고·이행·잔금 — 한 벌 전부
  const briefDue = scheds.find((x) => x.cat === "브리핑" && x.state !== "완료") ?? null;

  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm gm-wide" onClick={(e) => e.stopPropagation()}>
        <div className="gm-title-fix gm-title-row">
          {dongAddr(addr)}
          {/* 창의 색은 목록·레일과 **같은 근거**를 쓴다(2026-08-19):
              초록=계약 일정 소화 · 노랑=계약 상대가 정해짐 · 회색=담기만 했거나 비었다.
              전엔 「쌍이 하나라도 있으면 노랑」이라 담기만 해도 진행 중으로 보였다. */}
          <StateChip label="계약"
            cls={okDone ? "ok" : (mode === "stop" || failed) ? "hold"
              : mode === "pre" ? "" : (picked || mode === "go") ? "doing" : ""}
            onPick={(st) => { setMode(st); if (st === "stop") setShowStop(true); }} />
        </div>

        {/* 매수자 탭 — 붙은 사람들. 탭이 곧 「누구와의 일인가」다 */}
        <div className="mm-tabs">
          {/* 매도자 — 매물 하나의 값(매매가·매도희망)이 이 탭의 내용이다.
              매수자들과 같은 줄에 서야 「이쪽이 얼마, 저쪽이 얼마」가 같은 어법으로 읽힌다 */}
          <button className={`mm-tab sell ${tab === "sell" ? "on" : ""}`}
            onClick={() => setTab("sell")}>계약</button>
          {/* 다른 매물에서 계약한 사람은 흐리게 — 여기 후보 자리는 사실상 죽었다(2026-08-20) */}
          {proposals.map((x) => (
            <span key={x.id} className={`mm-tabwrap ${tab === x.id ? "on" : ""} ${x.dropped_at || (x.buyer_dealt && !x.picked_at) ? "dead" : ""} ${x.picked_at ? "picked" : ""}`}
              title={x.buyer_dealt && !x.picked_at ? "다른 매물에서 계약한 매수자입니다" : undefined}>
              {/* 탭은 늘 이름이다 — 덮으면 선택을 막는다. 조작은 창 바닥 왼쪽 버튼으로 */}
              <button className={`mm-tab ${tab === x.id ? "on" : ""}`}
                onClick={() => setTab(x.id)}
>
                {x.buyer_name}
              </button>
            </span>
          ))}
          {/* 호가판 — 이 매물의 값 전체를 한 판에. 매도자가 부른 값과 매수자들이 부른 값이
              한자리에 서야 「누가 제일 가깝나 · 얼마를 좁혀야 하나」가 보인다 */}
          {/* 담기는 **한 벌의 창**이다(2026-08-20) — 이름 자동완성만으로는 누구에게 돌릴지를
              못 고른다. 추천(조건 기반)과 명단을 한자리에서 본다 */}
          <button className="mm-tab add" onClick={() => setAdding(true)}>＋ 매수자</button>
          <span className="sp" />
          <button className={`mm-tab board ${tab === "board" ? "on" : ""}`}
            onClick={() => setTab("board")}>호가판</button>
        </div>

        {adding && (
          <PickModal mode="buyer" buildingPk={pk} title={`매수자 담기 — ${dongAddr(addr)}`}
            onClose={() => setAdding(false)}
            onAdded={() => onSaved()} />
        )}

        <div className="gm-fields mm-body">
          {tab === "sell" ? (<>
            <div className="gm-row lab">
              <span className="gm-lab">매매가</span>
              <div className="gm-body wrap np-chips">
                {pEdit === "list" ? (
                  <input className="gm-in mm-find num" autoFocus value={pTxt}
                    onChange={(e) => setPTxt(e.target.value)}
                    onBlur={async () => {
                      const v = pTxt.trim() ? parseAmount(pTxt) : null;
                      setPEdit(null);
                      await overlaysApi.put(pk, "sale_price", v != null ? String(v) : "");
                      onSaved();
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                ) : (
                  <button className="val num"
                    onClick={() => { setPEdit("list"); setPTxt(listPrice ? seedAmount(listPrice) : ""); }}>
                    {listPrice ? wonShort(listPrice) : "—"}</button>
                )}
                <span className="dim2">시장에 내건 값</span>
              </div>
            </div>
            <div className="gm-row lab">
              <span className="gm-lab">매도희망</span>
              <div className="gm-body wrap np-chips">
                {pEdit === "ask" ? (
                  <input className="gm-in mm-find num" autoFocus value={pTxt}
                    onChange={(e) => setPTxt(e.target.value)}
                    onBlur={async () => {
                      const v = pTxt.trim() ? parseAmount(pTxt) : null;
                      setPEdit(null);
                      await overlaysApi.put(pk, "ask_price", v != null ? String(v) : "");
                      onSaved();
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                ) : (
                  <button className="val num"
                    onClick={() => { setPEdit("ask"); setPTxt(askPrice ? seedAmount(askPrice) : ""); }}>
                    {askPrice ? wonShort(askPrice) : "—"}</button>
                )}
                <span className="dim2">매도자가 원하는 값</span>
              </div>
            </div>
            {askPrice != null && bestHope != null && !picked && (
              <div className="gm-row lab">
                <span className="gm-lab">최고 제시</span>
                <div className="gm-body wrap np-chips">
                  <span className="val num still">{wonShort(bestHope)}</span>
                  <span className="dim2 num">갭 {wonShort(Math.abs(askPrice - bestHope))}</span>
                </div>
              </div>
            )}

            {/* 계약 — **여기서 한 큐에 끝난다**(2026-08-19): 누구와 → 얼마에 → 언제.
                매수자 탭은 값이 오가는 자리고, 정해지는 자리는 이 탭 하나다.
                상대만 고르면 노랑(부분 채움), 계약가까지 서면 초록 — 값이 만드는 초록이다. */}
            {/* 매도인이 없으면 계약서를 못 쓴다(2026-08-20). 막지는 않는다 — 구두합의가
                먼저 서는 일이 있다. 다만 그 사실은 정하는 자리에서 보여야 한다. */}
            {!hasOwner && (
              <div className="gm-row lab">
                <span className="gm-lab" />
                <div className="gm-body"><span className="warn">소유자 미확보 — 계약서를 쓸 매도인이 없습니다</span></div>
              </div>
            )}

            <div className="gm-row lab">
              <span className="gm-lab">계약 상대</span>
              <div className="gm-body wrap np-chips">
                {alive.length === 0 ? <span className="dim2">담은 매수자가 없다</span> : (
                  <span className="multi">
                    {alive.map((x) => {
                      const on = !!x.picked_at;
                      return (
                        <button key={x.id} className={on ? "on" : ""}
                          onClick={async () => {
                            // 눌린 칩 재클릭 = 취소(창 공통 어법). 확정가도 같이 풀린다
                            await dealApi.patch(x.id, on ? { picked: false }
                              : { picked: true, pick_price: x.hope_price ?? undefined });
                            onSaved();
                          }}>{x.buyer_name}</button>
                      );
                    })}
                  </span>
                )}
              </div>
            </div>

            {picked && (<>
              <div className="gm-row lab">
                <span className="gm-lab">계약가</span>
                <div className="gm-body wrap np-chips">
                  {pEdit === "pick" ? (
                    <input className="gm-in mm-find num" autoFocus value={pTxt}
                      onChange={(e) => setPTxt(e.target.value)}
                      onBlur={async () => {
                        const v = pTxt.trim() ? parseAmount(pTxt) : null;
                        setPEdit(null);
                        if (v == null) return;
                        await dealApi.patch(picked.id, { picked: true, pick_price: v });
                        onSaved();
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                  ) : (
                    <button className={`val num ${picked.deal_price ? "ok" : ""}`}
                      onClick={() => { setPEdit("pick"); setPTxt(picked.deal_price ? seedAmount(picked.deal_price) : seedAmount(picked.hope_price ?? 0)); }}>
                      {picked.deal_price ? wonShort(picked.deal_price) : "—"}</button>
                  )}
                  {picked.hope_price != null && picked.deal_price != null
                    && picked.hope_price !== picked.deal_price && (
                    <span className="dim2 num">매수희망 {wonShort(picked.hope_price)}</span>
                  )}
                  {/* 계약 일정 — 값 바로 옆이다. 얼마에 가는지와 언제 만나는지는 한 호흡이다 */}

                  {signSched ? (
                    // 이미 잡혀 있으면 **보기**다 — 있는 약속을 두고 「만들기」가 서면 두 개가 생긴다
                    <span className={`due ${signSched.state === "완료" ? "done" : ""}`}>
                      <button className="act" onClick={() => setViewing(signSched.id)}>
                        <b className="num">{md(signSched.on)}</b> 계약 일정</button>
                      {signSched.state !== "완료" && (
                        <button className="act" onClick={async () => {
                          await schedulesApi.patch(signSched.id, { state: "완료" });
                          onSaved();
                        }} title="했다"><Icon name="check" size={14} /></button>
                      )}
                    </span>
                  ) : (
                    <button className="act" onClick={() => { setBookKind("sign"); setBooking(true); }}>
                      계약 일정 만들기</button>
                  )}
                </div>
              </div>

              {papers.length > 0 && (
                <div className="gm-row lab">
                  <span className="gm-lab">서류</span>
                  <div className="gm-body dd-grid">
                    {papers.map((d) => (
                      <label className="dd-item" key={d.code}>
                        <input type="checkbox" checked={d.done}
                          onChange={async (e) => {
                            await dealApi.toggleDoc(picked!.id, d.code, e.target.checked);
                            // 서류 하나가 칸의 색을 바꾼다(신고 = 체크·0124) — 목록·레일도 같이 갱신
                            docs.refetch(); onSaved();
                          }} />
                        <span className={d.done ? "done" : ""}>{d.actor} · {d.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>)}
                  </>) : tab === "board" ? (
            <OfferBoard pk={pk} />
          ) : cur ? (<>
            {/* 매수자 명함 — 업무 탭과 **같은 얼굴**(레일만 뺀다).
                여기서 관리할 것은 둘뿐이다: 브리핑을 했나 · 얼마를 부르나.
                계약 일정·계약가는 계약 탭에서 다룬다(같은 걸 두 군데서 고치지 않는다). */}
            {buyer && (
              <BuyerFace b={buyer} compact
                onOpenCond={(c) => nav("/search", { state: { applyCond: c.conditions_json } })}
                onEditCond={(c) => nav("/search", { state: { buyerCond: {
                  buyer_id: buyer.id, buyer_name: buyer.name,
                  cond_id: c?.id ?? null, name: c?.name ?? "새 조건",
                  conditions: c?.conditions_json ?? {} } } })}
                onDelCond={async (cid, name) => {
                  if (!confirm(`조건 「${name}」을(를) 지울까요?`)) return;
                  await buyersApi.removeCondition(cid); all.refetch();
                }}
                />
            )}
            {/* 브리핑 — 무엇으로 보여줬나 */}
            {/* 브리핑 — 한 줄기다(2026-08-19):
                  ① 비어 있으면 「브리핑 일정 만들기」
                  ② 약속을 잡으면 그 자리에 **약속 카드**(날짜·방식·[했다])
                  ③ 소화하면 카드가 사라지고 그 방식이 **브리핑 값**으로 켜진다 */}
            <div className="gm-row lab">
              <span className="gm-lab">브리핑</span>
              <div className="gm-body col">
                {/* 윗줄 = 어디서 · 오른쪽 끝은 약속(부가). 아랫줄 = 무엇을 */}
                <span className="br-top">
                <span className="multi">
                    {["현장에서", "사무실에서", "전화", "자료 발송"].map((k) => {
                      const on = (cur.brief_how ?? []).includes(k);
                      return (
                        <button key={k} className={on ? "on" : ""}
                          onClick={async () => {
                            const now = cur.brief_how ?? [];
                            const next = on ? now.filter((v) => v !== k) : [...now, k];
                            await dealApi.patch(cur.id, next.length
                              ? { brief_how: next } : { clear: ["brief_how"] });
                            onSaved();
                          }}>{k}</button>
                      );
                    })}
                  </span>
                  <span className="sp" />
                {briefDue ? (
                    <span className="due">
                      <b className="num">{md(briefDue.on)}</b> 브리핑 일정
                      <button className="act" onClick={async () => {
                        await schedulesApi.patch(briefDue.id, { state: "완료" });
                        const m = briefDue.method;
                        if (m) {
                          const now = cur.brief_how ?? [];
                          if (!now.includes(m)) await dealApi.patch(cur.id, { brief_how: [...now, m] });
                        }
                        onSaved();
                      }} title="했다"><Icon name="check" size={14} /></button>
                    </span>
                  ) : (
                    <button className="act quiet" onClick={() => { setBookKind("brief"); setBooking(true); }}>브리핑 일정 만들기</button>
                  )}
                </span>
                {/* 무엇을 보여줬나 — 브리핑은 「어디서 + 무엇을」 한 세트다(0123).
                    내용이 비어도 어디서가 찍혔으면 브리핑은 한 것이다(체크는 방식이 만든다) */}
                {pEdit === "brief" ? (
                  <input className="gm-in mm-find" autoFocus value={pTxt}
                    onChange={(e) => setPTxt(e.target.value)}
                    onBlur={async () => {
                      const v = pTxt.trim();
                      setPEdit(null);
                      if (v === (cur.brief_note ?? "")) return;
                      await dealApi.patch(cur.id, v ? { brief_note: v } : { clear: ["brief_note"] });
                      onSaved();
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                ) : (
                  <button className={`act ${cur.brief_note ? "" : "quiet"}`}
                    onClick={() => { setPEdit("brief"); setPTxt(cur.brief_note ?? ""); }}>
                    {cur.brief_note ?? "무엇을 보여줬나"}</button>
                )}
              </div>
            </div>

            {/* 일정 — 만든 약속이 여기 보인다. 완료도 여기서 찍는다 */}

            <>
              <div className="gm-row lab">
                <span className="gm-lab">매수희망</span>
                <div className="gm-body wrap np-chips">
                  {pEdit === "hope" ? (
                    <input className="gm-in mm-find num" autoFocus value={pTxt}
                      onChange={(e) => setPTxt(e.target.value)}
                      onBlur={async () => {
                        const v = pTxt.trim() ? parseAmount(pTxt) : null;
                        setPEdit(null);
                        await proposalsApi.update(cur.id, { hope_price: v ?? undefined, side: "매수" });
                        onSaved();
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                  ) : (
                    <button className="val num"
                      onClick={() => { setPEdit("hope"); setPTxt(cur.hope_price ? seedAmount(cur.hope_price) : ""); }}>
                      {cur.hope_price ? wonShort(cur.hope_price) : "—"}</button>
                  )}
                  {askPrice != null && cur.hope_price != null && (
                    <span className="dim2 num">차이 {wonShort(Math.abs(askPrice - cur.hope_price))}</span>
                  )}
                </div>
              </div>

            </>

          </>) : null}

          {/* 정지 — 창의 맨 아래 한 구획(탭이 아니다) */}
          {(
            <div className="mm-stop">
              <div className="gm-sep">정지 — 지금은 못 간다</div>
              <StopFields stage="match" full d={sd} onChange={setSd} />
            </div>
          )}
        </div>

        <div className="gm-foot">
          {/* 지우는 일은 저장과 같은 급의 결정이라 같은 자리(바닥)에 둔다 — 다만 반대편 */}
          {typeof tab === "number" && cur && (
            <button className="gm-del" onClick={async () => {
              if (!confirm(`${cur.buyer_name}과의 쌍을 해제할까요? 제안 장부가 함께 지워집니다.`)) return;
              await proposalsApi.remove(cur.id);
              setTab(alive.find((y) => y.id !== cur.id)?.id ?? "sell");
              onSaved();
            }}>이 매수자 빼기</button>
          )}
          <span className="sp" />
          {/* 값은 고치는 즉시 저장된다 — 그래서 평소엔 **닫기** 하나다(2026-08-20).
              [취소][저장]은 아직 안 저장된 것이 있을 때만 선다: 지금은 정지 사유가 그렇다.
              늘 세워 두면 「저장을 눌러야 남는다」는 거짓 약속이 된다. */}
          {showStop || failed ? (<>
            <button className="gm-ghost quiet" onClick={onClose}>취소</button>
            <button className="gm-save" disabled={busy} onClick={save}>{busy ? "…" : "저장"}</button>
          </>) : (
            <button className="gm-ghost quiet" onClick={onClose}>닫기</button>
          )}
        </div>
      </div>

      {/* 명함의 「편집」 — 등록과 **같은 창**을 쓴다(폼이 두 벌이면 항목이 어긋난다) */}
      {editing && buyer && (
        <PersonModal kind="buyer"
          init={{ id: buyer.id, name: buyer.name, phone: buyer.phone_masked ? null : buyer.phone,
            is_corp: buyer.is_corp, grade: buyer.grade, source: buyer.source,
            age_band: buyer.age_band, gender: buyer.gender, cooperation: buyer.cooperation,
            kindness: buyer.kindness, memo: buyer.memo,
            is_agent: buyer.is_agent, urgency: buyer.urgency }}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); all.refetch(); onSaved(); }} />
      )}

      {/* 잡혀 있는 약속 열어 보기 — 캘린더에서 여는 창과 같은 것(고치기·되돌리기 그대로) */}
      {viewing != null && (() => {
        const sc = pickScheds.find((x) => x.id === viewing);
        if (!sc) return null;
        return (
          <SchedModal
            // 열어 봐도 금액은 **계약가 그대로** — 여기서 고치면 확정가가 따라 바뀐다(거울)
            init={{ title: sc.title, on: sc.on, at: sc.at, category: sc.cat ?? "일반",
                    amount: sc.cat === "계약" ? (picked?.deal_price ?? undefined) : undefined } as never}
            addr={addr} buildingPk={pk}
            initExtras={{
              중도금: (() => { const y = pickScheds.find((z) => z.cat === "중도금");
                              return y ? { on: y.on, at: y.at } : null; })(),
              잔금: (() => { const y = pickScheds.find((z) => z.cat === "잔금");
                            return y ? { on: y.on, at: y.at } : null; })(),
            }}
            base={picked ? { kind: "buyer", ref_id: picked.buyer_id, label: picked.buyer_name ?? "" } : null}
            onCancel={() => setViewing(null)}
            onSkip={() => setViewing(null)}
            onDone={async (sf: SchedFinal) => {
              setViewing(null);
              await schedulesApi.patch(sc.id, {
                on_date: sf.on, at_time: sf.at ?? "", title: sf.title,
                people: sf.people, category: sf.category });
              if (sc.cat === "계약" && sf.amount != null && sf.amount !== picked?.deal_price) {
                await dealApi.patch(picked!.id, { picked: true, pick_price: sf.amount });
              }
              // 중도금·잔금 — 있으면 고치고, 지웠으면 지우고, 새로 잡았으면 만든다(한 자리에서)
              for (const k of ["중도금", "잔금"] as const) {
                const had = pickScheds.find((y) => y.cat === k);
                const now = (sf.extras ?? []).find((y) => y.category === k);
                if (had && now) {
                  if (had.on !== now.on || (had.at ?? null) !== (now.at ?? null)) {
                    await schedulesApi.patch(had.id, { on_date: now.on, at_time: now.at ?? "" });
                  }
                } else if (had && !now) {
                  await schedulesApi.remove(had.id);
                } else if (!had && now) {
                  await proposalsApi.update(picked!.id, { cell: "pay", schedule: {
                    title: `${k} — ${dongAddr(addr)}`.trim(), on: now.on, at: now.at ?? null,
                    category: k, building_pk: pk, people: sf.people,
                  } as never });
                }
              }
              onSaved();
            }} />
        );
      })()}

      {booking && (() => {
        // 브리핑은 지금 보고 있는 매수자와, 계약은 **계약 상대**와 잡는다.
        // 계약 일정 창엔 계약가가 미리 들어간다 — 거기서 고친 금액이 확정가가 된다(거울).
        const t = bookKind === "sign" ? picked : cur;
        if (!t) return null;
        const kindKo = bookKind === "sign" ? "계약" : "브리핑";
        return (
          <SchedModal
            init={{ title: `${kindKo} — ${bookKind === "sign" ? dongAddr(addr) : (t.buyer_name ?? "")}`.trim(),
              on: isoDay(), at: null,
              category: kindKo,
              amount: bookKind === "sign" ? (t.deal_price ?? undefined) : undefined } as never}
            addr={addr} buildingPk={pk}
            base={{ kind: "buyer", ref_id: t.buyer_id, label: t.buyer_name ?? "" }}
            onCancel={() => setBooking(false)}
            onSkip={() => setBooking(false)}
            onDone={async (sf: SchedFinal) => {
              setBooking(false);
              await proposalsApi.update(t.id, { schedule: sf as never,
                                                cell: bookKind === "sign" ? "sign" : "brief" });
              // 계약 창에서 같이 잡은 중도금·잔금 — 각각 제 약속으로 선다(나중에 따로 고친다)
              for (const x of sf.extras ?? []) {
                await proposalsApi.update(t.id, { cell: "pay", schedule: {
                  title: `${x.category} — ${dongAddr(addr)}`.trim(), on: x.on, at: x.at ?? null,
                  category: x.category, building_pk: pk,
                  people: sf.people,
                } as never });
              }
              onSaved();
            }} />
        );
      })()}
    </div>
  ), document.body);
}
