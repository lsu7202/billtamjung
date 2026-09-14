import { useState } from "react";

/** 시계열 블록(공시지가·매각·광고) — 표/그래프 토글 + SVG 라인차트 + 상승률.
 * 계열색 = 목업 통일: 공시지가 #1E5AF0 · 매각 #0F1A2E · 광고 #6E56E8(점선). specs S02 §3.7.
 */
export interface SeriesPoint { x: string; y: number }

export function SeriesBlock({
  title, points, color, dashed, fmt, unitLabel, extra,
}: {
  title: string;
  points: SeriesPoint[];
  color: string;
  dashed?: boolean;
  fmt: (v: number) => string;
  unitLabel: string;
  extra?: React.ReactNode;      // 우측 액션(광고 입력 등)
}) {
  const [mode, setMode] = useState<"t" | "c">("t");
  if (points.length === 0) {
    return (
      <div className="panel">
        <div className="sec-head">{title} <span>{extra}</span></div>
        <p style={{ color: "var(--muted)", fontSize: 13, padding: "0 14px 14px" }}>데이터가 없습니다</p>
      </div>
    );
  }

  const first = points[0].y, last = points[points.length - 1].y;
  const ratePct = first ? ((last - first) / first) * 100 : 0;
  const rateColor = ratePct >= 0 ? "var(--up)" : "var(--down)";

  // SVG 차트
  const W = 860, H = 220, L = 70, R = 30, T = 30, B = 36;
  const ys = points.map((p) => p.y);
  const ymin = Math.min(...ys), ymax = Math.max(...ys), span = ymax - ymin || ymax || 1;
  const X = (i: number) => points.length === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (points.length - 1);
  const Y = (v: number) => T + (H - T - B) * (1 - (v - ymin) / span);
  const path = points.map((p, i) => `${X(i)},${Y(p.y)}`).join(" ");

  return (
    <div className="panel">
      <div className="sec-head">
        {title}
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="num" style={{ fontSize: 13, fontWeight: 700, color: rateColor }}>
            {ratePct >= 0 ? "+" : ""}{ratePct.toFixed(1)}%
          </span>
          {extra}
          <span style={{ display: "flex" }}>
            <button className={`btn ${mode === "t" ? "primary" : ""}`} style={{ padding: "4px 10px", fontSize: 12, borderRadius: "6px 0 0 6px" }} onClick={() => setMode("t")}>표</button>
            <button className={`btn ${mode === "c" ? "primary" : ""}`} style={{ padding: "4px 10px", fontSize: 12, borderRadius: "0 6px 6px 0", borderLeft: 0 }} onClick={() => setMode("c")}>그래프</button>
          </span>
        </span>
      </div>
      {mode === "t" ? (
        <table className="wf">
          <thead><tr><th>시점</th><th className="num">{unitLabel}</th></tr></thead>
          <tbody>
            {[...points].reverse().slice(0, 12).map((p) => (
              <tr key={p.x}><td>{p.x}</td><td className="num">{fmt(p.y)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: "var(--surface-2)", display: "block" }}>
          <line x1={L} y1={T - 6} x2={L} y2={H - B} stroke="var(--line-2)" />
          <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="var(--line-2)" />
          <text x={L - 8} y={T + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="monospace">{fmt(ymax)}</text>
          <text x={L - 8} y={H - B + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="monospace">{fmt(ymin)}</text>
          <polyline fill="none" stroke={color} strokeWidth={2.5} strokeDasharray={dashed ? "5 4" : undefined} points={path} />
          {points.map((p, i) => (
            <g key={p.x}>
              <circle cx={X(i)} cy={Y(p.y)} r={3.5} fill={color} stroke="#fff" strokeWidth={1.5}>
                <title>{p.x} · {fmt(p.y)}</title>
              </circle>
              {(i === 0 || i === points.length - 1 || points.length <= 8 || i % Math.ceil(points.length / 8) === 0) && (
                <text x={X(i)} y={H - B + 18} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="monospace">{p.x}</text>
              )}
            </g>
          ))}
          <text x={X(points.length - 1)} y={Y(last) - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--ink)" fontFamily="monospace">{fmt(last)}</text>
        </svg>
      )}
    </div>
  );
}
