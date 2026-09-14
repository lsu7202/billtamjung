import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rentsApi, tenantsApi, placesApi, type FloorRent, type Tenant } from "../../shared/api/endpoints";
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
/** 월 임대료·월 관리비는 **늘 만 단위**다. 억으로 끊으면 1억2천만원짜리 월세처럼 읽힌다 —
 *  실제로 월 임대료가 「1억 2,000만」으로 찍히고 있었다(2026-09-05). */
const manOnly = (v?: number | null) =>
  v ? `${Math.round(v / 1e4).toLocaleString()}만` : null;

type DRow = { r: FloorRent; isPrefill?: boolean; key: string };
/** 고른 줄 — 층(그 층의 어느 줄) 또는 층을 모르는 업체 하나(u) */
type Pick = { floor?: string; key?: string; un?: true };

/** 이름 견줌용 — 「(주)더원」·「더원 삼성점」·「더원」이 하나. 백엔드 tenants.norm_name 과 같은 규칙 */
const nname = (s?: string | null) => {
  const t = (s ?? "").replace(/\([^)]*\)|㈜|\(주\)|주식회사|유한회사|\s+/g, "").toLowerCase();
  return t.length > 2 ? t.replace(/점$/, "") : t;
};
const sameName = (a: string, b: string) =>
  a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));

/** 업체 줄 — 원장(인허가·상가정보)이 아는 것. 값이 있는 칸만 그린다. 읽기 전용이다 */
function TenantRows({ list, areaTxt, onAdd }: {
  list: Tenant[]; areaTxt: (m2?: number | null) => string | null;
  /** 있으면 줄 끝에 ＋ — 그 업체를 이 층의 호실로 세운다(팀 줄이 이미 있는 층에서) */
  onAdd?: (t: Tenant) => void;
}) {
  return (
    <div className="fl2-t">
      {list.map((t) => (
        <div className="fl2-ti" key={t.name}>
          {t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.name}</a> : <b>{t.name}</b>}
          <span>{[t.biz, areaTxt(t.area)].filter(Boolean).join(" · ")}</span>
          {t.phone && <a className="tel" href={`tel:${t.phone}`}>{t.phone}</a>}
          {onAdd && <button className="mini" title="이 업체를 호실로" onClick={() => onAdd(t)}><Icon name="plus" size={12} /></button>}
        </div>
      ))}
    </div>
  );
}

/** 돈 한 칸 — 눌러서 그 자리에서 고친다. 저장 단위는 만원.
 *  `man` 을 주면 억으로 안 끊는다(월 임대료·월 관리비). */
function Money({ v, onSave, man }: { v?: number | null; onSave: (won: number) => void; man?: boolean }) {
  const [ed, setEd] = useState(false);
  const [t, setT] = useState("");
  if (ed) return (
    <input autoFocus value={t} inputMode="numeric"
      onChange={(e) => setT(e.target.value.replace(/[^\d.]/g, ""))}
      onBlur={() => { setEd(false); if (!t.trim()) { onSave(0); return; } const n = parseFloat(t); if (!Number.isNaN(n)) onSave(Math.round(n * 1e4)); }}   // 비우면 0 = 지우기
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }} />
  );
  const s = man ? manOnly(v) : eokMan(v);
  return (
    <span className={`cell ${s ? "" : "off"}`}
      onClick={(e) => { e.stopPropagation(); setT(v ? String(Math.round(v / 1e4)) : ""); setEd(true); }}>
      {s ?? "—"}
    </span>
  );
}

export function FloorRows({ pk, items, total, unit, refresh, addr }: {
  pk: string; items: FloorRent[]; total?: Record<string, number>;
  unit: "py" | "m2"; refresh: () => void;
  /** 카카오맵 업체 목록으로 건너뛸 주소(도로명 우선). 카카오 자료는 저장하지 않는다 — 링크만(항목 L) */
  addr?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const outline = useQuery({ queryKey: ["floor-outline", pk], queryFn: () => rentsApi.outline(pk) });
  // 업체 원장(인허가·상가정보) + 카카오(전화). 카카오는 화면에서만 이름으로 붙이고 저장하지 않는다(항목 L)
  const tenants = useQuery({ queryKey: ["tenants", pk], queryFn: () => tenantsApi.list(pk), staleTime: 6 * 3600 * 1000 });
  const places = useQuery({ queryKey: ["places", pk], queryFn: () => placesApi.list(pk), staleTime: 6 * 3600 * 1000, retry: false });
  const ledger: Tenant[] = (() => {
    const out = (tenants.data?.items ?? []).map((t) => ({ ...t }));
    for (const p of places.data?.items ?? []) {
      const k = nname(p.name);
      const hit = out.find((t) => sameName(nname(t.name), k));
      if (hit) { hit.phone ??= p.phone; hit.url ??= p.url; }
      else out.push({ name: p.name, floor: null, area: null, biz: p.detail || p.group, phone: p.phone, url: p.url });
    }
    return out;
  })();
  const ledgerOf = (floor: string) => ledger.filter((t) => t.floor && sfloor(t.floor) === sfloor(floor));
  // 층을 모르는 업체 — 팀이 어느 층에든 그 이름으로 줄을 세웠으면 여기서 빠진다
  const unknown = ledger.filter((t) => !t.floor
    && !items.some((r) => r.tenant_name && sameName(nname(r.tenant_name), nname(t.name))));

  // 층 단위 인수(0029): 그 층에 팀 입력이 하나라도 있으면 그 층 대장 프리필은 전부 대체된다.
  const teamFloors = new Set(items.map((i) => sfloor(i.floor)).filter((f): f is number => f != null));
  const prefill = (outline.data ?? []).filter((o) => {
    const f = sfloor(o.floor ?? undefined);
    return o.floor && (f == null || !teamFloors.has(f));
  });

  // ── 프리필(팀 줄이 없는 층) — **업체마다 한 줄**(2026-09-06 대표). 층 하나에 줄 하나면 업체가 셋인 층이
  //    「A 외 2」로 뭉개지고 업체별 임대상태·금액을 못 넣는다. 원장이 층을 아는 업체는 그 층의 호실로 미리 선다.
  //    호실 면적은 LOCALDATA 가 아는 업체만 채운다(영업 중 29%). **업체가 하나뿐이라도 층 면적을 그 호실에 넣지 않는다** —
  //    그 호실이 층 전부인지 모르면 총면적을 채우는 것도 지어낸 값이다(2026-09-06 대표). 층 총면적은 머리에 따로 선다.
  //    업체가 없는 층은 대장 층별개요 그대로 한 줄(그 줄이 곧 층이라 바닥면적을 계약면적으로 · 0035).
  type OutlineRow = NonNullable<typeof outline.data>[number];
  const pfFloors = new Map<number | null, OutlineRow[]>();
  for (const o of prefill) {
    const sf = sfloor(o.floor ?? undefined);
    (pfFloors.get(sf) ?? pfFloors.set(sf, []).get(sf)!).push(o);
  }
  for (const t of ledger) {   // 원장만 아는 층(대장에도 팀 줄에도 없다) — 층을 아는데 미상에 두면 거짓이다
    if (!t.floor) continue;
    const sf = sfloor(t.floor);
    if (sf == null || teamFloors.has(sf) || pfFloors.has(sf)) continue;
    pfFloors.set(sf, [{ floor: t.floor, use: null, floor_area: null, rent_est: null, deposit_est: null }]);
  }
  const prefillRows: DRow[] = [];
  for (const [sf, os] of pfFloors) {
    const floor = os[0].floor ?? "";
    const ts = sf == null ? [] : ledger.filter((t) => t.floor && sfloor(t.floor) === sf);
    if (ts.length === 0) {
      // 업체를 하나도 모르는 층 — 왼쪽 목록에 「층이 있다」고 세우는 자리표시(pf-)다. **호실이 아니다.**
      // 예전엔 바닥면적을 계약면적에 넣어 두었는데, 그 층에 업체를 하나 올리면 이 자리표시가 「면적 다 가진 이름 없는
      // 호실」로 굳고 업체는 「두 번째 호실」이 됐다(2026-09-07 대표). 대장이 층에 호실 하나를 말해도 실제는 둘일 수 있다 —
      // 층별 임대는 대장과 100% 같지 않아도 된다. 층 총면적은 머리에만 선다(floorArea).
      os.slice(0, 1).forEach((o) => prefillRows.push({ isPrefill: true, key: `pf-${o.floor}`,
        r: { floor: o.floor ?? "", unit_no: "", use: o.use ?? undefined, contract_area: undefined,
             deposit: 0, rent: 0, maintenance: 0, is_vacant: null } as FloorRent }));
    } else {
      // 호실 번호는 **안 만든다** — 모르는 값이다(2026-09-06 대표). 줄은 id 로 고친다(0160)
      ts.forEach((t) => prefillRows.push({ isPrefill: true, key: `pt-${floor}-${t.name}`,
        r: { floor, unit_no: "", use: os[0].use ?? undefined,
             tenant_name: t.name,
             contract_area: t.area ?? undefined,
             deposit: 0, rent: 0, maintenance: 0, is_vacant: null } as FloorRent }));
    }
  }
  const prefillOf = (floor: string) => prefillRows.filter((d) => sfloor(d.r.floor) === sfloor(floor));

  /** 그 층을 팀 행으로 확정 — 프리필을 건드리는 순간 그 층은 팀이 인수한다.
   *  금액은 안 옮긴다(대장 추정은 분석 탭 몫). 구조(상호명·면적)만 굳힌다. 업체 줄은 그대로 호실이 된다.
   *  호실 번호는 비운 채 넣는다 — 순번을 지어 넣지 않는다. 만든 줄의 id 를 프리필 열쇠별로 돌려준다. */
  async function adopt(floor: string): Promise<Map<string, number>> {
    const ids = new Map<string, number>();
    const sf = sfloor(floor);
    if (sf != null && teamFloors.has(sf)) return ids;
    const rows = prefillOf(floor).filter((d) => !d.key.startsWith("pf-"));   // 자리표시(pf-)는 호실이 아니라 안 굳힌다
    await Promise.all(rows.map(async (d) => {
      const res = await rentsApi.upsert(pk, {
        floor: d.r.floor || floor, unit_no: "",
        use: d.r.use ?? undefined, contract_area: d.r.contract_area ?? undefined,
        tenant_name: d.r.tenant_name ?? undefined,
        deposit: 0, rent: 0, maintenance: 0, is_vacant: null,
      } as FloorRent);
      ids.set(d.key, res.id);
    }));
    return ids;
  }

  /** 원장 업체 하나를 이 층의 호실로 — 팀 줄이 이미 있는 층에서 아래 업체 줄의 ＋ */
  async function addTenantUnit(floor: string, t: Tenant) {
    if (busy) return;
    setBusy(true);
    try {
      await adopt(floor);
      await rentsApi.upsert(pk, { floor, unit_no: "", tenant_name: t.name, contract_area: t.area ?? undefined,
        deposit: 0, rent: 0, maintenance: 0, is_vacant: null } as FloorRent);
      refresh();
    } finally { setBusy(false); }
  }

  async function addUnit(floor: string) {
    if (busy) return;
    setBusy(true);
    try {
      await adopt(floor);
      // 새 호실도 번호 없이 선다 — 이름은 팀이 적는다
      await rentsApi.upsert(pk, { floor, unit_no: "", deposit: 0, rent: 0, maintenance: 0, is_vacant: null } as FloorRent);
      refresh();
    } finally { setBusy(false); }
  }

  /** 값 하나 고치기 — 프리필 줄이면 그 층을 먼저 인수한다 */
  async function put(dr: DRow, patch: Partial<FloorRent>) {
    if (busy) return;
    setBusy(true);
    try {
      // 프리필 줄이면 먼저 인수하고, 방금 생긴 그 줄의 id 로 고친다
      const id = dr.isPrefill ? (await adopt(dr.r.floor)).get(dr.key) : dr.r.id;
      await rentsApi.upsert(pk, {
        id, floor: dr.r.floor, unit_no: dr.r.unit_no ?? "",
        use: dr.r.use ?? null, contract_area: dr.r.contract_area ?? null,
        tenant_name: dr.r.tenant_name ?? null,
        deposit: dr.r.deposit ?? 0, rent: dr.r.rent ?? 0, maintenance: dr.r.maintenance ?? 0,
        is_vacant: dr.r.is_vacant ?? null, ...patch,
      } as FloorRent);
      refresh();
    } finally { setBusy(false); }
  }

  /** 줄 지우기 — 팀 줄이면 지운다. 마지막 줄을 지우면 그 층은 대장 프리필로 돌아간다 */
  async function delUnit(dr: DRow) {
    if (busy || dr.r.id == null) return;
    setBusy(true);
    try { await rentsApi.del(pk, dr.r.id); refresh(); } finally { setBusy(false); }
  }

  // 층별 그룹 — 팀 입력 + 프리필(위에서 업체마다 세운 줄)을 한 배열로
  const allRows: DRow[] = [
    ...items.map((r) => ({ r, key: (r.id ?? `${r.floor}-${r.unit_no}`).toString() })),
    ...prefillRows,
  ];
  const groups = new Map<string, DRow[]>();
  allRows.forEach((dr) => { const f = dr.r.floor || "—"; (groups.get(f) ?? groups.set(f, []).get(f)!).push(dr); });
  const sorted = [...groups.entries()].sort((a, b) => frank(a[0]) - frank(b[0]));

  const areaTxt = (m2?: number | null) =>
    m2 == null ? null : `${(unit === "py" ? m2 / P : m2).toFixed(1)}${unit === "py" ? "평" : "㎡"}`;

  // ── 안C: 왼쪽 층 목록, 오른쪽 고른 층 상세(2026-09-05 대표 선택) ─────────────
  //  한 줄에 여섯 칸을 욱여넣으니 무엇이 열인지 눈이 세어야 했고, 상태 버튼은 있는지도 몰랐다.
  //  목록은 훑는 곳(층·상호명·상태), 상세는 채우는 곳(면적·금액·호실). 한 번에 한 층만 고친다.
  //  2026-09-06 밤(대표 확정판): 왼쪽은 밸류맵처럼 **업체마다 한 줄**(같은 층이면 「1층 1층 1층」), 층을 모르는 업체는
  //  층 칸이 「—」인 줄로 같은 목록 맨 위. 상태 열은 없다. 「층 미상」이라는 말은 안 쓴다.
  const [pick, setPick] = useState<Pick | null>(null);
  /** 층을 모르는 업체는 **왼쪽에서 한 줄로 묶는다**(2026-09-07 대표).
   *  하나씩 세우니 스무 곳이면 스무 줄이 목록 맨 위를 차지해 **실제 층이 화면 밖으로 밀렸다.**
   *  왼쪽은 훑는 곳이라 층이 먼저 보여야 한다. 묶은 줄을 누르면 오른쪽에 업체가 다 서고,
   *  거기서 **업체마다 층을 고른다** — 한 번 고를 때마다 그 업체가 목록에서 빠진다.
   *  다 빠지면 묶음 줄도 사라지므로, 빈 묶음을 고른 상태로 두지 않는다. */
  const curUn = !!pick?.un && unknown.length > 0;
  const curFloor = curUn ? null : (pick?.floor && groups.has(pick.floor) ? pick.floor : (sorted[0]?.[0] ?? null));
  const curRows = curFloor ? (groups.get(curFloor) ?? []) : [];
  const curKey = pick?.floor === curFloor ? pick?.key ?? null : null;
  useEffect(() => {
    if (curKey) document.getElementById(`fu-${curKey}`)?.scrollIntoView({ block: "nearest" });
  }, [curKey]);
  // 원장은 아는데 아직 이 층의 줄로 안 선 업체(팀 줄이 먼저 있던 층) — ＋ 로 줄을 세운다
  const ledgerOnly = (floor: string, rows: DRow[]) =>
    ledgerOf(floor).filter((t) => !rows.some((d) => sameName(nname(d.r.tenant_name), nname(t.name))));
  const curLedger = curFloor ? ledgerOnly(curFloor, curRows) : [];
  // 층 총면적 = 대장 바닥면적 하나. 업체 면적 합·남은 면적은 세우지 않는다(대표)
  const floorArea = curFloor
    ? ((outline.data ?? []).filter((o) => o.floor && sfloor(o.floor) === sfloor(curFloor)).reduce((a, o) => a + (o.floor_area || 0), 0) || null)
    : null;
  const bizOf = (name?: string | null) => name ? ledger.find((t) => sameName(nname(t.name), nname(name)))?.biz ?? null : null;
  const [addFloor, setAddFloor] = useState(false);

  /** 상세 한 칸 — 라벨과 값이 짝. 값은 눌러야 열린다(줄 문법) */
  const field = (label: string, node: React.ReactNode) => (
    <Fragment key={label}><span className="dk">{label}</span><span className="dv">{node}</span></Fragment>
  );

  return (
    <div className="bg-card">
      <div className="bg-ttl">층별 임대정보
        {/* + 층 추가하기 — 카드 머리. 누르면 그 자리에 층 이름 칸이 열리고, 치면 그 층이 서고 바로 골라진다 */}
        {addFloor
          ? <NewFloor pk={pk} refresh={refresh} onAdded={(f) => { setAddFloor(false); setPick({ floor: f }); }} onCancel={() => setAddFloor(false)} />
          : <button className="rst add" onClick={() => setAddFloor(true)}>+ 층 추가하기</button>}
        {items.length > 0 && (
          <button className="rst"
            onClick={async () => {
              if (!confirm("팀이 적은 호실·상호명·면적·금액을 전부 지우고 대장 구조로 되돌립니다. 계속할까요?")) return;
              await rentsApi.revert(pk);
              refresh();
            }}>전체 되돌리기</button>
        )}
        {/* 카카오맵 업체 목록 — 이 주소로 검색한 결과 페이지로 건너뛴다(2026-09-07 대표). 오른쪽 끝, 「출처」 링크와 같은 결 */}
        {addr && (
          <a className="fl2-kakao" href={`https://map.kakao.com/link/search/${encodeURIComponent(addr)}`}
             target="_blank" rel="noreferrer" title="카카오맵에서 이 주소의 업체 보기">카카오맵</a>
        )}
      </div>

      <div className="fl2">
        {/* 왼쪽 — 훑는 곳. 업체마다 한 줄: 층 · 업체 · 업종. 금액·상태는 오른쪽에서 본다 */}
        <div className="fl2-l">
          <div className="fl2-lh"><span>층</span><span>업체</span><span>업종</span></div>
          {/* 층을 모르는 업체 — 여럿이어도 「—」 한 줄. 누르면 오른쪽에서 업체마다 층을 정한다 */}
          {unknown.length > 0 && (
            <button className={`fl2-i ${curUn ? "on" : ""}`} onClick={() => setPick({ un: true })}>
              <b className="off">—</b>
              <span className="nm">{unknown[0].name}{unknown.length > 1 ? ` 외 ${unknown.length - 1}` : ""}</span>
              <span className="bz">{unknown.length === 1 ? unknown[0].biz ?? "" : `${unknown.length}곳`}</span>
            </button>
          )}
          {sorted.flatMap(([floor, rows]) => [
            ...rows.map((d, i) => {
              const nm = d.r.tenant_name || unitLabel(d.r.floor, d.r.unit_no);
              const on = floor === curFloor && (curKey ? curKey === d.key : i === 0);
              return (
                <button key={d.key} className={`fl2-i ${on ? "on" : ""}`} onClick={() => setPick({ floor, key: d.key })}>
                  <b>{floor}</b>
                  <span className="nm">{nm || <i className="off">—</i>}</span>
                  <span className="bz">{bizOf(d.r.tenant_name) ?? ""}</span>
                </button>
              );
            }),
            // 원장은 아는데 줄이 아직 없는 업체(팀 줄이 먼저 있던 층) — 누르면 그 층으로, ＋ 는 오른쪽에
            ...ledgerOnly(floor, rows).map((t) => (
              <button key={`lg-${floor}-${t.name}`} className={`fl2-i ${floor === curFloor && curKey === `lg-${t.name}` ? "on" : ""}`}
                onClick={() => setPick({ floor, key: `lg-${t.name}` })}>
                <b>{floor}</b>
                <span className="nm">{t.name}</span>
                <span className="bz">{t.biz ?? ""}</span>
              </button>
            )),
          ])}
        </div>

        {/* 오른쪽 — 채우는 곳. 고른 층 하나만. 상태 칩 둘은 늘 보인다 */}
        <div className="fl2-r">
          {curUn && (
            <>
              <div className="fl2-rh"><b className="off">—</b><span>{unknown.length}곳</span></div>
              {/* 층 칩 — 누르면 그 업체가 그 층의 줄이 된다. 라벨은 묶음에 하나만(2026-09-07 대표) */}
              <div className="fl2-fll">층 선택하기</div>
              {unknown.map((t) => (
                <div className="fl2-u" key={`un-${t.name}`}>
                  <div className="fl2-uh"><b>{t.name}</b>
                    {t.biz && <span className="fl2-ux">{t.biz}</span>}
                    {t.phone && <a className="tel" href={`tel:${t.phone}`}>{t.phone}</a>}
                  </div>
                  {/* 고른 뒤에도 묶음에 남는다 — 스무 곳을 붙이는데 매번 화면이 튀면 손이 끊긴다 */}
                  <div className="fl2-fl">
                    {sorted.map(([floor]) => (
                      <button key={floor} disabled={busy} onClick={() => addTenantUnit(floor, t)}>{floor}</button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
          {curFloor && (
            <>
              <div className="fl2-rh"><b>{curFloor}</b>
                {floorArea != null && <span>{areaTxt(floorArea)}</span>}
              </div>
              {curRows.filter((dr) => !dr.key.startsWith("pf-")).map((dr) => {   // 자리표시는 카드가 아니다
                const lg = dr.r.tenant_name ? ledger.find((t) => sameName(nname(t.name), nname(dr.r.tenant_name))) : undefined;
                const extra = lg?.biz ?? "";
                return (
                <div className={`fl2-u ${curKey === dr.key ? "on" : ""}`} key={dr.key} id={`fu-${dr.key}`}>
                  <div className="fl2-uh">
                    {/* 이름 없는 줄은 「—」 — 「1번째·2번째」 같은 순번은 안 세운다(대표) */}
                    {dr.r.tenant_name || unitLabel(dr.r.floor, dr.r.unit_no)
                      ? <b>{dr.r.tenant_name || unitLabel(dr.r.floor, dr.r.unit_no)}</b>
                      : <b className="off">—</b>}
                    {extra && <span className="fl2-ux">{extra}</span>}
                    {lg?.phone && <a className="tel" href={`tel:${lg.phone}`}>{lg.phone}</a>}
                    {/* 팀 줄은 지울 수 있다. 잘못 넣은 층이면 지우고 「—」 줄에서 다시 고른다 — 원장 업체는 없어지지 않는다 */}
                    {dr.r.id != null && (
                      <button className="mini bad" title="이 줄 지움" onClick={() => delUnit(dr)}>
                        <Icon name="trash" size={12} /></button>
                    )}
                  </div>
                  <div className="fl2-g">
                    {field("상호명", <Txt v={dr.r.tenant_name ?? ""} w={220} cls="nm" onSave={(v) => put(dr, { tenant_name: v || null })} />)}
                    {/* 호실 이름은 팀이 정한 것만 보인다 — 원장에서 세운 줄의 번호는 순번일 뿐 대장에 없는 값이다 */}
                    {!dr.isPrefill && field("호실", <Txt v={dr.r.unit_no ?? ""} w={90} onSave={(v) => put(dr, { unit_no: v })} />)}
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
                    {field("월 보증금", <Money v={dr.r.deposit} onSave={(w) => put(dr, { deposit: w })} />)}
                    {field("월 임대료", <Money man v={dr.r.rent} onSave={(w) => put(dr, { rent: w })} />)}
                    {field("월 관리비", <Money man v={dr.r.maintenance} onSave={(w) => put(dr, { maintenance: w })} />)}
                  </div>
                </div>
                );
              })}
              <button className="addu" onClick={() => addUnit(curFloor)}>+ 호실 추가하기</button>
              {/* 아직 호실로 안 선 업체(팀 줄이 먼저 있던 층) — ＋ 로 그 업체를 호실로 세운다 */}
              {curLedger.length > 0 && <TenantRows list={curLedger} areaTxt={areaTxt} onAdd={(t) => addTenantUnit(curFloor, t)} />}
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

/** + 층 추가하기 — 머리의 글자를 누르면 이 입력이 열린다. 층 이름을 치면 그 층이 서고 바로 골라진다. 비우고 나가면 닫힌다 */
function NewFloor({ pk, refresh, onAdded, onCancel }: { pk: string; refresh: () => void; onAdded: (f: string) => void; onCancel: () => void }) {
  const [t, setT] = useState("");
  return (
    <input className="um-in" autoFocus value={t} style={{ width: 78, padding: "3px 9px", fontSize: 13 }}
      placeholder="예: 3층"
      onChange={(e) => setT(e.target.value)}
      onBlur={async () => {
        const f = t.trim(); setT("");
        if (!f) { onCancel(); return; }
        await rentsApi.upsert(pk, { floor: f, unit_no: "", deposit: 0, rent: 0, maintenance: 0, is_vacant: null } as FloorRent);
        onAdded(f);
        refresh();
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setT(""); onCancel(); } }} />
  );
}
