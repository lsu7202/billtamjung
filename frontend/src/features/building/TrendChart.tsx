import { useId, useState, useRef, useLayoutEffect } from "react";

/** 재사용 시계열 라인차트 — 영역 그라디언트·부드러운 라인·미세 그리드·끝점 강조·호버 가이드.
 * 차트 라이브러리 없이(ponytail) SVG 하나. 공시지가·실거래·리포트 공용.
 */
export interface TrendPoint { x: string; y: number; sub?: string }

const toTime = (x: string): number => {
  const m = x.match(/(\d{4})\D?(\d{1,2})?\D?(\d{1,2})?/);
  return m ? +m[1] + (m[2] ? (+m[2] - 1) / 12 : 0) + (m[3] ? +m[3] / 365 : 0) : 0;
};

export function TrendChart({ points, color = "var(--signal)", dashed, fmt, height = 200, timeAxis = true, maxW }: {
  points: TrendPoint[];
  color?: string;
  dashed?: boolean;
  fmt: (v: number) => string;
  height?: number;
  timeAxis?: boolean;   // x를 연도척도로(공시지가 등). false면 균등간격.
  maxW?: number;        // 최대 폭(px) — 넓은 컬럼에서 납작하게 늘어나는 것 방지(직관성). 미지정=풀폭.
}) {
  const gid = useId();
  const [hi, setHi] = useState<number | null>(null);
  // 실제 렌더 폭을 측정해 viewBox와 1:1 매핑 → height가 정확한 px가 됨(폭에 비례 확대 방지).
  const ref = useRef<SVGSVGElement>(null);
  const [cw, setCw] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth || 600));
    ro.observe(el); setCw(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);
  if (points.length === 0)
    return <div style={{ padding: "24px 14px", color: "var(--muted)", fontSize: 13, textAlign: "center" }}>데이터가 없습니다</div>;

  const W = cw, H = height, L = 8, R = 12, T = 16, B = 22;
  const ys = points.map((p) => p.y);
  const ymin = Math.min(...ys), ymax = Math.max(...ys), span = ymax - ymin || ymax || 1;
  const pad = span * 0.12;
  const lo = ymin - pad, hi2 = ymax + pad, vspan = hi2 - lo || 1;
  const times = points.map((p) => toTime(p.x));
  const tmin = Math.min(...times), tmax = Math.max(...times), tspan = tmax - tmin || 1;
  const X = (i: number) => points.length === 1 ? (L + W - R) / 2
    : timeAxis ? L + ((times[i] - tmin) / tspan) * (W - L - R)
    : L + (i * (W - L - R)) / (points.length - 1);
  const Y = (v: number) => T + (H - T - B) * (1 - (v - lo) / vspan);

  const line = points.map((p, i) => `${X(i)},${Y(p.y)}`).join(" ");
  const area = `${X(0)},${H - B} ${line} ${X(points.length - 1)},${H - B}`;
  const last = points.length - 1;
  const grid = [0.5, 1].map((f) => lo + vspan * f);   // 미세 가로선 2개(중간·상단)

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block", height: H, maxWidth: maxW, overflow: "visible" }}
      onMouseLeave={() => setHi(null)}
      onMouseMove={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * W;
        let best = 0, bd = Infinity;
        points.forEach((_, i) => { const d = Math.abs(X(i) - px); if (d < bd) { bd = d; best = i; } });
        setHi(best);
      }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.20} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {grid.map((g, i) => (
        <line key={i} x1={L} y1={Y(g)} x2={W - R} y2={Y(g)} stroke="var(--line)" strokeWidth={1} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
      ))}
      {points.length > 1 && <polygon points={area} fill={`url(#${gid})`} stroke="none" style={{ animation: "bt-fade .9s ease .25s both" }} />}
      {points.length > 1 && (
        <polyline points={line} fill="none" stroke={color} strokeWidth={2.25} strokeDasharray={dashed ? "6 4" : undefined}
          pathLength={dashed ? undefined : 1} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
          style={dashed ? undefined : { strokeDasharray: 1, strokeDashoffset: 1, animation: "bt-line-draw 1.1s cubic-bezier(.4,0,.2,1) .1s forwards" }} />
      )}
      {/* x 라벨: 시작·중간·끝만 */}
      {[0, Math.floor(last / 2), last].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
        <text key={i} x={X(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}
          fontSize="10.5" fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>{points[i].x}</text>
      ))}
      {/* 호버 가이드 */}
      {hi != null && (
        <line x1={X(hi)} y1={T - 6} x2={X(hi)} y2={H - B} stroke="var(--line-2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      )}
      {points.map((p, i) => {
        const on = hi === i, end = i === last;
        return (on || end) ? (
          <circle key={i} cx={X(i)} cy={Y(p.y)} r={on ? 4.5 : 3.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
        ) : null;
      })}
      {/* 끝점 값 라벨(호버 없을 때) */}
      {hi == null && points.length > 0 && (
        <text x={X(last)} y={Y(points[last].y) - 10} textAnchor="end" fontSize="12" fontWeight={700} fill="var(--ink)"
          style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(points[last].y)}</text>
      )}
      {/* 호버 툴팁 */}
      {hi != null && (() => {
        const p = points[hi], cx = X(hi), cy = Y(p.y);
        const label = `${p.x} · ${fmt(p.y)}`;
        const w = Math.max(96, label.length * 6.6 + (p.sub ? 0 : 0)), h = p.sub ? 40 : 26;
        const bx = Math.min(Math.max(cx - w / 2, 0), W - w), by = cy - h - 10 < 0 ? cy + 10 : cy - h - 10;
        return (
          <g pointerEvents="none">
            <rect x={bx} y={by} width={w} height={h} rx={6} fill="var(--ink)" opacity={0.94} />
            <text x={bx + w / 2} y={by + (p.sub ? 16 : 17)} textAnchor="middle" fontSize="11.5" fontWeight={600} fill="var(--surface)"
              style={{ fontVariantNumeric: "tabular-nums" }}>{label}</text>
            {p.sub && <text x={bx + w / 2} y={by + 32} textAnchor="middle" fontSize="10.5" fill="var(--muted)"
              style={{ fontVariantNumeric: "tabular-nums" }}>{p.sub}</text>}
          </g>
        );
      })()}
    </svg>
  );
}
