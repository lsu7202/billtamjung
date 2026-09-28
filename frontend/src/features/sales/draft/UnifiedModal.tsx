/** 통합 매물 모달 — 토스 결.
 *
 *  탭 7(2026-09-26): 요약 · 소유자 · 접촉 · 정보 · 사진 · 계약 · 보류 + 우측 메모창.
 *  요약 = 옛 매물 탭 오른쪽 판(결정 문장·값·임대 합계·일정·매수자 짝·소유자). 매물 탭이 표 하나가 되며 여기로 왔다.
 *  소유자·접촉·정보·계약(채택·거래금액·매도희망·매매가)은 기존 API로 실동작.
 *  계약금·잔금·계약금 일부·중도금·할일 신설 체크는 **로컬 상태**(저장 없음 — 새로고침이면 초기화).
 *  계약 탭 = 결정 문장(채택되면 나타남) + 호가 줄(캡션에 마지막 움직임, 클릭하면 이력 펼침).
 *  기존 모달 파일은 건드리지 않는다 — 확정되면 본 수정에서 교체.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  boardApi, convertApi, dealApi, listingsApi, proposalsApi, schedulesApi, stopsApi,
  type Proposal, type Seller, type Stop, type StopStage,
} from "../../../shared/api/endpoints";
import { dongAddr, md, wonAcc } from "../../../shared/format";
import { MemoLog } from "./MemoLog";
import { useEnums } from "../../../shared/hooks/useEnums";
import { Chips } from "../../building/EnumField";
import { formatPhone, parseAmount, seedAmount } from "../../building/KV";
import { SchedModal, type SchedFinal } from "../SchedModal";
import { StopModal } from "../StopModal";
import { NEGO, dealTail, negoWord } from "../words";
import { stateWord, isUrgent } from "../listingWord";
import { PickModal } from "../PickModal";
import { openDetail } from "../../../shared/map/geo";
import { UploadTab } from "../../../shared/map/PhotoPanel";
import { RentLedger } from "./RentLedger";
import { Icon } from "../../../shared/ui/Icon";
import { SchedCal, SchedCalAdd, calTone } from "./SchedCal";
import "./draft.css";
import "./salestab.css";

export type UniTab = "sum" | "owner" | "touch" | "info" | "rent" | "photo" | "deal" | "hold";
type Tab = UniTab;

export function UnifiedModal({ r, buyers, tab0, onClose, onSaved, onBuyer }: {
  r: Seller; buyers: Proposal[]; tab0?: Tab;
  onClose: () => void; onSaved: () => void;
  /** 매수자 화면으로 — 요약 탭 짝 줄의 화살표 */
  onBuyer?: (id: number) => void;
}) {
  const pk = r.building_pk;
  const { options } = useEnums();
  const [tab, setTab] = useState<Tab>(tab0 ?? "sum");
  const lead = buyers.find((x) => x.picked_at) ?? buyers[0] ?? null;
  const rr = r as unknown as Record<string, string | null>;

  /* 로컬 상태 — 계약금 일부 줄을 폈나(저장 없음). 값 자체는 서버가 들고 있다 */
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const put = async (patch: Record<string, string | boolean | string[] | null>) => {
    await listingsApi.patchBiz(pk, patch); onSaved();
  };

  /* 호가 이력 — 참여자별 (시각, 값). 움직임은 전부 남긴다 — 같은 날 여러 번도 그대로 */
  const board = useQuery({ queryKey: ["draft-board", pk], queryFn: () => boardApi.get(pk) });
  const hist = useMemo(() => {
    const m = new Map<string, { at: string; v: number; src: "field" | "prop"; eid: number }[]>();
    const add = (k: string, at: string, v: number, src: "field" | "prop", eid: number) => {
      const a = m.get(k) ?? []; a.push({ at, v, src, eid }); m.set(k, a);
    };
    const b = board.data;
    if (b) {
      for (const s of b.sell) if (s.value != null) add(s.field, s.created_at, Number(s.value), "field", s.id);
      for (const x of b.buys) if (x.field === "hope_price" && x.value != null) add(`b${x.proposal_id}`, x.created_at, Number(x.value), "field", x.event_id);
    }
    for (const a of m.values()) {
      a.sort((p, q) => (p.at < q.at ? -1 : p.at > q.at ? 1 : 0));
      // 같은 값이 연달아 오면 하나로(두 소스가 같은 움직임을 이중으로 실어올 수 있다)
      for (let i = a.length - 1; i > 0; i--) if (a[i].v === a[i - 1].v) a.splice(i, 1);
    }
    return m;
  }, [board.data]);
  const [openHist, setOpenHist] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);

  /* 속성 줄 — 값만 보이고, 클릭하면 칩이 펼쳐지고, 고르면 접힌다 */
  const erow = (key: string, label: string, curLabel: string | null | undefined, chips: ReactNode) => {
    const open = openRow === key;
    return (
      <div key={key} className={`eitem ${open ? "open" : ""}`}>
        <div className="orow has" onClick={() => setOpenRow(open ? null : key)}>
          <span className="who g">{label}</span>
          <span className="cap" />
          <span className={`ev ${curLabel ? "" : "off"}`}>{curLabel ?? "—"}</span>
        </div>
        {open && <div className="eexp" onClick={(e) => e.stopPropagation()}>{chips}</div>}
      </div>
    );
  };
  const pick = (patch: Record<string, string | null>) => { put(patch); setOpenRow(null); };
  /* 글자 값 줄 — 인적사항(0128 실저장) */
  const trow = (k: string, label: string, cur: string | null | undefined) => (
    <div key={k} className="orow"><span className="who g">{label}</span><span className="cap" />
      {editable(k, cur ?? null, (v) => put({ [k]: v }))}
      <span className="okpad" /></div>
  );
  /* enum 코드 → 화면 라벨 */
  const lab = (enumKey: string, code: string | null | undefined) =>
    code == null ? null : (options(enumKey).find((o) => o.code === code)?.label ?? code);

  /* 일정 — 대표 짝의 계약·중도금·잔금. 문장 카드 밑에 서고, 여기서 만들고 고친다 */
  type SchedRow = { id: number; title: string; cat: string | null; on: string; at: string | null; state: string; amount?: number | null };
  const leadScheds: SchedRow[] = (() => {
    const x = (lead as unknown as { scheds?: unknown })?.scheds;
    if (Array.isArray(x)) return x as SchedRow[];
    if (typeof x === "string") { try { return JSON.parse(x) ?? []; } catch { return []; } }
    return [];
  })();
  const schedOf = (cat: string) => leadScheds.find((s) => s.cat === cat) ?? null;
  const [schedAt, setSchedAt] = useState<null | { id?: number; cat: "계약" | "중도금" | "잔금" | "일반"; title?: string }>(null);
  /** 매수자의 답은 **매수희망가**가 들고 있다(0141) — 「이 값이면 사겠다」가 곧 답이다.
   *  안 산다는 답은 짝 보류로 적는다: 사유가 줄로 서고 사람이 풀 수 있다. */
  const [holdAt, setHoldAt] = useState<null | { pid: number; name: string; cur: Stop | null }>(null);
  const [pickB, setPickB] = useState(false);
  useEffect(() => { if (tab0) setTab(tab0); }, [tab0]);   // 밖에서 탭을 바꿔 열 때(건물 상세 「임대 내역 →」)
  const team = useQuery({ queryKey: ["team-members"], queryFn: listingsApi.members });
  /** 답의 낱말 — 사실에서 파생한다(0141).
   *  보류면 그 사유 · 희망가가 있으면 그 값이 답 · 브리핑만 했으면 답 대기 · 그 전엔 비운다. */
  const answerWord = (b2: Proposal) => {
    if (b2.stop_reason) return b2.stop_reason;
    if (b2.hope_price != null) return null;          // 값 줄이 이미 말한다 — 두 번 안 쓴다
    return b2.d2_brief ? "답 대기" : null;
  };
  const saveSched = async (sf: SchedFinal) => {
    if (!lead) return;
    const cur = schedAt?.id != null ? leadScheds.find((s) => s.id === schedAt.id) : null;
    if (cur) {
      await schedulesApi.patch(cur.id, { on_date: sf.on, at_time: sf.at ?? "", title: sf.title,
        people: sf.people, category: sf.category });
    } else {
      await proposalsApi.update(lead.id, { cell: sf.category === "계약" ? "sign" : "pay", schedule: {
        title: sf.title || `${sf.category ?? "일정"} — ${dongAddr(r.addr)}`.trim(),
        on: sf.on, at: sf.at ?? null, category: sf.category, building_pk: pk, people: sf.people,
      } } as never);
    }
    // 계약 창에서 딸려 온 중도금·잔금(extras) — 있으면 고치고, 새로 잡았으면 만든다
    for (const k of ["중도금", "잔금"] as const) {
      const had = schedOf(k);
      const now = (sf.extras ?? []).find((y) => y.category === k);
      if (had && now) {
        if (had.on !== now.on || (had.at ?? null) !== (now.at ?? null)) {
          await schedulesApi.patch(had.id, { on_date: now.on, at_time: now.at ?? "" });
        }
      } else if (!had && now) {
        await proposalsApi.update(lead.id, { cell: "pay", schedule: {
          title: `${k} — ${dongAddr(r.addr)}`.trim(), on: now.on, at: now.at ?? null,
          category: k, building_pk: pk, people: sf.people,
        } } as never);
      }
    }
    setSchedAt(null); onSaved();
  };

  /* 계약 탭 — 값. 거래금액·채택은 기존 API(dealApi), 매도희망·매매가는 오버레이, 나머지 금액은 로컬 */
  const [pEdit, setPEdit] = useState<string | null>(null);
  const [pTxt, setPTxt] = useState("");
  const dealPrice = lead?.deal_price ?? null;
  const downSeed = dealPrice != null ? Math.round(dealPrice * 0.1) : null;
  const downNow = lead?.down_payment ?? downSeed;                     // 저장값 > 10% 씨앗
  const preNow = lead?.pre_contract_amount ?? null;
  const midSched = schedOf("중도금");                                  // 중도금 = 일정이 그릇(금액 포함)
  const midNow = midSched?.amount ?? null;
  const balanceSeed = dealPrice != null
    ? dealPrice - (downNow ?? 0) - (preNow ?? 0) - (midNow ?? 0)
    : null;

  const openPapers = () => window.open(`/deals/${encodeURIComponent(pk)}/papers`, "_blank");


  /* 보류 — 맨 오른쪽 빨간 탭(2026-08-23). 단계별 사유가 줄로 서고, 열린 보류는 대상당 하나 */
  const STOP_KO: Record<string, string> = { owner: "소유자", touch: "접촉", intent: "접촉", info: "정보", asset: "정보", match: "합의", deal: "합의" };
  const rs = r as unknown as { stop_id?: number | null; stop_stage?: string | null; stop_reason?: string | null;
};
  const curStop: Stop | null = rs.stop_id ? {
    id: rs.stop_id, target_type: "listing", target_id: pk,
    stage: (rs.stop_stage ?? "owner") as StopStage, reason: rs.stop_reason ?? null,
    note: null, created_at: "", held_days: null,
  } : null;


  const nego = NEGO[(r as unknown as { nego?: number }).nego ?? 0] || null;

  const editable = (key: string, val: string | null, onDone2: (v: string) => void, ph = "—") =>
    pEdit === key ? (
      <input className="um-in num" autoFocus value={pTxt}
        onChange={(e) => setPTxt(e.target.value)}
        onBlur={() => { setPEdit(null); onDone2(pTxt.trim()); }}   // 빈 값도 넘긴다 = 지우기(2026-09-06)
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    ) : (
      <button className="um-vp" onClick={() => { setPEdit(key); setPTxt(val ?? ""); }}>
        <b className="num">{val ?? ph}</b></button>
    );

  /* 돈 칩 — 라벨 붙은 금액. onSet 없으면 파생값(고정). onClear 있으면 호버 시 ✕ */
  const mchip = (label: string, key: string, val: string | null,
                 onSet?: (v: string) => void, onClear?: () => void) =>
    pEdit === key && onSet ? (
      <span className="um-chip" key={key}><i>{label}</i>
        <input className="ci num" autoFocus value={pTxt}
          onChange={(e) => setPTxt(e.target.value)}
          onBlur={() => { setPEdit(null); onSet(pTxt.trim()); }}   // 빈 값도 넘긴다 = 지우기
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></span>
    ) : (
      <span className={`um-chip num ${onSet ? "" : "still"} ${onClear ? "clr" : ""}`} key={key}
        onClick={onSet ? () => { setPEdit(key); setPTxt(val ?? ""); } : undefined}
        role={onSet ? "button" : undefined}>
        <i>{label}</i>{val ?? "—"}
        {onClear && <button className="cx" title="빼기"
          onClick={(e) => { e.stopPropagation(); onClear(); }}>✕</button>}
      </span>
    );

  /* 호가 줄 — 이름·값만. 이력은 줄 클릭으로 펼친다.
   * 이벤트에 안 남은 변경(오버레이만 바뀐 경우)이 있으면 현재 값을 끝점으로 붙인다 — 날짜는 모르니 「지금」. */
  const orow = (key: string, name: string, g: boolean, curV: number | null, valNode: ReactNode, adopt?: ReactNode, cap?: ReactNode) => {
    const h: { at: string | null; v: number; src?: "field" | "prop"; eid?: number }[] = [...(hist.get(key) ?? [])];
    if (curV != null && (h.length === 0 ? false : h[h.length - 1].v !== curV)) h.push({ at: null, v: curV });
    const can = h.length > 0;
    const open = openHist === key && can;
    return (
      <div key={key} className="oitem">
        <div className={`orow ${can ? "has" : ""}`}
          onClick={() => { if (can) setOpenHist(open ? null : key); }}>
          <span className={`who ${g ? "g" : ""}`}>{name}</span>
          <span className="cap">{cap}</span>
          <span onClick={(e) => e.stopPropagation()}>{valNode}</span>
          {adopt ?? <span className="okpad" />}
        </div>
        {open && (
          <div className="ohist num">
            <table>
              <thead><tr>{h.map((x, i) => {
                const d = x.at ? md(x.at.slice(0, 10)) : "지금";
                const prev = h[i - 1];
                const same = !!x.at && !!prev?.at && prev.at.slice(0, 10) === x.at.slice(0, 10);
                return <th key={x.at ?? "now"}>{same ? "" : d}</th>;
              })}</tr></thead>
              <tbody><tr>{h.map((x, i) => (
                <td key={x.at ?? "now"} className={`${i === h.length - 1 ? "nowv" : ""} ${x.eid != null ? "del" : ""}`}>
                  <span className="hv num">{wonAcc(x.v)}</span>
                  {x.eid != null && (
                    <button className="htrash" title="이력에서 빼기"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await boardApi.delEvent(x.src!, x.eid!);
                        board.refetch();
                      }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                    </button>
                  )}
                </td>))}</tr></tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="um" onClick={(e) => e.stopPropagation()}>
        <div className="um-head">
          <b>{dongAddr(r.addr)}</b>
          {r.listing_no && <span className="um-no num">{r.listing_no}</span>}
          {isUrgent(r) && <span className="um-flag red">급매</span>}
          {r.exclusive && <span className="um-flag blue">전속</span>}
          <span className={`um-st ${r.stop_id ? "hold" : ""}`}>{stateWord(r)}</span>
          <span className="sp" />
          <button className="um-x" title="건물 상세" onClick={() => openDetail(pk)}>
            <Icon name="external" size={15} /></button>
          <button className="um-x" onClick={onClose}>✕</button>
        </div>

        <div className="um-body">
          <div className="um-main">
            <div className="um-tabs">
              {([["sum", "요약"], ["owner", "소유자"], ["touch", "접촉"], ["info", "정보"], ["rent", "임대 내역"], ["photo", "사진"],
                 ["deal", "계약"], ["hold", "보류"]] as [Tab, string][]).map(([k, l]) => (
                <button key={k} className={`${tab === k ? "on" : ""} ${k === "hold" ? "hold" : ""}`}
                  onClick={() => setTab(k)}>
                  {l}{k === "hold" && curStop ? <i className="hdot" /> : null}</button>
              ))}
            </div>

            {/* ── 요약 ── 옛 매물 탭 오른쪽 판. 누르는 곳마다 그 값을 고치는 탭으로 간다 */}
            {tab === "sum" && (() => {
              const dealtOut = (x: Proposal) =>
                !x.picked_at && !!((x as { buyer_dealt?: boolean }).buyer_dealt
                  || (x as { listing_dealt?: boolean }).listing_dealt);
              const pairs = [...buyers].sort((a2, x) =>
                (Number(dealtOut(a2)) - Number(dealtOut(x)))
                || (Number(!!a2.dropped_at) - Number(!!x.dropped_at))
                || (Number(!!x.picked_at) - Number(!!a2.picked_at)) || (a2.id - x.id));
              const alive = pairs.filter((x) => !dealtOut(x));
              const picked = buyers.find((x) => x.picked_at) ?? null;
              const nv = (r as unknown as { nego?: number }).nego;
              const rentRow: [string, string | null][] = [
                ["보증금", r.total_deposit != null ? wonAcc(r.total_deposit) : null],
                ["월임대", r.total_rent != null ? wonAcc(r.total_rent) : null],
                ["관리비", r.total_mgmt != null ? wonAcc(r.total_mgmt) : null],
                ["공실", r.vacant_area != null ? `${(r.vacant_area / 3.305785).toFixed(1)}평` : null],
                [r.full_est ? "추정 만실 수익률" : "만실 수익률", r.roi_full != null ? `${Number(r.roi_full).toFixed(2)}%` : null],
              ];
              return (
                <div className="um-pane">
                  <div className="tc">
                    {picked && picked.deal_price != null ? (
                      <div className="um-sent2 num" onClick={() => setTab("deal")}>
                        <b>{picked.buyer_name}</b>과 <b>{wonAcc(picked.deal_price)}</b>에 {dealTail({ ...picked, nego: nv } as never)}</div>
                    ) : alive.length ? (
                      <div className="um-sent2 num" onClick={() => setTab("deal")}>
                        매수자 <b>{alive.length}명</b>과 {nego ?? "합의 전"}</div>
                    ) : (
                      <div className="um-sent2 dim" onClick={() => setTab("deal")}>매수자 없음</div>
                    )}
                    <div className="um-sub">
                      <button className="um-chip num" onClick={() => setTab("info")}>
                        <i>매매가</i>{r.list_price != null ? wonAcc(r.list_price) : "—"}</button>
                      <button className="um-chip num" onClick={() => setTab("info")}>
                        <i>매도희망가</i>{r.ask_price != null ? wonAcc(r.ask_price) : "—"}</button>
                      <span className="um-chip num still"><i>수익률</i>{r.roi != null ? `${Number(r.roi).toFixed(2)}%` : "—"}</span>
                    </div>
                    <div className="scals">
                      {leadScheds.filter((s2) => s2.cat).sort((a2, b2) => (a2.on < b2.on ? -1 : 1)).map((s2) => (
                        <SchedCal key={s2.id} name={s2.cat ?? "일정"} on={s2.on} at={s2.at}
                          tone={calTone(s2.on, s2.state, s2.cat === "계약")} onClick={() => setTab("deal")} />
                      ))}
                      <SchedCalAdd onClick={() => setTab("deal")} />
                    </div>
                  </div>
                  {/* 임대 합계 — 누르면 임대 내역 탭 */}
                  <div className="tc um-rent" onClick={() => setTab("rent")}>
                    {rentRow.map(([k, v]) => (
                      <span key={k} className="cell"><i>{k}</i><b className={`num ${v ? "" : "off"}`}>{v ?? "—"}</b></span>
                    ))}
                  </div>
                  {/* 매수자 짝 — 누르면 계약 탭, 화살표 = 매수자 화면 */}
                  <div className="tc um-offer">
                    {pairs.map((x) => (
                      <div key={x.id} className="orow has" onClick={() => setTab("deal")}
                        style={dealtOut(x) ? { opacity: .45 } : undefined}>
                        <span className="who">{x.buyer_name}</span>
                        <span className="cap">{dealtOut(x) ? "다른 곳과 계약" : negoWord(x)}</span>
                        <span className="ev num">
                          {x.deal_price != null ? wonAcc(x.deal_price) : x.hope_price != null ? wonAcc(x.hope_price) : "—"}</span>
                        <span className="act" onClick={(e) => e.stopPropagation()}>
                          <button className="mini" title="담기 해제" onClick={async () => {
                            if (!confirm(`매수자 「${x.buyer_name}」을(를) 이 매물에서 뺄까요?`)) return;
                            await proposalsApi.remove(x.id); onSaved();
                          }}>✕</button>
                          {onBuyer && (
                            <button className="mini" title="매수자 화면" onClick={() => { onClose(); onBuyer(x.buyer_id); }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
                            </button>)}
                        </span>
                      </div>
                    ))}
                    <div className="lt-foot"><button className="um-ghost" onClick={() => setPickB(true)}>＋ 매수자</button></div>
                  </div>
                  {/* 소유자 한 줄 — 누르면 소유자 탭 */}
                  <div className="tc um-offer">
                    <div className="orow has" onClick={() => setTab("owner")}>
                      <span className="who g">소유자</span>
                      <span className="cap">{r.owner_type === "법인" ? "법인" : ""}</span>
                      <span className={`ev ${r.owner_name ? "" : "off"}`}>{r.owner_name ?? "—"}</span>
                      {r.owner_phone && !r.phone_masked
                        ? <a className="um-tel num" href={`tel:${r.owner_phone.replace(/\D/g, "")}`}
                            onClick={(e) => e.stopPropagation()}>{formatPhone(r.owner_phone)}</a>
                        : <span className="okpad" />}
                    </div>
                  </div>
                </div>
              );
            })()}
            {/* ── 소유자 ── */}
            {tab === "owner" && (
              <div className="um-pane">
                <div className="tc">
                  <div className="um-row"><span className="k">이름</span>
                    {editable("owner_name", r.owner_name ?? null, (v2) => put({ owner_name: v2 || null }))}</div>
                  <div className="um-row"><span className="k">전화</span>
                    {r.phone_masked
                      ? <span className="dim">담당자 본인·대표만 볼 수 있습니다</span>
                      : editable("owner_phone", r.owner_phone ? formatPhone(r.owner_phone) : null,
                        (v2) => put({ owner_phone: v2.replace(/[^0-9]/g, "") || null }))}
                  </div>
                </div>
                <div className="tc um-offer">
                  {trow("owner_addr", "주소", r.owner_addr)}
                  {r.owner_type === "법인" && trow("owner_rep_name", "대표자", r.owner_rep_name)}
                  {r.owner_type === "법인" && trow("owner_corp_no", "법인등록번호", r.owner_corp_no)}
                  {erow("owner_nationality", "외국인", r.owner_nationality,
                    <Chips mode="inline" opts={[{ code: "내국인", label: "내국인" }, { code: "외국인", label: "외국인" }]}
                      cur={r.owner_nationality ?? "미지정"}
                      onSelect={(v) => pick({ owner_nationality: v === "미지정" || v === r.owner_nationality ? null : v })} />)}
                </div>
                <div className="tc um-offer">
                  {erow("owner_type", "구분", r.owner_type,
                    <Chips mode="inline" opts={[{ code: "개인", label: "개인" }, { code: "법인", label: "법인" }]}
                      cur={r.owner_type ?? "미지정"} onSelect={(v) => pick({ owner_type: v === "미지정" || v === r.owner_type ? null : v })} />)}
                  {erow("relation", "관계", lab("relation", r.relation),
                    <Chips mode="inline" opts={options("relation")} cur={r.relation ?? "미지정"}
                      onSelect={(v) => pick({ relation: v === "미지정" || v === r.relation ? null : v })} />)}
                  {erow("owner_age_band", "나이", lab("buyer_age", rr["owner_age_band"]),
                    <Chips mode="inline" opts={options("buyer_age")} cur={rr["owner_age_band"] ?? "미지정"}
                      onSelect={(v) => pick({ owner_age_band: v === "미지정" || v === rr["owner_age_band"] ? null : v })} />)}
                  {erow("owner_gender", "성별", lab("buyer_gender", rr["owner_gender"]),
                    <Chips mode="inline" opts={options("buyer_gender")} cur={rr["owner_gender"] ?? "미지정"}
                      onSelect={(v) => pick({ owner_gender: v === "미지정" || v === rr["owner_gender"] ? null : v })} />)}
                  {erow("cooperation", "협조", lab("cooperation", r.cooperation),
                    <Chips mode="inline" opts={options("cooperation")} cur={r.cooperation ?? "미지정"}
                      onSelect={(v) => pick({ cooperation: v === "미지정" || v === r.cooperation ? null : v })} />)}
                  {erow("kindness", "응대", lab("kindness", r.kindness),
                    <Chips mode="inline" opts={options("kindness")} cur={r.kindness ?? "미지정"}
                      onSelect={(v) => pick({ kindness: v === "미지정" || v === r.kindness ? null : v })} />)}
                </div>
              </div>
            )}

            {/* ── 접촉 ── */}
            {tab === "touch" && (
              <div className="um-pane">
                <div className="tc um-offer">
                  {erow("call_result", "통화", lab("call_result", r.call_result),
                    <Chips mode="inline" opts={options("call_result")} cur={r.call_result ?? "미지정"}
                      onSelect={(v) => pick({ call_result: v === "미지정" || v === r.call_result ? null : v })} />)}
                  {erow("intent", "의사", lab("intent", r.intent),
                    <Chips mode="inline" opts={options("intent")} cur={r.intent ?? "미지정"}
                      onSelect={(v) => pick({ intent: v === "미지정" || v === r.intent ? null : v })} />)}
                  {erow("urgency", "급함", lab("urgency", r.urgency),
                    <Chips mode="inline" opts={options("urgency")} cur={r.urgency ?? "미지정"}
                      onSelect={(v) => pick({ urgency: v === "미지정" || v === r.urgency ? null : v })} />)}
                  {/* 시기 — 막연한 시점(칩) 또는 날짜 하나. 둘 중 하나만 산다(0099 sell_on 복귀 2026-09-26) */}
                  {erow("sell_vague", "시기", r.sell_on ? r.sell_on.replace(/-/g, ".") : lab("sell_vague", r.sell_vague),
                    <span className="um-when">
                      <Chips mode="inline" opts={options("sell_vague")} cur={r.sell_on ? "미지정" : (r.sell_vague ?? "미지정")}
                        onSelect={(v) => pick({ sell_vague: v === "미지정" ? null : v, sell_on: null })} />
                      <input type="date" className="um-in num" value={r.sell_on ?? ""}
                        onChange={(e) => pick({ sell_on: e.target.value || null, sell_vague: null })} />
                    </span>)}
                  {erow("convert", "전환", r.owner_buyer_id ? "매수도 원함" : null,
                    <Chips mode="inline" opts={[{ code: "매수도 원함", label: "매수도 원함" }]}
                      cur={r.owner_buyer_id ? "매수도 원함" : "미지정"}
                      onSelect={async () => {
                        if (r.owner_buyer_id) await convertApi.ownerFromBuyer(pk);
                        else await convertApi.ownerToBuyer(pk);
                        setOpenRow(null); onSaved();
                      }} />)}
                </div>
              </div>
            )}

            {/* ── 정보 ── */}
            {tab === "info" && (
              <div className="um-pane">
                <div className="tc um-offer">
                  {/* 대분류 — 하나(0184) · 소분류 — 여럿(0182). 소분류는 칩을 누를 때마다 저장, 창은 안 닫힌다 */}
                  {erow("building_major", "매물 유형", lab("building_major", r.building_major),
                    <Chips mode="inline" opts={options("building_major")} cur={r.building_major ?? "미지정"}
                      onSelect={(v) => pick({ building_major: v === "미지정" ? null : v })} />)}
                  {erow("building_use", "소분류",
                    (r.building_use ?? []).map((c) => lab("building_use", c)).join(" · ") || null,
                    <span className="chips-in">
                      {options("building_use").map((o) => {
                        const on = (r.building_use ?? []).includes(o.code);
                        return (
                          <button key={o.code} className={on ? "on" : ""} onClick={() => {
                            const cur = r.building_use ?? [];
                            const next = on ? cur.filter((c) => c !== o.code) : [...cur, o.code];
                            put({ building_use: next.length ? next : null });
                          }}>{o.label}</button>
                        );
                      })}
                    </span>)}
                  {([["grade", "등급"], ["ipji", "입지"], ["nohudo", "노후도"]] as const).map(([key, l2]) =>
                    erow(key, l2, lab(key, rr[key]),
                      <Chips mode="inline" opts={options(key)} cur={rr[key] ?? "미지정"}
                        onSelect={(v) => pick({ [key]: v === "미지정" ? null : v })} />))}
                  {erow("exclusive", "전속", r.exclusive == null ? null : r.exclusive ? "전속" : "일반",
                    <Chips mode="inline" opts={[{ code: "전속", label: "전속" }, { code: "일반", label: "일반" }]}
                      cur={r.exclusive == null ? "미지정" : r.exclusive ? "전속" : "일반"}
                      onSelect={(v) => { put({ exclusive: v === "미지정" ? null : v === "전속" }); setOpenRow(null); }} />)}
                  {([["meongdo", "명도"], ["use_change", "용도변경"], ["myeolsil", "멸실"]] as const).map(([key, l2]) =>
                    erow(key, l2, lab(key, rr[key]),
                      <Chips mode="inline" opts={options(key)} cur={rr[key] ?? "미지정"}
                        onSelect={(v) => pick({ [key]: v === "미지정" || v === rr[key] ? null : v })} />))}
                  {erow("rent_check", "임대내역",
                    rr["rent_check"]
                      ? `${rr["rent_check"]}${(r as unknown as { rent_n?: number }).rent_n ? ` · ${(r as unknown as { rent_n?: number }).rent_n}건` : ""}`
                      : null,
                    <Chips mode="inline" opts={[{ code: "확인중", label: "확인중" }, { code: "받음", label: "받음" }]}
                      cur={rr["rent_check"] ?? "미지정"}
                      onSelect={(v) => pick({ rent_check: v === "미지정" || v === rr["rent_check"] ? null : v })} />)}
                </div>
                <div className="tc um-offer">
                  {/* 매물번호·접수일은 등록 순간 DB 가 발급한다(0068) — 읽기만 */}
                  <div className="orow"><span className="who g">매물번호</span><span className="cap" />
                    <span className={`ev num ${r.listing_no ? "" : "off"}`}>{r.listing_no ?? "—"}</span><span className="okpad" /></div>
                  <div className="orow"><span className="who g">접수일</span><span className="cap" />
                    <span className={`ev num ${r.received_on ? "" : "off"}`}>{r.received_on ? r.received_on.replace(/-/g, ".") : "—"}</span><span className="okpad" /></div>
                  {/* 담당 = 등록(S02 §4.1). 비우면 등록이 풀리므로 다른 사람으로 바꾸기만 한다 */}
                  {erow("assignee", "담당", team.data?.find((m) => m.account_id === r.assignee_account_id)?.name ?? null,
                    <span className="chips-in">
                      {(team.data ?? []).map((m) => (
                        <button key={m.account_id} className={m.account_id === r.assignee_account_id ? "on" : ""}
                          onClick={async () => {
                            if (m.account_id === r.assignee_account_id) return;
                            await listingsApi.claim(pk, m.account_id); setOpenRow(null); onSaved();
                          }}>{m.name}</button>
                      ))}
                    </span>)}
                </div>
                <div className="tc um-offer">
                  {/* 시세대비(0187) — 사람이 매긴다. 적정가로 자동으로 채우지 않는다 */}
                  {erow("price_vs_market", "시세대비", lab("price_vs_market", r.price_vs_market),
                    <Chips mode="inline" opts={options("price_vs_market")} cur={r.price_vs_market ?? "미지정"}
                      onSelect={(v) => pick({ price_vs_market: v === "미지정" ? null : v })} />)}
                </div>
                <div className="tc um-half">
                  <div className="um-row"><span className="k">매매가</span>
                    {editable("sale", r.list_price != null ? wonAcc(r.list_price) : null, async (t) => {
                      const v = parseAmount(t); await listingsApi.patchBiz(pk, { sale_price: v != null ? String(v) : "" }); onSaved();
                    })}</div>
                  <div className="um-row"><span className="k">매도희망가</span>
                    {editable("ask", r.ask_price != null ? wonAcc(r.ask_price) : null, async (t) => {
                      const v = parseAmount(t); await listingsApi.patchBiz(pk, { ask_price: v != null ? String(v) : "" }); onSaved();
                    })}</div>
                </div>
              </div>
            )}

            {/* ── 임대 내역 ── 팀 호실 줄(0185). 건물 상세의 층별 정보와 나뉜다 */}
            {tab === "rent" && (
              <div className="um-pane"><RentLedger pk={pk} onSaved={onSaved} /></div>
            )}
            {/* ── 사진 ── 건물 상세 사진과 같은 표·같은 부품 */}
            {tab === "photo" && (
              <div className="um-pane"><div className="tc"><UploadTab pk={pk} /></div></div>
            )}
            {/* ── 계약 ── 결정 문장(채택되면 선다) + 호가 줄(마지막 움직임 · 클릭 = 이력) */}
            {tab === "deal" && (
              <div className="um-pane">
                {lead?.picked_at && (
                  <div className="tc">
                    <div className="um-sent">
                      <b>{lead.buyer_name}</b>과{" "}
                      {pEdit === "deal" ? (
                        <input className="um-sin num" autoFocus value={pTxt}
                          onChange={(e) => setPTxt(e.target.value)}
                          onBlur={async () => {
                            setPEdit(null);
                            const v = pTxt.trim() ? parseAmount(pTxt) : null;
                            if (v != null) { await dealApi.patch(lead.id, { picked: true, pick_price: v }); onSaved(); }
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                      ) : (
                        <button className="um-sp num"
                          onClick={() => { setPEdit("deal"); setPTxt(dealPrice != null ? seedAmount(dealPrice) : ""); }}>
                          {dealPrice != null ? wonAcc(dealPrice) : "—"}</button>
                      )}에 계약
                    </div>
                    <div className="um-sub">
                      {(preNow != null || !!local["pre_on"]) && mchip("계약금 일부", "pre_amt",
                        preNow != null ? wonAcc(preNow) : null,
                        async (t) => { const n = parseAmount(t);
                          if (n != null) { await dealApi.patch(lead.id, { pre_contract_amount: n }); onSaved(); } },
                        async () => {
                          setLocal((p) => ({ ...p, pre_on: false }));
                          if (preNow != null) { await dealApi.patch(lead.id, { clear: ["pre_contract_amount", "pre_contract_on"] }); onSaved(); }
                        })}
                      {mchip("계약금", "down_amt", downNow != null ? wonAcc(downNow) : null,
                        async (t) => { const n = parseAmount(t);
                          if (n != null) { await dealApi.patch(lead.id, { down_payment: n }); onSaved(); } })}
                      {midSched && mchip("중도금", "mid_amt",
                        midNow != null ? wonAcc(midNow) : null,
                        async (t) => { const n = parseAmount(t);
                          if (n != null) { await schedulesApi.patch(midSched.id, { amount: n }); onSaved(); } },
                        async () => { await schedulesApi.remove(midSched.id); onSaved(); })}
                      {mchip("잔금", "bal", balanceSeed != null ? wonAcc(balanceSeed) : null)}
                      {preNow == null && !local["pre_on"] && (
                        <button className="um-ghost" onClick={() => setLocal((p) => ({ ...p, pre_on: true }))}>＋ 계약금 일부</button>)}
                      {!midSched && (
                        <button className="um-ghost" onClick={() => setSchedAt({ cat: "중도금" })}>＋ 중도금</button>)}
                    </div>
                  </div>
                )}

                <div className="tc um-offer">
                  {orow("ask_price", "매도희망", true, r.ask_price ?? null,
                    editable("ask", r.ask_price != null ? wonAcc(r.ask_price) : null, async (t) => {
                      const v = parseAmount(t);
                      await listingsApi.patchBiz(pk, { ask_price: v != null ? String(v) : "" }); onSaved();
                    }))}
                  {orow("sale_price", "매매가", true, r.list_price ?? null,
                    editable("sale", r.list_price != null ? wonAcc(r.list_price) : null, async (t) => {
                      const v = parseAmount(t);
                      await listingsApi.patchBiz(pk, { sale_price: v != null ? String(v) : "" }); onSaved();
                    }))}
                  {buyers.map((b) => orow(`b${b.id}`, b.buyer_name ?? "", false, b.hope_price ?? null,
                    editable(`hope_${b.id}`, b.hope_price != null ? wonAcc(b.hope_price) : null, async (t) => {
                      const v = parseAmount(t);
                      if (v != null) { await proposalsApi.update(b.id, { hope_price: v }); onSaved(); }
                    }),
                    <button className={`um-adopt ${b.picked_at ? "on" : ""}`}
                      title={b.picked_at ? "채택됨" : "채택"}
                      onClick={async (e) => {
                        e.stopPropagation();
                        await dealApi.patch(b.id, b.picked_at ? { picked: false }
                          : { picked: true, pick_price: b.hope_price ?? undefined });
                        onSaved();
                      }}>✓</button>,
                    /* 답 — 낱말은 사실에서 파생(보류 사유 · 답 대기). 적기는 보류 창 */
                    <span className="um-answer" onClick={(e) => e.stopPropagation()}>
                      {answerWord(b) && <i className={b.stop_id ? "" : "wait"}>{answerWord(b)}</i>}
                      <button className="um-reply" title={b.stop_id ? "보류 고치기" : "안 산다 · 보류"}
                        onClick={() => setHoldAt({ pid: b.id, name: b.buyer_name ?? "",
                          cur: b.stop_id
                            ? ({ id: b.stop_id, target_type: "proposal", target_id: String(b.id),
                                 stage: "deal", reason: b.stop_reason ?? null, note: null,
                                 created_at: "", held_days: null } as Stop)
                            : null })}>
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                          strokeWidth="2.4" strokeLinecap="round"><path d="M9 5v14M15 5v14" /></svg>
                      </button>
                    </span>))}
                  {buyers.length === 0 && (
                    <div className="orow"><span className="who g dim">매수자 없음</span></div>)}
                </div>

                {lead && (
                  <div className="scals">
                    {leadScheds.filter((s2) => s2.cat).sort((a2, b2) => (a2.on < b2.on ? -1 : 1)).map((s2) => (
                      <SchedCal key={s2.id} name={s2.cat ?? "일정"} on={s2.on} at={s2.at}
                        tone={calTone(s2.on, s2.state, s2.cat === "계약")}
                        onClick={() => setSchedAt({ id: s2.id, cat: (s2.cat ?? "일반") as never })} />
                    ))}
                    <SchedCalAdd onClick={() =>
                      setSchedAt({ cat: schedOf("계약") ? "일반" : "계약" })} />
                  </div>
                )}

                <div className="um-foot2">
                  <span className={`um-seg ${lead?.picked_at ? "" : "off"}`}>
                    {(["별도", "포함"] as const).map((v) => (
                      <button key={v} className={lead?.vat_mode === v ? "on" : ""}
                        onClick={async () => {
                          if (!lead?.picked_at) return;
                          await dealApi.patch(lead.id, { vat_mode: v }); onSaved();
                        }}>부가세 {v}</button>
                    ))}
                  </span>
                  <span className="sp" />
                  {/* 아이콘만 두니 부가세 칩 옆에 묻혀 「이게 뭐지」가 됐다(2026-08-28).
                      계약서·확인설명서·영수증을 만드는 자리라 이름을 붙여 세운다. */}
                  <button className="um-doc wide" onClick={openPapers}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></svg>
                    문서 만들기
                  </button>
                </div>
              </div>
            )}

            {/* ── 할일 ── 좌 리스트 / 우 상세 */}
            {/* ── 보류 ── 단계별 줄: 사유를 고르면 보류, 미지정으로 돌리면 해제. 깨움은 그 아래 줄 */}
            {tab === "hold" && (
              <div className="um-pane">
                <div className="tc um-offer">
                  {(["owner", "touch", "info", "match"] as StopStage[]).map((st) => {
                    const on = curStop?.stage === st;
                    const open = openRow === `hold_${st}`;
                    return (
                      <div key={st} className={`eitem ${open ? "open" : ""}`}>
                        <div className="orow has" onClick={() => setOpenRow(open ? null : `hold_${st}`)}>
                          <span className="who g">{STOP_KO[st]}</span><span className="cap" />
                          <span className={`ev ${on ? "bad" : "off"}`}>{on ? (curStop?.reason ?? "보류") : "—"}</span>
                        </div>
                        {open && (
                          <div className="eexp" onClick={(e) => e.stopPropagation()}>
                            <Chips mode="inline"
                              opts={[{ code: "미지정", label: "미지정" }, ...options(`stop_reason_${st}`)]}
                              cur={on ? (curStop?.reason ?? "미지정") : "미지정"}
                              onSelect={async (v2) => {
                                if (v2 === "미지정" || (on && v2 === curStop?.reason)) {
                                  if (on && curStop) await stopsApi.release(curStop.id);
                                } else await stopsApi.open({ target_type: "listing", target_id: pk, stage: st, reason: v2 });
                                setOpenRow(null); onSaved();
                              }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── 우측: 메모창 — 건물 상세 사이드바와 같은 컴포넌트(MemoLog) ── */}
          <MemoLog target="listing" id={pk} />
        </div>

        {pickB && (
          <PickModal mode="buyer" buildingPk={pk} title={`매수자 담기 — ${dongAddr(r.addr)}`}
            onClose={() => setPickB(false)} onAdded={() => onSaved()} />
        )}
        {holdAt && (
          <StopModal target={{ type: "proposal", id: String(holdAt.pid) }} stage="deal"
            title={`${holdAt.name} · ${dongAddr(r.addr)}`} cur={holdAt.cur}
            onClose={() => setHoldAt(null)}
            onSaved={() => { setHoldAt(null); onSaved(); }} />
        )}

        {schedAt && lead && (
          <SchedModal
            init={(schedAt.id != null ? (() => {
              const s = leadScheds.find((x) => x.id === schedAt.id)!;
              return { title: s.title, on: s.on, at: s.at, place: null, hint: "",
                category: (s.cat ?? "일반") as never };
            })() : { title: schedAt.title ?? "", on: "", at: null, place: null, hint: "",
              category: schedAt.cat as never }) as never}
            addr={r.addr} buildingPk={pk}
            base={{ kind: "buyer", ref_id: lead.buyer_id, label: lead.buyer_name ?? "" }}
            initExtras={{
              중도금: (() => { const y = schedOf("중도금"); return y ? { on: y.on, at: y.at } : null; })(),
              잔금: (() => { const y = schedOf("잔금"); return y ? { on: y.on, at: y.at } : null; })(),
            } as never}
            onCancel={() => setSchedAt(null)} onSkip={() => setSchedAt(null)}
            onDone={saveSched} />
        )}
      </div>
    </div>
  ), document.body);
}
