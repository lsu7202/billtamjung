import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dealApi, proposalsApi, salesApi, schedulesApi,
         type Proposal } from "../../shared/api/endpoints";
import { StateChip } from "./StageRail";
import { Icon } from "../../shared/ui/Icon";
import { SchedModal, type SchedFinal } from "./SchedModal";
import { PickModal } from "./PickModal";
import { parseAmount, seedAmount } from "../building/KV";
import { dongAddr, isoDay, md, wonShort } from "../../shared/format";
import "./sales.css";

/** 매수자의 계약 창 — **매물 창을 뒤집은 것**(2026-08-19).
 *
 *  매물 창은 「매물 하나 + 매수자 탭」이고, 이 창은 「사람 하나 + 매물 탭」이다.
 *  같은 창을 돌려 쓰면 매수자 화면에서 남의 매물 값(매매가·매도희망)을 고치게 되고,
 *  정작 이 사람에게 궁금한 것 — **어느 매물을 어디까지 보여줬나** — 이 안 보인다.
 *
 *  탭 하나 = 담아 둔 매물 하나. 그 안에서 답하는 것은 셋이다:
 *    브리핑 했나 · 매도자는 얼마를 원하나 · 이 사람은 얼마를 부르나.
 *  계약 상대를 정하는 일은 **매물 쪽 창**이 한다(한 매물에 상대는 하나뿐이라 그쪽이 정본).
 */
const md2 = (s: string | null | undefined) => (s ? md(s) : "");

export function BuyerDealModal({ buyerId, buyerName, onClose, onSaved }: {
  buyerId: number; buyerName: string; onClose: () => void; onSaved: () => void;
}) {
  // 값은 **매물 창과 같은 곳에서 온다**(거울): 매수희망=쌍(proposals.hope_price),
  // 매도희망·매매가=매물 오버레이(ask_price·sale_price). 한쪽에서 고치면 다른 쪽도 바뀌어야
  // 하므로 저장 뒤 두 목록을 함께 무효화한다 — 캐시가 갈리면 같은 값이 두 개가 된다.
  const qc = useQueryClient();
  const sync = () => {
    qc.invalidateQueries({ queryKey: ["proposals"] });
    qc.invalidateQueries({ queryKey: ["sellers"] });
    qc.invalidateQueries({ queryKey: ["buyers"] });
    onSaved();
  };
  const props = useQuery({ queryKey: ["proposals", buyerId],
    queryFn: () => proposalsApi.list({ buyer_id: buyerId }) });
  const sellers = useQuery({ queryKey: ["sellers"], queryFn: () => salesApi.sellers() });
  const rows = (props.data ?? []).filter((x) => !x.dropped_at);
  const [tab, setTab] = useState<number | null>(null);
  const cur: Proposal | null = rows.find((x) => x.id === tab) ?? rows[0] ?? null;
  const s = (sellers.data ?? []).find((x) => x.building_pk === cur?.building_pk) ?? null;
  const [edit, setEdit] = useState(false);
  const [txt, setTxt] = useState("");
  const [booking, setBooking] = useState(false);
  const [pick, setPick] = useState(false);   // 담기 창(매물)
  const [bEdit, setBEdit] = useState(false);
  const [bTxt, setBTxt] = useState("");

  const scheds = cur ? (() => {
    const raw = (cur as { scheds?: unknown }).scheds;
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return (arr as { id: number; cat: string | null; on: string; at: string | null;
                     state: string; title: string }[] | null) ?? [];
  })() : [];
  const briefDue = scheds.find((x) => x.cat === "브리핑" && x.state !== "완료") ?? null;
  const signDone = scheds.some((x) => x.cat === "계약" && x.state === "완료");
  // 서류 — 쌍의 것이라 매수자 창에서도 같은 목록을 본다(체크도 여기서 된다)
  const docs = useQuery({ queryKey: ["deal-docs", cur?.id], enabled: !!cur?.picked_at,
    queryFn: () => dealApi.docs(cur!.id) });
  const papers = docs.data?.items ?? [];

  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm gm-wide" onClick={(e) => e.stopPropagation()}>
        <div className="gm-title-fix gm-title-row">
          {buyerName}
          {/* 상태는 매물 창과 **같은 규칙**이다: 계약 일정을 소화했으면 초록,
              계약 상대로 정해졌으면 노랑, 담아만 뒀으면 회색 채움. 여기서 고르지 않는다. */}
          <StateChip label="계약" cls={signDone ? "ok" : cur?.picked_at ? "doing" : cur ? "half" : ""}
            onPick={() => {}} />
        </div>

        {/* 담아 둔 매물 = 탭. 「이 사람에게 무엇을 보여줬나」가 창의 뼈대다 */}
        <div className="mm-tabs">
          {rows.map((x) => (
            <button key={x.id} className={`mm-tab ${x.id === cur?.id ? "on" : ""}`}
              onClick={() => setTab(x.id)}>
              {dongAddr(x.addr) || x.building_pk}</button>
          ))}
          {/* 담기 — 창을 닫고 프로필로 돌아가지 않아도 여기서 바로 담는다(2026-08-20) */}
          <button className="mm-tab add" onClick={() => setPick(true)}>＋ 매물</button>
        </div>
        {pick && (
          <PickModal mode="listing" buyerId={buyerId} title={`매물 담기 — ${buyerName}`}
            onClose={() => setPick(false)} onAdded={sync} />
        )}

        <div className="gm-fields mm-body">
          {!cur ? <div className="dim2">담은 매물이 없습니다 — 프로필 창의 「담기」에서 담습니다</div> : (<>
            <div className="gm-row lab">
              <span className="gm-lab">브리핑</span>
              <div className="gm-body col">
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
                            props.refetch(); sync();
                          }}>{k}</button>
                      );
                    })}
                  </span>
                  <span className="sp" />
                {briefDue ? (
                    <span className="due">
                      <b className="num">{md2(briefDue.on)}</b> 브리핑 일정
                      <button className="act" title="했다" onClick={async () => {
                        await schedulesApi.patch(briefDue.id, { state: "완료" });
                        props.refetch(); sync();
                      }}><Icon name="check" size={14} /></button>
                    </span>
                  ) : (
                    <button className="act quiet" onClick={() => setBooking(true)}>브리핑 일정 만들기</button>
                  )}
                </span>
                {/* 무엇을 보여줬나 — 어디서와 한 세트(0123) */}
                {bEdit ? (
                  <input className="gm-in mm-find" autoFocus value={bTxt}
                    onChange={(e) => setBTxt(e.target.value)}
                    onBlur={async () => {
                      const v = bTxt.trim();
                      setBEdit(false);
                      if (v === (cur.brief_note ?? "")) return;
                      await dealApi.patch(cur.id, v ? { brief_note: v } : { clear: ["brief_note"] });
                      props.refetch(); sync();
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                ) : (
                  <button className={`act ${cur.brief_note ? "" : "quiet"}`}
                    onClick={() => { setBEdit(true); setBTxt(cur.brief_note ?? ""); }}>
                    {cur.brief_note ?? "무엇을 보여줬나"}</button>
                )}
              </div>
            </div>

            <div className="gm-row lab">
              <span className="gm-lab">매도희망</span>
              <div className="gm-body wrap np-chips">
                {/* 매도자의 값이라 여기서는 **읽기만** 한다 — 고치는 자리는 매물 창이다 */}
                <span className="val num still">{s?.ask_price ? wonShort(s.ask_price) : "—"}</span>
                {s?.list_price != null && (
                  <span className="dim2 num">매매가 {wonShort(s.list_price)}</span>
                )}
              </div>
            </div>

            <div className="gm-row lab">
              <span className="gm-lab">매수희망</span>
              <div className="gm-body wrap np-chips">
                {edit ? (
                  <input className="gm-in mm-find num" autoFocus value={txt}
                    onChange={(e) => setTxt(e.target.value)}
                    onBlur={async () => {
                      const v = txt.trim() ? parseAmount(txt) : null;
                      setEdit(false);
                      await proposalsApi.update(cur.id, { hope_price: v ?? undefined, side: "매수" });
                      props.refetch(); sync();
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                ) : (
                  <button className="val num"
                    onClick={() => { setEdit(true); setTxt(cur.hope_price ? seedAmount(cur.hope_price) : ""); }}>
                    {cur.hope_price ? wonShort(cur.hope_price) : "—"}</button>
                )}
                {s?.ask_price != null && cur.hope_price != null && (
                  <span className="dim2 num">차이 {wonShort(Math.abs(s.ask_price - cur.hope_price))}</span>
                )}
              </div>
            </div>

            {cur.picked_at && papers.length > 0 && (
              <div className="gm-row lab">
                <span className="gm-lab">서류</span>
                <div className="gm-body dd-grid">
                  {papers.map((d) => (
                    <label className="dd-item" key={d.code}>
                      <input type="checkbox" checked={d.done}
                        onChange={async (e) => {
                          await dealApi.toggleDoc(cur.id, d.code, e.target.checked);
                          docs.refetch(); props.refetch(); sync();
                        }} />
                      <span className={d.done ? "done" : ""}>{d.actor} · {d.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {cur.picked_at && (
              <div className="gm-row lab">
                <span className="gm-lab">계약</span>
                <div className="gm-body wrap np-chips">
                  <span className="val num still ok">
                    이 매물의 계약 상대 {cur.deal_price ? `· ${wonShort(cur.deal_price)}` : ""}</span>
                </div>
              </div>
            )}
          </>)}
        </div>

        <div className="gm-foot">
          <span className="sp" />
          <button className="gm-ghost quiet" onClick={onClose}>닫기</button>
        </div>
      </div>

      {booking && cur && (
        <SchedModal
          init={{ title: `브리핑 — ${buyerName}`, on: isoDay(), at: null, category: "브리핑" } as never}
          addr={cur.addr ?? null} buildingPk={cur.building_pk}
          base={{ kind: "buyer", ref_id: buyerId, label: buyerName }}
          onCancel={() => setBooking(false)}
          onSkip={() => setBooking(false)}
          onDone={async (sf: SchedFinal) => {
            setBooking(false);
            await proposalsApi.update(cur.id, { schedule: sf as never, cell: "brief" });
            props.refetch(); sync();
          }} />
      )}
    </div>
  ), document.body);
}
