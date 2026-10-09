import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { buyersApi, inquiriesApi, type Buyer, type BuyerCondition } from "../../shared/api/endpoints";
import { shortAddr, won } from "../../shared/format";
import { Loading } from "../../shared/ui/Spinner";
import { Icon } from "../../shared/ui/Icon";
import { formatPhone } from "../building/KV";
import { condSummary } from "./summaries";
import { MemoLog } from "./draft/MemoLog";
import { CustomerFields, budgetText } from "./CustomerFields";
import "./draft/salestab.css";

/* ══════════════════════ 고객관리 · 고객(S09, 2026-10-04) ══════════════════════
 *
 * 중개사가 쓰는 고객 기록 = 성격(사람) + 조건(건물). 열은 중개사가 쓰던 고객 엑셀 순서 그대로.
 * 조건은 「저장한 조건에 고객을 붙인 것」(0214) — 누르면 매물 탐색이 그 조건으로 열린다. 찾은 매물을 고객에 붙이지는 않는다.
 * 매물관리와 같은 결: 전체 폭 표, 줄을 누르면 「조건」 열 오른쪽부터 판이 붙는다. */

const GRADE: [string, string][] = [["A", "확실"], ["B", "보통"], ["C", "관망"]];
const gradeOf = (g: string | null | undefined) => GRADE.find(([k]) => k === g)?.[1] ?? "";
const condName = (c: BuyerCondition) => condSummary(c) || c.name;

export function CustomerTable({ head, focus }: { head?: React.ReactNode; focus?: number | null }) {
  const qc = useQueryClient();
  const rows = useQuery({ queryKey: ["buyers"], queryFn: buyersApi.list });
  const iqs = useQuery({ queryKey: ["inquiries"], queryFn: inquiriesApi.list });
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [gr, setGr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(focus ?? null);
  const [add, setAdd] = useState(false);
  useEffect(() => { if (focus) setOpenId(focus); }, [focus]);
  const list = rows.data ?? [];
  const iqN = useMemo(() => {
    const m = new Map<number, number>();
    (iqs.data ?? []).forEach((x) => { if (x.buyer_id) m.set(x.buyer_id, (m.get(x.buyer_id) ?? 0) + 1); });
    return m;
  }, [iqs.data]);
  const shown = useMemo(() => {
    const t = q.trim();
    return list.filter((r) => (!gr || (gr === "none" ? !r.grade : r.grade === gr))
      && (!t || [r.name, r.phone ?? "", r.memo ?? "", ...r.conditions.map(condName)].some((x) => x.includes(t))));
  }, [list, q, gr]);
  const cur = list.find((r) => r.id === openId) ?? null;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["buyers"] }); qc.invalidateQueries({ queryKey: ["saved"] }); };
  const search = (c: BuyerCondition) => nav("/explore", { state: { applyCond: c.conditions_json } });

  // 판 자리 — 목록 상자의 오른쪽 · 위 끝(매물관리 · 문의와 같은 방식)
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
  return (
    <div className={`lx cxx ${cur ? "docked" : ""}`}>
      <div className="lx-bar">
        {head}
        <input className="lt-q lx-q" value={q} placeholder="이름 · 전화 · 조건 · 비고" onChange={(e) => setQ(e.target.value)} />
        {GRADE.map(([k, l]) => (
          <button key={k} className={`lx-pn ${gr === k ? "on" : ""}`} onClick={() => setGr(gr === k ? null : k)}>
            {l}<b className="num">{list.filter((r) => r.grade === k).length}</b></button>
        ))}
        <span className="sp" />
        <button className="lx-addb" onClick={() => setAdd(true)}>고객 등록</button>
      </div>
      <div ref={wrapRef} className="lx-wrap">
        <table className="lx-t">
          <thead><tr>
            <th className="c-gr">긴급도</th>
            <th className="c-nm">이름</th>
            <th className="r c-bud">희망매매가</th>
            <th className="c-x">지역</th>
            <th className="c-x">조건</th>
            <th className="c-x r">시드</th>
            <th className="c-x">목표</th>
            <th className="c-x">건축의사</th>
            <th className="c-x">개인/법인</th>
            <th className="c-x">시기</th>
            <th className="c-x c-iq">문의</th>
            <th className="c-x">비고</th>
          </tr></thead>
          <tbody>
            {shown.map((r) => {
              const c0 = r.conditions[0];
              return (
                <tr key={r.id} className={openId === r.id ? "on" : ""} onClick={() => setOpenId(r.id)}>
                  <td className="c-gr"><span className={`cx-gr g-${r.grade ?? "none"}`}>{gradeOf(r.grade)}</span></td>
                  <td className="c-nm"><b>{r.name}</b></td>
                  <td className="r num c-bud">{budgetText({ budget_min: r.budget_min ?? null, budget_max: r.budget_max ?? null, budget_any: r.budget_any ?? null })}</td>
                  <td className="c-rg">{(r.regions ?? []).slice(0, 3).join(" · ")}{(r.regions ?? []).length > 3 ? ` 외 ${(r.regions ?? []).length - 3}` : ""}</td>
                  <td className="c-cond">
                    {c0 && <>
                      <button className="cx-search" title="이 조건으로 매물 탐색" onClick={(e) => { e.stopPropagation(); search(c0); }}>
                        <Icon name="search" size={13} /></button>
                      <span>{condName(c0)}</span>
                      {r.conditions.length > 1 && <i className="sub">외 {r.conditions.length - 1}</i>}
                    </>}
                  </td>
                  <td className="r num">{r.equity_won != null ? won(r.equity_won) : ""}</td>
                  <td>{(r.goal ?? []).join(" · ")}</td>
                  <td>{r.build_intent ?? ""}</td>
                  <td>{r.is_corp == null ? "" : r.is_corp ? "법인" : "개인"}</td>
                  <td>{r.timing ?? ""}</td>
                  <td className="c-iq num">{iqN.get(r.id) ?? ""}</td>
                  <td className="c-memo">{r.memo ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <div className="lt-none">{list.length ? "맞는 고객이 없습니다" : "등록한 고객이 없습니다"}</div>}
      </div>
      {cur && dock && <CustomerPanel key={cur.id} b={cur} docked={dock} onClose={() => setOpenId(null)} onDone={refresh}
        onSearch={search} />}
      {add && <AddCustomer onClose={() => setAdd(false)} onSaved={(id) => { setAdd(false); refresh(); setOpenId(id); }} />}
    </div>
  );
}

/** 고객 판 — 성격 · 조건 · 문의 · 메모창. 줄은 매물 모달 건축물대장 탭과 같은 그리드, 값을 누르면 그 자리에서 고친다 */
function CustomerPanel({ b, docked, onClose, onDone, onSearch }: {
  b: Buyer; docked: { left: number; top: number }; onClose: () => void; onDone: () => void; onSearch: (c: BuyerCondition) => void;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const iqs = useQuery({ queryKey: ["inquiries"], queryFn: inquiriesApi.list });
  const [memo, setMemo] = useState(true);
  const [edit, setEdit] = useState<string | null>(null);
  const [txt, setTxt] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !edit) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, edit]);
  const patch = async (p: Record<string, unknown>) => {
    setErr(null);
    try { await buyersApi.update(b.id, p); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  const mine = (iqs.data ?? []).filter((x) => x.buyer_id === b.id);
  const removeCond = async (c: BuyerCondition) => { await buyersApi.removeCondition(c.id); onDone(); qc.invalidateQueries({ queryKey: ["saved"] }); };
  // 새 조건은 희망매매가를 매매가에 미리 넣고 연다(조건의 매매가는 그 뒤로 따로 간다)
  const seedCond = () => (!b.budget_any && (b.budget_min != null || b.budget_max != null) ? {
    values: { 매매가: { ...(b.budget_min != null ? { lo: b.budget_min / 1e8 } : {}), ...(b.budget_max != null ? { hi: b.budget_max / 1e8 } : {}) } },
    filters: { price_min: b.budget_min ?? null, price_max: b.budget_max ?? null } } : {});
  const editCond = (c?: BuyerCondition) => nav("/explore", { state: { buyerCond: {
    buyer_id: b.id, buyer_name: b.name, cond_id: c?.id ?? null, name: c?.name ?? "조건", conditions: c?.conditions_json ?? seedCond() } } });

  // 줄 — 글자 · 금액 칸은 클릭-편집(벗어나면 저장, 비우면 지움), 선택 칸은 줄 안에 칸으로 깔린다(고른 칸 재클릭 = 미지정)
  const textLine = (k: string, label: string, val: string | null | undefined, opt: { amount?: boolean; multi?: boolean; lock?: boolean } = {}) => {
    const open = edit === k;
    const save = async () => {
      setEdit(null);
      const t = txt.trim();
      if (opt.amount) {
        if (!t) return patch({ clear: [k] });
        const x = Number(t.replace(/,/g, ""));
        if (!Number.isFinite(x)) { setErr(`${label} — 숫자로 적으세요(억)`); return; }
        return patch({ [k]: Math.round(x * 1e8) });
      }
      return patch({ [k]: t });   // 빈 글자 = 지움
    };
    return (
      <div className={`lgx-r ${open ? "open" : ""}`}>
        <span className="lgx-k">{label}</span>
        <div className="lgx-v" onClick={() => { if (!open && !opt.lock) { setEdit(k); setTxt(opt.amount ? (b.equity_won != null ? String(b.equity_won / 1e8) : "") : val ?? ""); } }}>
          {open ? (opt.multi
            ? <textarea autoFocus className="lgx-in cx-ta" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={save}
                onKeyDown={(e) => { if (e.key === "Escape") setEdit(null); }} />
            : <input autoFocus className="lgx-in" value={txt} inputMode={opt.amount ? "decimal" : undefined}
                onChange={(e) => setTxt(e.target.value)} onBlur={save}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEdit(null); }} />)
            : <b className={opt.multi ? "cx-pre" : ""}>{val ?? ""}</b>}
          {open && opt.amount && <i className="lgx-u">억</i>}
        </div>
      </div>
    );
  };
  const chipLine = (label: string, opts: [string, string][], cur: string[], onPick: (next: string[]) => void, multi = false) => (
    <div className="lgx-r">
      <span className="lgx-k">{label}</span>
      <div className="lgx-v iq-v"><span className="lgx-chips">{opts.map(([k, l]) => {
        const on = cur.includes(k);
        return <button key={k} className={on ? "on" : ""}
          onClick={() => onPick(multi ? (on ? cur.filter((x) => x !== k) : [...cur, k]) : on ? [] : [k])}>{l}</button>;
      })}</span></div>
    </div>
  );
  const one = (v: string[], k: string) => patch(v.length ? { [k]: v[0] } : { [k]: "" });
  return (
    <div className="um-dock" style={{ left: docked.left, top: docked.top }}>
      <div className="um docked iqp cxp" onClick={(e) => e.stopPropagation()}>
        <div className="iqp-head">
          <b>{b.name}</b><span className="iqp-sub">{gradeOf(b.grade)}</span>
          <span className="sp" />
          <button className={`cxp-memo-t ${memo ? "on" : ""}`} onClick={() => setMemo(!memo)} title={memo ? "메모 닫기" : "메모 열기"}>
            <Icon name="comment" size={15} />메모</button>
          <button className="iqp-x" title="닫기" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <div className={`iqp-body lgx ${memo ? "with-memo" : ""}`}>
          {err && <div className="lgx-err">{err}</div>}
          {/* 머리 줄 없이 — 묶음 사이는 굵은 선 하나(10-04) */}
          {chipLine("긴급도", GRADE, b.grade ? [b.grade] : [], (v) => one(v, "grade"))}
          {textLine("name", "이름", b.name)}
          {textLine("phone", "전화", b.phone ? formatPhone(b.phone) : "", { lock: !!b.phone_masked })}
          <div className="cxf-sep" />
          {/* 원하는 것 · 나에 대해 — 고객 프로필(마이페이지)과 같은 부품(같은 칸 · 같은 순서) */}
          <CustomerFields noteLabel="비고" onErr={setErr}
            v={{ budget_min: b.budget_min ?? null, budget_max: b.budget_max ?? null, budget_any: b.budget_any ?? null,
              goal: b.goal ?? null, regions: b.regions ?? null, timing: b.timing ?? null, build_intent: b.build_intent ?? null,
              is_corp: b.is_corp ?? null, equity_won: b.equity_won ?? null, experience: b.experience ?? null, note: b.memo ?? null }}
            set={(p) => {
              // 부분 수정 — 값은 그대로, null 은 지움(글자 칸은 빈 문자열, 나머지는 clear 목록)
              const out: Record<string, unknown> = {}; const clear: string[] = [];
              for (const [k0, val] of Object.entries(p)) {
                const k = k0 === "note" ? "memo" : k0;
                if (val == null) { if (["timing", "build_intent", "experience", "memo"].includes(k)) out[k] = ""; else clear.push(k); }
                else out[k] = val;
              }
              patch({ ...out, ...(clear.length ? { clear } : {}) });
            }}
            wantExtra={chipLine("광고 매물", [["y", "선호"], ["n", "상관없음"]], b.prefer_ad == null ? [] : [b.prefer_ad ? "y" : "n"],
              (v) => patch(v.length ? { prefer_ad: v[0] === "y" } : { clear: ["prefer_ad"] }))} />

          <div className="lgx-h">조건 {b.conditions.length || ""}</div>
          {b.conditions.map((c) => (
            <div key={c.id} className="lgx-r cx-cond">
              <span className="lgx-k">{c.name}</span>
              <div className="lgx-v" onClick={() => onSearch(c)} title="이 조건으로 매물 탐색">
                <Icon name="search" size={13} /><b>{condSummary(c) || "조건 없음"}</b></div>
              <span className="lgx-a"><button title="고치기" onClick={() => editCond(c)}><Icon name="edit" size={13} /></button></span>
              <span className="lgx-a"><button title="떼기" onClick={() => removeCond(c)}><Icon name="close" size={13} /></button></span>
            </div>
          ))}
          <button className="cx-add" onClick={() => editCond()}><Icon name="plus" size={13} />조건</button>

          {mine.length > 0 && <>
            <div className="lgx-h">문의 {mine.length}</div>
            {mine.map((x) => (
              <div key={x.id} className="lgx-r iq-other" onClick={() => nav(`/customers?tab=inquiry&iq=${x.id}`)}>
                <span className="lgx-k num">{x.created_at.slice(2, 10).replace(/-/g, ".")}</span>
                <div className="lgx-v"><b>{x.kind.replace(" 문의", "")}</b><span className="iq-o-a">{shortAddr(x.addr)}</span>
                  <span className={`iq-st s-${x.status}`}>{x.status}</span></div>
              </div>
            ))}
          </>}
        </div>
        {/* 메모창 — 매물 모달과 같은 부품. 부품이 오른쪽 서랍 자리를 스스로 잡는다(겉 상자를 씌우면 두 겹이 된다) */}
        {memo && <MemoLog target="buyer" id={String(b.id)} />}
      </div>
    </div>
  );
}

/** 고객 등록 — 이름 · 전화만 받고 판을 연다. 나머지는 판에서 채운다(입력 서식은 판 한 곳에만) */
function AddCustomer({ onClose, onSaved }: { onClose: () => void; onSaved: (id: number) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim()) { setErr("이름을 적으세요"); return; }
    setBusy(true); setErr(null);
    try { const r = await buyersApi.create({ name: name.trim(), phone: phone.trim() || null, source: "직접문의" }); onSaved(r.id); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="lx-addm" onClick={(e) => e.stopPropagation()}>
        <div className="lx-addm-h"><b>고객 등록</b><span className="sp" />
          <button className="lx-addm-x" title="닫기" onClick={onClose}><Icon name="close" size={18} /></button></div>
        <div className="cx-addf">
          <div className="lgx-r"><span className="lgx-k">이름</span>
            <div className="lgx-v"><input autoFocus className="lgx-in" value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) save(); if (e.key === "Escape") onClose(); }} /></div></div>
          <div className="lgx-r"><span className="lgx-k">전화</span>
            <div className="lgx-v"><input className="lgx-in num" value={phone} placeholder="010-0000-0000" onChange={(e) => setPhone(formatPhone(e.target.value))}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) save(); }} /></div></div>
          {err && <div className="lgx-err">{err}</div>}
          <button className="cx-addb" disabled={busy} onClick={save}>{busy ? "…" : "등록"}</button>
        </div>
      </div>
    </div>
  ), document.body);
}
