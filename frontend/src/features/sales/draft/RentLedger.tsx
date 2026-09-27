import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rentsApi, type FloorRent, type LedgerFloor } from "../../../shared/api/endpoints";
import { Icon } from "../../../shared/ui/Icon";
import { wonAcc } from "../../../shared/format";
import "../../building/bldgtab.css";

/** 임대 내역(내 매물) — 팀 호실 줄을 층별로 고친다(0185, 2026-09-26 대표).
 *
 *  호실 = **업체 단위** 한 줄. 상태는 저장하지 않는다 — 상호가 있거나 임대료가 적혀 있으면 임대중,
 *  둘 다 없으면 공실(서버 판정 `occupied`). 호실이 하나도 없는 층은 모름이다.
 *  매물 등록 때 원장 업체가 한 번 복사돼 들어와 있고, 그 뒤로는 여기서만 바뀐다.
 *  층을 모르는 업체(층 미상)는 층 칩을 눌러 옮긴다. 문 닫은 업체는 지운다.
 */

const P = 3.305785;
/** 보증금 — 1억5천은 「1.5억」(대표). 표기는 공용 wonAcc 하나 */
const eokMan = (v?: number | null) => (v ? wonAcc(v) : null);
/** 월 임대료·관리비는 늘 만 단위 — 억으로 끊으면 월세가 1억2천처럼 읽힌다 */
const manOnly = (v?: number | null) => (v ? `${Math.round(v / 1e4).toLocaleString()}만` : null);
const py = (m2?: number | null) => (m2 == null ? null : `${(m2 / P).toFixed(1)}평`);

/** 돈 한 칸 — 눌러서 그 자리에서 고친다. 입력은 만원, 비우면 모름(null) */
function Money({ v, onSave, man }: { v?: number | null; onSave: (won: number | null) => void; man?: boolean }) {
  const [ed, setEd] = useState(false);
  const [t, setT] = useState("");
  if (ed) return (
    <input className="um-in num" autoFocus value={t} inputMode="numeric" style={{ width: 110, padding: "4px 8px", fontSize: 13 }}
      onChange={(e) => setT(e.target.value.replace(/[^\d.]/g, ""))}
      onBlur={() => { setEd(false); if (!t.trim()) { onSave(null); return; } const n = parseFloat(t); if (!Number.isNaN(n)) onSave(Math.round(n * 1e4)); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }} />
  );
  const s = man ? manOnly(v) : eokMan(v);
  return (
    <button className="um-vp" onClick={() => { setT(v ? String(Math.round(v / 1e4)) : ""); setEd(true); }}>
      <b className={`num ${s ? "" : "off"}`}>{s ?? "—"}</b></button>
  );
}

/** 글자 한 칸 — 눌러서 그 자리에서. 비우면 null */
function Txt({ v, w, onSave, num }: { v: string; w: number; onSave: (v: string) => void; num?: boolean }) {
  const [ed, setEd] = useState(false);
  const [t, setT] = useState("");
  if (ed) return (
    <input className={`um-in ${num ? "num" : ""}`} autoFocus value={t} style={{ width: w, padding: "4px 8px", fontSize: 13 }}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => { setEd(false); if (t !== v) onSave(t.trim()); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }} />
  );
  return (
    <button className="um-vp" style={{ maxWidth: w }} onClick={() => { setT(v); setEd(true); }}>
      <b className={`${num ? "num" : ""} ${v ? "" : "off"}`}>{v || "—"}</b></button>
  );
}

type Cat = { path: string[]; name: string; depth: number };

/** 업종 고르기 — 칩 세 줄(대 → 중 → 소)과 찾기 한 줄. 어디서 멈춰도 저장되고, 고른 칩을 다시 누르면 그 단이 빠진다.
 *  목록은 크롤링 업종 나무(가나다순, /biz-cats). 드롭다운이 아니라 칩이다(CLAUDE.md UI 어법) */
function CatPicker({ cur, cats, onPick }: { cur: string[]; cats: Cat[]; onPick: (p: string[] | null) => void }) {
  const [q, setQ] = useState("");
  const kids = (parent: string[]) => cats.filter((c) => c.depth === parent.length + 1
    && parent.every((p, i) => c.path[i] === p));
  const pick = (c: Cat) => {
    const same = cur.length === c.depth && c.path.every((p, i) => cur[i] === p);
    const next = same ? c.path.slice(0, -1) : c.path;
    onPick(next.length ? next : null);
  };
  const row = (parent: string[]) => {
    const list = kids(parent);
    if (!list.length) return null;
    return (
      <span className="chips-in" key={parent.join(">") || "root"}>
        {list.map((c) => (
          <button key={c.name} className={cur[c.depth - 1] === c.name ? "on" : ""} onClick={() => pick(c)}>{c.name}</button>
        ))}
      </span>
    );
  };
  const hits = q.trim() ? cats.filter((c) => c.name.includes(q.trim())).slice(0, 20) : [];
  return (
    <div className="rl-cp">
      <input className="um-in" autoFocus placeholder="찾기" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim() ? (
        <span className="chips-in">
          {hits.map((c) => <button key={c.path.join(">")} onClick={() => { onPick(c.path); setQ(""); }}>{c.path.join(" › ")}</button>)}
          {!hits.length && <span className="off">없음</span>}
        </span>
      ) : (
        <>{row([])}{cur[0] && row(cur.slice(0, 1))}{cur[1] && row(cur.slice(0, 2))}</>
      )}
    </div>
  );
}

export function RentLedger({ pk, onSaved }: { pk: string; onSaved: () => void }) {
  const q = useQuery({ queryKey: ["rent-ledger", pk], queryFn: () => rentsApi.list(pk) });
  const catsQ = useQuery({ queryKey: ["biz-cats"], queryFn: rentsApi.cats, staleTime: 10 * 60_000 });
  const [catOpen, setCatOpen] = useState<number | null>(null);   // 업종을 고르는 호실
  const floors: LedgerFloor[] = q.data?.floors ?? [];
  const unknown: FloorRent[] = q.data?.unknown ?? [];   // 층 미상 호실
  const total = q.data?.total;
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<string | null>(null);         // 층 이름 · 「?」 = 층 미상
  const curUn = pick === "?" ? unknown.length > 0 : !floors.length && unknown.length > 0;
  const cur = curUn ? null : floors.find((g) => g.floor === pick) ?? floors[0] ?? null;

  const done = async () => { await q.refetch(); onSaved(); };
  /** 호실 한 줄 저장 — 줄 전체를 보낸다(서버는 id 로 고친다) */
  async function put(u: FloorRent, patch: Partial<FloorRent>) {
    if (busy) return;
    setBusy(true);
    try {
      await rentsApi.upsert(pk, {
        id: u.id, floor: u.floor, unit_no: u.unit_no ?? "",
        contract_area: u.contract_area ?? null, excl_area: u.excl_area ?? null,
        tenant_name: u.tenant_name ?? null, cat_nodes: u.cat_nodes ?? null,
        deposit: u.deposit ?? null, rent: u.rent ?? null, maintenance: u.maintenance ?? null,
        ...patch,
      } as FloorRent);
      await done();
    } finally { setBusy(false); }
  }
  async function addUnit(floor: string) {
    if (busy) return;
    setBusy(true);
    try { await rentsApi.upsert(pk, { floor, unit_no: "" } as FloorRent); await done(); } finally { setBusy(false); }
  }
  async function del(u: FloorRent) {
    if (busy || u.id == null) return;
    setBusy(true);
    try { await rentsApi.del(pk, u.id); await done(); } finally { setBusy(false); }
  }
  const [addFloor, setAddFloor] = useState(false);
  const [nf, setNf] = useState("");

  const unitCard = (u: FloorRent, moving?: boolean) => (
    <div className="fl2-u" key={u.id}>
      <div className="fl2-uh">
        {u.tenant_name ? <b>{u.tenant_name}</b> : <b className="off">—</b>}
        <span className={`rl-st ${u.occupied ? "" : "vac"}`}>{u.occupied ? "임대중" : "공실"}</span>
        {u.cat_nodes?.length ? <i className="rl-cat">{u.cat_nodes.join(" › ")}</i> : null}
        <button className="mini bad" title="이 호실 지움" onClick={() => del(u)}><Icon name="trash" size={12} /></button>
      </div>
      {moving && (
        <div className="fl2-fl">
          {floors.map((g) => (
            <button key={g.floor} disabled={busy} onClick={() => put(u, { floor: g.floor })}>{g.floor}</button>
          ))}
        </div>
      )}
      <div className="fl2-g">
        <span className="dk">상호명</span><span className="dv"><Txt v={u.tenant_name ?? ""} w={220} onSave={(v) => put(u, { tenant_name: v || null })} /></span>
        <span className="dk">업종</span><span className="dv">
          <button className="um-vp" onClick={() => setCatOpen(catOpen === u.id ? null : u.id ?? null)}>
            <b className={u.cat_nodes?.length ? "" : "off"}>{u.cat_nodes?.length ? u.cat_nodes.join(" › ") : "—"}</b></button>
        </span>
        {catOpen === u.id && (
          <div className="rl-cpw"><CatPicker cur={u.cat_nodes ?? []} cats={catsQ.data ?? []}
            onPick={(p) => put(u, { cat_nodes: p })} /></div>
        )}
        <span className="dk">호수</span><span className="dv"><Txt v={u.unit_no ?? ""} w={110} onSave={(v) => put(u, { unit_no: v })} /></span>
        <span className="dk">계약면적</span><span className="dv"><Txt num v={u.contract_area != null ? (u.contract_area / P).toFixed(1) : ""} w={110}
          onSave={(v) => { const n = parseFloat(v.replace(/[^\d.]/g, "")); put(u, { contract_area: Number.isFinite(n) ? n * P : null }); }} /></span>
        <span className="dk">전용면적</span><span className="dv"><Txt num v={u.excl_area != null ? (u.excl_area / P).toFixed(1) : ""} w={110}
          onSave={(v) => { const n = parseFloat(v.replace(/[^\d.]/g, "")); put(u, { excl_area: Number.isFinite(n) ? n * P : null }); }} /></span>
        <span className="dk">보증금</span><span className="dv"><Money v={u.deposit} onSave={(w) => put(u, { deposit: w })} /></span>
        <span className="dk">월 임대료</span><span className="dv"><Money man v={u.rent} onSave={(w) => put(u, { rent: w })} /></span>
        <span className="dk">월 관리비</span><span className="dv"><Money man v={u.maintenance} onSave={(w) => put(u, { maintenance: w })} /></span>
      </div>
    </div>
  );

  return (
    <div className="bg-card rl">
      <div className="bg-ttl">임대 내역
        {addFloor
          ? <input className="um-in" autoFocus value={nf} style={{ width: 78, padding: "3px 9px", fontSize: 13 }} placeholder="예: 3층"
              onChange={(e) => setNf(e.target.value)}
              onBlur={async () => { const f = nf.trim(); setNf(""); setAddFloor(false); if (f) { await addUnit(f); setPick(f); } }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setNf(""); setAddFloor(false); } }} />
          : <button className="rst add" onClick={() => setAddFloor(true)}>+ 층</button>}
      </div>
      <div className="fl2">
        <div className="fl2-l">
          <div className="fl2-lh"><span>층</span><span>호실</span></div>
          {unknown.length > 0 && (
            <button className={`fl2-i ${curUn ? "on" : ""}`} onClick={() => setPick("?")}>
              <b className="off">—</b>
              <span className="nm">{unknown[0].tenant_name ?? "—"}{unknown.length > 1 ? ` 외 ${unknown.length - 1}` : ""}</span>
              <span className="bz">{unknown.length}곳</span>
            </button>
          )}
          {/* 호실마다 한 줄(층 이름은 되풀이). 호실이 없는 층은 한 줄 「—」(모름) */}
          {floors.flatMap((g) => (g.units.length ? g.units : [null]).map((u, i) => (
            <button key={`${g.floor}-${u?.id ?? i}`} className={`fl2-i ${!curUn && cur?.floor === g.floor ? "on" : ""}`}
              onClick={() => setPick(g.floor)}>
              <b>{g.floor}</b>
              <span className="nm">{u ? (u.tenant_name ?? (u.occupied ? "—" : <i className="off">공실</i>)) : <i className="off">—</i>}</span>
            </button>
          )))}
        </div>

        <div className="fl2-r">
          {curUn && (
            <>
              <div className="fl2-rh"><b className="off">층 미상</b><span>{unknown.length}곳</span></div>
              <div className="fl2-fll">층 선택하기</div>
              {unknown.map((u) => unitCard(u, true))}
            </>
          )}
          {cur && (
            <>
              <div className="fl2-rh"><b>{cur.floor}</b></div>
              <div className="fl2-sec">호실</div>
              {cur.units.map((u) => unitCard(u))}
              <button className="addu" disabled={busy} onClick={() => addUnit(cur.floor)}>+ 호실</button>
            </>
          )}
        </div>
      </div>
      {total && (
        <div className="fl-sum">
          <span>합계{total.vacant_area != null ? ` · 공실 ${py(total.vacant_area)}` : ""}</span>
          <span style={{ flex: 1 }} />
          <span className="fm">
            <span>{eokMan(total.deposit) ?? "—"}</span>
            <span>{manOnly(total.rent) ?? "—"}</span>
            <span>{manOnly(total.maintenance) ?? "—"}</span>
          </span>
          <span className="okpad" />
        </div>
      )}
    </div>
  );
}
