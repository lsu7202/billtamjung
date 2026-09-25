import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rentsApi, type FloorRent, type FloorUnit, type FloorGroup, type LedgerRoom, type Tenant } from "../../shared/api/endpoints";
import { Icon } from "../../shared/ui/Icon";

/** 층별 임대정보 — 여덟 열 표를 버리고 층마다 한 줄(2026-08-25).
 *
 *  **두 겹이다**(2026-09-25). 오른쪽 위는 그 층에 딸린 값(용도·바닥면적·전유부는 대장, 공실면적은 팀),
 *  그 아래는 들어온 업체 줄이다. 호실 칸과 임대상태 칩은 없다 — 대장 호실은 등기 단위라 실제 칸과
 *  다르고, 공실은 칸 수가 아니라 넓이다(0180).
 *  칩을 안 쓰는 이유: 칩은 내용만큼만 넓어 「1억」과 「5,000만」의 폭이 달라진다 —
 *  층별을 보는 이유가 층끼리 견주기인데 자릿수가 어긋나면 그게 깨진다.
 *
 *  **금액은 대장에 없다.** 층·전유부·용도·면적까지가 대장이 주는 것이고
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

// 화면 순서(1층부터 위로, 옥탑, 지하)는 서버(floors.py _frank)가 정해 준다(2026-09-17)

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
  /** 있으면 줄 끝에 ＋ — 그 업체를 이 층의 업체 줄로 세운다(팀 줄이 이미 있는 층에서) */
  onAdd?: (t: Tenant) => void;
}) {
  return (
    <div className="fl2-t">
      {list.map((t) => (
        <div className="fl2-ti" key={t.name}>
          {t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.name}</a> : <b>{t.name}</b>}
          {areaTxt(t.area) && <span>{areaTxt(t.area)}</span>}
          {onAdd && <button className="mini" title="업체로 추가" onClick={() => onAdd(t)}><Icon name="plus" size={12} /></button>}
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
  // 층으로 묶인 것은 **서버가** 준다(GET /buildings/{pk}/floors, 2026-09-17). 예전엔 대장 층별개요·업체 원장·
  // 카카오를 여기서 따로 받아 층 이름을 맞추고 상호를 붙이고 층 미상을 골라냈다 — 모델이 같은 넷을 받아
  // 제 식으로 합치니 화면과 다른 답이 났다. 합치기는 한 곳(서버)이고 화면은 그린다.
  // 부모의 ["rents", pk] 와 같은 캐시라 왕복이 늘지 않는다.
  const fq = useQuery({ queryKey: ["rents", pk], queryFn: () => rentsApi.list(pk) });
  const floors: FloorGroup[] = fq.data?.floors ?? [];
  const unknown: Tenant[] = fq.data?.unknown ?? [];

  const teamFloors = new Set(items.map((i) => sfloor(i.floor)).filter((f): f is number => f != null));
  // 팀 줄이 없는 층 — 원장 업체마다 자리표시 줄(pt-), 원장도 없으면 빈 자리표시(pf-). 눌러 값을 넣는 순간 굳는다(adopt)
  const prefillRows: DRow[] = [];
  for (const g of floors) {
    const sf = sfloor(g.floor);
    if (sf != null && teamFloors.has(sf)) continue;
    if (g.ledger.length === 0) {
      prefillRows.push({ isPrefill: true, key: `pf-${g.floor}`,
        r: { floor: g.floor, unit_no: "", deposit: 0, rent: 0, maintenance: 0 } as FloorRent });
    } else {
      // **영업장면적을 계약면적 칸에 넣지 않는다**(2026-09-25). 인허가가 준 넓이는 계약서 면적이
      // 아니다. 미리 채우면 중개인이 그 줄을 한 번만 건드려도 남의 눈금이 팀 값으로 굳는다.
      g.ledger.forEach((t) => prefillRows.push({ isPrefill: true, key: `pt-${g.floor}-${t.name}`,
        r: { floor: g.floor, unit_no: "", tenant_name: t.name,
             deposit: 0, rent: 0, maintenance: 0,
             url: t.url } as FloorUnit }));
    }
  }
  const prefillOf = (floor: string) => prefillRows.filter((d) => sfloor(d.r.floor) === sfloor(floor));

  async function adopt(floor: string): Promise<Map<string, number>> {
    const ids = new Map<string, number>();
    const sf = sfloor(floor);
    if (sf != null && teamFloors.has(sf)) return ids;
    const rows = prefillOf(floor).filter((d) => !d.key.startsWith("pf-"));   // 자리표시(pf-)는 업체 줄이 아니라 안 굳힌다
    await Promise.all(rows.map(async (d) => {
      const res = await rentsApi.upsert(pk, {
        floor: d.r.floor || floor, unit_no: "",
        use: d.r.use ?? undefined, contract_area: d.r.contract_area ?? undefined,
        tenant_name: d.r.tenant_name ?? undefined,
        deposit: 0, rent: 0, maintenance: 0,
      } as FloorRent);
      ids.set(d.key, res.id);
    }));
    return ids;
  }

  /** 원장 업체 하나를 이 층의 업체 줄로 — 팀 줄이 이미 있는 층에서 아래 업체 줄의 ＋ */
  async function addTenantUnit(floor: string, t: Tenant) {
    if (busy) return;
    setBusy(true);
    try {
      await adopt(floor);
      await rentsApi.upsert(pk, { floor, unit_no: "", tenant_name: t.name,
        deposit: 0, rent: 0, maintenance: 0 } as FloorRent);
      refresh();
    } finally { setBusy(false); }
  }

  async function addUnit(floor: string) {
    if (busy) return;
    setBusy(true);
    try {
      await adopt(floor);
      // 새 줄은 이름 없이 선다 — 상호명은 팀이 적는다
      await rentsApi.upsert(pk, { floor, unit_no: "", deposit: 0, rent: 0, maintenance: 0 } as FloorRent);
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
        ...patch,
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
  // 팀 줄은 서버가 층으로 묶어 준 것(업종·전화가 붙어 있다). 순서도 서버 것(1층부터 위로, 옥탑, 지하)
  const allRows: DRow[] = [
    ...floors.flatMap((g) => g.units.map((r) => ({ r, key: (r.id ?? `${r.floor}-${r.unit_no}`).toString() }))),
    ...prefillRows,
  ];
  const groups = new Map<string, DRow[]>();
  allRows.forEach((dr) => { const f = dr.r.floor || "—"; (groups.get(f) ?? groups.set(f, []).get(f)!).push(dr); });
  const sorted: [string, DRow[]][] = floors.map((g) => [g.floor, groups.get(g.floor) ?? []]);

  const areaTxt = (m2?: number | null) =>
    m2 == null ? null : `${(unit === "py" ? m2 / P : m2).toFixed(1)}${unit === "py" ? "평" : "㎡"}`;

  const [pick, setPick] = useState<Pick | null>(null);
  const curUn = !!pick?.un && unknown.length > 0;
  const curFloor = curUn ? null : (pick?.floor && groups.has(pick.floor) ? pick.floor : (sorted[0]?.[0] ?? null));
  const curRows = curFloor ? (groups.get(curFloor) ?? []) : [];
  const curKey = pick?.floor === curFloor ? pick?.key ?? null : null;
  useEffect(() => {
    if (curKey) document.getElementById(`fu-${curKey}`)?.scrollIntoView({ block: "nearest" });
  }, [curKey]);
  // 원장은 아는데 아직 줄이 아닌 업체 — 서버가 층마다 준다. 자리표시로 세운 것은 뺀다
  const ledgerOnly = (floor: string, rows: DRow[]) =>
    (floors.find((g) => g.floor === floor)?.ledger ?? []).filter((t) => !rows.some((d) => sameName(nname(d.r.tenant_name), nname(t.name))));
  const curLedger = curFloor ? ledgerOnly(curFloor, curRows) : [];
  const curGroup = curFloor ? floors.find((g) => g.floor === curFloor) : undefined;
  const floorArea = curGroup?.floor_area ?? null;
  /** 전유부를 펼친 층 — 줄엔 개수만, 누르면 호실마다 전용·공용면적(줄 문법) */
  const [roomsOpen, setRoomsOpen] = useState<string | null>(null);
  const rooms: LedgerRoom[] = curGroup?.rooms ?? [];
  /** 층의 공실면적 — 칸 수가 아니라 넓이다(0180). 비우면 모름으로 돌아간다([[clear-means-null]]) */
  async function saveVacancy(floor: string, v: string) {
    const n = parseFloat(v.replace(/[^\d.]/g, ""));
    await rentsApi.setVacancy(pk, floor, Number.isFinite(n) ? (unit === "py" ? n * P : n) : null);
    refresh();
  }
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
              if (!confirm("팀이 적은 상호명·면적·금액을 전부 지우고 대장 구조로 되돌립니다. 계속할까요?")) return;
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
        {/* 왼쪽 — 훑는 곳. 업체마다 한 줄: 층 · 업체. 금액·상태는 오른쪽에서 본다 */}
        <div className="fl2-l">
          <div className="fl2-lh"><span>층</span><span>업체</span></div>
          {/* 층을 모르는 업체 — 여럿이어도 「—」 한 줄. 누르면 오른쪽에서 업체마다 층을 정한다 */}
          {unknown.length > 0 && (
            <button className={`fl2-i ${curUn ? "on" : ""}`} onClick={() => setPick({ un: true })}>
              <b className="off">—</b>
              <span className="nm">{unknown[0].name}{unknown.length > 1 ? ` 외 ${unknown.length - 1}` : ""}</span>
              <span className="bz">{unknown.length}곳</span>
            </button>
          )}
          {sorted.flatMap(([floor, rows]) => [
            ...rows.map((d, i) => {
              const nm = d.r.tenant_name;
              const on = floor === curFloor && (curKey ? curKey === d.key : i === 0);
              // 업체를 모르는 층은 **대장 용도**를 흐리게 세운다. 「—」만 있으면 훑을 것이 없는데,
              // 대장은 그 층이 오피스텔인지 의원인지를 안다(2026-09-25).
              const uz = floors.find((g) => g.floor === floor)?.uses ?? [];
              return (
                <button key={d.key} className={`fl2-i ${on ? "on" : ""}`} onClick={() => setPick({ floor, key: d.key })}>
                  <b>{floor}</b>
                  <span className="nm">{nm || (uz.length ? <i className="off">{uz.join(" · ")}</i> : <i className="off">—</i>)}</span>
                </button>
              );
            }),
            // 원장은 아는데 줄이 아직 없는 업체(팀 줄이 먼저 있던 층) — 누르면 그 층으로, ＋ 는 오른쪽에
            ...ledgerOnly(floor, rows).map((t) => (
              <button key={`lg-${floor}-${t.name}`} className={`fl2-i ${floor === curFloor && curKey === `lg-${t.name}` ? "on" : ""}`}
                onClick={() => setPick({ floor, key: `lg-${t.name}` })}>
                <b>{floor}</b>
                <span className="nm">{t.name}</span>
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
              <div className="fl2-rh"><b>{curFloor}</b></div>
              {/* 층에 딸린 값 — 줄엔 라벨과 현재 값만, 누르면 펼치거나 고친다(2026-09-25 대표).
                  용도·바닥면적·전유부는 대장, 공실면적은 팀이 적는다. 전유부는 집합건물에만 선다 */}
              <div className="fl2-g fl2-fi">
                {field("용도", <span className="ro">{curGroup?.uses.length ? curGroup.uses.join(" · ") : "—"}</span>)}
                {field("바닥면적", <span className="ro">{areaTxt(floorArea) ?? "—"}</span>)}
                {rooms.length > 0 && field("전유부", (
                  <button className={`fx ${roomsOpen === curFloor ? "on" : ""}`}
                    onClick={() => setRoomsOpen(roomsOpen === curFloor ? null : curFloor)}>
                    {rooms.length}개<i>›</i></button>
                ))}
                {rooms.length > 0 && roomsOpen === curFloor && (
                  <div className="fl2-ex">
                    {rooms.map((r, i) => (
                      <div key={i}><span>전용 {areaTxt(r.excl_area)}</span>
                        {r.common_area != null && <span>공용 {areaTxt(r.common_area)}</span>}</div>
                    ))}
                  </div>
                )}
                {field("공실면적", <Txt v={areaTxt(curGroup?.vacant_area) ?? ""} w={110}
                  onSave={(v) => saveVacancy(curFloor, v)} />)}
              </div>
              <div className="fl2-sec">업체</div>
              {curRows.filter((dr) => !dr.key.startsWith("pf-")).map((dr) => {   // 자리표시는 카드가 아니다
                return (
                <div className={`fl2-u ${curKey === dr.key ? "on" : ""}`} key={dr.key} id={`fu-${dr.key}`}>
                  <div className="fl2-uh">
                    {/* 이름 없는 줄은 「—」 — 「1번째·2번째」 같은 순번은 안 세운다(대표) */}
                    {dr.r.tenant_name ? <b>{dr.r.tenant_name}</b> : <b className="off">—</b>}
                    {/* 팀 줄은 지울 수 있다. 잘못 넣은 층이면 지우고 「—」 줄에서 다시 고른다 — 원장 업체는 없어지지 않는다 */}
                    {dr.r.id != null && (
                      <button className="mini bad" title="이 줄 지움" onClick={() => delUnit(dr)}>
                        <Icon name="trash" size={12} /></button>
                    )}
                  </div>
                  <div className="fl2-g">
                    {field("상호명", <Txt v={dr.r.tenant_name ?? ""} w={220} cls="nm" onSave={(v) => put(dr, { tenant_name: v || null })} />)}
                    {/* 호실 칸을 뺐다(2026-09-25 대표). 대장 호실은 등기 단위라 실제 칸과 다르고,
                        쓰시면서 실제로 호수를 적은 줄이 하나도 없었다(순번이나 빈칸이었다).
                        칸을 부를 이름이 필요하면 상호명에 적는다 — 「302호」든 「안쪽 칸」이든. */}
                    {field("계약면적", <Txt v={areaTxt(dr.r.contract_area) ?? ""} w={110}
                      onSave={(v) => { const n = parseFloat(v.replace(/[^\d.]/g, ""));
                        put(dr, { contract_area: Number.isFinite(n) ? (unit === "py" ? n * P : n) : null }); }} />)}
                    {/* 임대상태 칩을 뺐다(0180). 줄이 있으면 들어온 업체고, 공실은 위의 층 공실면적이다 */}
                    {field("보증금", <Money v={dr.r.deposit} onSave={(w) => put(dr, { deposit: w })} />)}
                    {field("월 임대료", <Money man v={dr.r.rent} onSave={(w) => put(dr, { rent: w })} />)}
                    {field("월 관리비", <Money man v={dr.r.maintenance} onSave={(w) => put(dr, { maintenance: w })} />)}
                  </div>
                </div>
                );
              })}
              <button className="addu" onClick={() => addUnit(curFloor)}>+ 업체 추가하기</button>
              {/* 아직 줄로 안 선 업체(팀 줄이 먼저 있던 층) — ＋ 로 그 업체를 줄로 세운다 */}
              {curLedger.length > 0 && <TenantRows list={curLedger} areaTxt={areaTxt} onAdd={(t) => addTenantUnit(curFloor, t)} />}
            </>
          )}
        </div>
      </div>

      {total && (items.length > 0 || total.vacant_area != null) && (
        <div className="fl-sum">
          {/* 공실은 층마다 적은 넓이의 합이다. 한 층도 안 적었으면 안 쓴다 — 0 으로 메우면 만실로 읽힌다 */}
          <span>합계 · {sorted.length}개 층{total.vacant_area != null ? ` · 공실 ${areaTxt(total.vacant_area)}` : ""}</span>
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
        await rentsApi.upsert(pk, { floor: f, unit_no: "", deposit: 0, rent: 0, maintenance: 0 } as FloorRent);
        onAdded(f);
        refresh();
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setT(""); onCancel(); } }} />
  );
}
