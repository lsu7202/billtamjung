/** 리포트/전체 공용 표현 컴포넌트 — 일관성·재사용. 금액은 shared/format, 시계열은 TrendChart. */
import { useId, useState, useRef, useLayoutEffect } from "react";
import { InfoDot } from "../../shared/ui/InfoDot";

/* 지표 타일 — 라벨 + 대표값(+보조·델타). 헤더지표·리포트 공용. hint=산식 설명(ⓘ 팝오버). */
export function StatTile({ label, value, sub, delta, deltaColor, accent, hint }: {
  label: string; value: string; sub?: string; delta?: string; deltaColor?: string; accent?: string; hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center" }}>
        {label}{hint && <InfoDot text={hint} />}
      </span>
      <span style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.15, color: accent ?? "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{value || "—"}</span>
      {(sub || delta) && (
        <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
          {sub}{delta && <b style={{ color: deltaColor ?? "var(--up)", marginLeft: sub ? 5 : 0 }}>{delta}</b>}
        </span>
      )}
    </div>
  );
}

/* 지표 스택 — 차트 옆 대표 수치(라벨 작게·값 크게 mono·항목 hairline 구분). 공시지가·실거래 등 차트 카드 공용(§9 a). */
export function MetricStack({ items }: {
  items: { label: string; value: React.ReactNode; unit?: string; accent?: string; hint?: string }[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignSelf: "stretch", minWidth: 168 }}>
      {items.map((it, i) => (
        <div key={i} style={{ padding: i === 0 ? "0 0 12px" : "12px 0", borderTop: i === 0 ? undefined : "1px solid var(--line)" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: ".03em", marginBottom: 4, display: "inline-flex", alignItems: "center" }}>{it.label}{it.hint && <InfoDot text={it.hint} />}</div>
          <div className="num" style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, color: it.accent ?? "var(--ink)" }}>{it.value ?? "—"}{it.unit && <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginLeft: 2 }}>{it.unit}</span>}</div>
        </div>
      ))}
    </div>
  );
}

/* 점수 레이더 — N축(F-16 8축 등). score 0~100. */
export function ScoreRadar({ axes, size = 210, color = "var(--signal)", showValues }: {
  axes: { label: string; score: number }[]; size?: number; color?: string; showValues?: boolean;
}) {
  const n = axes.length;
  if (n < 3) return null;
  const cx = size / 2, cy = size / 2, r = size / 2 - 34;
  const pt = (i: number, val: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n, rr = (r * Math.max(0, Math.min(100, val))) / 100;
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size, display: "block", margin: "0 auto", overflow: "visible" }}>
      {[25, 50, 75, 100].map((rg) => (
        <polygon key={rg} points={poly(axes.map(() => rg))} fill="none" stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      {axes.map((_, i) => { const [x, y] = pt(i, 100); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />; })}
      <polygon points={poly(axes.map((a) => a.score))} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke"
        style={{ transformBox: "fill-box", transformOrigin: "center", animation: "bt-radar-in .7s cubic-bezier(.22,1,.36,1) .15s both" }} />
      {axes.map((a) => a.score).map((v, i) => { const [x, y] = pt(i, v); return <circle key={i} cx={x} cy={y} r={2.5} fill={color} />; })}
      {axes.map((ax, i) => {
        const [x, y] = pt(i, showValues ? 128 : 122);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={10.5} fill="var(--muted)">
            <tspan x={x}>{ax.label}</tspan>
            {showValues && <tspan x={x} dy={12} fontWeight={700} fill={color}>{Math.round(ax.score)}%</tspan>}
          </text>
        );
      })}
    </svg>
  );
}

/* 비교 컬럼차트 — 세로 막대(그라디언트·호버 강조·값라벨·베이스라인). 가격/임대료 비교. TrendChart와 동일 감성. */
export function CompareBar({ items, fmt, height = 178, refLine }: {
  items: { label: string; value: number; color?: string; strong?: boolean }[]; fmt: (n: number) => string; height?: number;
  refLine?: { value: number; label: string } | null;
}) {
  const gid = useId();
  const ref = useRef<SVGSVGElement>(null);
  const [cw, setCw] = useState(360);
  const [hi, setHi] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth || 360));
    ro.observe(el); setCw(el.clientWidth || 360);
    return () => ro.disconnect();
  }, []);
  const list = items.filter((i) => i.value > 0);
  if (!list.length) return <p style={{ color: "var(--muted)", fontSize: 13 }}>데이터 없음</p>;
  const W = cw, H = height, T = 24, B = 34, base = H - B;
  const max = Math.max(...list.map((i) => i.value), refLine?.value || 0, 1);
  const yOf = (v: number) => base - (v / max) * (base - T);
  // 고정 폭·고정 간격으로 가운데 정렬(퍼짐 방지). 넘치면 폭만 축소.
  const gap = 16;
  let colW = 40;
  if (colW * list.length + gap * (list.length - 1) > W) colW = Math.max(10, (W - gap * (list.length - 1)) / list.length);
  const groupW = colW * list.length + gap * (list.length - 1);
  const startX = (W - groupW) / 2;
  const xOf = (i: number) => startX + i * (colW + gap);
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ height: H, display: "block", overflow: "visible" }} onMouseLeave={() => setHi(null)}>
      <defs>
        {list.map((it, i) => (
          <linearGradient key={i} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={it.color ?? "var(--ink-2)"} stopOpacity={1} />
            <stop offset="100%" stopColor={it.color ?? "var(--ink-2)"} stopOpacity={0.82} />
          </linearGradient>
        ))}
      </defs>
      <line x1={0} y1={base} x2={W} y2={base} stroke="var(--line-2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {refLine && refLine.value > 0 ? <>
        <line x1={0} y1={yOf(refLine.value)} x2={W} y2={yOf(refLine.value)} stroke="var(--blue)" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        <text x={W - 2} y={yOf(refLine.value) - 5} textAnchor="end" fontSize="11" fontWeight={700} fill="var(--blue)">{refLine.label} {fmt(refLine.value)}</text>
      </> : null}
      {list.map((it, i) => {
        const h = Math.max(3, (it.value / max) * (base - T));
        const x = xOf(i), y = base - h;
        const dim = hi != null && hi !== i;
        const delay = i * 0.07;
        return (
          <g key={it.label} onMouseEnter={() => setHi(i)} style={{ cursor: "default" }}>
            <rect x={xOf(i) - gap / 2} y={0} width={colW + gap} height={H} fill="transparent" />
            <g style={{ transformBox: "fill-box", transformOrigin: "bottom", animation: `bt-col-grow .6s cubic-bezier(.22,1,.36,1) ${delay}s both`, transition: "opacity .12s", opacity: dim ? 0.5 : 1 }}>
              <rect x={x} y={y} width={colW} height={h} rx={5} fill={`url(#${gid}-${i})`} />
              {(hi === i || it.strong) && <rect x={x} y={y} width={colW} height={Math.min(h, 3)} rx={1.5} fill={it.color ?? "var(--ink)"} />}
            </g>
            <text x={x + colW / 2} y={y - 7} textAnchor="middle" fontSize="12" fontWeight={it.strong || hi === i ? 800 : 700} fill="var(--ink)" style={{ fontVariantNumeric: "tabular-nums", animation: `bt-fade .4s ease ${delay + 0.28}s both` }}>{fmt(it.value)}</text>
            <text x={x + colW / 2} y={H - 13} textAnchor="middle" fontSize="11.5" fill={it.strong ? "var(--ink)" : "var(--muted)"} fontWeight={it.strong ? 700 : 500}>{it.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* 추세 비교 라인차트 — 시계열 라인(면적채움·끝점 강조) + 기준선(주변 평균 등). 리포트 공용. */
export function TrendCompare({ points, refValue, refLabel, fmt, height = 170 }: {
  points: { label: string; value: number }[]; refValue?: number | null; refLabel?: string; fmt: (n: number) => string; height?: number;
}) {
  const gid = useId();
  const ref = useRef<SVGSVGElement>(null);
  const [cw, setCw] = useState(360);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth || 360));
    ro.observe(el); setCw(el.clientWidth || 360);
    return () => ro.disconnect();
  }, []);
  const pts = points.filter((p) => p.value > 0);
  if (pts.length < 2) return <p style={{ color: "var(--muted)", fontSize: 13 }}>데이터 없음</p>;
  const W = cw, H = height, T = 26, B = 30, L = 8, R = 12, base = H - B;
  const max = Math.max(...pts.map((p) => p.value), refValue || 0) * 1.1;
  const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v: number) => base - (v / max) * (base - T);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${base} L${x(0).toFixed(1)} ${base} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ height: H, display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={`${gid}-a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--navy)" stopOpacity={0.18} />
          <stop offset="100%" stopColor="var(--navy)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={0} y1={base} x2={W} y2={base} stroke="var(--line-2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {refValue ? <>
        <line x1={L} y1={y(refValue)} x2={W - R} y2={y(refValue)} stroke="var(--blue)" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        <text x={L + 2} y={y(refValue) - 5} fontSize="11" fontWeight={700} fill="var(--blue)">{refLabel ?? "주변 평균"} {fmt(refValue)}</text>
      </> : null}
      <path d={area} fill={`url(#${gid}-a)`} />
      <path d={line} fill="none" stroke="var(--navy)" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" style={{ animation: "bt-fade .5s ease both" }} />
      {pts.map((p, i) => (
        <g key={p.label}>
          <circle cx={x(i)} cy={y(p.value)} r={i === pts.length - 1 ? 4 : 2.5} fill={i === pts.length - 1 ? "var(--navy)" : "#fff"} stroke="var(--navy)" strokeWidth={1.6} />
          <text x={x(i)} y={H - 12} textAnchor="middle" fontSize="11" fill="var(--muted)">{p.label}</text>
        </g>
      ))}
      <text x={x(pts.length - 1)} y={y(last.value) - 10} textAnchor="end" fontSize="12.5" fontWeight={800} fill="var(--navy)" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(last.value)}</text>
    </svg>
  );
}

/* 등급 배지(A~E 등) — 매력도·적합도. */
export function Grade({ grade, color }: { grade: string; color?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 26, height: 26, padding: "0 7px",
      borderRadius: 7, fontWeight: 800, fontSize: 14, color: "#fff", background: color ?? "var(--signal)",
    }}>{grade}</span>
  );
}

/* 리포트 카드 셸 — 제목 + 우측 액션 + 본문. 일관 패딩·헤더. */
export function ReportCard({ title, right, children, span2 }: {
  title: string; right?: React.ReactNode; children: React.ReactNode; span2?: boolean;
}) {
  return (
    <div className="panel" style={{ gridColumn: span2 ? "1 / -1" : undefined, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
        {right && <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{right}</span>}
      </div>
      {children}
    </div>
  );
}
