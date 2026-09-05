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
// 접기·더보기를 없앴다(2026-09-05). 층은 스무 개가 넘는 건물이 흔한데 다섯만 보이고
// 「더보기」를 눌러야 나머지가 섰다 — 층끼리 견주려고 보는 화면에서 그 한 번이 늘 헛수고였다.
// 이제 전부 그리고 목록이 스크롤한다.

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

  const areaTxt = (m2?: number | null) =>
    m2 == null ? null : `${(unit === "py" ? m2 / P : m2).toFixed(1)}${unit === "py" ? "평" : "㎡"}`;

  // ── 안C: 왼쪽 층 목록, 오른쪽 고른 층 상세(2026-09-05 대표 선택) ─────────────
  //  한 줄에 여섯 칸을 욱여넣으니 무엇이 열인지 눈이 세어야 했고, 상태 버튼은 있는지도 몰랐다.
  //  목록은 훑는 곳(층·상호명·상태), 상세는 채우는 곳(면적·금액·호실). 한 번에 한 층만 고친다.
  const [pick, setPick] = useState<string | null>(null);
  const curFloor = pick && groups.has(pick) ? pick : (sorted[0]?.[0] ?? null);
  const curRows = curFloor ? (groups.get(curFloor) ?? []) : [];
  const floorArea = curRows.reduce((s, d) => s + (d.r.contract_area || 0), 0) || null;

  /** 상세 한 칸 — 라벨과 값이 짝. 값은 눌러야 열린다(줄 문법) */
  const field = (label: string, node: React.ReactNode) => (
    <Fragment key={label}><span className="dk">{label}</span><span className="dv">{node}</span></Fragment>
  );

  return (
    <div className="bg-card">
      <div className="bg-ttl">층별 임대정보
        {items.length > 0 && (
          <button className="rst"
            onClick={async () => {
              if (!confirm("호실 나눔·상호명·면적을 대장 구조로 되돌립니다. 넣은 금액도 함께 지워집니다. 계속할까요?")) return;
              await rentsApi.revert(pk);
              refresh();
            }}>대장 구조로</button>
        )}
      </div>

      <div className="fl2">
        {/* 왼쪽 — 훑는 곳. 층·상호명·임대상태만. 금액은 오른쪽에서 본다 */}
        <div className="fl2-l">
          <div className="fl2-lh"><span>층</span><span>상호명</span><span>임대상태</span></div>
          {sorted.map(([floor, rows]) => {
            const names = [...new Set(rows.map((d) => d.r.tenant_name).filter(Boolean))].join(" · ");
            const vac = rows.length === 1 ? rows[0].r.is_vacant
              : rows.some((d) => d.r.is_vacant === true) ? true
              : rows.every((d) => d.r.is_vacant === false) ? false : null;
            return (
              <button key={floor} className={`fl2-i ${floor === curFloor ? "on" : ""}`} onClick={() => setPick(floor)}>
                <b>{floor}</b>
                <span className="nm">{names || (rows.length > 1 ? `${rows.length}호실` : <i className="off">—</i>)}</span>
                <span className={`vac ${vac === true ? "on" : vac === false ? "in" : "off"}`}>
                  {vac === true ? "공실" : vac === false ? "임대중" : "—"}</span>
              </button>
            );
          })}
          <NewFloor pk={pk} refresh={refresh} onAdded={setPick} />
        </div>

        {/* 오른쪽 — 채우는 곳. 고른 층 하나만. 상태 칩 둘은 늘 보인다 */}
        <div className="fl2-r">
          {curFloor && (
            <>
              <div className="fl2-rh"><b>{curFloor}</b>
                {floorArea != null && <span>{areaTxt(floorArea)}</span>}
                {curRows.length > 1 && <span>{curRows.length}호실</span>}
              </div>
              {curRows.map((dr, i) => (
                <div className="fl2-u" key={dr.key}>
                  {curRows.length > 1 && (
                    <div className="fl2-uh">
                      <b>{unitLabel(dr.r.floor, dr.r.unit_no) || `${i + 1}번째`}</b>
                      {dr.r.id != null && (
                        <button className="mini bad" title="이 호실 지움" onClick={() => delUnit(dr)}>
                          <Icon name="trash" size={12} /></button>
                      )}
                    </div>
                  )}
                  <div className="fl2-g">
                    {field("상호명", <Txt v={dr.r.tenant_name ?? ""} w={220} cls="nm" onSave={(v) => put(dr, { tenant_name: v || null })} />)}
                    {curRows.length > 1 && field("호실", <Txt v={dr.r.unit_no ?? ""} w={90} onSave={(v) => put(dr, { unit_no: v })} />)}
                    {field("면적", <Txt v={areaTxt(dr.r.contract_area) ?? ""} w={110}
                      onSave={(v) => { const n = parseFloat(v.replace(/[^\d.]/g, ""));
                        put(dr, { contract_area: Number.isFinite(n) ? (unit === "py" ? n * P : n) : null }); }} />)}
                    {/* 임대상태 — 칩 둘이 늘 보인다. 고른 칩을 다시 누르면 미지정 */}
                    {field("임대상태", (
                      <span className="vacs">
                        {([[false, "임대중", "in"], [true, "공실", "on"]] as const).map(([val, label, cls]) => (
                          <button key={label} className={`vac ${dr.r.is_vacant === val ? cls : "pick"}`}
                            onClick={() => put(dr, { is_vacant: dr.r.is_vacant === val ? null : val })}>{label}</button>
                        ))}
                      </span>
                    ))}
                    {field("보증금", <Money v={dr.r.deposit} onSave={(w) => put(dr, { deposit: w })} />)}
                    {field("임대료", <Money v={dr.r.rent} onSave={(w) => put(dr, { rent: w })} />)}
                    {field("관리비", <Money v={dr.r.maintenance} onSave={(w) => put(dr, { maintenance: w })} />)}
                  </div>
                </div>
              ))}
              <button className="addu" onClick={() => addUnit(curFloor)}>＋ 호실 나누기</button>
            </>
          )}
        </div>
      </div>

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
    <button className={`um-vp ${cls ?? ""}`} style={{ maxWidth: w }} onClick={() => { setT(v); setEd(true); }}>
      <b className={v ? "" : "off"}>{v || "—"}</b></button>
  );
}

/** ＋ 층 — 층 번호를 치면 그 층이 서고, 그 층이 바로 골라진다.
 *  왼쪽 목록의 마지막 줄이라 금액 칸을 그리지 않는다(금액은 오른쪽 상세에서 본다). */
function NewFloor({ pk, refresh, onAdded }: { pk: string; refresh: () => void; onAdded?: (f: string) => void }) {
  const [ed, setEd] = useState(false);
  const [t, setT] = useState("");
  if (ed) return (
    <div className="fl2-i new">
      <input className="um-in" autoFocus value={t} style={{ width: 78, padding: "4px 9px", fontSize: 14 }}
        placeholder="3F"
        onChange={(e) => setT(e.target.value)}
        onBlur={async () => {
          setEd(false);
          const f = t.trim(); setT("");
          if (!f) return;
          await rentsApi.upsert(pk, { floor: f, unit_no: "1", deposit: 0, rent: 0, maintenance: 0, is_vacant: null } as FloorRent);
          onAdded?.(f);
          refresh();
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setT(""); setEd(false); } }} />
    </div>
  );
  return <button className="fl2-i new" onClick={() => setEd(true)}>＋ 층</button>;
}
