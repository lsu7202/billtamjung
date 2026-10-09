import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rentsApi, type FloorRent } from "../../../shared/api/endpoints";
import { Icon } from "../../../shared/ui/Icon";
import { floorName, wonAcc } from "../../../shared/format";
import { parseAmount } from "../../building/KV";
import { useUnit } from "../../../shared/hooks/useUnit";

/** 임대 내역 — 자유로운 시트(10-02 대표). 한 줄 = 호실 하나, 칸이 곧 입력칸(엑셀처럼).
 *
 *  우리가 아는 것은 미리 채운다 — 원장 업체(층 · 업체, 매물 등록 때 복사)와,
 *  대장에는 있는데 호실이 없는 층(층만 채운 줄 — 다른 줄과 똑같이 보인다. 치면 그 줄이 저장된다).
 *  맨 아래는 늘 빈 줄 하나. 「+ 행」 단추는 두지 않는다(누르기만 하고 층을 안 친다) — Enter 로 줄이 이어진다. 층 순서(1층부터 위로 → 옥탑 → 지하 → 층 모름)로 저절로 정렬된다.
 *  칸을 벗어나면 그 줄을 저장한다. 돈은 만원(5000 · 5000만 · 1.5억), 면적은 앱 단위(평/㎡).
 *  상태는 저장하지 않는다 — 업체도 임대료도 없으면 공실(서버 판정 occupied). */

const P = 3.305785;
// 업종은 내역에 안 싣는다(10-02 대표) — 원장에서 복사해 온 업종(cat_nodes)은 저장값으로 그대로 둔다
const COLS = ["floor", "tenant_name", "unit_no", "contract_area", "excl_area", "deposit", "rent", "maintenance"] as const;
type Col = (typeof COLS)[number];

/** 층 정렬 열쇠 — 앱 전체와 같은 순서: 1층부터 위로 → 옥탑 → 지하(B1, B2 …) → 모르면 맨 뒤 */
function floorRank(f: string | null | undefined): number {
  if (!f) return 1e6;
  const s = f.replace(/\s/g, "");
  let m = s.match(/^(?:지하|B)(\d+)/i); if (m) return 2000 + Number(m[1]);
  m = s.match(/^(?:옥탑|R)(\d*)/i); if (m) return 1000 + Number(m[1] || 1);
  m = s.match(/(\d+)/); if (m) return Number(m[1]);
  return 5e5;
}

type Row = { key: string; u: FloorRent | null; floor: string | null; virtual: boolean };

/** dongs = 매물 지번 위 동이 둘 이상이면 칩으로 고른다(임대 줄은 (매물, 동)마다 · 0255) */
export function RentLedger({ pk, lid, dongs, onDong, onSaved }: {
  pk: string; lid: number; dongs?: { building_pk: string; name: string }[]; onDong?: (pk: string) => void; onSaved: () => void;
}) {
  const q = useQuery({ queryKey: ["rent-ledger", lid, pk], queryFn: () => rentsApi.list(pk, lid) });
  const { unit } = useUnit();
  const per = unit === "py" ? P : 1;
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, Partial<Record<Col, string>>>>({});   // 치는 중인 글자(줄 열쇠 → 칸)
  const total = q.data?.total;
  const tableRef = useRef<HTMLDivElement>(null);

  /* 줄 — 저장된 호실 + 호실 없는 대장 층(회색, virtual) + 맨 아래 빈 줄. 층 순서로 */
  const rows: Row[] = useMemo(() => {
    const floors = q.data?.floors ?? [];
    const saved: Row[] = [...floors.flatMap((g) => g.units), ...(q.data?.unknown ?? [])]
      .map((u) => ({ key: `u${u.id}`, u, floor: u.floor, virtual: false }));
    const ghosts: Row[] = floors.filter((g) => !g.units.length)
      .map((g) => ({ key: `g${g.floor}`, u: null, floor: g.floor, virtual: true }));
    const all = [...saved, ...ghosts].sort((a, b) => floorRank(a.floor) - floorRank(b.floor) || (a.u?.id ?? 0) - (b.u?.id ?? 0));
    // 엑셀처럼 줄을 깔아 둔다 — 100줄(미리 채운 줄이 많으면 빈 줄 하나 이상은 늘 남긴다)
    const blanks = Math.max(1, 100 - all.length);
    return [...all, ...Array.from({ length: blanks }, (_, i) => ({ key: `n${i}`, u: null, floor: null, virtual: true }))];
  }, [q.data]);
  useEffect(() => { setDraft({}); }, [pk, lid]);

  /** 칸에 보일 글자 — 치는 중이면 그 글자, 아니면 저장값 */
  const shown = (r: Row, c: Col): string => {
    const d = draft[r.key]?.[c];
    if (d !== undefined) return d;
    const u = r.u;
    if (c === "floor") return r.floor ? floorName(r.floor) : "";
    if (!u) return "";
    switch (c) {
      case "tenant_name": return u.tenant_name ?? "";
      case "unit_no": return u.unit_no ?? "";
      case "contract_area": return u.contract_area != null ? String(Math.round((u.contract_area / per) * 10) / 10) : "";
      case "excl_area": return u.excl_area != null ? String(Math.round((u.excl_area / per) * 10) / 10) : "";
      // 보증금은 억 단위 표기(1.5억 · 5,000만), 월 임대료 · 관리비는 만원(10-02 대표)
      case "deposit": return u.deposit != null ? wonAcc(u.deposit) : "";
      case "rent": case "maintenance": {
        const v = u[c]; return v != null ? Math.round(v / 1e4).toLocaleString() : "";
      }
    }
  };
  const setCell = (r: Row, c: Col, v: string) => setDraft((d) => ({ ...d, [r.key]: { ...d[r.key], [c]: v } }));

  /** 줄 저장 — 칸을 벗어날 때. 바뀐 칸이 없으면 안 보낸다. 회색 · 빈 줄은 무엇이든 치면 새 호실 */
  async function commit(r: Row) {
    const d = draft[r.key];
    if (!d || !Object.keys(d).length || busy) return;
    const u = r.u;
    const num = (t: string | undefined) => { const n = parseFloat((t ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
    // 단위 없이 치면 — 보증금은 억(1.5 → 1.5억), 월 임대료 · 관리비는 만원(300 → 300만). 단위를 붙이면 그 값
    const money = (t: string | undefined, base: number) => (t == null || !t.trim() ? null : parseAmount(t, base));
    const has = (c: Col) => d[c] !== undefined;
    const base: FloorRent = {
      id: u?.id, floor: u?.floor ?? r.floor ?? null, unit_no: u?.unit_no ?? "",
      contract_area: u?.contract_area ?? null, excl_area: u?.excl_area ?? null,
      tenant_name: u?.tenant_name ?? null, cat_nodes: u?.cat_nodes ?? null,
      deposit: u?.deposit ?? null, rent: u?.rent ?? null, maintenance: u?.maintenance ?? null,
      vacant: u?.vacant ?? false,
    };
    if (has("floor")) base.floor = d.floor!.trim() || null;
    if (has("tenant_name")) base.tenant_name = d.tenant_name!.trim() || null;
    if (has("unit_no")) base.unit_no = d.unit_no!.trim();
    if (has("contract_area")) { const n = num(d.contract_area); base.contract_area = n != null ? n * per : null; }
    if (has("excl_area")) { const n = num(d.excl_area); base.excl_area = n != null ? n * per : null; }
    if (has("deposit")) base.deposit = money(d.deposit, 1e8);
    for (const c of ["rent", "maintenance"] as const) if (has(c)) base[c] = money(d[c], 1e4);
    // 엑셀처럼 — 칸을 다 비운 줄은 지운다(지우기 단추 없음). 층만 있어도 값이 있는 줄이다
    const empty = !base.floor && !base.vacant && !base.tenant_name && !base.unit_no && base.contract_area == null && base.excl_area == null
      && base.deposit == null && base.rent == null && base.maintenance == null;
    if (empty) {
      setDraft((x) => { const n = { ...x }; delete n[r.key]; return n; });
      if (u?.id != null) await del(u);
      return;
    }
    setBusy(true);
    try {
      await rentsApi.upsert(pk, lid, base); await q.refetch(); onSaved();
      // 맨 아래 빈 줄에서 쳤으면 — 저장된 줄은 층 자리로 가고, 새 빈 줄의 첫 칸으로 이어서 친다
      if (r.key.startsWith("n")) setTimeout(() => tableRef.current?.querySelector<HTMLInputElement>(".rsx-r.blank input")?.focus(), 0);
    }
    finally {
      setBusy(false);
      setDraft((x) => { const n = { ...x }; delete n[r.key]; return n; });
    }
  }
  /** 공실 체크 — 누르면 바로 저장. 빈 줄 · 층만 있는 줄에서 누르면 그 층의 공실 호실이 생긴다 */
  async function toggleVacant(r: Row) {
    if (busy) return;
    const u = r.u;
    const floor = draft[r.key]?.floor !== undefined ? (draft[r.key]!.floor!.trim() || null) : (u?.floor ?? r.floor ?? null);
    setBusy(true);
    try {
      await rentsApi.upsert(pk, lid, u ? { ...u, floor, vacant: !u.vacant } : { floor, unit_no: "", vacant: true } as FloorRent);
      await q.refetch(); onSaved();
    } finally { setBusy(false); }
  }
  async function del(u: FloorRent) {
    if (busy || u.id == null) return;
    setBusy(true);
    try { await rentsApi.del(pk, lid, u.id); await q.refetch(); onSaved(); } finally { setBusy(false); }
  }

  /** Enter = 아래 칸, Esc = 치던 것 버리기. Tab 은 브라우저 기본(오른쪽 칸) */
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, ri: number, ci: number, r: Row) => {
    if (e.key === "Escape") { setDraft((x) => { const n = { ...x }; delete n[r.key]; return n; }); (e.target as HTMLInputElement).blur(); }
    if (e.key === "Enter") {
      e.preventDefault();
      const next = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${ri + 1}"][data-c="${ci}"]`);
      if (next) next.focus(); else (e.target as HTMLInputElement).blur();
    }
  };

  const unitLab = unit === "py" ? "평" : "㎡";
  return (
    <div className="rsx" ref={tableRef}>
      {/* 초기화 — 첫 상태(원장 업체만 복사된 상태)로 되돌린다 */}
      <div className="rsx-bar">
        {dongs && dongs.length > 1 && (
          <span className="lgx-pc rsx-dongs">{dongs.map((d) => (
            <button key={d.building_pk} className={d.building_pk === pk ? "on" : ""} onClick={() => onDong?.(d.building_pk)}>{d.name}</button>
          ))}</span>
        )}
        <span className="sp" />
        <button disabled={busy} onClick={async () => {
          if (!confirm(`${dongs && dongs.length > 1 ? `${dongs.find((d) => d.building_pk === pk)?.name ?? ""} ` : ""}임대내역을 첫 상태로 되돌립니다. 적은 값이 모두 지워집니다.`)) return;
          setBusy(true);
          try { await rentsApi.reset(pk, lid); setDraft({}); await q.refetch(); onSaved(); } finally { setBusy(false); }
        }}><Icon name="reset" size={14} />초기화</button>
      </div>
      <div className="rsx-r h">
        <span>층</span><span>업체</span><span>호수</span>
        {/* 단위(평 · 만원)는 머리에서 뺐다(10-02 대표) — 칸 폭을 업체 · 업종에 준다 */}
        <span className="n">계약면적</span><span className="n">전용면적</span>
        <span className="n">보증금</span><span className="n">월 임대료</span><span className="n">월 관리비</span><span className="c">공실</span>
      </div>
      {rows.map((r, ri) => (
        <div key={r.key} className={`rsx-r ${r.key.startsWith("n") ? "blank" : ""}`}
          // 줄 안에서 칸을 옮기는 동안은 저장하지 않는다 — 줄을 벗어날 때 한 번
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commit(r); }}>
          {COLS.map((c, ci) => (
            <input key={c} className={["contract_area", "excl_area", "deposit", "rent", "maintenance"].includes(c) ? "n" : ""}
              data-r={ri} data-c={ci} value={shown(r, c)}
              inputMode={["contract_area", "excl_area"].includes(c) ? "decimal" : undefined}
              onChange={(e) => setCell(r, c, e.target.value)}
              onKeyDown={(e) => onKey(e, ri, ci, r)} />
          ))}
          {/* 공실 — 체크 = 공실, 업체 있음 = 임대중, 둘 다 아님 = 모름(0208) */}
          <button className={`vk ${r.u?.vacant ? "on" : ""}`} tabIndex={-1} title={r.u?.vacant ? "공실 해제" : "공실"}
            onClick={() => toggleVacant(r)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></button>
        </div>
      ))}
      {/* 합계 — 맨 아래에 붙어 스크롤해도 보인다 */}
      <div className="rsx-r sum">
        <span>합계</span><span /><span />
        <span className="n">{total?.vacant_area != null ? `공실 ${Math.round((total.vacant_area / per) * 10) / 10}${unitLab}` : ""}</span><span />
        <span className="n">{total?.deposit ? wonAcc(total.deposit) : ""}</span>
        <span className="n">{total?.rent ? `${Math.round(total.rent / 1e4).toLocaleString()}만` : ""}</span>
        <span className="n">{total?.maintenance ? `${Math.round(total.maintenance / 1e4).toLocaleString()}만` : ""}</span><span />
      </div>
    </div>
  );
}
