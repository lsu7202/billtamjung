/** 통합 매수자 모달(2026-08-24) — 매물 모달과 같은 얼굴·같은 결(확정 디자인 규칙).
 *
 *  탭 4: 프로필 · 조건 · 매물 · 보류 + 우측 메모창(상주).
 *  프로필·인적사항은 buyersApi.update 실저장. 조건 편집은 지도가 필요해 검색 화면으로 간다.
 *  주민등록번호는 여기에도 없다 — 문서 탭에서만 산다(0128).
 */
import { useState, type ReactNode } from "react";
import { MemoLog } from "./MemoLog";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  buyersApi, dealApi, proposalsApi, stopsApi,
  type Buyer, type BuyerCondition, type Stop, type StopStage,
} from "../../../shared/api/endpoints";
import { dongAddr, md, wonAcc } from "../../../shared/format";
import { useEnums } from "../../../shared/hooks/useEnums";
import { Chips } from "../../building/EnumField";
import { formatPhone, parseAmount } from "../../building/KV";
import { SchedModal, type SchedFinal } from "../SchedModal";
import { negoWord } from "../words";
import "./draft.css";

type Tab = "profile" | "cond" | "deals" | "hold";

/** 취득 부대비용 기본 5.7% = 중개 0.9 + 취득세등 4.6 + 법무사 0.2. 협의로 달라지니 고칠 수 있다. */
const FEE_PCT_DEFAULT = 5.7;

export function UnifiedBuyerModal({ b, tab0, onClose, onSaved, onGoListing, onEditCond, onOpenCond, onDelete }: {
  b: Buyer; tab0?: Tab;
  onClose: () => void; onSaved: () => void;
  onGoListing?: (pk: string) => void;
  onEditCond?: (c?: BuyerCondition) => void;
  onOpenCond?: (c: BuyerCondition) => void;
  onDelete?: () => void;
}) {
  const { options } = useEnums();
  const [tab, setTab] = useState<Tab>(tab0 ?? "profile");
  const put = async (patch: Record<string, unknown>) => {
    // 백엔드 어법: null=그대로 · 빈 문자열=지움 · 불리언 비우기=clear 목록
    const body: Record<string, unknown> = {};
    const clear: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) {
        if (k === "is_corp" || k === "is_agent") clear.push(k);
        else body[k] = "";
      } else body[k] = v;
    }
    if (clear.length) body.clear = clear;
    await buyersApi.update(b.id, body); onSaved();
  };

  /* 매물(짝) */
  const props2 = useQuery({ queryKey: ["proposals", b.id], queryFn: () => proposalsApi.list({ buyer_id: b.id }) });
  type SchedRow = { id: number; title: string; cat: string | null; on: string; at: string | null; state: string };
  const schedsOf = (p: unknown): SchedRow[] => {
    const x = (p as { scheds?: unknown })?.scheds;
    if (Array.isArray(x)) return x as SchedRow[];
    if (typeof x === "string") { try { return JSON.parse(x) ?? []; } catch { return []; } }
    return [];
  };
  /* 브리핑 일정 잡기 — 저장하면 그 짝의 일정이 되고, 소화하면 브리핑 날짜가 자동 기입된다 */
  const [briefAt, setBriefAt] = useState<null | { pid: number; pk: string; addr: string | null }>(null);
  const saveBrief = async (sf: SchedFinal) => {
    if (!briefAt) return;
    await proposalsApi.update(briefAt.pid, { cell: "brief", schedule: {
      title: sf.title || `브리핑 — ${dongAddr(briefAt.addr)}`.trim(),
      on: sf.on, at: sf.at ?? null, category: "브리핑",
      building_pk: briefAt.pk, people: sf.people,
    } });
    setBriefAt(null); onSaved(); props2.refetch();
  };

  /* 줄 부품 — 매물 모달과 같은 어법 */
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [pEdit, setPEdit] = useState<string | null>(null);
  const [pTxt, setPTxt] = useState("");
  const editable = (key: string, val: string | null, onDone2: (v: string) => void, ph = "—") =>
    pEdit === key ? (
      <input className="um-in num" autoFocus value={pTxt}
        onChange={(e) => setPTxt(e.target.value)}
        onBlur={() => { setPEdit(null); if (pTxt.trim()) onDone2(pTxt.trim()); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    ) : (
      <button className="um-vp" onClick={() => { setPEdit(key); setPTxt(val ?? ""); }}>
        <b className="num">{val ?? ph}</b></button>
    );
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
  const trow = (k: string, label: string, cur: string | null | undefined) => (
    <div key={k} className="orow"><span className="who g">{label}</span><span className="cap" />
      {editable(k, cur ?? null, (v) => put({ [k]: v }))}
      <span className="okpad" /></div>
  );
  const pick = (patch: Record<string, unknown>) => { put(patch); setOpenRow(null); };
  const lab = (enumKey: string, code: string | null | undefined) =>
    code == null ? null : (options(enumKey).find((o) => o.code === code)?.label ?? code);

  /* 보류 — 매수자 단계: 살 물건 찾기·제안 */
  const STOP_KO: Record<string, string> = { find: "찾기", deal: "제안", touch: "접촉", intent: "의사" };
  const curStop: Stop | null = b.stop_id ? {
    id: b.stop_id, target_type: "buyer", target_id: String(b.id),
    stage: (b.stop_stage ?? "find") as StopStage, reason: b.stop_reason ?? null,
    note: null, created_at: "", held_days: null,
  } : null;

  /* 투자 시뮬레이션(0133) — 조건 탭의 가정 × 이 매물의 값.
     밑값은 **거래가 → 매수희망가 → 매매가(팀값 없으면 추정가)** 순. 합의된 값이 있으면 그게 먼저다.
     LTV는 담보가치(매매가) 기준 — 총투자비로 나누면 은행이 말하는 LTV와 달라진다. */
  const sim = (p: { deal_price: number | null; hope_price: number | null; price: number | null;
                    annual_rent?: number | null }) => {
    const base = p.deal_price ?? p.hope_price ?? p.price ?? null;
    const eq = b.equity_won ?? null;
    const rent0 = p.annual_rent ?? null;
    // 임대료가 없으면 ROE를 안 센다(0134). 총임대료는 층별 실측의 합계이거나 팀이 직접 적은
    // 총액이고, 둘 다 없으면 추정으로 메우지 않는다 — ROE는 레버리지가 걸려 임대 오차가
    // 몇 배로 증폭되므로, 추정 위에 세운 ROE는 틀린 값을 확신 있게 말하는 것이 된다.
    if (!base || eq == null || !rent0) return (
      <div className="brow"><span className="bk">시뮬</span>
        <span className="ev off">{
          eq == null ? "조건 탭에 자기자본을 적으면 계산합니다"
            : !rent0 ? "—"
              : "값이 없습니다"}</span></div>
    );
    const fp = b.fee_pct ?? FEE_PCT_DEFAULT;
    const fee = Math.round(base * (fp / 100));
    const acq = base + fee;                                   // 총투자비 = 값 + 부대비용
    const loan = Math.max(0, acq - eq);
    const ltv = loan ? (loan / base) * 100 : null;
    const r = b.loan_rate;                                    // 금리 미지정이면 이자·순수익·ROE는 안 센다
    const annInt = r != null ? Math.round(loan * (r / 100)) : null;
    const annNet = annInt != null ? rent0 - annInt : null;
    const roe = annNet != null && eq > 0 ? (annNet / eq) * 100 : null;
    const which = p.deal_price != null ? "거래가" : p.hope_price != null ? "매수희망가" : "매매가";
    return (
      <>
        <div className="brow"><span className="bk">시뮬</span>
          <span className="ev num">{wonAcc(acq)}<em className="um-dim"> 총투자비 · {which} 기준</em></span></div>
        <div className="brow"><span className="bk" />
          <span className="ev num">{loan ? wonAcc(loan) : "0"}
            <em className="um-dim"> 대출{ltv != null ? ` · LTV ${ltv.toFixed(0)}%` : " 없음(전액 자기자본)"}</em></span></div>
        <div className="brow"><span className="bk" />
          <span className={`ev num ${annInt == null ? "off" : ""}`}>
            {annInt != null ? wonAcc(annInt) : "—"}<em className="um-dim"> 연 이자{r == null ? " · 금리 미지정" : ""}</em></span></div>
        <div className="brow"><span className="bk" />
          <span className={`ev num ${annNet == null ? "off" : ""}`}>
            {annNet != null ? wonAcc(annNet) : "—"}
            <em className="um-dim"> 연 순수익 · 임대료 기준</em></span></div>
        <div className="brow"><span className="bk" />
          <span className={`ev num ${roe == null ? "off" : ""}`}
            style={roe != null ? { color: roe >= 0 ? "var(--signal)" : "var(--red)" } : undefined}>
            {roe != null ? `${roe.toFixed(1)}%` : "—"}<em className="um-dim"> 자기자본 수익률</em></span></div>
      </>
    );
  };

  const corp = b.is_corp === true;
  const condSummary = (c: BuyerCondition) => {
    const j = c.conditions_json ?? {};
    const n = Object.keys(j).length;
    return n ? `${n}칸` : "빈 조건";
  };

  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="um" onClick={(e) => e.stopPropagation()}>
        <div className="um-head">
          <b>{b.name}</b>
          {b.top_status && <span className="um-st">{b.top_status}</span>}
          <span className="sp" />
          <button className="um-x" onClick={onClose}>✕</button>
        </div>

        <div className="um-body">
          <div className="um-main">
            <div className="um-tabs">
              {([["profile", "프로필"], ["cond", "조건"], ["deals", "매물"], ["hold", "보류"]] as [Tab, string][]).map(([k, l]) => (
                <button key={k} className={`${tab === k ? "on" : ""} ${k === "hold" ? "hold" : ""}`}
                  onClick={() => setTab(k)}>
                  {l}{k === "hold" && curStop ? <i className="hdot" /> : null}</button>
              ))}
            </div>

            {/* ── 프로필 ── */}
            {tab === "profile" && (
              <div className="um-pane">
                <div className="tc">
                  <div className="um-row"><span className="k">이름</span>
                    {editable("name", b.name ?? null, (v) => put({ name: v }))}</div>
                  <div className="um-row"><span className="k">전화</span>
                    {b.phone_masked
                      ? <span className="dim">담당자 본인·대표만 볼 수 있습니다</span>
                      : editable("phone", b.phone ? formatPhone(b.phone) : null,
                        (v) => put({ phone: v.replace(/[^0-9]/g, "") }))}
                  </div>
                </div>
                <div className="tc um-offer">
                  {trow("addr", "주소", b.addr)}
                  {corp && trow("rep_name", "대표자", b.rep_name)}
                  {corp && trow("corp_no", "법인등록번호", b.corp_no)}
                  {erow("nationality", "외국인", b.nationality,
                    <Chips mode="inline" opts={[{ code: "내국인", label: "내국인" }, { code: "외국인", label: "외국인" }]}
                      cur={b.nationality ?? "미지정"}
                      onSelect={(v) => pick({ nationality: v === "미지정" || v === b.nationality ? null : v })} />)}
                </div>
                <div className="tc um-offer">
                  {erow("is_corp", "구분", b.is_corp == null ? null : b.is_corp ? "법인" : "개인",
                    <Chips mode="inline" opts={[{ code: "개인", label: "개인" }, { code: "법인", label: "법인" }]}
                      cur={b.is_corp == null ? "미지정" : b.is_corp ? "법인" : "개인"}
                      onSelect={(v) => pick({ is_corp: v === "미지정" || (v === "법인") === b.is_corp ? null : v === "법인" })} />)}
                  {erow("is_agent", "상대", b.is_agent == null ? null : b.is_agent ? "대리인" : "본인",
                    <Chips mode="inline" opts={[{ code: "본인", label: "본인" }, { code: "대리인", label: "대리인" }]}
                      cur={b.is_agent == null ? "미지정" : b.is_agent ? "대리인" : "본인"}
                      onSelect={(v) => pick({ is_agent: v === "미지정" || (v === "대리인") === b.is_agent ? null : v === "대리인" })} />)}
                  {erow("grade", "등급", lab("buyer_grade", b.grade),
                    <Chips mode="inline" opts={options("buyer_grade")} cur={b.grade ?? "미지정"}
                      onSelect={(v) => pick({ grade: v === "미지정" || v === b.grade ? null : v })} />)}
                  {erow("source", "출처", lab("buyer_source", b.source),
                    <Chips mode="inline" opts={options("buyer_source")} cur={b.source ?? "미지정"}
                      onSelect={(v) => pick({ source: v === "미지정" || v === b.source ? null : v })} />)}
                  {erow("age_band", "나이", lab("buyer_age", b.age_band),
                    <Chips mode="inline" opts={options("buyer_age")} cur={b.age_band ?? "미지정"}
                      onSelect={(v) => pick({ age_band: v === "미지정" || v === b.age_band ? null : v })} />)}
                  {erow("gender", "성별", lab("buyer_gender", b.gender),
                    <Chips mode="inline" opts={options("buyer_gender")} cur={b.gender ?? "미지정"}
                      onSelect={(v) => pick({ gender: v === "미지정" || v === b.gender ? null : v })} />)}
                  {erow("cooperation", "협조", lab("cooperation", b.cooperation),
                    <Chips mode="inline" opts={options("cooperation")} cur={b.cooperation ?? "미지정"}
                      onSelect={(v) => pick({ cooperation: v === "미지정" || v === b.cooperation ? null : v })} />)}
                  {erow("kindness", "응대", lab("kindness", b.kindness),
                    <Chips mode="inline" opts={options("kindness")} cur={b.kindness ?? "미지정"}
                      onSelect={(v) => pick({ kindness: v === "미지정" || v === b.kindness ? null : v })} />)}
                  {erow("urgency", "급함", lab("urgency", b.urgency),
                    <Chips mode="inline" opts={options("urgency")} cur={b.urgency ?? "미지정"}
                      onSelect={(v) => pick({ urgency: v === "미지정" || v === b.urgency ? null : v })} />)}
                  {erow("call_result", "통화", lab("call_result", b.call_result),
                    <Chips mode="inline" opts={options("call_result")} cur={b.call_result ?? "미지정"}
                      onSelect={(v) => pick({ call_result: v === "미지정" || v === b.call_result ? null : v })} />)}
                </div>
                {onDelete && (
                  <div className="um-foot2"><span className="sp" />
                    <button className="um-ghost bad" onClick={onDelete}>매수자 삭제</button></div>
                )}
              </div>
            )}

            {/* ── 조건 ── 클릭=그 조건으로 검색 · 연필=편집(지도) · ✕=삭제 */}
            {tab === "cond" && (
              <div className="um-pane">
                <div className="tc um-offer">
                  {(b.conditions ?? []).map((c) => (
                    <div key={c.id} className="orow has" onClick={() => onOpenCond?.(c)}>
                      <span className="who">{c.name}</span>
                      <span className="cap" />
                      <span className="ev off num">{condSummary(c)}</span>
                      <span className="act" onClick={(e) => e.stopPropagation()}>
                        <button className="mini" title="편집" onClick={() => onEditCond?.(c)}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
                        </button>
                        <button className="mini" title="삭제" onClick={async () => {
                          await buyersApi.removeCondition(c.id); onSaved();
                        }}>✕</button>
                      </span>
                    </div>
                  ))}
                  {(b.conditions ?? []).length === 0 && (
                    <div className="orow"><span className="who g dim">조건 없음</span></div>)}
                </div>
                {/* 투자 가정(0133) — 자기자본·금리·부대비용률. **그 사람의 형편**이라 여기 한 번만 적고,
                    담은 매물 전부가 이 값으로 계산된다. 결과는 매물 탭에서 매물별로 선다.
                    미지정은 —, 지어내지 않는다(금리를 안 물어봤는데 4%로 채우면 안 한 계산이 화면에 선다). */}
                <div className="um-k2">투자 가정</div>
                <div className="tc um-offer">
                  <div className="orow"><span className="who g">자기자본</span><span className="cap" />
                    {editable("fin_equity", b.equity_won != null ? wonAcc(b.equity_won) : null,
                      (t) => { const v = parseAmount(t); put(v != null ? { equity_won: v } : { equity_won: null }); })}
                    <span className="okpad" /></div>
                  <div className="orow"><span className="who g">대출 금리(연)</span><span className="cap" />
                    {editable("fin_rate", b.loan_rate != null ? `${b.loan_rate}%` : null,
                      (t) => { const v = parseFloat(t.replace(/[^0-9.]/g, "")); put({ loan_rate: isNaN(v) ? null : v }); })}
                    <span className="okpad" /></div>
                  <div className="orow"><span className="who g">취득 부대비용률</span><span className="cap" />
                    {editable("fin_fee", b.fee_pct != null ? `${b.fee_pct}%` : null,
                      (t) => { const v = parseFloat(t.replace(/[^0-9.]/g, "")); put({ fee_pct: isNaN(v) ? null : v }); },
                      `${FEE_PCT_DEFAULT}% 기본`)}
                    <span className="okpad" /></div>
                </div>
                <div className="um-foot2">
                  <button className="um-ghost" onClick={() => onEditCond?.()}>＋ 조건</button>
                  <span className="sp" />
                </div>
              </div>
            )}

            {/* ── 매물 ── 이 사람이 담은 짝들. 클릭 = 펼침(브리핑 관리), 이동은 호버 화살표 */}
            {tab === "deals" && (
              <div className="um-pane">
                <div className="tc um-offer">
                  {(props2.data ?? []).map((p) => {
                    const word = negoWord(p);
                    const open = openRow === `deal_${p.id}`;
                    const how = p.brief_how ?? [];
                    return (
                      <div key={p.id} className={`eitem ${open ? "open" : ""}`}>
                        <div className="orow has" onClick={() => setOpenRow(open ? null : `deal_${p.id}`)}>
                          <span className="who">{dongAddr(p.addr) || p.building_pk}</span>
                          <span className="cap">{word}</span>
                          {p.picked_at ? (
                            <span className="ev num">{p.deal_price != null ? wonAcc(p.deal_price) : "—"}</span>
                          ) : (
                            <span onClick={(e) => e.stopPropagation()}>
                              {editable(`hope_${p.id}`, p.hope_price != null ? wonAcc(p.hope_price) : null,
                                async (t) => {
                                  const v = parseAmount(t);
                                  if (v != null) { await proposalsApi.update(p.id, { hope_price: v }); onSaved(); props2.refetch(); }
                                })}</span>
                          )}
                          <span className="act" onClick={(e) => e.stopPropagation()}>
                            <button className="mini" title="담기 해제" onClick={async () => {
                              if (!confirm(`「${dongAddr(p.addr) || p.building_pk}」을(를) 이 매수자에게서 뺄까요?`)) return;
                              await proposalsApi.remove(p.id); onSaved(); props2.refetch();
                            }}>✕</button>
                            <button className="mini" title="매물로 이동" onClick={() => onGoListing?.(p.building_pk)}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
                            </button>
                          </span>
                        </div>
                        {open && (
                          <div className="eexp bexp" onClick={(e) => e.stopPropagation()}>
                            <div className="brow"><span className="bk">브리핑</span>
                              <span className="chips-in">
                                {options("brief_how").map((o) => {
                                  const sel = how.includes(o.code);
                                  return (
                                    <button key={o.code} className={sel ? "on" : ""}
                                      onClick={async () => {
                                        const next = sel ? how.filter((x) => x !== o.code) : [...how, o.code];
                                        await dealApi.patch(p.id, next.length ? { brief_how: next } : { clear: ["brief_how"] });
                                        onSaved(); props2.refetch();
                                      }}>{o.label}</button>
                                  );
                                })}
                              </span></div>
                            <div className="brow"><span className="bk" />
                              {(() => {
                                const bs2 = schedsOf(p).filter((x) => x.cat === "브리핑");
                                const done2 = bs2.find((x) => x.state === "완료");
                                const due = bs2.find((x) => x.state !== "완료");
                                if (done2) return <span className="ev num">{md(done2.on)} 완료</span>;
                                if (p.briefed_on) return <span className="ev num">{md(String(p.briefed_on).slice(0, 10))} 완료</span>;
                                if (due) return <span className="ev num">{md(due.on)}{due.at ? ` ${due.at.slice(0, 5)}` : ""} 예정</span>;
                                return (
                                  <button className="um-ghost"
                                    onClick={() => setBriefAt({ pid: p.id, pk: p.building_pk, addr: p.addr ?? null })}>
                                    ＋ 일정 잡기</button>
                                );
                              })()}</div>
                            {/* 투자 시뮬레이션(0133) — 조건 탭의 가정으로 이 매물을 계산한다 */}
                            {sim(p)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {(props2.data ?? []).length === 0 && (
                    <div className="orow"><span className="who g dim">담은 매물 없음</span></div>)}
                </div>
              </div>
            )}

            {/* ── 보류 ── */}
            {tab === "hold" && (
              <div className="um-pane">
                <div className="tc um-offer">
                  {(["find", "deal"] as StopStage[]).map((st) => {
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
                                } else await stopsApi.open({ target_type: "buyer", target_id: String(b.id), stage: st, reason: v2 });
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

          {briefAt && (
            <SchedModal
              init={{ title: `브리핑 — ${dongAddr(briefAt.addr)}`, on: "", at: null, place: null, hint: "",
                category: "브리핑" } as never}
              addr={briefAt.addr} buildingPk={briefAt.pk}
              base={{ kind: "buyer", ref_id: b.id, label: b.name ?? "" }}
              onCancel={() => setBriefAt(null)} onSkip={() => setBriefAt(null)}
              onDone={saveBrief} />
          )}

          {/* ── 우측: 메모창 — 매물 모달·건물 상세와 같은 컴포넌트(MemoLog) ── */}
          <MemoLog target="buyer" id={String(b.id)} />
        </div>
      </div>
    </div>
  ), document.body);
}
