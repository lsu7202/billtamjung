import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { marketApi } from "../../shared/api/endpoints";

/** 주변시세(S03 인라인) — 반경·재조회 · 임대 comps curation(체크=평균 포함) · 층별평균 · 매각 comps. */

interface RentComp {
  floor: string; unit_no: string; contract_area: number | null; exclusive_area: number | null;
  deposit: number; rent: number; maintenance: number; addr: string; building_pk: string;
  per_deposit?: number; per_rent?: number; is_outlier: boolean;
}
interface SaleComp {
  building_pk: string; contract_ym: string; price: number; total_area: number | null;
  addr: string; dist_m: number; per_area?: number; is_outlier: boolean;
}
interface Nearby { rents: RentComp[]; sales: SaleComp[]; radius_m: number; count: number }

const man = (n?: number | null) => (n == null ? "—" : `${Math.round(n / 1e4).toLocaleString()}만`);
const eok = (n?: number | null) => (n == null ? "—" : `${(n / 1e8).toFixed(1)}억`);

export function MarketBlock({ lng, lat }: { lng: number; lat: number }) {
  const [radius, setRadius] = useState(500);
  const [applied, setApplied] = useState(500);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  const q = useQuery<Nearby>({
    queryKey: ["nearby", lng, lat, applied],
    queryFn: () => marketApi.nearby({ center_lat: lat, center_lng: lng, radius_m: applied }) as unknown as Promise<Nearby>,
  });

  const rents = q.data?.rents ?? [];
  const sales = q.data?.sales ?? [];
  const keyOf = (r: RentComp) => `${r.building_pk}-${r.floor}-${r.unit_no}`;

  // 체크 초기값: 일반=체크 / 이상치=해제(스펙 §3.2). unchecked = 기본값에서 반전된 키.
  const toggle = (r: RentComp) => {
    const k = keyOf(r);
    setUnchecked((s) => {
      const n = new Set(s);
      if (r.is_outlier) {
        // 이상치는 기본 해제 → unchecked에 있으면 "수동 포함" 표시로 사용(반전)
        if (n.has(k)) n.delete(k); else n.add(k);
      } else {
        if (n.has(k)) n.delete(k); else n.add(k);
      }
      return n;
    });
  };
  const effChecked = (r: RentComp) => (r.is_outlier ? unchecked.has(keyOf(r)) : !unchecked.has(keyOf(r)));

  // 층별 평균(체크 행만 라이브 — §3.2)
  const floorAvg = useMemo(() => {
    const by: Record<string, RentComp[]> = {};
    rents.filter(effChecked).forEach((r) => {
      if (r.per_rent) (by[r.floor] ??= []).push(r);
    });
    return Object.entries(by).map(([floor, xs]) => ({
      floor,
      perDeposit: Math.round(xs.reduce((a, x) => a + (x.per_deposit ?? 0), 0) / xs.length),
      perRent: Math.round(xs.reduce((a, x) => a + (x.per_rent ?? 0), 0) / xs.length),
      count: xs.length,
    })).sort((a, b) => a.floor.localeCompare(b.floor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rents, unchecked]);

  return (
    <div className="panel">
      <div className="sec-head">주변시세 <small style={{ color: "var(--muted)", fontWeight: 400 }}>임대 · 매각 · 반경 직접 설정</small>
        <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          반경
          <input type="range" min={200} max={1000} step={50} value={radius} onChange={(e) => setRadius(+e.target.value)} />
          <span className="num">{radius}m</span>
          <button className="btn primary" style={{ padding: "5px 12px" }} onClick={() => setApplied(radius)}>재조회</button>
        </span>
      </div>

      <div className="sec-head" style={{ fontSize: 13, borderTop: "1px solid var(--line)" }}>
        주변 임대시세 <small style={{ color: "var(--muted)", fontWeight: 400 }}>체크 해제 = 평균 제외 · 이상치는 기본 해제</small>
      </div>
      <table className="wf">
        <thead><tr><th style={{ width: 30 }}>✓</th><th>층</th><th className="num">계약면적</th><th className="num">보증금</th><th className="num">임대료</th><th className="num">평당임대</th><th>주소</th></tr></thead>
        <tbody>
          {rents.map((r) => (
            <tr key={keyOf(r)} style={r.is_outlier ? { opacity: .6 } : undefined}>
              <td><input type="checkbox" checked={effChecked(r)} onChange={() => toggle(r)} /></td>
              <td>{r.floor}{r.is_outlier && <span className="tag stale" style={{ marginLeft: 5 }}>이상치</span>}</td>
              <td className="num">{r.contract_area ?? "—"}평</td>
              <td className="num">{man(r.deposit)}</td>
              <td className="num">{man(r.rent)}</td>
              <td className="num">{r.per_rent ? man(r.per_rent) : "—"}</td>
              <td style={{ fontSize: 12 }}>{r.addr.replace("서울특별시 ", "").replace("번지", "")}</td>
            </tr>
          ))}
          {rents.length === 0 && <tr><td colSpan={7} style={{ color: "var(--muted)", textAlign: "center", padding: 16 }}>반경 내 임대 데이터가 없습니다 — 층별 임대정보가 축적되면 표시됩니다</td></tr>}
        </tbody>
      </table>

      {floorAvg.length > 0 && (
        <>
          <div className="sec-head" style={{ fontSize: 13 }}>층별 평균 <small style={{ color: "var(--muted)", fontWeight: 400 }}>체크 행 라이브</small></div>
          <table className="wf">
            <thead><tr><th>층</th><th className="num">평당 보증금</th><th className="num">평당 임대료</th><th className="num">건수</th></tr></thead>
            <tbody>
              {floorAvg.map((f) => (
                <tr key={f.floor}>
                  <td>{f.floor}</td>
                  <td className="num" style={{ color: "var(--signal)" }}>{man(f.perDeposit)}</td>
                  <td className="num" style={{ color: "var(--signal)" }}>{man(f.perRent)}</td>
                  <td className="num">{f.count}건</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="sec-head" style={{ fontSize: 13, borderTop: "1px solid var(--line)" }}>
        주변 매각사례 <small style={{ color: "var(--muted)", fontWeight: 400 }}>최근 5년 · 추정</small>
      </div>
      <table className="wf">
        <thead><tr><th>주소</th><th className="num">거리</th><th>거래일</th><th className="num">매각가</th><th className="num">연면적 평단가</th></tr></thead>
        <tbody>
          {sales.slice(0, 10).map((s) => (
            <tr key={`${s.building_pk}-${s.contract_ym}-${s.price}`} style={s.is_outlier ? { opacity: .6 } : undefined}>
              <td style={{ fontSize: 12 }}>{s.addr.replace("서울특별시 ", "").replace("번지", "")}{s.is_outlier && <span className="tag stale" style={{ marginLeft: 5 }}>이상치</span>}</td>
              <td className="num">{s.dist_m}m</td>
              <td className="num">{s.contract_ym.slice(0, 4)}/{s.contract_ym.slice(4)}</td>
              <td className="num">{eok(s.price)}</td>
              <td className="num">{s.per_area ? man(s.per_area) : "—"}</td>
            </tr>
          ))}
          {sales.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 16 }}>반경 내 최근 5년 매각사례가 없습니다 — 반경을 넓혀보세요</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
