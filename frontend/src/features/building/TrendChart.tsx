import { useId, useState, useRef, useLayoutEffect } from "react";

/** 재사용 시계열 라인차트 — 영역 그라디언트·부드러운 라인·미세 그리드·끝점 강조·호버 가이드.
 * 차트 라이브러리 없이(ponytail) SVG 하나. 공시지가·실거래·리포트 공용.
 */
export interface TrendPoint { x: string; y: number; sub?: string }

const toTime = (x: string): number => {
  const m = x.match(/(\d{4})\D?(\d{1,2})?\D?(\d{1,2})?/);
  return m ? +m[1] + (m[2] ? (+m[2] - 1) / 12 : 0) + (m[3] ? +m[3] / 365 : 0) : 0;
};

/** 구간 음영 — from(그 x값) 부터 끝까지 옅게 칠한다. 겹쳐 쓰라고 만든 것이다:
 *  5년은 10년 안에 있으니 두 겹을 그대로 겹치면 「5년이 10년의 일부」가 그림으로 보인다. */
export interface TrendBand { from: string; op?: number }
/** 축 아래 오른쪽 한 줄 — 구간 위에 맞추면 좁은 구간에서 반드시 겹친다.
 *  대신 글자 색을 음영 농도에 맞춰 어느 숫자가 어느 칸인지 잇는다. */
export interface TrendFoot { label: string; color: string }

export function TrendChart({ points, color = "var(--signal)", dashed, fmt, height = 200, timeAxis = true, maxW,
                             bands, foot, rate }: {
  points: TrendPoint[];
  color?: string;
  dashed?: boolean;
  fmt: (v: number) => string;
  height?: number;
  timeAxis?: boolean;   // x를 연도척도로(공시지가 등). false면 균등간격.
  maxW?: number;        // 최대 폭(px) — 넓은 컬럼에서 납작하게 늘어나는 것 방지(직관성). 미지정=풀폭.
  bands?: TrendBand[];  // 구간 음영(겹쳐 그린다)
  foot?: TrendFoot[];   // 축 아래 오른쪽 한 줄
  /** 호버 줄에 직전 대비 상승률을 붙인다(공시지가=전년, 실거래=직전 거래) */
  rate?: boolean;
}) {
  const gid = useId();
  // 십자는 **가장 가까운 점에 붙는다**(2026-08-26). 마우스 좌표를 그대로 읽어 봤더니
  // 「그 해에 정확히 얼마였나」를 알 수 없었다 — 그게 이 그래프를 보는 이유다.
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

  const W = cw, H = height, L = 8, R = 12, T = 16, B = foot?.length ? 40 : 22;
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
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block", height: H, maxWidth: maxW, overflow: "visible", cursor: "crosshair" }}
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
      {/* 구간 음영 — 겹쳐 그린다. 5년이 10년 안에 있다는 게 농도로 보인다 */}
      {(bands ?? []).map((b, i) => {
        const t = toTime(b.from);
        const x = timeAxis ? L + ((t - tmin) / tspan) * (W - L - R)
          : L + (points.findIndex((p) => p.x === b.from) * (W - L - R)) / Math.max(1, points.length - 1);
        if (!(x > L) || x > W - R) return null;
        return (
          <g key={i}>
            <rect x={x} y={T - 8} width={W - R - x} height={H - B - T + 8} fill={color} opacity={b.op ?? 0.05} />
            <line x1={x} y1={T - 8} x2={x} y2={H - B} stroke={color} strokeWidth={1} opacity={0.16} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
      {points.length > 1 && <polygon points={area} fill={`url(#${gid})`} stroke="none" style={{ animation: "bt-fade .9s ease .25s both" }} />}
      {/* 라인에 vectorEffect 를 쓰지 않는다(2026-08-26) — pathLength=1 + strokeDasharray:1 과 겹치면
          크롬이 대시를 화면 단위로 재서 pathLength 정규화를 무시한다. 선이 1px 점선으로 그려져
          「중간이 끊긴」 것처럼 보였다. viewBox 폭 = 렌더 폭이라 굵기 보정도 애초에 필요 없다. */}
      {points.length > 1 && (
        <polyline points={line} fill="none" stroke={color} strokeWidth={2.25} strokeDasharray={dashed ? "6 4" : undefined}
          pathLength={dashed ? undefined : 1} strokeLinejoin="round" strokeLinecap="round"
          style={dashed ? undefined : { strokeDasharray: 1, strokeDashoffset: 1, animation: "bt-line-draw 1.1s cubic-bezier(.4,0,.2,1) .1s forwards" }} />
      )}
      {/* x 라벨: 시작·중간·끝만 */}
      {[0, Math.floor(last / 2), last].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
        <text key={i} x={X(i)} y={H - B + 16} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}
          fontSize="10.5" fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>{points[i].x}</text>
      ))}
      {/* 십자 — 가리킨 점에 붙는다. 양쪽 축까지 점선 */}
      {hi != null && (
        <g pointerEvents="none">
          <line x1={X(hi)} y1={T - 8} x2={X(hi)} y2={H - B} stroke="var(--line-2)" strokeWidth={1}
            strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <line x1={L} y1={Y(points[hi].y)} x2={X(hi)} y2={Y(points[hi].y)} stroke="var(--line-2)" strokeWidth={1}
            strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </g>
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
      {/* 축 값 — 가리킨 **점**의 값을 축 쪽에 비춘다(2026-08-26).
          y는 y축 쪽, x는 x축 쪽. 마우스 좌표를 그대로 읽는 것도 해 봤지만
          「그 해에 정확히 얼마였나」를 알 수 없어 접었다 — 그게 이 그래프를 보는 이유다. */}
      {hi != null && (() => {
        const p = points[hi], px = X(hi), py = Y(p.y);
        const prev = hi > 0 ? points[hi - 1] : null;
        const d = rate && prev && prev.y ? ((p.y - prev.y) / prev.y) * 100 : null;
        const yv = fmt(p.y);
        const vw = Math.max(44, yv.length * 7 + 14), xw = Math.max(38, p.x.length * 7 + 12);
        return (
          <g pointerEvents="none">
            {/* y축 쪽 */}
            <rect x={L - 2} y={py - 11} width={vw} height={22} rx={6} fill="var(--ink)" />
            <text x={L - 2 + vw / 2} y={py + 4} textAnchor="middle" fontSize="11" fontWeight={700} fill="var(--surface)"
              style={{ fontVariantNumeric: "tabular-nums" }}>{yv}</text>
            {/* x축 쪽 */}
            <rect x={Math.min(Math.max(px - xw / 2, 0), W - xw)} y={H - B + 2} width={xw} height={20} rx={6} fill="var(--ink)" />
            <text x={Math.min(Math.max(px, xw / 2), W - xw / 2)} y={H - B + 16} textAnchor="middle" fontSize="11" fontWeight={700}
              fill="var(--surface)" style={{ fontVariantNumeric: "tabular-nums" }}>{p.x}</text>
            {/* 직전 대비 — 그 점 위 */}
            {d != null && (
              <text x={px} y={py - 12} textAnchor="middle" fontSize="11.5" fontWeight={800}
                fill={d >= 0 ? "var(--up)" : "var(--down)"} style={{ fontVariantNumeric: "tabular-nums" }}>
                {`${d >= 0 ? "+" : ""}${d.toFixed(1)}%`}
              </text>
            )}
          </g>
        );
      })()}
      {/* 축 아래 오른쪽 한 줄 — 구간 상승률. 라인이 어디로 가든 겹치지 않는다 */}
      {foot?.length ? (
        <text x={W - R} y={H - 6} textAnchor="end" fontSize="11.5" fontWeight={800}
          style={{ fontVariantNumeric: "tabular-nums" }}>
          {foot.map((f, i) => (
            <tspan key={i} fill={f.color}>{i ? "   ·   " : ""}{f.label}</tspan>
          ))}
        </text>
      ) : null}
    </svg>
  );
}
