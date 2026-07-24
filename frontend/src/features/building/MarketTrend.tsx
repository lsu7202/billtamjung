import { useState } from "react";

/** 시세 추이 통합 카드 — 공시지가(총)·실거래가·광고가를 한 그래프에 겹쳐 비교(전부 원 단위).
 * 표 모드는 계열별 최신 3개만, 더보기로 펼침. specs S02 §3.7(통합).
 */
export interface Series { key: string; name: string; color: string; dashed?: boolean; pts: { x: string; y: number }[] }

const toTime = (x: string): number => {   // "2026" | "2026/07" | "2026-07-21" → 분수 연도
  const m = x.match(/(\d{4})\D?(\d{2})?\D?(\d{2})?/);
  if (!m) return 0;
  return +m[1] + (m[2] ? (+m[2] - 1) / 12 : 0) + (m[3] ? +m[3] / 365 : 0);
};

export function MarketTrend({ series, extra, fmt }: { series: Series[]; extra?: React.ReactNode; fmt: (n: number) => string }) {
  const [mode, setMode] = useState<"c" | "t">("c");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const live = series.filter((s) => s.pts.length > 0);

  if (live.length === 0) {
    return (
      <div className="panel">
        <div className="sec-head">시세 추이 <span style={{ marginLeft: "auto" }}>{extra}</span></div>
        <p style={{ color: "var(--muted)", fontSize: 13, padding: "0 14px 14px" }}>데이터가 없습니다</p>
      </div>
    );
  }

  // 공통 축(시간·값)
  const W = 860, H = 240, L = 74, R = 24, T = 26, B = 34;
  const times = live.flatMap((s) => s.pts.map((p) => toTime(p.x)));
  const tmin = Math.min(...times), tmax = Math.max(...times), tspan = tmax - tmin || 1;
  const ys = live.flatMap((s) => s.pts.map((p) => p.y));
  const ymin = Math.min(...ys), ymax = Math.max(...ys), yspan = ymax - ymin || ymax || 1;
  const X = (x: string) => L + ((toTime(x) - tmin) / tspan) * (W - L - R);
  const Y = (v: number) => T + (H - T - B) * (1 - (v - ymin) / yspan);

  return (
    <div className="panel">
      <div className="sec-head">시세 추이 <small style={{ color: "var(--muted)", fontWeight: 400 }}>공시지가(총)·실거래·광고 · 원 단위 비교</small>
        <span style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          {extra}
          <span style={{ display: "flex" }}>
            <button className={`btn ${mode === "c" ? "primary" : ""}`} style={{ padding: "4px 10px", fontSize: 12, borderRadius: "6px 0 0 6px" }} onClick={() => setMode("c")}>그래프</button>
            <button className={`btn ${mode === "t" ? "primary" : ""}`} style={{ padding: "4px 10px", fontSize: 12, borderRadius: "0 6px 6px 0", borderLeft: 0 }} onClick={() => setMode("t")}>표</button>
          </span>
        </span>
      </div>

      {/* 범례 */}
      <div style={{ display: "flex", gap: 16, padding: "0 14px 8px", fontSize: 12, flexWrap: "wrap" }}>
        {live.map((s) => (
          <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 600 }}>
            <span style={{ width: 14, height: 0, borderTop: `3px ${s.dashed ? "dashed" : "solid"} ${s.color}`, display: "inline-block" }} />{s.name}
          </span>
        ))}
      </div>

      {mode === "c" ? (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: "var(--surface-2)", display: "block" }}>
          <line x1={L} y1={T - 6} x2={L} y2={H - B} stroke="var(--line-2)" />
          <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="var(--line-2)" />
          <text x={L - 8} y={T + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="monospace">{fmt(ymax)}</text>
          <text x={L - 8} y={H - B + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="monospace">{fmt(ymin)}</text>
          {[tmin, (tmin + tmax) / 2, tmax].map((t) => (
            <text key={t} x={L + ((t - tmin) / tspan) * (W - L - R)} y={H - B + 18} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="monospace">{Math.round(t)}</text>
          ))}
          {live.map((s) => (
            <g key={s.key}>
              {s.pts.length > 1 && <polyline fill="none" stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dashed ? "5 4" : undefined}
                points={s.pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")} />}
              {s.pts.map((p) => (
                <circle key={p.x} cx={X(p.x)} cy={Y(p.y)} r={3.5} fill={s.color} stroke="#fff" strokeWidth={1.5}>
                  <title>{s.name} · {p.x} · {fmt(p.y)}</title>
                </circle>
              ))}
            </g>
          ))}
        </svg>
      ) : (
        <div style={{ display: "grid", gap: 14, padding: "0 14px 14px" }}>
          {live.map((s) => {
            const rows = [...s.pts].reverse();
            const shown = open[s.key] ? rows : rows.slice(0, 3);
            return (
              <div key={s.key}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: "inline-block" }} />{s.name}
                </div>
                <table className="wf">
                  <tbody>
                    {shown.map((p) => <tr key={p.x}><td>{p.x}</td><td className="num">{fmt(p.y)}</td></tr>)}
                  </tbody>
                </table>
                {rows.length > 3 && (
                  <button className="btn" style={{ marginTop: 6, padding: "3px 10px", fontSize: 12 }}
                    onClick={() => setOpen((o) => ({ ...o, [s.key]: !o[s.key] }))}>
                    {open[s.key] ? "접기" : `더보기 (${rows.length - 3})`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
