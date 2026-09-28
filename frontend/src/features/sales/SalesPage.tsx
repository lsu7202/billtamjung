import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  buyersApi, proposalsApi,
  type Buyer, type BuyerCondition, type Proposal,
} from "../../shared/api/endpoints";
import { negoWord, dealTail, NEGO } from "./words";
import { Loading } from "../../shared/ui/Spinner";
import { formatPhone } from "../building/KV";
import { dongAddr, wonAcc } from "../../shared/format";
import { CalendarTab } from "./CalendarTab";
import { NewPerson } from "./PersonModal";
import { UnifiedBuyerModal } from "./draft/UnifiedBuyerModal";
import { SchedCal, calTone } from "./draft/SchedCal";
import "./draft/salestab.css";
import { useEnums } from "../../shared/hooks/useEnums";
import { shortAddr } from "../../shared/format";
import { ListingsTab } from "./ListingTable";
import { InquiryBox } from "./InquiryBox";
import "./sales.css";

/** S04 업무 — 대시보드(오늘 할 일) · 캘린더 · 매물(소유자 포함) · 매수자.
 *
 *  이름을 「영업」에서 「거래」로 바꿨다(2026-08-13). 이 화면이 다루는 것은 매물·매도자·
 *  매수자·수수료 — 전부 거래의 구성요소고, 대시보드는 거래 현황판이다. 「영업」은 행위의
 *  이름이라 일정·수수료 계산 같은 걸 담기엔 옷이 작았다.
 *
 *  어휘·저장소는 발명하지 않는다: 매도자 = 업무탭과 같은 app.listings(jindo enum 그대로),
 *  장부 = app.contacts 하나(0141). 짝(매수자×매물)의 상태는 app.nego_rank 가 사실에서 판다.
 *  담는 일은 지도·건물 상세(「매수자」 탭) 또는 리스트의 「매물 담기」(주소 자동완성). */


/* 끝난 건 — 탭 줄에서 흐리게 뒤로 민다.
   「계약」은 끝이 아니다(2026-08-17) — ③사다리에선 그 뒤에 잔금·신고가 남는다.
   흐려지는 건 **죽은 짝**(dropped_at)뿐이다. 안 산다는 답은 보류라 살아 있다(0141). */

/** 등급은 코드(A/B/C)로 저장하고 표시는 한글 라벨만(0045 — 알파벳은 소음). */
function useGradeLabel() {
  const { options } = useEnums();
  return (code?: string | null) =>
    code ? (options("buyer_grade").find((o) => o.code === code)?.label ?? code) : null;
}

/* ══════════════════════ 루트 ══════════════════════ */

/* 윗메뉴 셋(2026-09-28) — 부기사처럼 매물관리 · 고객관리 · 일정을 나눴다. 아래 줄 탭은 없앴다.
 * 대시보드(TodayTab)와 하단 대화창(TradeBar)은 화면에서만 뺐다 — 코드는 둔다. */

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["buyers"] });
    qc.invalidateQueries({ queryKey: ["proposals"] });
    qc.invalidateQueries({ queryKey: ["sellers"] });
    qc.invalidateQueries({ queryKey: ["sales-today"] });
  };
}

/** 매물관리 — 매물 표. 건물 상세 → ?listing=pk(&tab=rent) 로 넘어온다 */
export function SalesPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const refresh = useRefresh();
  const buyer = sp.get("buyer");
  // 옛 주소 — 매수자는 고객관리로 옮겼다
  useEffect(() => { if (buyer) nav(`/customers?buyer=${buyer}`, { replace: true }); }, [buyer, nav]);
  const listing = sp.get("listing");
  const focusTab = sp.get("tab") === "rent" ? "rent" as const : undefined;   // 건물 상세 「임대 내역 →」
  return (
    <div className="page sales">
      <ListingsTab focus={listing} focusTab={focusTab} onDone={refresh}
        onBuyer={(id) => nav(`/customers?buyer=${id}`)} />
    </div>
  );
}

/** 고객관리 — 지금은 매수자. 소유자(매도) 등 다른 갈래는 나중에 여기로 */
export function CustomersPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const refresh = useRefresh();
  const focus = sp.get("buyer") ? Number(sp.get("buyer")) : null;
  return (
    <div className="page sales">
      {/* 광고를 보고 들어온 문의 — 맨 위(S05). 없으면 칸이 안 선다 */}
      <InquiryBox onBuyer={(id) => nav(`/customers?buyer=${id}`)} />
      <BuySide focus={focus} onDone={refresh} onGoListing={(pk) => nav(`/sales?listing=${encodeURIComponent(pk)}`)} />
    </div>
  );
}

/** 일정 — 캘린더 */
export function SchedulePage() {
  const nav = useNavigate();
  return (
    <div className="page sales">
      <CalendarTab onBuyer={(id) => nav(`/customers?buyer=${id}`)}
        onSeller={(pk) => nav(`/sales?listing=${encodeURIComponent(pk)}`)} />
    </div>
  );
}

/* 매물 탭은 ListingTable.tsx — 표 하나 + 통합 모달(2026-09-26) */

/* ══════════════════════ 매수 장부 ══════════════════════ */

function BuySide({ focus, onDone, onGoListing }: { focus: number | null; onDone: () => void; onGoListing?: (pk: string) => void }) {
  // 새로 만든 사람은 편집 창이 열린 채로 — 폼은 한 벌(PersonModal)뿐이다.
  const [created, setCreated] = useState<number | null>(null);
  const buyers = useQuery({ queryKey: ["buyers"], queryFn: buyersApi.list });
  // 「사람 / 흐름」 전환은 뺐다 — 사람 화면의 탭·요약이 흐름을 이미 보여준다.
  // 같은 것을 두 모양으로 두면 어느 쪽이 정본인지 매번 고르게 된다.
  return (
    <Buyers rows={buyers.data} loading={buyers.isLoading} onDone={onDone}
      focus={created ?? focus} flipId={created} onGoListing={onGoListing}
      add={<NewPerson kind="buyer" onDone={onDone} onCreated={setCreated} />} />
  );
}

function Buyers({ rows, loading, onDone, focus, flipId, add, onGoListing }: {
  rows?: Buyer[]; loading: boolean; onDone: () => void; focus?: number | null;
  onGoListing?: (pk: string) => void;
  flipId?: number | null; add?: React.ReactNode;
}) {
  const [sel, setSel] = useState<number | null>(focus ?? null);
  useEffect(() => { if (focus != null) setSel(focus); }, [focus]);
  const gradeLabel = useGradeLabel();
  const [q, setQ] = useState("");
  const [lane, setLane] = useState<"live" | "done">("live");
  if (loading) return <Loading label="불러오는 중" minHeight="40vh" />;
  const all = rows ?? [];
  // 계약을 마친 사람은 따로 본다(2026-08-20) — 굴릴 사람과 끝난 사람은 하는 일이 다르다
  const done = all.filter((b) => b.dealt);
  const live = all.filter((b) => !b.dealt);
  const list = lane === "live" ? live : done;
  if (!all.length) {
    return <div className="panel sales-empty">등록된 매수자가 없습니다
      <small>「＋」로 시작합니다</small>{add}</div>;
  }
  const hit = q.trim()
    ? list.filter((b) => b.name.includes(q.trim()) || (b.phone ?? "").includes(q.trim()))
    : list;
  // 첫 진입엔 **아무도 안 골라 둔다**(2026-08-19) — 매물 탭과 같다.
  // 자동으로 한 명을 펼쳐 두면 그 사람을 「내가 고른 사람」으로 착각한다.
  const cur = sel != null ? (list.find((b) => b.id === sel) ?? null) : null;
  // 합의 낱말(2026-08-24 확정) — 담은 매물 없음=— · 합의 전 → 합의중 → 계약예정 → 계약완료
  const buyerWord = (b: Buyer) =>
    b.stop_id ? "보류"
      : (b.nego ?? 0) >= 1 && (b.nego ?? 0) < NEGO.length ? NEGO[b.nego!]
        : b.active_proposals > 0 ? "합의 전" : "—";
  return (
    <div className="lt-split">
      <div className="lt-list">
        <div className="lt-lanes">
          {([["live", "매수자", live.length], ["done", "계약", done.length]] as ["live" | "done", string, number][]).map(([v, l, n]) => (
            <button key={v} className={`um-chip ${lane === v ? "on" : ""}`}
              onClick={() => { setLane(v); setSel(null); }}>{l}<i className="num">{n}</i></button>
          ))}
          <span className="sp" />
          {add}
        </div>
        <input className="lt-q" value={q} placeholder="이름 · 연락처"
          onChange={(e) => setQ(e.target.value)} />
        {hit.map((b) => (
          <button key={b.id} className={`lt-row ${b.id === cur?.id ? "on" : ""}`} onClick={() => setSel(b.id)}>
            <span className="who">{b.name}</span>
            <span className="cap">
              {[b.is_corp ? "법인" : null,
                b.grade ? gradeLabel(b.grade) : null,
                b.active_proposals > 0 ? `매물 ${b.active_proposals}` : null,
                b.activity === "휴면" ? "휴면" : null]
                .filter(Boolean).join(" · ")}</span>
            <span className={`ev ${b.stop_id ? "bad" : ""}`}
              title={b.stop_id
                ? ["보류", b.stop_reason].filter(Boolean).join(" · ")
                : undefined}>{buyerWord(b)}</span>
          </button>
        ))}
        {!hit.length && <div className="lt-none">찾는 사람이 없습니다</div>}
      </div>
      <div className="lt-right">
        {cur && <BuyerProfile key={cur.id} b={cur} onDone={onDone}
          startFlipped={cur.id === flipId} goListing={onGoListing} />}
      </div>
    </div>
  );
}

/* 사람 요약 — 등급·유입·나이대·성별·협조·전속을 읽고 한 문단으로.
   비어 있는 항목은 말하지 않는다 — "미지정"을 넣으면 요약이 아니라 빈칸 목록이 된다. */
/** 소유자 요약 — 매수자 요약과 같은 어법. 찍힌 필드만 문장이 된다(안 찍힌 건 침묵). */
function BuyerProfile({ b, onDone, startFlipped, goListing }: {
  b: Buyer; onDone: () => void; startFlipped?: boolean; goListing?: (pk: string) => void }) {
  const nav = useNavigate();
  const props = useQuery({ queryKey: ["proposals", b.id], queryFn: () => proposalsApi.list({ buyer_id: b.id }) });
  const [editing, setEditing] = useState(!!startFlipped);
  const del = async () => {
    if (!confirm(`매수자 「${b.name}」을(를) 지울까요? 제안 이력도 함께 사라집니다.`)) return;
    await buyersApi.remove(b.id); onDone();
  };
  const openCond = (c: BuyerCondition) => {
    nav("/search", { state: { applyCond: c.conditions_json } });
  };
  const editCond = (c?: BuyerCondition) => {
    nav("/search", { state: { buyerCond: {
      buyer_id: b.id, buyer_name: b.name,
      cond_id: c?.id ?? null, name: c?.name ?? "새 조건",
      conditions: c?.conditions_json ?? {},
    } } });
  };
  const rows = props.data ?? [];
  const dealtOut = (x: Proposal) =>
    !x.picked_at && !!((x as { buyer_dealt?: boolean }).buyer_dealt
      || (x as { listing_dealt?: boolean }).listing_dealt);
  const alive = rows.filter((p) => !dealtOut(p) && !p.dropped_at);
  const bLead = rows.find((x) => x.picked_at)
    ?? alive.reduce<Proposal | null>((a, x) => {
      const sc = (y: Proposal) => ["d2_brief", "d3_visit", "d4_nego", "d5_pre", "d6_sign", "d7_pay", "d8_file"]
        .reduce((n, k) => n + ((y as unknown as Record<string, boolean>)[k] ? 1 : 0), 0);
      return a === null || sc(x) > sc(a) ? x : a;
    }, null);
  const pairWord = (p: Proposal) => negoWord(p);
  // 매수자엔 레일이 없다(2026-08-24 확정) — 상태는 합의 낱말 하나
  const word = b.stop_id ? "보류"
    : (b.nego ?? 0) >= 1 && (b.nego ?? 0) < NEGO.length ? NEGO[b.nego!]
      : rows.length > 0 ? "합의 전" : "—";

  return (
    <div className="lt-pane">
      {/* 결정 문장 — 이 사람의 지금. 누르면 매수자 모달 */}
      <section className="tc lt-sent">
        <button className="lt-addr" onClick={() => setEditing(true)}>
          {b.name}{b.is_corp ? " · 법인" : ""}</button>
        {bLead?.picked_at && bLead.deal_price != null ? (
          <div className="sent num" onClick={() => setEditing(true)}>
            <b>{shortAddr(bLead.addr)}</b>를 <b>{wonAcc(bLead.deal_price)}</b>에{" "}
            {dealTail({ ...bLead, nego: b.nego })}</div>
        ) : alive.length ? (
          <div className="sent num" onClick={() => setEditing(true)}>
            매물 <b>{alive.length}건</b>과 {word === "—" ? "합의 전" : word}</div>
        ) : (
          <div className="sent dim" onClick={() => setEditing(true)}>담은 매물 없음</div>
        )}
        <div className="lt-chips">
          <span className={`um-chip still ${b.stop_id ? "hold" : ""}`}><i>상태</i>{word}</span>
          {b.phone && !b.phone_masked && (
            <a className="um-chip still num" style={{ textDecoration: "none" }}
              href={`tel:${b.phone.replace(/\D/g, "")}`}><i>전화</i>{formatPhone(b.phone)}</a>)}
          {b.grade && <span className="um-chip still"><i>등급</i>{b.grade}</span>}
        </div>

        {/* 이 사람에게 걸린 일정 — 매물 판과 같은 달력 카드.
            여러 매물에 걸릴 수 있어 카드에 매물을 함께 적는다 */}
        {(() => {
          const cards = rows.flatMap((p) => {
            const raw = (p as unknown as Record<string, unknown>)["scheds"];
            const list: { id: number; cat: string | null; on: string; at: string | null; state: string }[] =
              Array.isArray(raw) ? raw as never
                : typeof raw === "string" ? (() => { try { return JSON.parse(raw) ?? []; } catch { return []; } })()
                  : [];
            return list.filter((x) => x.cat).map((x) => ({ ...x, addr: p.addr, pid: p.id }));
          }).sort((a2, b2) => (a2.on < b2.on ? -1 : 1));
          if (!cards.length) return null;
          return (
            <div className="scals">
              {cards.map((x) => (
                <SchedCal key={x.id} name={x.cat ?? "일정"} on={x.on} at={x.at}
                  tone={calTone(x.on, x.state, x.cat === "계약")}
                  onClick={() => goListing?.(rows.find((p) => p.id === x.pid)?.building_pk ?? "")} />
              ))}
            </div>
          );
        })()}
      </section>

      {/* 조건 — 클릭=그 조건으로 검색 · 연필=편집 · ✕=삭제 */}
      <section className="tc um-offer">
        {(b.conditions ?? []).map((c) => (
          <div key={c.id} className="orow has" onClick={() => openCond(c)}>
            <span className="who">{c.name}</span>
            <span className="cap" />
            <span className="ev off num">{Object.keys(c.conditions_json ?? {}).length}칸</span>
            <span className="act" onClick={(e) => e.stopPropagation()}>
              <button className="mini" title="편집" onClick={() => editCond(c)}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
              </button>
              <button className="mini" title="삭제" onClick={async () => {
                if (!confirm(`조건 「${c.name}」을(를) 지울까요?`)) return;
                await buyersApi.removeCondition(c.id); onDone();
              }}>✕</button>
            </span>
          </div>
        ))}
        {(b.conditions ?? []).length === 0 && (
          <div className="orow"><span className="who g dim">조건 없음</span></div>)}
        <div className="lt-foot">
          <button className="um-ghost" onClick={() => editCond()}>＋ 조건</button>
        </div>
      </section>

      {/* 담은 매물 — 줄 목록. 누르면 매수자 모달의 매물 탭, 호버 화살표=매물 화면 */}
      <section className="tc um-offer">
        {rows.map((p) => (
          <div key={p.id} className="orow has" onClick={() => setEditing(true)}
            style={dealtOut(p) ? { opacity: .45 } : undefined}>
            {/* 주소를 누르면 그 매물로 간다(2026-08-28) — 줄 전체는 이 매수자의 매물 탭이다.
                호버 화살표를 찾아 누르는 것보다 주소를 누르는 쪽이 먼저 떠오른다. */}
            <span className="who lnk" onClick={(e) => { e.stopPropagation(); goListing?.(p.building_pk); }}>
              {dongAddr(p.addr) || p.building_pk}</span>
            <span className="cap">{dealtOut(p) ? "다른 곳과 계약" : pairWord(p)}</span>
            <span className="ev num">
              {p.deal_price != null ? wonAcc(p.deal_price)
                : p.hope_price != null ? wonAcc(p.hope_price) : "—"}</span>
            <span className="act" onClick={(e) => e.stopPropagation()}>
              <button className="mini" title="담기 해제" onClick={async () => {
                if (!confirm(`「${dongAddr(p.addr) || p.building_pk}」을(를) 이 매수자에게서 뺄까요?`)) return;
                await proposalsApi.remove(p.id); props.refetch(); onDone();
              }}>✕</button>
              <button className="mini" title="매물 화면" onClick={() => goListing?.(p.building_pk)}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
              </button>
            </span>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="orow"><span className="who g dim">담은 매물 없음 — 조건을 만들면 추천이 시작됩니다</span></div>)}
      </section>

      {editing && (
        <UnifiedBuyerModal b={b}
          onClose={() => setEditing(false)}
          onSaved={onDone}
          onGoListing={(pk2) => { setEditing(false); goListing?.(pk2); }}
          onEditCond={editCond} onOpenCond={openCond}
          onDelete={del} />
      )}
    </div>
  );
}

