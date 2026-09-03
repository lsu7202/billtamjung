import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  buyersApi, proposalsApi, salesApi, listingsApi,

  type Buyer, type BuyerCondition, type Proposal,
  type Seller,
} from "../../shared/api/endpoints";
import { PickModal } from "./PickModal";
import { cellWord, negoWord, NEGO } from "./words";
import { Loading } from "../../shared/ui/Spinner";
import { formatPhone } from "../building/KV";
import { dongAddr, wonAcc } from "../../shared/format";
import { CalendarTab } from "./CalendarTab";
import { NewPerson } from "./PersonModal";
import { LADDER, railBlock, cellsOf } from "./StageRail";
import { DEAL_LADDER } from "./StageRail";
import { ListingModal } from "./ListingModal";
import { UnifiedModal } from "./draft/UnifiedModal";
import { UnifiedBuyerModal } from "./draft/UnifiedBuyerModal";
import { SchedCal, SchedCalAdd, calTone } from "./draft/SchedCal";
import { TodayTab } from "./draft/TodayTab";
import { Icon } from "../../shared/ui/Icon";
import "./draft/salestab.css";
import { useTradeCtx } from "./tradeCtx";
import { touchPk } from "./recent";
import { TradeBar } from "./TradeBar";
import { useEnums } from "../../shared/hooks/useEnums";
import { openDetail } from "../../shared/map/geo";
import { buildingsApi, authApi } from "../../shared/api/endpoints";
import { shortAddr } from "../../shared/format";
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

export function SalesPage() {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const fromUrl = sp.get("buyer") ? Number(sp.get("buyer")) : null;
  const fromListing = sp.get("listing");                   // 건물상세 → 「업무에서 관리」 리다이렉트
  const [tab, setTab] = useState<"today" | "cal" | "listings" | "buy">(
    fromUrl ? "buy" : fromListing ? "listings" : "today");
  const [focusBuyer, setFocusBuyer] = useState<number | null>(fromUrl);
  const [focusSeller, setFocusSeller] = useState<string | null>(null);
  const [focusListing] = useState<string | null>(fromListing);
  const goBuyer = (id: number) => { setFocusBuyer(id); setTab("buy"); };
  // 매도 탭은 없앴다(2026-08-16) — 소유자는 그 매물의 일부라 매물 화면으로 간다
  const goSeller = (pk: string) => { setFocusSeller(pk); setTab("listings"); };
  const setCtx = useTradeCtx((s) => s.setCtx);
  useEffect(() => { if (tab === "today" || tab === "cal") setCtx(null); }, [tab, setCtx]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["buyers"] });
    qc.invalidateQueries({ queryKey: ["proposals"] });
    qc.invalidateQueries({ queryKey: ["sellers"] });
    qc.invalidateQueries({ queryKey: ["sales-today"] });
  };

  return (
    <div className="page sales">
      {/* 화면 이동 = 밑줄 탭(GNB 어법). 섹션 이름표는 뺐다 — GNB의 「업무」가 이미 말한다.
          순서는 하루가 흐르는 대로다(2026-08-28): **오늘 뭘 하지**(대시보드) →
          **무엇을 파나**(매물) → **누구에게**(매수자). 셋은 한 줄기라 붙여 세운다.
          캘린더는 「언제」라 갈래가 다르다 — 여백을 하나 두고 떨어뜨렸다.
          예전엔 대시보드 옆에 캘린더가 끼어 있어서, 매물·매수자로 가는 길이 한 번 끊겼다. */}
      <div className="subnav">
        {([["today", "대시보드", "lead"], ["listings", "매물", ""], ["buy", "매수자", ""],
           ["cal", "캘린더", "apart"]] as const).map(([k, l, mod]) => (
          <button key={k} className={`${tab === k ? "on" : ""} ${mod}`.trim()} onClick={() => setTab(k)}>{l}</button>
        ))}
        <span style={{ flex: 1 }} />
      </div>

      <TradeBar />
      {tab === "today" && <TodayTab onBuyer={goBuyer} onSeller={goSeller} />}
      {tab === "cal" && <CalendarTab onBuyer={goBuyer} onSeller={goSeller} />}
      {tab === "listings" && <ListingsTab focus={focusSeller ?? focusListing} onDone={refresh}
        onBuyer={goBuyer} />}
      {tab === "buy" && <BuySide focus={focusBuyer} onDone={refresh} onGoListing={goSeller} />}
    </div>
  );
}

/* ══════════════════════ 매물 — 건물 단위 한 판 ══════════════════════ */

/* 매물 1 : 매도자 1 : 매수자 N. 사람 단위 화면(매도·매수)만으로는 한 건물에서 벌어지는
   일이 흩어져 보인다 — 여기서는 건물을 축으로 현재 상황을 정리한다.
   기록은 **여기서 쓰지 않는다**(읽기 전용 합본). 쓰는 건 각 장부에서 — 이 화면에서도 쓰게
   하면 「이 줄이 매도자 얘긴가 매수자 얘긴가」를 매번 고르게 된다.
   담당자(=매물 등록, S02 §4.1)는 이제 여기가 정본이다 — 매물상세는 요약만 보여주고 이리로 온다. */
/** 매물 목록의 두 갈래 — 소유자를 잡은 물건(own) · 찍어만 둔 건물(watch) */
type Lane = "own" | "watch" | "done";

function ListingsTab({ focus, onDone, onBuyer }: {
  focus: string | null; onDone: () => void; onBuyer: (id: number) => void;
}) {
  const qc = useQueryClient();
  const rows = useQuery({ queryKey: ["sellers"], queryFn: () => salesApi.sellers() });
  const [sel, setSel] = useState<string | null>(focus);
  useEffect(() => { if (focus) setSel(focus); }, [focus]);
  // 연 매물을 손버릇으로 남긴다 — 일정 창의 매물 목록이 이 순서로 선다
  useEffect(() => { touchPk(sel); }, [sel]);
  const [q, setQ] = useState("");
  const [lane, setLane] = useState<Lane>("own");
  const [add, setAdd] = useState(false);              // 담기 창(편집과 한 벌)
  const list = rows.data ?? [];
  // 세 갈래(2026-08-20) — 매물(소유자 확보) · 관심(미확보) · **계약**(팔린 것).
  // 팔린 매물이 매물 목록에 섞여 있으면 매번 「이건 끝난 건데」를 눈으로 걸러야 한다.
  const sold = list.filter((r) => r.s6_match);
  const owned = list.filter((r) => r.has_owner && !r.s6_match);
  const watched = list.filter((r) => !r.has_owner && !r.s6_match);
  const lane_ = lane === "own" ? owned : lane === "watch" ? watched : sold;
  // 검색 = 주소 · 소유자 · 매물번호. 중개인은 서류의 매물번호로 찾는 일이 잦다.
  const hit = q.trim() ? lane_.filter((r) => {
    const t = q.trim();
    return (r.addr ?? "").includes(t) || (r.owner_name ?? "").includes(t) || (r.listing_no ?? "").includes(t);
  }) : lane_;
  // 리다이렉트로 온 건물이 아직 목록에 없을 수 있다(한 번도 안 담은 매물) — 등록 화면을 띄운다
  const cur = list.find((r) => r.building_pk === sel) ?? null;
  const unknown = sel && !cur ? sel : null;
  // 다른 화면에서 넘어온 건물이 반대 갈래에 있으면 그 갈래로 옮겨 준다(안 그러면 빈 목록이 뜬다)
  useEffect(() => {
    if (cur) setLane(cur.s6_match ? "done" : cur.has_owner ? "own" : "watch");
  }, [cur?.building_pk, cur?.has_owner]);   // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => {
    rows.refetch();
    qc.invalidateQueries({ queryKey: ["contacts"] });
    // 합본(기록)도 — 안 하면 확보·멈춤 auto 줄이 다음 방문까지 안 보인다
    qc.invalidateQueries({ queryKey: ["timeline"] });
    onDone();
  };
  // 이 매물을 보는 동안 대화창의 대상 = 이 매물(매도자 축) — 합본은 읽기 전용이지만
  // 여기서 친 문장은 이 매물 장부로 간다
  const setCtx = useTradeCtx((st) => st.setCtx);
  useEffect(() => {
    if (!cur) return;
    // 소유자가 없어도(관심 매물) 이 매물이 맥락이다 — 지주작업 메모가 갈 자리가 있어야 한다.
    // 사람 id 는 소유자가 있을 때만 붙는다(없으면 매물 장부로 간다·2026-08-16).
    setCtx({ kind: "owner", id: cur.owner_id ?? 0, label: cur.owner_name ?? shortAddr(cur.addr),
      building_pk: cur.building_pk, addr: cur.addr });
  }, [cur?.building_pk, cur?.owner_id, setCtx]);

  if (rows.isLoading) return <Loading label="불러오는 중" minHeight="40vh" />;
  return (
    <div className="lt-split">
      <div className="lt-list">
        <div className="lt-lanes">
          {([["own", "매물", owned.length], ["watch", "관심", watched.length], ["done", "계약", sold.length]] as [Lane, string, number][]).map(([v, l, n]) => (
            <button key={v} className={`um-chip ${lane === v ? "on" : ""}`}
              onClick={() => { setLane(v); setSel(null); }}>{l}<i className="num">{n}</i></button>
          ))}
          <span className="sp" />
          <button className="lt-add" title="매물 담기" onClick={() => setAdd(true)}>
            <Icon name="plus" size={14} /></button>
        </div>
        <input className="lt-q" value={q} placeholder="주소 · 소유자 · 매물번호"
          onChange={(e) => setQ(e.target.value)} />
        {hit.map((r) => {
          // 상태 낱말은 한 사전(2026-08-24) — 보류 > 합의 축(모달과 같은 낱말) > 준비 축 현재 칸
          const n = (r as unknown as { nego?: number }).nego ?? 0;
          const now = railBlock(r, [...LADDER, ...DEAL_LADDER]);
          const word = r.stop_id ? "보류"
            : n >= 1 && n < NEGO.length ? NEGO[n]
              : cellWord(r as never, now?.key ?? "file",
                  (cellsOf(r)[now?.key ?? "file"] ?? "none"), "listing") ?? now?.label ?? "완료";
          return (
            <button key={r.building_pk}
              className={`lt-row ${r.building_pk === (cur?.building_pk ?? unknown) ? "on" : ""}`}
              onClick={() => setSel(r.building_pk)}>
              <span className="who">{shortAddr(r.addr)}
                {Boolean(r.is_vacant) && <span className="tag" style={{ marginLeft: 5, background: "#E8F3EC", color: "#12855C" }}>나대지</span>}</span>
              <span className="cap">{r.has_owner ? (r.owner_name ?? "이름 미확보") : ""}</span>
              <span className={`ev ${r.stop_id ? "bad" : ""}`}
                title={r.stop_id
                  ? ["보류", r.stop_reason].filter(Boolean).join(" · ")
                  : undefined}>{word}</span>
            </button>
          );
        })}
        {!hit.length && <div className="lt-none">담은 매물이 없습니다 — 건물 상세의 「소유자」 탭에서 담으면 여기 모입니다</div>}
      </div>
      <div className="lt-right">
        {unknown
          ? <ListingClaim pk={unknown} onDone={refresh} />
          : cur && <ListingPane key={cur.building_pk} r={cur} onDone={refresh}
              all={list} onBuyer={onBuyer} onGo={(p2) => setSel(p2)} />}
      </div>
      {add && (
        <ListingModal onClose={() => setAdd(false)}
          onSaved={(pk2) => { setAdd(false); setSel(pk2); refresh(); }} />
      )}
    </div>
  );
}

/* 아직 한 번도 안 담은 매물로 리다이렉트해 온 경우 — 등록(담당자 지정)이 곧 담기다(S02 §4.1). */
function ListingClaim({ pk, onDone }: { pk: string; onDone: () => void }) {
  // 나대지 매물은 pk 가 'P'+pnu 다 — 주소는 건물이 아니라 필지 API 가 안다(2026-08-27)
  const vacant = pk.startsWith("P");
  const b = useQuery({ queryKey: ["building", pk],
    queryFn: () => (vacant ? buildingsApi.vacant(pk.slice(1)) : buildingsApi.get(pk)) });
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const [err, setErr] = useState<string | null>(null);
  const bd = b.data as Record<string, unknown> | undefined;
  return (
    <div className="panel by-detail" style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center", padding: "36px 16px" }}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{shortAddr(String(bd?.addr ?? pk))}
        {vacant && <span className="tag" style={{ marginLeft: 6, background: "#E8F3EC", color: "#12855C" }}>나대지</span>}</div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: 0, maxWidth: 300, lineHeight: 1.6 }}>
        아직 거래에 담지 않은 매물입니다. 등록하면 담당자로 지정되고
        매도자·매수자 관리가 열립니다.</p>
      {err && <div style={{ color: "var(--up)", fontSize: 12 }}>{err}</div>}
      <button className="btn primary" style={{ padding: "9px 20px", fontSize: 14 }}
        disabled={me.data?.account_id == null}
        onClick={async () => {
          try { setErr(null); await listingsApi.claim(pk, me.data!.account_id); onDone(); }
          catch (e) { setErr(String((e as Error)?.message ?? "등록하지 못했습니다")); }
        }}>＋ 내 매물로 등록</button>
    </div>
  );
}

/* 매물 한 판 — 머리(담당자=등록) · 매도자 카드 · 매수자 목록 · 합쳐 본 기록 */
function ListingPane({ r, all, onDone, onBuyer, onGo }: {
  r: Seller; all: Seller[]; onDone: () => void;
  onBuyer: (id: number) => void; onGo: (pk: string) => void;
}) {
  const pk = r.building_pk;
  const others = r.owner_id ? all.filter((x) => x.owner_id === r.owner_id && x.building_pk !== pk) : [];
  const props = useQuery({ queryKey: ["proposals", "pk", pk], queryFn: () => proposalsApi.list({ building_pk: pk }) });
  // 통합 모달(2026-08-23 확정) — 값을 만지는 문은 전부 이 창. 레일 칸이 탭을 고른다.
  const [uni, setUni] = useState<null | "owner" | "touch" | "info" | "deal" | "hold">(null);
  const [pickB, setPickB] = useState(false);
  const buyers = props.data ?? [];
  const dealtOut = (x: Proposal) =>
    !x.picked_at && !!((x as { buyer_dealt?: boolean }).buyer_dealt
      || (x as { listing_dealt?: boolean }).listing_dealt);
  const pairs = [...buyers].sort((a2, x) =>
    (Number(dealtOut(a2)) - Number(dealtOut(x)))
    || (Number(!!a2.dropped_at) - Number(!!x.dropped_at))
    || (Number(!!x.picked_at) - Number(!!a2.picked_at)) || (a2.id - x.id));
  const alive = pairs.filter((p) => !dealtOut(p));
  // 대표 짝 — 계약 상대(picked)가 있으면 그 사람(2026-08-19)
  const lead = buyers.find((x) => x.picked_at) ?? buyers.filter((x) => !x.dropped_at).reduce<Proposal | null>((a, x) => {
    const sc = (y: Proposal) => ["d2_brief", "d3_visit", "d4_nego", "d5_pre", "d6_sign", "d7_pay", "d8_file"]
      .reduce((n, k) => n + ((y as unknown as Record<string, boolean>)[k] ? 1 : 0), 0);
    return a === null || sc(x) > sc(a) ? x : a;
  }, null);
  const nego = NEGO[(r as unknown as { nego?: number }).nego ?? 0] || null;
  const pairWord = (p: Proposal) => negoWord(p);

  return (
    <div className="lt-pane">
      <div className="lt-top">
      {/* 결정 문장 — 이 매물의 지금. 누르면 계약 탭 */}
      <section className="tc lt-sent">
        <button className="lt-addr" onClick={() => openDetail(pk)}>{shortAddr(r.addr)}</button>
        {lead?.picked_at && lead.deal_price != null ? (
          <div className="sent num" onClick={() => setUni("deal")}>
            <b>{lead.buyer_name}</b>과 <b>{wonAcc(lead.deal_price)}</b>에
            {((r as unknown as { nego?: number }).nego ?? 0) === 4 ? " 계약" : " 계약 예정"}</div>
        ) : alive.length ? (
          <div className="sent num" onClick={() => setUni("deal")}>
            매수자 <b>{alive.length}명</b>과 {nego ?? "합의 전"}</div>
        ) : (
          <div className="sent dim" onClick={() => setUni("deal")}>매수자 없음</div>
        )}
        <div className="lt-chips">
          {(() => {
            const n2 = (r as unknown as { nego?: number }).nego ?? 0;
            const now2 = railBlock(r, [...LADDER, ...DEAL_LADDER]);
            const w2 = r.stop_id ? "보류"
              : n2 >= 1 && n2 < NEGO.length ? NEGO[n2]
                : cellWord(r as never, now2?.key ?? "file",
                    (cellsOf(r)[now2?.key ?? "file"] ?? "none"), "listing") ?? now2?.label ?? "완료";
            const tab2 = r.stop_id ? "hold" as const
              : n2 >= 1 ? "deal" as const
                : now2?.key === "info" ? "info" as const
                  : now2?.key === "touch" ? "touch" as const
                    : now2?.key === "owner" ? "owner" as const : "deal" as const;
            return (
              <button className={`um-chip ${r.stop_id ? "hold" : ""}`} onClick={() => setUni(tab2)}>
                <i>상태</i>{w2}</button>
            );
          })()}
          <button className="um-chip num" onClick={() => setUni("info")}>
            <i>매매가</i>{r.list_price != null ? wonAcc(r.list_price) : "—"}</button>
          <button className="um-chip num" onClick={() => setUni("info")}>
            <i>매도희망가</i>{r.ask_price != null ? wonAcc(r.ask_price) : "—"}</button>
        </div>
        {(() => {
          // 이 매물의 일정 — 대표 짝에 걸린 것(계약·중도금·잔금 등). 카드를 누르면 계약 탭에서 고친다
          const raw = (lead as unknown as { scheds?: unknown })?.scheds;
          const rows2: { id: number; cat: string | null; on: string; at: string | null; state: string }[] =
            Array.isArray(raw) ? raw as never
              : typeof raw === "string" ? (() => { try { return JSON.parse(raw) ?? []; } catch { return []; } })()
                : [];
          const sorted = rows2.filter((x) => x.cat).sort((a2, b2) => (a2.on < b2.on ? -1 : 1));
          return (
            <div className="scals">
              {sorted.map((x) => (
                <SchedCal key={x.id} name={x.cat ?? "일정"} on={x.on} at={x.at}
                  tone={calTone(x.on, x.state, x.cat === "계약")} onClick={() => setUni("deal")} />
              ))}
              <SchedCalAdd onClick={() => setUni("deal")} />
            </div>
          );
        })()}
      </section>

      {/* 소유자 — 누르면 소유자 탭 */}
      <section className="tc lt-owner" onClick={() => setUni("owner")}>
        <span className="k">소유자</span>
        {r.has_owner ? (<>
          <b className="nm">{r.owner_name ?? "이름 미확보"}</b>
          {r.owner_type === "법인" && <span className="tag">법인</span>}
          {r.owner_phone && (r.phone_masked
            ? <span className="ph dim num">{r.owner_phone}</span>
            : <a className="ph num" href={`tel:${r.owner_phone.replace(/\D/g, "")}`}
                onClick={(e) => e.stopPropagation()}>{formatPhone(r.owner_phone)}</a>)}
        </>) : <span className="nm off">—</span>}
        {others.length > 0 && (
          <span className="lt-others" onClick={(e) => e.stopPropagation()}>
            {others.map((x) => (
              <button key={x.building_pk} className="lnk a" onClick={() => onGo(x.building_pk)}>
                {shortAddr(x.addr)}</button>
            ))}
          </span>
        )}
      </section>
      </div>

      {/* 매수자 짝 — 줄 목록. 누르면 계약 탭, 호버 화살표=매수자 화면 */}
      <section className="tc um-offer lt-pairs">
        {pairs.map((p) => (
          <div key={p.id} className="orow has" onClick={() => setUni("deal")}
            style={dealtOut(p) ? { opacity: .45 } : undefined}>
            <span className="who">{p.buyer_name}</span>
            <span className="cap">{dealtOut(p) ? "다른 곳과 계약" : pairWord(p)}</span>
            <span className="ev num">
              {p.deal_price != null ? wonAcc(p.deal_price)
                : p.hope_price != null ? wonAcc(p.hope_price) : "—"}</span>
            <span className="act" onClick={(e) => e.stopPropagation()}>
              <button className="mini" title="담기 해제" onClick={async () => {
                if (!confirm(`매수자 「${p.buyer_name}」을(를) 이 매물에서 뺄까요?`)) return;
                await proposalsApi.remove(p.id); props.refetch(); onDone();
              }}>✕</button>
              <button className="mini" title="매수자 화면" onClick={() => onBuyer(p.buyer_id)}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
              </button>
            </span>
          </div>
        ))}
        {pairs.length === 0 && (
          <div className="orow"><span className="who g dim">매수자 없음</span></div>)}
        <div className="lt-foot">
          <button className="um-ghost" onClick={() => setPickB(true)}>＋ 매수자</button>
        </div>
      </section>

      {uni && (
        <UnifiedModal r={r} buyers={buyers} tab0={uni}
          onClose={() => setUni(null)}
          onSaved={() => { props.refetch(); onDone(); }} />
      )}
      {pickB && (
        <PickModal mode="buyer" buildingPk={pk} title={`매수자 담기 — ${dongAddr(r.addr)}`}
          onClose={() => setPickB(false)}
          onAdded={() => { props.refetch(); onDone(); }} />
      )}
    </div>
  );
}

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
            <b>{shortAddr(bLead.addr)}</b>를 <b>{wonAcc(bLead.deal_price)}</b>에
            {(b.nego ?? 0) === 4 ? " 계약" : " 계약 예정"}</div>
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

