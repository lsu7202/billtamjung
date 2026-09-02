import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rentsApi, type FloorRent } from "../../shared/api/endpoints";
import { Icon } from "../../shared/ui/Icon";
import { Chips } from "./EnumField";

/** 층별 임대정보 — 여덟 열 표를 버리고 층마다 한 줄(2026-08-25).
 *
 *  층이 `.who`, 「용도 · 호실 · 평수 · 상태」가 `.cap`, 돈 셋은 폭 104px 고정 칸이다.
 *  칩을 안 쓰는 이유: 칩은 내용만큼만 넓어 「1억」과 「5,000만」의 폭이 달라진다 —
 *  층별을 보는 이유가 층끼리 견주기인데 자릿수가 어긋나면 그게 깨진다.
 *
 *  **금액은 대장에 없다.** 층·호실·용도·면적까지가 대장이 주는 것이고
 *  금액 추정은 분석 탭이 맡는다. 그래서 여기 금액에는 ↺도 파란 「고친 값」도 안 쓴다 —
 *  되돌릴 원본이 없고, 전부 팀 값이라 다 파래지면 색이 아무 말도 안 한다.
 *
 *  층 없애기(hideFloor)는 뺐다. 층은 대장이 정하는 사실이라 우리가 지울 것이 아니고,
 *  그것 하나 때문에 🗑·확인창·되살리기 칩까지 UI가 셋 붙어 있었다.
 */

const P = 3.305785;
const CAP = 5;   // 처음엔 다섯 층. 나머지는 눌러서 편다

/** 서명층수 — 지상 양수·지하 음수. 문자열 정렬이면 「10층」이 「2층」 앞에 온다 */
const sfloor = (fl?: string): number | null => {
  if (!fl) return null;
  const n = parseInt(fl.replace(/\D/g, ""), 10);
  if (/지하|^\s*B/i.test(fl)) return isNaN(n) ? -1 : -n;
  return isNaN(n) ? null : n;
};
const eokMan = (v?: number | null) => {
  if (!v) return null;
  const e = Math.floor(v / 1e8), m = Math.round((v % 1e8) / 1e4);
  return e ? `${e}억${m ? ` ${m.toLocaleString()}만` : ""}` : `${m.toLocaleString()}만`;
};

type DRow = { r: FloorRent; isPrefill?: boolean; key: string };

/** 돈 한 칸 — 눌러서 그 자리에서 고친다. 저장 단위는 만원 */
function Money({ v, onSave }: { v?: number | null; onSave: (won: number) => void }) {
  const [ed, setEd] = useState(false);
  const [t, setT] = useState("");
  if (ed) return (
    <input autoFocus value={t} inputMode="numeric"
      onChange={(e) => setT(e.target.value.replace(/[^\d.]/g, ""))}
      onBlur={() => { setEd(false); const n = parseFloat(t); if (!Number.isNaN(n)) onSave(Math.round(n * 1e4)); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }} />
  );
  const s = eokMan(v);
  return (
    <span className={`cell ${s ? "" : "off"}`} title="누르면 고쳐집니다"
      onClick={(e) => { e.stopPropagation(); setT(v ? String(Math.round(v / 1e4)) : ""); setEd(true); }}>
      {s ?? "—"}
    </span>
  );
}

export function FloorRows({ pk, items, total, unit, refresh }: {
  pk: string; items: FloorRent[]; total?: Record<string, number>;
  unit: "py" | "m2"; refresh: () => void;
}) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());     // 다호실 층 접고펴기
  const [expand, setExpand] = useState<string | null>(null);    // 줄 아래 펼침(호실·용도·면적·상태)
  const [busy, setBusy] = useState(false);
  const outline = useQuery({ queryKey: ["floor-outline", pk], queryFn: () => rentsApi.outline(pk) });

  // 층 단위 인수(0029): 그 층에 팀 입력이 하나라도 있으면 그 층 대장 프리필은 전부 대체된다.
  const teamFloors = new Set(items.map((i) => sfloor(i.floor)).filter((f): f is number => f != null));
  const outlineOf = (floor: string) =>
    (outline.data ?? []).filter((o) => o.floor && sfloor(o.floor) === sfloor(floor));
  const prefill = (outline.data ?? []).filter((o) => {
    const f = sfloor(o.floor ?? undefined);
    return o.floor && (f == null || !teamFloors.has(f));
  });

  /** 그 층을 팀 행으로 확정 — 프리필을 건드리는 순간 그 층은 팀이 인수한다.
   *  금액은 안 옮긴다(대장 추정은 분석 탭 몫). 구조(호실·용도·면적)만 굳힌다. */
  async function adopt(floor: string) {
    const sf = sfloor(floor);
    if (sf != null && teamFloors.has(sf)) return;
    const rows = outlineOf(floor);
    await Promise.all(rows.map((o, i) => rentsApi.upsert(pk, {
      floor: o.floor ?? floor, unit_no: String(i + 1),
      use: o.use ?? undefined, contract_area: o.floor_area ?? undefined,
      deposit: 0, rent: 0, maintenance: 0, is_vacant: null,
    } as FloorRent)));
  }

  async function addUnit(floor: string) {
    if (busy) return;
    setBusy(true);
    try {
      await adopt(floor);
      const used = new Set([...items.filter((i) => sfloor(i.floor) === sfloor(floor)).map((i) => i.unit_no),
                            ...outlineOf(floor).map((_, i) => String(i + 1))]);
      let n = 1; while (used.has(String(n))) n++;
      await rentsApi.upsert(pk, { floor, unit_no: String(n), deposit: 0, rent: 0, maintenance: 0, is_vacant: null } as FloorRent);
      setOpen((s) => new Set(s).add(floor));
      refresh();
    } finally { setBusy(false); }
  }

  /** 값 하나 고치기 — 프리필 줄이면 그 층을 먼저 인수한다 */
  async function put(dr: DRow, patch: Partial<FloorRent>) {
    if (busy) return;
    setBusy(true);
    try {
      if (dr.isPrefill) await adopt(dr.r.floor);
      await rentsApi.upsert(pk, {
        floor: dr.r.floor, unit_no: dr.r.unit_no || "1",
        use: dr.r.use ?? null, contract_area: dr.r.contract_area ?? null,
        deposit: dr.r.deposit ?? 0, rent: dr.r.rent ?? 0, maintenance: dr.r.maintenance ?? 0,
        is_vacant: dr.r.is_vacant ?? null, ...patch,
      } as FloorRent);
      refresh();
    } finally { setBusy(false); }
  }

  /** 호실 지우기 — 다호실 층에서만. 마지막 하나는 못 지운다(층이 사라진다) */
  async function delUnit(dr: DRow) {
    if (busy || dr.r.id == null) return;
    setBusy(true);
    try { await rentsApi.del(pk, dr.r.id); refresh(); } finally { setBusy(false); }
  }

  // 층별 그룹 — 팀 입력 + 프리필을 한 배열로
  const allRows: DRow[] = [
    ...items.map((r) => ({ r, key: (r.id ?? `${r.floor}-${r.unit_no}`).toString() })),
    // 대장 층별개요의 면적은 그 층의 바닥면적이라 계약면적 칸으로 들어간다(0035).
    // 금액(rent_est·deposit_est)은 옮기지 않는다 — 정본 칸에 추정을 앉히지 않는다.
    // 대장은 호실 번호를 안 준다 — 그 층 안 순번을 붙인다(인수할 때 쓰는 번호와 같다).
    // 안 붙이면 다호실 층을 폈을 때 호실 자리가 전부 「—」로 서서 어느 줄인지 못 가른다.
    ...prefill.map((o, i) => ({ isPrefill: true, key: `pf-${o.floor}-${i}`,
      r: { floor: o.floor ?? "",
           unit_no: String(prefill.filter((x) => sfloor(x.floor ?? undefined) === sfloor(o.floor ?? undefined))
             .findIndex((x) => x === o) + 1),
           use: o.use ?? undefined,
           contract_area: o.floor_area ?? undefined, deposit: 0, rent: 0, maintenance: 0, is_vacant: null } as FloorRent })),
  ];
  const groups = new Map<string, DRow[]>();
  allRows.forEach((dr) => { const f = dr.r.floor || "—"; (groups.get(f) ?? groups.set(f, []).get(f)!).push(dr); });
  const sorted = [...groups.entries()].sort((a, b) => (sfloor(b[0]) ?? -999) - (sfloor(a[0]) ?? -999));
  const shown = all ? sorted : sorted.slice(0, CAP);

  const areaTxt = (m2?: number | null) =>
    m2 == null ? null : `${(unit === "py" ? m2 / P : m2).toFixed(1)}${unit === "py" ? "평" : "㎡"}`;
  const vLabel = (v?: boolean | null) => (v == null ? null : v ? "공실" : "임대중");

  /** 곁말 — 용도는 진하게(층의 성격), 나머지는 회색 */
  const cap = (use?: string | null, unitNo?: string, m2?: number | null, vac?: boolean | null, n?: number) => (
    <span className="cap">
      <b>{use || "용도 미정"}</b>
      {n && n > 1 ? <><span className="gap">·</span>{n}호실</> : unitNo ? <><span className="gap">·</span>{unitNo}</> : null}
      {areaTxt(m2) && <><span className="gap">·</span>{areaTxt(m2)}</>}
      {vLabel(vac) && <><span className="gap">·</span>{vLabel(vac)}</>}
    </span>
  );

  const moneyCells = (dr: DRow) => (
    <span className="fm">
      <Money v={dr.r.deposit} onSave={(w) => put(dr, { deposit: w })} />
      <Money v={dr.r.rent} onSave={(w) => put(dr, { rent: w })} />
      <Money v={dr.r.maintenance} onSave={(w) => put(dr, { maintenance: w })} />
    </span>
  );

  /** 펼침 — 호실 · 용도 · 면적 · 상태. 자주 고치는 돈은 줄에서, 이건 한 겹 뒤로 */
  const exp = (dr: DRow) => (
    <div className="eexp" onClick={(e) => e.stopPropagation()}
      style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span className="bk">상태</span>
        <Chips mode="inline" opts={[{ code: "임대중", label: "임대중" }, { code: "공실", label: "공실" }]}
          cur={dr.r.is_vacant == null ? "미지정" : dr.r.is_vacant ? "공실" : "임대중"}
          onSelect={(v) => put(dr, { is_vacant: v === "미지정" ? null : v === "공실" })} />
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span className="bk">호실</span>
        <Txt v={dr.r.unit_no} w={84} onSave={(v) => put(dr, { unit_no: v })} />
        <span className="bk" style={{ marginLeft: 6 }}>용도</span>
        <Txt v={dr.r.use ?? ""} w={110} onSave={(v) => put(dr, { use: v })} />
        <span className="bk" style={{ marginLeft: 6 }}>면적</span>
        <Txt v={dr.r.contract_area != null ? String((unit === "py" ? dr.r.contract_area / P : dr.r.contract_area).toFixed(1)) : ""}
          w={74} onSave={(v) => put(dr, { contract_area: v ? (unit === "py" ? parseFloat(v) * P : parseFloat(v)) : null })} />
      </div>
    </div>
  );

  return (
    <div className="bg-card">
      {/* 안내 문구는 건물정보에 한 번만 — 화면마다 되풀이하면 잔소리가 된다 */}
      <div className="bg-ttl">층별 임대정보
        {items.length > 0 && (
          <button className="rst"
            onClick={async () => {
              if (!confirm("호실 나눔·용도·면적을 대장 구조로 되돌립니다. 넣은 금액도 함께 지워집니다. 계속할까요?")) return;
              await Promise.all(items.filter((i) => i.id != null).map((i) => rentsApi.del(pk, i.id!)));
              refresh();
            }}>대장 구조로</button>
        )}
      </div>

      {/* 라벨은 맨 위에 한 번만 — 칸마다 붙이면 열이 셋에서 여섯이 된다 */}
      <div className="fl-head">
        <span style={{ width: 96 }} /><span style={{ flex: 1 }} />
        <span className="fmh"><span>보증금</span><span>임대료</span><span>관리비</span></span>
        <span className="okpad" />
      </div>

      <div style={{ padding: "0 6px 6px" }}>
        {shown.map(([floor, rows]) => {
          const one = rows.length === 1;
          const isOpen = open.has(floor);
          const sum = (k: "deposit" | "rent" | "maintenance") => rows.reduce((s, d) => s + (d.r[k] || 0), 0);
          const uses = [...new Set(rows.map((d) => d.r.use).filter(Boolean))].join(" · ");
          const areaSum = rows.reduce((s, d) => s + (d.r.contract_area || 0), 0) || null;
          if (one) {
            const dr = rows[0];
            const isExp = expand === dr.key;
            return (
              <div key={floor} className={`eitem ${isExp ? "open" : ""}`}>
                <div className="orow has" onClick={() => setExpand(isExp ? null : dr.key)}>
                  <span className="who"><span className="fold" />{floor}</span>
                  {cap(dr.r.use, dr.r.unit_no, dr.r.contract_area, dr.r.is_vacant)}
                  {moneyCells(dr)}
                  <span className="okpad" />
                </div>
                {isExp && exp(dr)}
              </div>
            );
          }
          return (
            <Fragment key={floor}>
              <div className="orow has" onClick={() => setOpen((s) => { const n = new Set(s); n.has(floor) ? n.delete(floor) : n.add(floor); return n; })}>
                <span className="who"><span className="fold">{isOpen ? "▾" : "▸"}</span>{floor}</span>
                {cap(uses, undefined, areaSum, null, rows.length)}
                <span className="fm">
                  <span>{eokMan(sum("deposit")) ?? "—"}</span>
                  <span>{eokMan(sum("rent")) ?? "—"}</span>
                  <span>{eokMan(sum("maintenance")) ?? "—"}</span>
                </span>
                <span className="okpad" />
              </div>
              {isOpen && rows.map((dr) => {
                const isExp = expand === dr.key;
                return (
                  <div key={dr.key} className={`eitem ${isExp ? "open" : ""}`}>
                    <div className="orow unit has" onClick={() => setExpand(isExp ? null : dr.key)}>
                      <span className="who">{dr.r.unit_no || "—"}</span>
                      {cap(dr.r.use, undefined, dr.r.contract_area, dr.r.is_vacant)}
                      {moneyCells(dr)}
                      <span className="okpad">
                        {/* 호실은 팀이 나눈 것이라 지울 수 있다. 마지막 하나는 못 지운다 */}
                        {rows.length > 1 && dr.r.id != null && (
                          <span className="act">
                            <button className="mini bad" title="이 호실 지움"
                              onClick={(e) => { e.stopPropagation(); delUnit(dr); }}>
                              <Icon name="trash" size={12} /></button>
                          </span>
                        )}
                      </span>
                    </div>
                    {isExp && exp(dr)}
                  </div>
                );
              })}
              {isOpen && <button className="addu" onClick={() => addUnit(floor)}>＋ 호실</button>}
            </Fragment>
          );
        })}

        {/* 새 층 — 상시 버튼을 두면 눈에 걸린다. 판에 올렸을 때만 흐리게 뜬다 */}
        <NewFloor pk={pk} refresh={refresh} />
      </div>

      {sorted.length > CAP && (
        <button className="bg-more" onClick={() => setAll((v) => !v)}>
          {all ? "접기" : `더보기 (${sorted.length - CAP}개 층)`}
        </button>
      )}

      {total && items.length > 0 && (
        <div className="fl-sum">
          <span>합계 · {sorted.length}개 층{total.vacant_count > 0 ? ` 중 공실 ${total.vacant_count}` : ""}</span>
          <span style={{ flex: 1 }} />
          <span className="fm">
            <span>{eokMan(total.deposit) ?? "—"}</span>
            <span>{eokMan(total.rent) ?? "—"}</span>
            <span>{eokMan(total.maintenance) ?? "—"}</span>
          </span>
          <span className="okpad" />
        </div>
      )}
    </div>
  );
}

/** 글자 한 칸 — 눌러서 그 자리에서 */
function Txt({ v, w, onSave }: { v: string; w: number; onSave: (v: string) => void }) {
  const [ed, setEd] = useState(false);
  const [t, setT] = useState("");
  if (ed) return (
    <input className="um-in" autoFocus value={t} style={{ width: w, padding: "5px 10px", fontSize: 13 }}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => { setEd(false); if (t !== v) onSave(t.trim()); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }} />
  );
  return (
    <button className="um-vp" onClick={() => { setT(v); setEd(true); }}>
      <b className={v ? "" : "off"} style={{ fontSize: 13.5 }}>{v || "—"}</b></button>
  );
}

/** ＋ 층 — 층 번호를 치면 그 층이 선다 */
function NewFloor({ pk, refresh }: { pk: string; refresh: () => void }) {
  const [ed, setEd] = useState(false);
  const [t, setT] = useState("");
  return (
    <div className="orow newrow" onClick={() => setEd(true)}>
      <span className="who"><span className="fold" />{ed ? (
        <input className="um-in" autoFocus value={t} style={{ width: 64, padding: "4px 9px", fontSize: 14 }}
          placeholder="3F"
          onChange={(e) => setT(e.target.value)}
          onBlur={async () => {
            setEd(false);
            const f = t.trim(); setT("");
            if (!f) return;
            await rentsApi.upsert(pk, { floor: f, unit_no: "1", deposit: 0, rent: 0, maintenance: 0, is_vacant: null } as FloorRent);
            refresh();
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setT(""); setEd(false); } }} />
      ) : "＋ 층"}</span>
      <span className="cap">{ed ? "" : "층 번호를 치면 새 층이 섭니다"}</span>
      <span className="fm"><span className="off">—</span><span className="off">—</span><span className="off">—</span></span>
      <span className="okpad" />
    </div>
  );
}
