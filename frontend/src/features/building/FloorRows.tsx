import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rentsApi, type FloorRent } from "../../shared/api/endpoints";
import { Icon } from "../../shared/ui/Icon";

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

/** 서명층수 — 같은 층인지 가르는 데만 쓴다(정렬은 frank).
 *  **옥탑은 따로 센다**(2026-09-04). 숫자만 뽑으면 「옥탑1층」이 「1층」과 같은 값이 되어
 *  한 층으로 묶였다. 삼성동 78 의 1층이 「102호」로 뜬 것이 그 탓이다. */
const sfloor = (fl?: string): number | null => {
  if (!fl) return null;
  const n = parseInt(fl.replace(/\D/g, ""), 10);
  if (/^(옥탑|옥상|PH|RF?)/i.test(fl.trim())) return 900 + (isNaN(n) ? 1 : n);
  if (/지하|^\s*B/i.test(fl)) return isNaN(n) ? -1 : -n;
  return isNaN(n) ? null : n;
};

/** 화면 순서(2026-09-04) — **1층부터 위로, 그다음 옥탑, 맨 아래 지하.**
 *  예) 1층 2층 3층 옥탑1층 지하1층. 작을수록 위에 선다. */
const frank = (fl?: string): number => {
  const t = String(fl ?? "").trim();
  const n = Number(t.replace(/[^0-9]/g, "")) || 0;
  if (/^(옥탑|옥상|PH|RF?)/i.test(t)) return 1000 + n;
  if (/^(지하|지|B)/i.test(t)) return 2000 + n;
  return n;
};

/** 호실 이름 — 「1호실」이 아니라 층을 앞에 붙인 「101호」(2026-09-04).
 *  저장값(unit_no)은 그대로 두고 보이는 글자만 바꾼다. 팀이 「201-1」처럼 직접 적었으면 그대로 쓴다. */
const unitLabel = (floor?: string, unitNo?: string): string => {
  const u = String(unitNo ?? "").trim();
  if (!u) return "";
  if (!/^\d{1,2}$/.test(u)) return u;                       // 손으로 적은 이름은 건드리지 않는다
  const t = String(floor ?? "").trim();
  const n = Number(t.replace(/[^0-9]/g, "")) || 0;
  const two = u.padStart(2, "0");
  if (/^(옥탑|옥상|PH|RF?)/i.test(t)) return `옥탑${two}호`;
  if (/^(지하|지|B)/i.test(t)) return `B${n || 1}${two}호`;
  return n ? `${n}${two}호` : `${two}호`;
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
    <span className={`cell ${s ? "" : "off"}`}
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
        tenant_name: dr.r.tenant_name ?? null,
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
    // **호실 번호는 안 붙인다**(2026-09-04). 대장은 호실을 안 준다. 그 층 안 순번을 지어
    // 붙였더니 화면에 「102호」가 서서, 대장에 없는 값을 우리가 만든 꼴이 됐다.
    // 미지정은 비워 둔다. 호실은 팀이 ＋호실로 나눌 때 그때 생긴다.
    ...prefill.map((o, i) => ({ isPrefill: true, key: `pf-${o.floor}-${i}`,
      r: { floor: o.floor ?? "",
           unit_no: "",
           use: o.use ?? undefined,
           contract_area: o.floor_area ?? undefined, deposit: 0, rent: 0, maintenance: 0, is_vacant: null } as FloorRent })),
  ];
  const groups = new Map<string, DRow[]>();
  allRows.forEach((dr) => { const f = dr.r.floor || "—"; (groups.get(f) ?? groups.set(f, []).get(f)!).push(dr); });
  const sorted = [...groups.entries()].sort((a, b) => frank(a[0]) - frank(b[0]));
  const shown = all ? sorted : sorted.slice(0, CAP);

  const areaTxt = (m2?: number | null) =>
    m2 == null ? null : `${(unit === "py" ? m2 / P : m2).toFixed(1)}${unit === "py" ? "평" : "㎡"}`;
  const vLabel = (v?: boolean | null) => (v == null ? null : v ? "공실" : "임대중");

  /** 한 줄 편집 — 상호명·호실·면적·상태가 줄 위에 그대로 선다(2026-09-04).
   *  예전엔 줄을 눌러 펼쳐야 고칠 수 있었다. 한 호실짜리 층이 대부분이라 펼침이 늘 한 겹의 헛수고였다.
   *  대장에서 온 줄은 호실이 비어 있다 — 대장은 호실을 안 준다. */
  const editRow = (dr: DRow, showUnit: boolean) => (
    <span className="fedit" onClick={(e) => e.stopPropagation()}>
      {/* 상호명 — 이 줄의 주인공. 비면 글자가 없다(빈 칸에 낱말을 세우지 않는다) */}
      <Txt v={dr.r.tenant_name ?? ""} w={150} cls="nm" onSave={(v) => put(dr, { tenant_name: v || null })} />
      {showUnit && <Txt v={dr.r.unit_no ?? ""} w={54} onSave={(v) => put(dr, { unit_no: v })} />}
      <Txt v={dr.r.contract_area != null
        ? `${(unit === "py" ? dr.r.contract_area / P : dr.r.contract_area).toFixed(1)}${unit === "py" ? "평" : "㎡"}` : ""}
        w={68}
        onSave={(v) => {
          const n = parseFloat(v.replace(/[^\d.]/g, ""));
          put(dr, { contract_area: Number.isFinite(n) ? (unit === "py" ? n * P : n) : null });
        }} />
      {/* 상태 — 미지정이면 아무것도 안 뜬다. 누르면 임대중 → 공실 → 미지정 으로 돈다 */}
      <button className={`vac ${dr.r.is_vacant === true ? "on" : dr.r.is_vacant === false ? "in" : "off"}`}
        title="임대중 · 공실 · 미지정"
        onClick={(e) => {
          e.stopPropagation();
          put(dr, { is_vacant: dr.r.is_vacant == null ? false : dr.r.is_vacant === false ? true : null });
        }}>{dr.r.is_vacant === true ? "공실" : dr.r.is_vacant === false ? "임대중" : ""}</button>
    </span>
  );

  /** 곁말 — 묶음 줄(층 머리)에만 쓴다. 낱줄은 editRow 가 대신한다. */
  const cap = (tenant?: string | null, floor?: string, unitNo?: string, m2?: number | null, vac?: boolean | null, n?: number) => (
    <span className="cap">
      {[
        tenant || null,
        n && n > 1 ? `${n}호실` : unitLabel(floor, unitNo) || null,
        areaTxt(m2),
        vLabel(vac),
      ].filter(Boolean).map((t, i) => (
        <span key={i}>{i > 0 && <span className="gap">·</span>}{i === 0 && tenant ? <b>{t}</b> : t}</span>
      ))}
    </span>
  );

  const moneyCells = (dr: DRow) => (
    <span className="fm">
      <Money v={dr.r.deposit} onSave={(w) => put(dr, { deposit: w })} />
      <Money v={dr.r.rent} onSave={(w) => put(dr, { rent: w })} />
      <Money v={dr.r.maintenance} onSave={(w) => put(dr, { maintenance: w })} />
    </span>
  );


  return (
    <div className="bg-card">
      {/* 안내 문구는 건물정보에 한 번만 — 화면마다 되풀이하면 잔소리가 된다 */}
      <div className="bg-ttl">층별 임대정보
        {items.length > 0 && (
          <button className="rst"
            onClick={async () => {
              if (!confirm("호실 나눔·상호명·면적을 대장 구조로 되돌립니다. 넣은 금액도 함께 지워집니다. 계속할까요?")) return;
              // 한 번에 지운다 — 행마다 DELETE 를 부르면 없앤 층 표시가 남아 「되돌렸는데 그대로」가 됐다
              await rentsApi.revert(pk);
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
          const sum = (k: "deposit" | "rent" | "maintenance") => rows.reduce((s, d) => s + (d.r[k] || 0), 0);
          const uses = [...new Set(rows.map((d) => d.r.tenant_name).filter(Boolean))].join(" · ");
          const areaSum = rows.reduce((s, d) => s + (d.r.contract_area || 0), 0) || null;
          if (one) {
            const dr = rows[0];
            return (
              <div key={floor} className="eitem">
                <div className="orow has">
                  <span className="who"><span className="fold" />{floor}</span>
                  {editRow(dr, false)}
                  {moneyCells(dr)}
                  <span className="okpad">
                    <span className="act">
                      <button className="mini" title="이 층에 호실 더하기"
                        onClick={(e) => { e.stopPropagation(); addUnit(floor); }}>＋</button>
                    </span>
                  </span>
                </div>
              </div>
            );
          }
          return (
            <Fragment key={floor}>
              {/* 접기를 없앴다(2026-09-04) — 호실이 여럿인 층도 항상 펴져 있다.
                  접어 두면 몇 호실인지 보려고 매번 펴야 했고, 접힌 층에는 ＋ 호실도 안 보였다. */}
              <div className="orow has grp">
                <span className="who"><span className="fold" />{floor}</span>
                {cap(uses, floor, undefined, areaSum, null, rows.length)}
                <span className="fm">
                  <span>{eokMan(sum("deposit")) ?? "—"}</span>
                  <span>{eokMan(sum("rent")) ?? "—"}</span>
                  <span>{eokMan(sum("maintenance")) ?? "—"}</span>
                </span>
                <span className="okpad" />
              </div>
              {rows.map((dr) => {
                return (
                  <div key={dr.key} className="eitem">
                    <div className="orow unit has">
                      <span className="who">{unitLabel(dr.r.floor, dr.r.unit_no) || ""}</span>
                      {editRow(dr, true)}
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
                  </div>
                );
              })}
              <button className="addu" onClick={(e) => { e.stopPropagation(); addUnit(floor); }}>＋ 호실</button>
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
function Txt({ v, w, onSave, cls }: { v: string; w: number; onSave: (v: string) => void; cls?: string }) {
  const [ed, setEd] = useState(false);
  const [t, setT] = useState("");
  if (ed) return (
    <input className="um-in" autoFocus value={t}
      style={{ width: w, padding: "4px 8px", fontSize: 13 }}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => { setEd(false); if (t !== v) onSave(t.trim()); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }} />
  );
  // 빈 칸은 「—」 하나. 칸 이름을 글자로 세우면 줄이 「읽는 곳」이 아니라 「채우는 서식」이 된다
  return (
    <button className={`um-vp ${cls ?? ""}`} style={{ width: w }} onClick={() => { setT(v); setEd(true); }}>
      <b className={v ? "" : "off"}>{v || "—"}</b></button>
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
      <span className="cap" />
      <span className="fm"><span className="off">—</span><span className="off">—</span><span className="off">—</span></span>
      <span className="okpad" />
    </div>
  );
}
