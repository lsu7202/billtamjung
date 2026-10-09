import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { authApi, customerApi, inquiriesApi, type AdCard, type CustomerTiming, type InquiryKind } from "../../shared/api/endpoints";
import { Face } from "../../shared/ui/Face";
import "./adcards.css";
import { formatPhone } from "../building/KV";

export function Avatar({ name, photo }: { name: string; photo?: string | null }) {
  return <Face name={name} photo={photo} className="adf-av" />;
}

/** 예산 칸(S09 §2) — 폼에서 한 번에 고르는 구간. 프로필엔 최소 · 최대로 남는다 */
const BUDGETS: [string, number | null, number | null][] = [
  ["10억 이하", null, 10e8], ["10~30억", 10e8, 30e8], ["30~50억", 30e8, 50e8], ["50~100억", 50e8, 100e8], ["100억 이상", 100e8, null]];

/** 상담요청 폼(모달) — 유형 · 내용(200자) · 이름 · 전화 · 동의. 이름 · 전화는 계정 값으로 미리 채운다.
 *  매도 문의면 「팔려는 건물 주소」가 나온다(비워도 된다, 대표 09-28 가안).
 *  보내는 순간 고객 프로필 · 저장한 조건이 사본으로 같이 간다(S09). 프로필이 비어 있으면 목표 · 예산 · 시기만 여기서 고른다(안 골라도 된다) */
export function InquiryModal({ ad, onClose }: { ad: AdCard; onClose: () => void }) {
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const prof = useQuery({ queryKey: ["cprofile"], queryFn: customerApi.profile });
  const empty = !!prof.data && !prof.data.goal?.length && prof.data.budget_min == null && prof.data.budget_max == null && !prof.data.timing;
  const [goal, setGoal] = useState<string[]>([]);
  const [budget, setBudget] = useState<number | null>(null);   // BUDGETS 칸 번호
  const [timing, setTiming] = useState<CustomerTiming | null>(null);
  const [kind, setKind] = useState<InquiryKind>("매수 문의");
  const [body, setBody] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [addr, setAddr] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const nm = name ?? me.data?.name ?? "";
  const ph = phone ?? formatPhone(me.data?.phone ?? "");

  const send = async () => {
    if (!nm.trim() || !ph.trim()) { setErr("이름과 전화를 적으세요"); return; }
    setBusy(true); setErr(null);
    try {
      const b = budget != null ? BUDGETS[budget] : null;
      await inquiriesApi.send({ ad_id: ad.id, kind, body: body || null, name: nm, phone: ph, consent: ok,
        sell_addr: kind === "매도 문의" ? addr || null : null,
        ...(empty && kind !== "매도 문의" ? { goal: goal.length ? goal : null, budget_min: b?.[1] ?? null,
          budget_max: b?.[2] ?? null, timing } : {}) });
      setSent(true);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const row = (label: string, node: React.ReactNode) => (
    <div className="gm-row lab"><span className="gm-lab">{label}</span><div className="gm-body wrap">{node}</div></div>
  );
  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm" onClick={(e) => e.stopPropagation()}>
        <div className="gm-title-fix">{ad.office_name ?? "중개사"}에 상담요청</div>
        {sent ? (
          <>
            <div className="iq-done">보냈습니다. 중개사가 확인한 뒤 연락합니다.</div>
            <div className="gm-foot"><span className="sp" /><button className="gm-save" onClick={onClose}>닫기</button></div>
          </>
        ) : (
          <>
            {row("유형", (["매수 문의", "매도 문의", "시세 문의"] as const).map((k) => (
              <button key={k} type="button" className={`um-chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>{k}</button>
            )))}
            {kind === "매도 문의" && row("팔 건물", <input className="gm-in" style={{ flex: 1 }} value={addr}
              placeholder="주소(비워도 됩니다)" onChange={(e) => setAddr(e.target.value)} />)}
            {/* 프로필이 비었을 때만 — 무엇을 찾는지 세 칸. 고른 칸을 다시 누르면 풀린다 */}
            {empty && kind !== "매도 문의" && <>
              {row("목표", (["시세차익", "수익률", "실사용"] as const).map((k) => (
                <button key={k} type="button" className={`um-chip ${goal.includes(k) ? "on" : ""}`}
                  onClick={() => setGoal(goal.includes(k) ? goal.filter((x) => x !== k) : [...goal, k])}>{k}</button>)))}
              {row("예산", BUDGETS.map(([l], i) => (
                <button key={l} type="button" className={`um-chip ${budget === i ? "on" : ""}`} onClick={() => setBudget(budget === i ? null : i)}>{l}</button>)))}
              {row("시기", (["3개월 안", "6개월 안", "1년 안", "미정"] as const).map((k) => (
                <button key={k} type="button" className={`um-chip ${timing === k ? "on" : ""}`} onClick={() => setTiming(timing === k ? null : k)}>{k}</button>)))}
            </>}
            {row("내용", <textarea className="gm-in ad-body" rows={3} maxLength={200} value={body}
              onChange={(e) => setBody(e.target.value)} />)}
            {row("이름", <input className="gm-in" value={nm} onChange={(e) => setName(e.target.value)} />)}
            {row("전화", <input className="gm-in num" value={ph} placeholder="010-0000-0000" onChange={(e) => setPhone(formatPhone(e.target.value))} />)}
            {row("동의", <button type="button" className={`um-chip ${ok ? "on" : ""}`} onClick={() => setOk(!ok)}>
              이름 · 전화 · 내 프로필(목표 · 예산 · 시기 · 저장한 조건 등)을 이 중개사에게 넘기는 데 동의</button>)}
            {err && <div className="ad-err">{err}</div>}
            <div className="gm-foot">
              <span className="sp" />
              <button className="gm-ghost quiet" onClick={onClose}>취소</button>
              <button className="gm-save" disabled={busy || !ok} onClick={send}>{busy ? "…" : "보내기"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body);
}
