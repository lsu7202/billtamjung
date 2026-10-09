import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { authApi, listingsApi, seeksApi, type Interest, type SeekRow, type SeekProposal } from "../../shared/api/endpoints";
import { formatPhone } from "../building/KV";
import { Icon } from "../../shared/ui/Icon";

/** 구해요(S06) 부품 — 줄 · 창 셋. 가격은 어디에도 없다(호가창이 생기지 않게). */

/** 관심 정도 — 「저장 3 · 오늘 5명」. 둘 다 0 이면 아무것도 안 낸다 */
export const interestText = (x?: Interest | null) => {
  if (!x) return "";
  const t = [x.saves ? `저장 ${x.saves}` : "", x.today ? `오늘 ${x.today}명` : ""].filter(Boolean);
  return t.join(" · ");
};

const eok = (v: number) => `${Math.round(v / 1e7) / 10}억`.replace(".0억", "억");
/** 남긴 사람 — 고객 프로필의 예산 · 목표. 이름 · 연락처는 없다 */
export const seekWho = (x: Pick<SeekRow, "budget_min" | "budget_max" | "goal">) => {
  const b = x.budget_min != null && x.budget_max != null ? `${eok(x.budget_min)}~${eok(x.budget_max)}`
    : x.budget_max != null ? `~${eok(x.budget_max)}` : x.budget_min != null ? `${eok(x.budget_min)}~` : "";
  return [b, (x.goal ?? []).join(" · ")].filter(Boolean).join(" · ");
};

/** 구해요 한 줄 — 예산 · 목적 · 한마디 · 제안 n/5 · D-일. 중개사는 줄 오른쪽 아이콘으로 제안 */
export function SeekLine({ x, broker, onPropose }: { x: SeekRow; broker: boolean; onPropose: () => void }) {
  const who = seekWho(x);
  return (
    <div className="sk-line">
      <div className="sk-txt">
        {(who || x.mine) && <span className="sk-who">{x.mine && <em className="sk-me">내 구해요</em>}{who}</span>}
        {x.note && <span className="sk-note">{x.note}</span>}
      </div>
      <span className={`sk-meta num ${x.state === "마감" ? "full" : ""}`}>제안 {x.n_prop}/{x.cap} · D-{x.days_left}</span>
      {broker && (x.our
        ? <span className="sk-our">{x.our}</span>
        : x.state === "열림" && <button className="sk-act" title="제안 보내기" onClick={(e) => { e.stopPropagation(); onPropose(); }}>
          <Icon name="send" size={14} /></button>)}
    </div>
  );
}

function Shell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm" onClick={(e) => e.stopPropagation()}>
        <div className="gm-title-fix">{title}</div>
        {children}
      </div>
    </div>
  ), document.body);
}
const row = (label: string, node: React.ReactNode) => (
  <div className="gm-row lab"><span className="gm-lab">{label}</span><div className="gm-body wrap">{node}</div></div>
);
function Foot({ busy, ok = true, label, onClose, onSave }: { busy: boolean; ok?: boolean; label: string; onClose: () => void; onSave: () => void }) {
  return (
    <div className="gm-foot"><span className="sp" />
      <button className="gm-ghost quiet" onClick={onClose}>취소</button>
      <button className="gm-save" disabled={busy || !ok} onClick={onSave}>{busy ? "…" : label}</button></div>
  );
}

/** 구해요 남기기(고객) — 건물 하나 · 한마디(200자). 예산 · 목적은 프로필에서 읽혀 목록에 선다 */
export function SeekModal({ pnu, addr, onClose, onDone }: { pnu: string; addr: string; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await seeksApi.add(pnu, note.trim() || null); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Shell title="구해요 남기기" onClose={onClose}>
      {row("건물", <b className="sk-addr">{addr.replace("서울특별시 ", "").replace("번지", "")}</b>)}
      {row("한마디", <textarea className="gm-in ad-body" rows={3} maxLength={200} value={note} autoFocus
        placeholder="예: 역세권 사옥용, 연내 매입" onChange={(e) => setNote(e.target.value)} />)}
      {err && <div className="ad-err">{err}</div>}
      <Foot busy={busy} label="남기기" onClose={onClose} onSave={save} />
    </Shell>
  );
}

/** 제안 보내기(중개사) — 우리 매물 하나(비워도 된다) · 한마디(300자). 한 구해요에 사무소당 하나 */
export function ProposeModal({ seek, onClose, onDone }: { seek: SeekRow; onClose: () => void; onDone: () => void }) {
  const mine = useQuery({ queryKey: ["myListings"], queryFn: listingsApi.mine });
  const [lid, setLid] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = (mine.data ?? []).map((r) => ({ id: Number(r.listing_id), addr: String(r.addr ?? "").replace("서울특별시 ", "").replace("번지", "") }))
    .filter((r) => !q.trim() || r.addr.includes(q.trim()));
  const save = async () => {
    setBusy(true); setErr(null);
    try { await seeksApi.propose(seek.id, lid, msg.trim() || null); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const who = seekWho(seek);
  return (
    <Shell title="제안 보내기" onClose={onClose}>
      {row("구해요", <div className="sk-q">
        <b>{seek.addr.replace("서울특별시 ", "").replace("번지", "")}</b>
        {who && <span>{who}</span>}
        {seek.note && <span>{seek.note}</span>}
      </div>)}
      {row("매물", <div className="sk-pick">
        <div className="sk-find"><Icon name="search" size={13} /><input value={q} placeholder="내 매물 주소" onChange={(e) => setQ(e.target.value)} /></div>
        <div className="sk-chips">
          {list.slice(0, 12).map((r) => (
            <button key={r.id} type="button" className={`um-chip ${lid === r.id ? "on" : ""}`}
              onClick={() => setLid(lid === r.id ? null : r.id)}>{r.addr || r.id}</button>
          ))}
        </div>
      </div>)}
      {row("한마디", <textarea className="gm-in ad-body" rows={3} maxLength={300} value={msg}
        onChange={(e) => setMsg(e.target.value)} />)}
      {err && <div className="ad-err">{err}</div>}
      <Foot busy={busy} label="보내기" onClose={onClose} onSave={save} />
    </Shell>
  );
}

/** 제안 고르기(고객) — 그 사무소에 매수 문의가 생기고 이름 · 전화가 넘어간다 */
export function PickModal({ p, onClose, onDone }: { p: SeekProposal; onClose: () => void; onDone: () => void }) {
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nm = name ?? me.data?.name ?? "";
  const ph = phone ?? formatPhone(me.data?.phone ?? "");
  const save = async () => {
    if (!nm.trim() || !ph.trim()) { setErr("이름과 전화를 적으세요"); return; }
    setBusy(true); setErr(null);
    try { await seeksApi.pick(p.id, { name: nm, phone: ph, consent: ok }); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Shell title={`${p.office_name ?? "중개사"} 제안 고르기`} onClose={onClose}>
      {row("이름", <input className="gm-in" value={nm} onChange={(e) => setName(e.target.value)} />)}
      {row("전화", <input className="gm-in num" value={ph} placeholder="010-0000-0000" onChange={(e) => setPhone(formatPhone(e.target.value))} />)}
      {row("동의", <button type="button" className={`um-chip ${ok ? "on" : ""}`} onClick={() => setOk(!ok)}>
        이름 · 전화를 이 중개사에게 넘기는 데 동의</button>)}
      {err && <div className="ad-err">{err}</div>}
      <Foot busy={busy} ok={ok} label="고르기" onClose={onClose} onSave={save} />
    </Shell>
  );
}
