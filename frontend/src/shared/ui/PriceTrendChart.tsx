import { useMemo, useRef, useState } from "react";

/** 가격추이 차트 — 실거래·총공시지가·광고가 3종 시계열을 한 축(총액)에 겹침.
 *  S01 지도 요약카드(개요·겹침)와 S02 상세가 공유(색·툴팁 언어 동일, 명세 S01 §3.6).
 *  단위 통일: 공시지가(원/㎡)는 총공시지가(=개별공시지가×대지면적)로 환산해 억원 축에 표기.
 *  색 = 공통 토큰: 실거래 --c-real(잉크) · 공시지가 --c-gongsi(시그널블루) · 광고가 --c-ad(퍼플·점선). */

export interface TrendPoint { year: number; value: number } // value = 총액(원)
export interface TrendSeries { real: TrendPoint[]; gongsi: TrendPoint[]; ad: TrendPoint[] }

const W = 320, H = 168, L = 20, R = 12, T = 12, B = 22;
const PW = W - L - R, PH = H - T - B;

const eok = (n: number) =>
  n >= 1e8 ? `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1)}억` : `${Math.round(n / 1e4).toLocaleString()}만`;

const SERIES: { key: keyof TrendSeries; label: string; color: string; dash?: string }[] = [
  { key: "real", label: "실거래", color: "var(--c-real)" },
  { key: "gongsi", label: "공시지가", color: "var(--c-gongsi)" },
  { key: "ad", label: "광고가", color: "var(--c-ad)", dash: "4 3" },
];

export function PriceTrendChart({ series }: { series: TrendSeries }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverYear, setHoverYear] = useState<number | null>(null);

  const { years, minY, maxY, maxV, has } = useMemo(() => {
    const all = [...series.real, ...series.gongsi, ...series.ad];
    const ys = [...new Set(all.map((p) => p.year))].sort((a, b) => a - b);
    const vs = all.map((p) => p.value).filter((v) => v > 0);
    return {
      years: ys,
      minY: ys[0] ?? 0, maxY: ys[ys.length - 1] ?? 0,
      maxV: vs.length ? Math.max(...vs) : 0,
      has: all.length > 0,
    };
  }, [series]);

  if (!has) return <div style={{ color: "var(--muted)", fontSize: 12, padding: "20px 0", textAlign: "center" }}>가격 시계열 데이터가 없습니다</div>;

  const x = (yr: number) => (maxY === minY ? L + PW / 2 : L + ((yr - minY) / (maxY - minY)) * PW);
  const y = (v: number) => (maxV === 0 ? T + PH : T + (1 - v / maxV) * PH);

  const nearestYear = (clientX: number): number | null => {
    const svg = svgRef.current;
    if (!svg || !years.length) return null;
    const rect = svg.getBoundingClientRect();
    const xv = ((clientX - rect.left) / rect.width) * W;
    return years.reduce((best, yr) => (Math.abs(x(yr) - xv) < Math.abs(x(best) - xv) ? yr : best), years[0]);
  };

  const at = (arr: TrendPoint[], yr: number) => arr.find((p) => p.year === yr);

  return (
    <div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", cursor: "crosshair" }}
        onMouseMove={(e) => setHoverYear(nearestYear(e.clientX))}
        onMouseLeave={() => setHoverYear(null)}>
        {/* 기준선 */}
        <line x1={L} y1={T + PH} x2={W - R} y2={T + PH} stroke="var(--line)" strokeWidth={1} />
        {/* 호버 가이드 */}
        {hoverYear != null && (
          <line x1={x(hoverYear)} y1={T} x2={x(hoverYear)} y2={T + PH} stroke="var(--line-2)" strokeWidth={1} strokeDasharray="2 2" />
        )}
        {/* 계열 */}
        {SERIES.map(({ key, color, dash }) => {
          const pts = [...series[key]].sort((a, b) => a.year - b.year).filter((p) => p.value > 0);
          if (!pts.length) return null;
          const d = pts.map((p) => `${x(p.year)},${y(p.value)}`).join(" ");
          return (
            <g key={key}>
              <polyline points={d} fill="none" stroke={color} strokeWidth={1.75} strokeDasharray={dash}
                strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p) => (
                <circle key={p.year} cx={x(p.year)} cy={y(p.value)} r={hoverYear === p.year ? 3.5 : 2} fill={color} />
              ))}
            </g>
          );
        })}
        {/* x축 라벨(양끝) */}
        {years.length > 0 && (
          <>
            <text x={L} y={H - 6} fontSize={9} fill="var(--muted)">{minY}</text>
            <text x={W - R} y={H - 6} fontSize={9} fill="var(--muted)" textAnchor="end">{maxY}</text>
          </>
        )}
      </svg>

      {/* 범례 + 호버 툴팁 값 */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, marginTop: 4 }}>
        {SERIES.map(({ key, label, color, dash }) => {
          const hv = hoverYear != null ? at(series[key], hoverYear) : undefined;
          return (
            <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 14, height: 0, borderTop: `2px ${dash ? "dashed" : "solid"} ${color}` }} />
              <span style={{ color: "var(--ink-2)" }}>{label}</span>
              <span className="num" style={{ color, fontWeight: 700 }}>{hv ? eok(hv.value) : "—"}</span>
            </span>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
        {hoverYear != null ? `${hoverYear}년 기준` : "그래프에 마우스를 올리면 연도별 값이 표시됩니다"}
        <span style={{ marginLeft: 6 }}>· 공시지가=총공시지가(개별공시지가×대지면적)</span>
      </div>
    </div>
  );
}

/** building.get(gongsi_series·sales_history) + adPrices + land_area → 3계열 조립. */
export function buildTrendSeries(
  building: Record<string, unknown> | undefined,
  adPrices: { observed_on: string; price: number | null }[] | undefined,
): TrendSeries {
  const landArea = Number(building?.land_area) || 0;

  // 실거래: sales_history [{ym:"YYYYMM", price}] → 연도별 최신(마지막) 총액
  const realRaw = (building?.sales_history as { ym?: string; price?: number }[] | undefined) ?? [];
  const realByYear = new Map<number, number>();
  for (const s of realRaw) {
    const yr = Number(String(s.ym ?? "").slice(0, 4));
    if (yr && s.price) realByYear.set(yr, s.price); // ORDER BY ym → 최신값이 덮어씀
  }

  // 공시지가: gongsi_series [[year, 원/㎡]] × 대지면적 = 총공시지가
  const gongsiRaw = (building?.gongsi_series as [number, number][] | undefined) ?? [];
  const gongsi: TrendPoint[] = landArea > 0
    ? gongsiRaw.filter(([, p]) => p > 0).map(([yr, p]) => ({ year: Number(yr), value: p * landArea }))
    : [];

  // 광고가: adPrices [{observed_on, price}] → 연도별 최신 총액
  const adByYear = new Map<number, number>();
  for (const a of adPrices ?? []) {
    const yr = Number(String(a.observed_on ?? "").slice(0, 4));
    if (yr && a.price) adByYear.set(yr, a.price);
  }

  const toPoints = (m: Map<number, number>): TrendPoint[] =>
    [...m.entries()].map(([year, value]) => ({ year, value })).sort((a, b) => a.year - b.year);

  return { real: toPoints(realByYear), gongsi, ad: toPoints(adByYear) };
}
