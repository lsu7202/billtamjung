import { useEffect, useMemo, useRef, useState } from "react";

/** 입체 지적도 — 필지·접도·용적을 한 장면에 세운다.
 *
 *  지도 타일 위에 얹지 않는 이유: 타일이 시끄러워 수치가 묻히고, 자료로 캡처·인쇄할 때도 불리하다.
 *  우리가 가진 도형(필지 폴리곤·도로 구간)만 등각(isometric)으로 눕혀 그리면
 *  대지 위에 현재 용적을 매스로 세우고 법정 여유를 그 위에 비워 보여줄 수 있다.
 *
 *  담는 값은 전부 사실이다 — 대지면적·연면적·건폐율/용적률·법정 용적률·접도 폭·용도지역.
 */

type LngLat = [number, number];
type Geo = { type: string; coordinates: any };

export type SceneData = {
  parcel: Geo | null;
  roads: { rn: string; road_bt: number; geojson: Geo }[];
  landArea?: number | null;      // ㎡
  totalArea?: number | null;     // ㎡
  bcr?: number | null;           // %
  far?: number | null;           // %
  legalFar?: number | null;      // %
  useZone?: string | null;
  frontRn?: string | null;
  floorsAbove?: number | null;
  height?: number | null;        // m — 건축물대장 표제부 실측. 없으면 null(가정값을 넣지 않는다)
};

/* ── 도형 유틸 ───────────────────────────────────────────── */
const ringsOf = (g: Geo | null): LngLat[][] => {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates[0]];
  if (g.type === "MultiPolygon") return g.coordinates.map((p: any) => p[0]);
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
};

/** 등각 투영 — 위경도를 미터 평면으로 펴고 눕힌다.
 *
 *  스케일은 **시야 폭(m)** 으로 잡는다. 필지에만 맞추면 접한 도로가 통째로 화면 밖으로 밀려
 *  "접도 35m"라는 핵심 사실이 그림에 안 남는다(실측). 반대로 도로까지 bbox에 넣으면
 *  대로가 화면을 삼켜 필지가 점이 된다. 그래서 필지 폭의 2.2배, 최소 70m를 담는 시야로 고정한다.
 *  70m면 왕복 대로 한 폭과 이면도로가 같이 들어온다.
 */
function makeProjector(parcel: LngLat[][], w: number, h: number, tilt = 0.62) {
  const pts = parcel.flat();
  const lat0 = pts.reduce((a, p) => a + p[1], 0) / (pts.length || 1);
  const lng0 = pts.reduce((a, p) => a + p[0], 0) / (pts.length || 1);
  const mx = 111320 * Math.cos((lat0 * Math.PI) / 180), my = 110540;

  const flat = pts.map(([lng, lat]) => [(lng - lng0) * mx, (lat - lat0) * my]);
  const xs = flat.map((p) => p[0]), ys = flat.map((p) => p[1]);
  const spanX = (Math.max(...xs) - Math.min(...xs)) || 1;
  const spanY = (Math.max(...ys) - Math.min(...ys)) || 1;

  const fovX = Math.max(spanX * 2.2, 70);                        // 담을 가로 시야(m)
  const sc = Math.min(w / fovX, (h * 0.34) / (spanY * tilt));    // 필지 깊이는 화면의 1/3 안으로
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const ox = w / 2 - cx * sc, oy = h * 0.7 + cy * tilt * sc;     // 아래쪽에 앉혀 위로 매스가 서게

  return {
    scale: sc,
    at([lng, lat]: LngLat): [number, number] {
      const x = (lng - lng0) * mx, y = (lat - lat0) * my;
      return [x * sc + ox, -y * tilt * sc + oy];
    },
  };
}

const path = (pts: [number, number][], close = true) =>
  pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("") + (close ? "Z" : "");

const centroid = (pts: [number, number][]): [number, number] => [
  pts.reduce((a, p) => a + p[0], 0) / pts.length,
  pts.reduce((a, p) => a + p[1], 0) / pts.length,
];

/* ── 본체 ───────────────────────────────────────────────── */
export function ParcelScene({ data, w = 900, h = 520, animate = true }: {
  data: SceneData; w?: number; h?: number; animate?: boolean;
}) {
  const [step, setStep] = useState(animate ? 0 : 99);
  const timer = useRef<number>();

  useEffect(() => {
    if (!animate) return;
    let i = 0;
    timer.current = window.setInterval(() => {
      i += 1; setStep(i);
      if (i >= 5 && timer.current) window.clearInterval(timer.current);
    }, 420);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [animate]);

  const scene = useMemo(() => {
    const parcelRings = ringsOf(data.parcel);
    if (!parcelRings.length) return null;
    const proj = makeProjector(parcelRings, w, h);

    const parcel = parcelRings.map((r) => r.map(proj.at));
    const base = parcel[0];
    const c = centroid(base);

    // 매스 높이 — 도로 폭과 같은 축척(m→px)으로 세운다. 대장 실측 높이가 있으면 그것,
    // 없으면 층수×3.5m(층수도 없으면 용적률÷건폐율로 되돌린다). 법정 여유는 용적률 비율만큼 더.
    const far = data.far ?? 0, legal = data.legalFar ?? 0, bcr = data.bcr ?? 0;
    const floors = data.floorsAbove ?? (bcr > 0 && far > 0 ? Math.max(1, Math.round(far / bcr)) : 3);
    const hCur = Math.min((data.height ?? floors * 3.5) * proj.scale, h * 0.45);
    const hLegal = far > 0 && legal > far ? Math.min(hCur * (legal / far), h * 0.55) : hCur;

    const lift = (pts: [number, number][], dy: number) =>
      pts.map(([x, y]) => [x, y - dy] as [number, number]);

    // 옆면 — 아래 링과 위 링을 잇는 사각형들
    const sides = (dy0: number, dy1: number) =>
      base.map((p, i) => {
        const q = base[(i + 1) % base.length];
        return [[p[0], p[1] - dy0], [q[0], q[1] - dy0], [q[0], q[1] - dy1], [p[0], p[1] - dy1]] as [number, number][];
      });

    const roads = data.roads.map((r) => ({
      ...r,
      lines: ringsOf(r.geojson).map((ln) => ln.map(proj.at)),
    })).filter((r) => r.lines.length);

    return { proj, parcel, base, c, hCur, hLegal, lift, sides, roads };
  }, [data, w, h]);

  if (!scene) return <div className="ps-empty">필지 도형이 없어 그릴 수 없습니다</div>;
  const { proj, parcel, base, c, hCur, hLegal, lift, sides, roads } = scene;

  /** 도로 폭은 실제 축척으로 긋는다 — 35m 대로가 굵게 보이는 게 사실이다.
   *  다만 눕힌 각도 때문에 정면 도로가 과장되므로 0.75만 반영하고 화면 비율로 조인다. */
  const roadPx = (m: number) => Math.max(4, Math.min(m * proj.scale * 0.6, h * 0.16));
  /** 같은 도로가 여러 구간으로 쪼개져 들어온다 — 이름당 하나만, 넓은 순으로 셋.
   *  라벨을 선 위에 띄우면 화면 밖으로 나간 구간이 엉뚱한 도로 위에 앉는다(실측). 목록으로 뺀다. */
  const labelRoads = Object.values(
    roads.reduce<Record<string, typeof roads[number]>>((a, r) => {
      if (!a[r.rn] || a[r.rn].road_bt < r.road_bt) a[r.rn] = r;
      return a;
    }, {}),
  ).sort((a, b) => b.road_bt - a.road_bt).slice(0, 3);
  const on = (n: number) => (step >= n ? 1 : 0);

  const fmtArea = (m2?: number | null) => (m2 ? `${(m2 / 3.305785).toFixed(1)}평` : "—");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="ps" role="img" aria-label="입체 지적도">
      <defs>
        <linearGradient id="ps-mass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5B7FC7" stopOpacity=".95" />
          <stop offset="100%" stopColor="#2B5AA8" stopOpacity=".85" />
        </linearGradient>
        <linearGradient id="ps-head" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8FB0E0" stopOpacity=".30" />
          <stop offset="100%" stopColor="#8FB0E0" stopOpacity=".05" />
        </linearGradient>
        <clipPath id="ps-clip"><rect x="0" y="0" width={w} height={h} rx="10" /></clipPath>
        <filter id="ps-glow"><feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>

      {/* 1 · 접한 도로 — 폭에 비례한 굵기. 필지 기준 스케일이라 화면 밖으로 뻗는 건 잘라낸다 */}
      <g className="ps-fade" style={{ opacity: on(1) }} clipPath="url(#ps-clip)">
        {roads.map((r, i) => r.lines.map((ln, j) => (
          <path key={`${i}-${j}`} d={path(ln, false)} fill="none"
            stroke={r.rn === data.frontRn ? "#E7C876" : "#3A4658"}
            strokeWidth={roadPx(r.road_bt)}
            strokeOpacity={r.rn === data.frontRn ? 0.55 : 0.3}
            strokeLinecap="round" strokeLinejoin="round"
            filter={r.rn === data.frontRn ? "url(#ps-glow)" : undefined} />
        )))}
      </g>

      {/* 2 · 대지 */}
      <g className="ps-fade" style={{ opacity: on(2) }}>
        {parcel.map((r, i) => (
          <path key={i} d={path(r)} fill="#1B2740" fillOpacity=".55" stroke="#8FB0E0" strokeWidth="1.6" />
        ))}
      </g>

      {/* 3 · 현재 용적 매스 */}
      <g className="ps-rise" style={{ opacity: on(3) }}>
        {sides(0, hCur).map((q, i) => (
          <path key={i} d={path(q)} fill="url(#ps-mass)" stroke="#1E2A4A" strokeWidth=".6" strokeOpacity=".5" />
        ))}
        <path d={path(lift(base, hCur))} fill="#6E8FD4" stroke="#fff" strokeWidth="1.2" strokeOpacity=".7" />
      </g>

      {/* 4 · 법정 용적까지 남은 여유 */}
      {hLegal > hCur + 2 && (
        <g className="ps-rise" style={{ opacity: on(4) }}>
          {sides(hCur, hLegal).map((q, i) => (
            <path key={i} d={path(q)} fill="url(#ps-head)" stroke="#8FB0E0" strokeWidth=".7"
              strokeDasharray="4 3" strokeOpacity=".7" />
          ))}
          <path d={path(lift(base, hLegal))} fill="none" stroke="#8FB0E0" strokeWidth="1"
            strokeDasharray="4 3" strokeOpacity=".8" />
        </g>
      )}

      {/* 5 · 수치 — 겹치지 않게 자리를 나눈다 */}
      <g className="ps-fade" style={{ opacity: on(5) }}>
        {/* 좌상단 스펙 블록 — 도로 띠가 뒤로 지나가도 읽히게 바닥을 깐다 */}
        <g transform="translate(22,24)">
          <rect x={-12} y={-20} width={148} height={122} rx={10} fill="#0B111C" fillOpacity=".78" />
          {data.useZone && <text className="ps-zone" y="0">{data.useZone}</text>}
          <text className="ps-k" y="22">대지면적</text>
          <text className="ps-v" y="42">{fmtArea(data.landArea)}</text>
          <text className="ps-k" y="66">연면적</text>
          <text className="ps-v" y="86">{fmtArea(data.totalArea)}</text>
        </g>

        {/* 우상단 용적 블록 */}
        <g transform={`translate(${w - 22},24)`} textAnchor="end">
          <rect x={-172} y={-20} width={184} height={99} rx={10} fill="#0B111C" fillOpacity=".78" />
          <text className="ps-k" y="0">건폐율 / 용적률</text>
          <text className="ps-v" y="20">{data.bcr ?? "—"}% · {data.far ?? "—"}%</text>
          {data.legalFar != null && (
            <>
              <text className="ps-k" y="44">법정 용적률</text>
              <text className="ps-h" y="63">
                {data.legalFar}%
                {(data.legalFar - (data.far ?? 0)) > 0
                  ? ` · 여유 ${(data.legalFar - (data.far ?? 0)).toFixed(0)}%p`
                  : " · 여유 없음"}
              </text>
            </>
          )}
        </g>

        {/* 매스 꼭대기 지시선 */}
        <g>
          <line x1={c[0]} y1={c[1]} x2={c[0]} y2={c[1] - hCur} stroke="#8FB0E0"
            strokeWidth=".8" strokeOpacity=".55" strokeDasharray="3 3" />
          <circle cx={c[0]} cy={c[1] - hCur} r="3" fill="#8FB0E0" />
        </g>

        {/* 접도 폭 — 도로 선 위에 */}
        {/* 접도 — 좌하단 목록. 금색 점이 전면 도로 */}
        {labelRoads.length > 0 && (
          <g transform={`translate(22,${h - 26 - labelRoads.length * 24})`}>
            <rect x={-12} y={-26} width={210} height={labelRoads.length * 24 + 34} rx={10}
              fill="#0B111C" fillOpacity=".78" />
            <text className="ps-k" y="-10">접도</text>
            {labelRoads.map((r, i) => {
              const front = r.rn === data.frontRn;
              return (
                <g key={i} transform={`translate(0,${i * 24 + 12})`}>
                  <circle cx={4} cy={-4} r={4} fill={front ? "#E7C876" : "#4A5C78"} />
                  <text className="ps-road" x={16} fill="#C7D3E6">{r.rn}</text>
                  <text className="ps-v" x={186} textAnchor="end" style={{ fontSize: 13 }}>{r.road_bt}m</text>
                </g>
              );
            })}
          </g>
        )}
      </g>
    </svg>
  );
}
