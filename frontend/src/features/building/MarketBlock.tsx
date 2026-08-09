import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { marketApi, rentsApi } from "../../shared/api/endpoints";
import { MarketArea, CompPoint, CompFilter, COMP_FILTER_DEFAULT, circleToGeoJSON, fmtArea, fmtDist, openDetail } from "../../shared/map/geo";
import { parseWon } from "./KV";
import { won, wonShort } from "../../shared/format";
import { Icon } from "../../shared/ui/Icon";

/** 주변시세(S03 인라인) — 반경·재조회 · 임대 comps를 본매물 층별로 그룹(접고펴기) · 매각 comps(매물별 최근·요약). */

interface RentComp {
  floor: string; unit_no: string; contract_area: number | null;
  deposit: number; rent: number; maintenance: number; addr: string; building_pk: string;
  lng: number; lat: number; per_deposit?: number; per_rent?: number; is_outlier: boolean; is_estimate?: boolean;
}
interface SaleComp {
  building_pk: string; contract_ym: string; price: number; total_area: number | null;
  addr: string; lng: number; lat: number; dist_m: number; per_area?: number; is_outlier: boolean;
}
interface Nearby { rents: RentComp[]; sales: SaleComp[]; radius_m: number; count: number }

const P = 3.305785;   // ㎡→평
const man = won;        // 공용(억+만). shared/format.ts
const eok = wonShort;   // 컴팩트(X.X억)
const NO_RENTS: RentComp[] = [];   // 안정 빈 배열 — data undefined 시 매 렌더 새 배열 방지(무한 setState 루프 차단)
const NO_SALES: SaleComp[] = [];
const signedFloor = (fl: string): number => {   // 서명층수: 지상 양수·지하 음수(층별임대 표와 동일 정렬)
  const n = parseInt(fl.replace(/\D/g, ""), 10);
  if (/지하|^\s*B/i.test(fl)) return isNaN(n) ? -1 : -n;
  return isNaN(n) ? -999 : n;
};
const shortAddr = (a: string) => a.replace("서울특별시 ", "").replace("번지", "");

/** 억 단위로 치는 금액 칸 — 매매가 입력과 같은 파서(15억·1500000000 둘 다 받는다). 빈칸=제한 없음. */
function EokInput({ v, ph, onSave }: { v: number | null; ph: string; onSave: (won: number | null) => void }) {
  const [t, setT] = useState("");
  const [on, setOn] = useState(false);
  const disp = v == null ? "" : `${+(v / 1e8).toFixed(2)}억`;
  if (!on) return (
    <span style={{ cursor: "pointer", minWidth: 52, display: "inline-block", textAlign: "right",
      color: v == null ? "var(--muted)" : "var(--ink)", borderBottom: "1px dashed var(--line)" }}
      onClick={() => { setT(disp); setOn(true); }}>{disp || ph}</span>
  );
  return (
    <input className="input" autoFocus value={t} placeholder={ph}
      style={{ width: 72, padding: "3px 6px", fontSize: 12, textAlign: "right" }}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => { setOn(false); onSave(t.trim() ? parseWon(t) : null); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setOn(false); }} />
  );
}

export function MarketBlock({ pk, lng, lat, area, comp, onComp, onComps }: {
  pk: string; lng: number; lat: number; area: MarketArea;
  comp: CompFilter; onComp: (c: CompFilter) => void; onComps?: (pts: CompPoint[]) => void;
}) {
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [openFloors, setOpenFloors] = useState<Set<string>>(new Set());   // 층별 접고펴기
  const [salesOpen, setSalesOpen] = useState(false);   // 실거래 접고펴기(기본 10개 요약)
  const [rentFloorsOpen, setRentFloorsOpen] = useState(false);   // 임대 층 목록 5개 초과 더보기

  // 본매물 층 목록 = 층별임대(팀) + 대장 프리필 — 이 층들로 주변 임대시세 그룹·후보 조회(§3.2)
  const subjRents = useQuery({ queryKey: ["rents", pk], queryFn: () => rentsApi.list(pk) });
  const subjOutline = useQuery({ queryKey: ["floor-outline", pk], queryFn: () => rentsApi.outline(pk) });
  const subjectFloors = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const it of subjRents.data?.items ?? []) if (it.floor && !seen.has(it.floor)) { seen.add(it.floor); out.push(it.floor); }
    for (const o of subjOutline.data ?? []) if (o.floor && !seen.has(o.floor)) { seen.add(o.floor); out.push(o.floor); }
    out.sort((a, b) => signedFloor(b) - signedFloor(a));   // 지상 높은층 → 낮은층 → 지하(층별임대와 동일)
    return out;
  }, [subjRents.data, subjOutline.data]);

  const q = useQuery<Nearby>({
    queryKey: ["nearby", lng, lat, pk, area, subjectFloors, comp],
    queryFn: () => marketApi.nearby({
      center_lat: lat, center_lng: lng, building_pk: pk, radius_m: 0,
      polygon: area.kind === "circle" ? circleToGeoJSON(area.center ?? { lng, lat }, area.radius_m) : area.geojson,
      floors: subjectFloors,
      sale_years: comp.years, sale_price_min: comp.price_min, sale_price_max: comp.price_max,
    }) as unknown as Promise<Nearby>,
  });

  const rents = q.data?.rents ?? NO_RENTS;
  const sales = q.data?.sales ?? NO_SALES;
  const keyOf = (r: RentComp) => `${r.building_pk}-${r.floor}-${r.unit_no}`;

  // 지도용 포인트: 임대 매물 + 실거래 매물(같은 건물이면 실거래 우선). 부모(PhotoPanel)로 전달해 색 구분 표시.
  const points = useMemo<CompPoint[]>(() => {
    const m = new Map<string, CompPoint>();
    rents.forEach((r) => { if (r.lng != null) m.set(r.building_pk, { building_pk: r.building_pk, lng: r.lng, lat: r.lat, kind: "rent" }); });
    sales.forEach((s) => { if (s.lng != null) m.set(s.building_pk, { building_pk: s.building_pk, lng: s.lng, lat: s.lat, kind: "sale" }); });
    return [...m.values()];
  }, [rents, sales]);
  useEffect(() => { onComps?.(points); }, [points, onComps]);

  // 체크 초기값: 일반=체크 / 이상치=해제(스펙 §3.2). unchecked = 기본값에서 반전된 키.
  const toggle = (r: RentComp) => {
    const k = keyOf(r);
    setUnchecked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };
  const effChecked = (r: RentComp) => (r.is_outlier ? unchecked.has(keyOf(r)) : !unchecked.has(keyOf(r)));
  const toggleFloor = (f: string) => setOpenFloors((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; });

  const compsByFloor = useMemo(() => {
    const by: Record<string, RentComp[]> = {};
    rents.forEach((r) => (by[r.floor] ??= []).push(r));
    return by;
  }, [rents]);
  const floorSummary = (floor: string) => {
    const cs = (compsByFloor[floor] ?? []).filter(effChecked).filter((c) => c.per_rent);
    if (!cs.length) return null;
    return {
      perDeposit: Math.round(cs.reduce((a, c) => a + (c.per_deposit ?? 0), 0) / cs.length),
      perRent: Math.round(cs.reduce((a, c) => a + (c.per_rent ?? 0), 0) / cs.length),
    };
  };

  const areaBadge = (
    <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--signal)", fontWeight: 600 }}>
      {area.kind === "circle" ? `반경 ${fmtDist(area.radius_m)}` : `상권 ${fmtArea(area.area_m2)}`}
    </span>
  );
  const shownFloors = rentFloorsOpen ? subjectFloors : subjectFloors.slice(0, 5);   // 층 많으면 5개까지만
  return (
    <>
    {/* 주변 임대시세 — 별도 카드 */}
    <div className="panel">
      <div className="sec-head">주변 임대시세 <small style={{ color: "var(--muted)", fontWeight: 400 }}>본매물 층별 · 펼치면 주변 임대 comps · 주소 클릭 = 상세로 이동해 입력</small>
        {areaBadge}
      </div>
      <table className="wf">
        <thead><tr><th>층</th><th className="num">평당 보증금</th><th className="num">평당 임대료</th></tr></thead>
        <tbody>
          {subjectFloors.length === 0 && <tr><td colSpan={3} style={{ color: "var(--muted)", textAlign: "center", padding: 16 }}>본매물 층 정보가 없습니다 — 층별 임대정보를 먼저 입력하세요</td></tr>}
          {shownFloors.map((floor) => {
            const comps = compsByFloor[floor] ?? [];
            const sum = floorSummary(floor);
            const open = openFloors.has(floor);
            const has = comps.length > 0;
            return (
              <Fragment key={floor}>
                <tr style={has ? { cursor: "pointer" } : undefined} onClick={has ? () => toggleFloor(floor) : undefined}>
                  <td>{has ? <span style={{ color: "var(--muted)", marginRight: 4 }}>{open ? "▾" : "▸"}</span> : null}{floor}</td>
                  <td className="num" style={{ color: "var(--signal)" }}>{sum ? man(sum.perDeposit) : ""}</td>
                  <td className="num" style={{ color: "var(--signal)" }}>{sum ? man(sum.perRent) : ""}</td>
                </tr>
                {open && comps.map((c) => (
                  <tr key={keyOf(c)} style={{ background: "var(--surface-2)", ...(c.is_outlier ? { opacity: .6 } : {}) }}>
                    <td colSpan={3} style={{ padding: "4px 8px 4px 22px", fontSize: 12 }}>
                      <input type="checkbox" checked={effChecked(c)} onChange={() => toggle(c)} title="체크=층 평균 포함" style={{ marginRight: 8, verticalAlign: "middle" }} />
                      <a onClick={() => openDetail(c.building_pk)} style={{ cursor: "pointer", color: "var(--signal)" }} title="클릭 = 이 매물 상세로 이동해 임대정보 입력">{shortAddr(c.addr)}</a>
                      {c.is_outlier && <span className="tag stale" style={{ marginLeft: 5 }}>이상치</span>}
                      {c.is_estimate && <span className="tag" style={{ marginLeft: 5, color: "var(--muted)" }}>추정</span>}
                      <span style={{ color: "var(--muted)" }}>{c.contract_area != null ? ` · ${(c.contract_area / P).toFixed(0)}평` : ""} · 보 {man(c.deposit) || "—"} · 임 {man(c.rent) || "—"} · 평당 {man(c.per_rent) || "—"}</span>
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {subjectFloors.length > 5 && (
        <div style={{ padding: "0 14px 12px" }}>
          <button className="btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => setRentFloorsOpen((v) => !v)}>
            {rentFloorsOpen ? "접기" : `더보기 (${subjectFloors.length - 5})`}
          </button>
        </div>
      )}
    </div>

    {/* 주변 실거래 — 별도 카드 */}
    <div className="panel">
      <div className="sec-head">주변 실거래 <small style={{ color: "var(--muted)", fontWeight: 400 }}>매물별 최근 거래 · 영역 내 {sales.length}건</small>
        {areaBadge}
      </div>
      {/* 사례 조건 — 기간이 5년으로 박혀 있고 가격대 필터가 없어서
          1,500억 매물의 사례에 3억짜리가 섞였다. 리포트도 같은 값을 쓴다. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "0 2px 8px", fontSize: 12, color: "var(--muted)" }}>
        <span>기간</span>
        <select className="input" style={{ width: "auto", minWidth: 0, padding: "4px 8px", fontSize: 12 }}
          value={comp.years} onChange={(e) => onComp({ ...comp, years: Number(e.target.value) })}>
          {[1, 2, 3, 5, 10].map((y) => <option key={y} value={y}>최근 {y}년</option>)}
        </select>
        <span style={{ marginLeft: 6 }}>가격대</span>
        <EokInput v={comp.price_min} ph="하한" onSave={(w) => onComp({ ...comp, price_min: w })} />
        <span>~</span>
        <EokInput v={comp.price_max} ph="상한" onSave={(w) => onComp({ ...comp, price_max: w })} />
        {(comp.years !== 5 || comp.price_min != null || comp.price_max != null) && (
          <button className="btn" style={{ padding: "2px 8px", fontSize: 11 }}
            onClick={() => onComp(COMP_FILTER_DEFAULT)}>조건 초기화</button>
        )}
      </div>
      <table className="wf">
        <thead><tr><th>주소</th><th className="num">거리</th><th>거래일</th><th className="num">실거래가</th><th className="num">연면적 평단가</th></tr></thead>
        <tbody>
          {(salesOpen ? sales : sales.slice(0, 10)).map((s) => (
            <tr key={`${s.building_pk}-${s.contract_ym}-${s.price}`} style={s.is_outlier ? { opacity: .6 } : undefined}>
              <td style={{ fontSize: 12 }}>
                <a onClick={() => openDetail(s.building_pk)} style={{ cursor: "pointer", color: "var(--signal)" }} title="클릭 = 이 매물 상세로 이동(새 탭)">{shortAddr(s.addr)}<Icon name="external" size={11} style={{ verticalAlign: "-1px", marginLeft: 3, opacity: .6 }} /></a>
                {s.is_outlier && <span className="tag stale" style={{ marginLeft: 5 }}>이상치</span>}
              </td>
              <td className="num">{s.dist_m}m</td>
              <td className="num">{s.contract_ym.slice(0, 4)}/{s.contract_ym.slice(4)}</td>
              <td className="num">{eok(s.price)}</td>
              <td className="num">{man(s.per_area)}</td>
            </tr>
          ))}
          {sales.length > 10 && (
            <tr><td colSpan={5} style={{ textAlign: "center", padding: 6 }}>
              <button className="btn" style={{ padding: "3px 12px", fontSize: 12 }} onClick={() => setSalesOpen((v) => !v)}>
                {salesOpen ? "접기" : `더보기 (${sales.length - 10})`}
              </button>
            </td></tr>
          )}
          {sales.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 16 }}>조건에 맞는 실거래가 없습니다 — 영역을 넓히거나 기간·가격대를 풀어보세요</td></tr>}
        </tbody>
      </table>
    </div>
    </>
  );
}
