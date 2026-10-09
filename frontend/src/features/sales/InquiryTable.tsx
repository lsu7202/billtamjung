import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { inquiriesApi, type CustomerProfile, type Inquiry, type InquiryStatus } from "../../shared/api/endpoints";
import { shortAddr, won } from "../../shared/format";
import { Loading } from "../../shared/ui/Spinner";
import { Icon } from "../../shared/ui/Icon";
import { formatPhone } from "../building/KV";
import { openParcel } from "../../shared/map/geo";
import { condSummary } from "./summaries";
import "./draft/salestab.css";

/* ══════════════════════ 고객관리 = 문의 관리(S09, 2026-10-04) ══════════════════════
 *
 * 매물관리와 같은 결 — 전체 폭 표, 줄을 누르면 「이름」 열 오른쪽부터 판이 붙는다(목록은 남아 다른 문의로 넘어간다).
 * 매물과 잇지 않는다(고객등록 · 담은 매물 없음). 하는 일: 문의를 보고, 원하는 건물을 판단하고, 상태와 메모를 남긴다.
 * 고객 배경은 **문의 순간 사본**(profile_snap) — 고객이 나중에 프로필을 고쳐도 받은 문의는 그대로다. */

const STATUSES: InquiryStatus[] = ["미확인", "상담중", "종료"];
const KIND_SHORT: Record<string, string> = { "매수 문의": "매수", "매도 문의": "매도", "시세 문의": "시세" };

const ymd = (s: string) => s.slice(2, 10).replace(/-/g, ".");
const hm = (s: string) => new Date(s).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

/** 예산 글자 — 「30~50억」 · 「50억 이하」 · 「100억 이상」. 모르면 빈 글자 */
function budgetText(p: Partial<CustomerProfile> | null): string {
  if (p?.budget_any) return "상관없음";
  const lo = p?.budget_min ?? null, hi = p?.budget_max ?? null;
  if (lo != null && hi != null && lo === hi) return won(lo);
  const e = (v: number) => won(v);
  if (lo != null && hi != null) return `${e(lo)}~${e(hi)}`;
  if (hi != null) return `${e(hi)} 이하`;
  if (lo != null) return `${e(lo)} 이상`;
  return "";
}
/** 원하는 건물 한 줄 — 목표 · 예산 · 시기 · 지역(셋까지). 목록 줄과 판 머리에 같이 쓴다 */
function wantLine(p: Partial<CustomerProfile> | null): string {
  if (!p) return "";
  const rg = p.regions ?? [];
  return [
    [...(p.goal ?? []), ...(p.build_intent === "있음" ? ["신축"] : [])].join(" · "),
    budgetText(p),
    p.timing ?? "",
    rg.length ? rg.slice(0, 3).join(" · ") + (rg.length > 3 ? ` 외 ${rg.length - 3}` : "") : "",
  ].filter(Boolean).join(" / ");
}

export function InquiryTable({ head, focus, onCustomer }: {
  head?: React.ReactNode; focus?: number | null; onCustomer?: (buyerId: number) => void;
}) {
  const qc = useQueryClient();
  const rows = useQuery({ queryKey: ["inquiries"], queryFn: inquiriesApi.list });
  const [q, setQ] = useState("");
  const [st, setSt] = useState<InquiryStatus | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(focus ?? null);
  useEffect(() => { if (focus) setOpenId(focus); }, [focus]);
  const list = rows.data ?? [];

  const shown = useMemo(() => {
    const t = q.trim();
    return list.filter((r) => (!st || r.status === st) && (!kind || r.kind === kind)
      && (!t || [r.name, r.phone, r.addr, r.body ?? "", r.sell_addr ?? ""].some((x) => x.includes(t))));
  }, [list, q, st, kind]);
  const cur = list.find((r) => r.id === openId) ?? null;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["inquiries"] }); qc.invalidateQueries({ queryKey: ["iqCount"] }); };

  // 판 자리 — 목록 상자의 오른쪽 · 위 끝에서 잰다(매물관리와 같은 방식)
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!cur) { setDock(null); return; }
    const measure = () => {
      const b = wrapRef.current?.getBoundingClientRect();
      if (b) setDock({ left: Math.round(b.right), top: Math.round(b.top) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [!!cur]);   // eslint-disable-line react-hooks/exhaustive-deps
  // ↑ ↓ — 판을 연 채로 이전 · 다음 문의
  useEffect(() => {
    if (!cur) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if ((e.target as HTMLElement)?.closest?.("input, textarea")) return;
      const i = shown.findIndex((r) => r.id === cur.id);
      const nx = shown[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (nx) { e.preventDefault(); setOpenId(nx.id); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [cur?.id, shown]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (rows.isLoading) return <Loading label="불러오는 중" minHeight="40vh" />;
  const nOf = (s: InquiryStatus) => list.filter((r) => r.status === s).length;
  return (
    <div className={`lx iqx ${cur ? "docked" : ""}`}>
      <div className="lx-bar">
        {head}
        <input className="lt-q lx-q" value={q} placeholder="이름 · 전화 · 주소 · 내용" onChange={(e) => setQ(e.target.value)} />
        {/* 상태 · 유형 — 칸을 누르면 거르고, 다시 누르면 푼다 */}
        {STATUSES.map((s) => (
          <button key={s} className={`lx-pn ${st === s ? "on" : ""}`} onClick={() => setSt(st === s ? null : s)}>
            {s}<b className="num">{nOf(s)}</b></button>
        ))}
        {(["매수 문의", "매도 문의", "시세 문의"] as const).map((k) => (
          <button key={k} className={`lx-pn ${kind === k ? "on" : ""}`} onClick={() => setKind(kind === k ? null : k)}>{KIND_SHORT[k]}</button>
        ))}
        <span className="sp" />
      </div>
      <div ref={wrapRef} className="lx-wrap">
        <table className="lx-t">
          <thead><tr>
            <th className="c-day">문의날짜</th>
            <th className="c-st">상태</th>
            <th className="c-kd">유형</th>
            <th>이름</th>
            <th className="c-x">원하는 건물</th>
            <th className="c-x">문의 매물</th>
            <th className="c-x">전화</th>
            <th className="c-x c-memo">메모</th>
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={`${openId === r.id ? "on" : ""} ${r.status === "미확인" ? "unread" : ""}`} onClick={() => setOpenId(r.id)}>
                <td className="c-day num">{ymd(r.created_at)}</td>
                <td className="c-st"><span className={`iq-st s-${r.status}`}>{r.status}</span></td>
                <td className="c-kd">{KIND_SHORT[r.kind] ?? r.kind}</td>
                <td className="c-nm"><b>{r.name}</b>{r.same_n > 1 && <span className="sub">문의 {r.same_n}건</span>}</td>
                <td className="c-want">{wantLine(r.profile_snap)}</td>
                <td className="c-addr">{r.kind === "매도 문의" && r.sell_addr ? <>팔 건물 {r.sell_addr}</> : shortAddr(r.addr)}</td>
                <td className="num">{formatPhone(r.phone)}</td>
                <td className="c-memo num">{r.note_n ? r.note_n : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <div className="lt-none">{list.length ? "맞는 문의가 없습니다" : "받은 문의가 없습니다"}</div>}
      </div>
      {cur && dock && <InquiryPanel key={cur.id} r={cur} all={list} docked={dock} onClose={() => setOpenId(null)}
        onOpen={setOpenId} onDone={refresh} onCustomer={onCustomer} />}
    </div>
  );
}

/** 문의 판 — 연락처 · 문의 · 고객 배경(문의 당시) · 상담(상태 · 메모) · 이 고객의 다른 문의. 줄은 매물 모달 건축물대장 탭과 같은 그리드 */
function InquiryPanel({ r, all, docked, onClose, onOpen, onDone, onCustomer }: {
  r: Inquiry; all: Inquiry[]; docked: { left: number; top: number };
  onClose: () => void; onOpen: (id: number) => void; onDone: () => void; onCustomer?: (buyerId: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  /** 고객으로 등록(S09 §2) — 같은 계정 고객이 있으면 붙이고, 없으면 만들어 문의 당시 배경 · 조건으로 채운다. 그 고객 판으로 간다 */
  const toCustomer = async () => {
    setBusy(true);
    try { const x = await inquiriesApi.toCustomer(r.id); onDone(); qc.invalidateQueries({ queryKey: ["buyers"] }); onCustomer?.(x.buyer_id); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const qc = useQueryClient();
  const notes = useQuery({ queryKey: ["iqNotes", r.id], queryFn: () => inquiriesApi.notes(r.id) });
  const [txt, setTxt] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const p = r.profile_snap;
  const others = all.filter((x) => x.account_id === r.account_id && x.id !== r.id);
  const setStatus = async (s: InquiryStatus) => {
    if (s === r.status) return;
    try { await inquiriesApi.status(r.id, s); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  const addNote = async () => {
    const t = txt.trim(); if (!t) return;
    try { await inquiriesApi.addNote(r.id, t); setTxt(""); qc.invalidateQueries({ queryKey: ["iqNotes", r.id] }); onDone(); }
    catch (e) { setErr((e as Error).message); }
  };
  const delNote = async (nid: number) => {
    await inquiriesApi.delNote(r.id, nid); qc.invalidateQueries({ queryKey: ["iqNotes", r.id] }); onDone();
  };
  const line = (k: string, v: React.ReactNode) => (
    <div className="lgx-r"><span className="lgx-k">{k}</span><div className="lgx-v iq-v">{v}</div></div>
  );
  return (
    <div className="um-dock" style={{ left: docked.left, top: docked.top }}>
      <div className="um docked iqp" onClick={(e) => e.stopPropagation()}>
        <div className="iqp-head">
          <b>{r.name}</b><span className="iqp-sub">{r.kind} · {ymd(r.created_at)} {hm(r.created_at)}</span>
          <span className="sp" />
          {r.buyer_id
            ? <button className="iqp-act" onClick={() => onCustomer?.(r.buyer_id!)}>고객 보기{r.buyer_name ? ` · ${r.buyer_name}` : ""}</button>
            : <button className="iqp-act main" disabled={busy} onClick={toCustomer}>고객으로 등록</button>}
          <button className="iqp-x" title="닫기" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <div className="iqp-body lgx">
          {err && <div className="lgx-err">{err}</div>}
          <div className="lgx-h">상담</div>
          {line("상태", <span className="lgx-chips">{STATUSES.map((s) => (
            <button key={s} className={r.status === s ? "on" : ""} onClick={() => setStatus(s)}>{s}</button>))}</span>)}
          <div className="iq-notes">
            {(notes.data ?? []).map((n) => (
              <div key={n.id} className="iq-note">
                <span className="iq-note-t">{n.body}</span>
                <span className="iq-note-m num">{n.author ?? ""} · {ymd(n.created_at)} {hm(n.created_at)}</span>
                <button className="iq-note-x" title="지우기" onClick={() => delNote(n.id)}><Icon name="close" size={12} /></button>
              </div>
            ))}
            <input className="iq-note-in" value={txt} placeholder="메모 한 줄 · Enter"
              onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) addNote(); }} />
          </div>

          <div className="lgx-h">연락처</div>
          {line("이름", <b>{r.name}</b>)}
          {line("전화", <b className="num">{formatPhone(r.phone)}</b>)}

          <div className="lgx-h">문의</div>
          {line("유형", <b>{r.kind}</b>)}
          {line("내용", <span className="iq-body">{r.body ?? ""}</span>)}
          {line("문의 매물", r.pnu
            ? <button className="iq-link" onClick={() => openParcel(r.pnu!)}>{shortAddr(r.addr)}{r.ad_title ? ` · ${r.ad_title}` : ""}</button> : "")}
          {r.kind === "매도 문의" && line("팔 건물", <b>{r.sell_addr ?? ""}</b>)}
          {line("경로", r.seek_id ? "구해요" : "광고")}

          <div className="lgx-h">문의 당시 고객 배경</div>
          {!p ? <div className="lgx-none">고객이 적은 배경이 없습니다</div> : <>
            {line("목표", <b>{(p.goal ?? []).join(" · ")}</b>)}
            {line("건축의사", <b>{p.build_intent ?? ""}</b>)}
            {line("예산", <b className="num">{budgetText(p)}</b>)}
            {line("개인/법인", <b>{p.is_corp == null ? "" : p.is_corp ? "법인" : "개인"}</b>)}
            {line("시드", <b className="num">{p.equity_won != null ? won(p.equity_won) : ""}</b>)}
            {line("시기", <b>{p.timing ?? ""}</b>)}
            {line("지역", <b>{(p.regions ?? []).join(" · ")}</b>)}
            {line("매입 경험", <b>{p.experience ?? ""}</b>)}
            {line("메모", <span className="iq-body">{p.note ?? ""}</span>)}
          </>}
          {(r.wants_snap ?? []).length > 0 && <>
            <div className="lgx-h">문의 당시 고객 조건</div>
            {r.wants_snap!.map((w, i) => line(w.name, <span>{condSummary({ id: i, name: w.name, conditions_json: w.conditions_json } as never) || ""}</span>))}
          </>}

          {others.length > 0 && <>
            <div className="lgx-h">이 고객의 다른 문의 {others.length}</div>
            {others.map((x) => (
              <div key={x.id} className="lgx-r iq-other" onClick={() => onOpen(x.id)}>
                <span className="lgx-k num">{ymd(x.created_at)}</span>
                <div className="lgx-v"><b>{KIND_SHORT[x.kind]}</b><span className="iq-o-a">{shortAddr(x.addr)}</span>
                  <span className={`iq-st s-${x.status}`}>{x.status}</span></div>
              </div>
            ))}
          </>}
        </div>
      </div>
    </div>
  );
}
