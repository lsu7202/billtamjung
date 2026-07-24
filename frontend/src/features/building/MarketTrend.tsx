import { useState } from "react";
import { seriesApi, type SeriesPt } from "../../shared/api/endpoints";

/** 시세 추이 통합 카드 — 공시지가(총)·실거래·광고 팀 오버레이. 겹친 그래프(원) + 그래프 호버 툴팁 + 평단가.
 * 표 모드: 계열별 행 추가(호버 시 draft)·수정(억)·삭제(오버레이). specs S02 §3.7.
 */
const META: { kind: "gongsi" | "real" | "ad"; name: string; color: string; dashed?: boolean; perPy?: boolean }[] = [
  { kind: "gongsi", name: "총공시지가", color: "#1E5AF0", perPy: true },
  { kind: "real", name: "실거래가", color: "var(--c-real)", perPy: true },
  { kind: "ad", name: "광고가", color: "var(--c-ad)", dashed: true, perPy: true },
];

const toTime = (x: string): number => {
  const m = x.match(/(\d{4})\D?(\d{1,2})?\D?(\d{1,2})?/);
  return m ? +m[1] + (m[2] ? (+m[2] - 1) / 12 : 0) + (m[3] ? +m[3] / 365 : 0) : 0;
};
const validX = (x: string) => /^\d{4}([/-]\d{1,2}([/-]\d{1,2})?)?$/.test(x.trim());
const fmtDate = (s: string): string => {   // 숫자만 입력 → 슬래시 자동삽입: 20000404 → 2000/04/04
  const d = s.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}/${d.slice(4)}`;
  return `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6)}`;
};
const perPyFmt = (y: number, areaPy?: number) => (areaPy ? `${Math.round(y / areaPy / 1e4).toLocaleString()}만/평` : "");

export function MarketTrend({ pk, data, fmt, refresh, areaPy }: {
  pk: string; data: Record<"gongsi" | "real" | "ad", SeriesPt[]>; fmt: (n: number) => string; refresh: () => void; areaPy?: number | null;
}) {
  const [mode, setMode] = useState<"c" | "t">("c");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [hovPt, setHovPt] = useState<{ kind: string; name: string; color: string; x: string; y: number; cx: number; cy: number } | null>(null);
  const series = META.map((m) => ({ ...m, pts: data[m.kind] ?? [] }));
  const live = series.filter((s) => s.pts.length > 0);

  const W = 860, H = 240, L = 74, R = 24, T = 26, B = 34;
  const allPts = live.flatMap((s) => s.pts);
  const times = allPts.map((p) => toTime(p.x));
  const tmin = Math.min(...times), tmax = Math.max(...times), tspan = tmax - tmin || 1;
  const ys = allPts.map((p) => p.y);
  const ymin = Math.min(...ys), ymax = Math.max(...ys), yspan = ymax - ymin || ymax || 1;
  const X = (x: string) => L + ((toTime(x) - tmin) / tspan) * (W - L - R);
  const Y = (v: number) => T + (H - T - B) * (1 - (v - ymin) / yspan);

  return (
    <div className="panel">
      <div className="sec-head">시세 추이
        <span style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          <span style={{ display: "flex" }}>
            <button className={`btn ${mode === "c" ? "primary" : ""}`} style={{ padding: "4px 10px", fontSize: 12, borderRadius: "6px 0 0 6px" }} onClick={() => setMode("c")}>그래프</button>
            <button className={`btn ${mode === "t" ? "primary" : ""}`} style={{ padding: "4px 10px", fontSize: 12, borderRadius: "0 6px 6px 0", borderLeft: 0 }} onClick={() => setMode("t")}>표</button>
          </span>
        </span>
      </div>

      <div style={{ display: "flex", gap: 16, padding: "0 14px 8px", fontSize: 12, flexWrap: "wrap" }}>
        {series.map((s) => (
          <span key={s.kind} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 600, opacity: s.pts.length ? 1 : .4 }}>
            <span style={{ width: 14, height: 0, borderTop: `3px ${s.dashed ? "dashed" : "solid"} ${s.color}`, display: "inline-block" }} />{s.name}
          </span>
        ))}
      </div>

      {mode === "c" ? (
        live.length === 0
          ? <p style={{ color: "var(--muted)", fontSize: 13, padding: "0 14px 14px" }}>데이터가 없습니다 — 표에서 시점을 추가하세요</p>
          : (
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: "var(--surface-2)", display: "block" }}
              onMouseLeave={() => setHovPt(null)}>
              <line x1={L} y1={T - 6} x2={L} y2={H - B} stroke="var(--line-2)" />
              <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="var(--line-2)" />
              <text x={L - 8} y={T + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="monospace">{fmt(ymax)}</text>
              <text x={L - 8} y={H - B + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="monospace">{fmt(ymin)}</text>
              {[tmin, (tmin + tmax) / 2, tmax].map((t) => (
                <text key={t} x={L + ((t - tmin) / tspan) * (W - L - R)} y={H - B + 18} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="monospace">{Math.round(t)}</text>
              ))}
              {live.map((s) => (
                <g key={s.kind}>
                  {s.pts.length > 1 && <polyline fill="none" stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dashed ? "5 4" : undefined}
                    points={s.pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")} />}
                  {s.pts.map((p) => (
                    <circle key={p.x} cx={X(p.x)} cy={Y(p.y)} r={hovPt?.kind === s.kind && hovPt?.x === p.x ? 5.5 : 3.5} fill={s.color} stroke="#fff" strokeWidth={1.5}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() => setHovPt({ kind: s.kind, name: s.name, color: s.color, x: p.x, y: p.y, cx: X(p.x), cy: Y(p.y) })} />
                  ))}
                </g>
              ))}
              {/* 호버 툴팁(표 정보): 시점·값·평단가 */}
              {hovPt && (() => {
                const meta = META.find((m) => m.kind === hovPt.kind);
                const l3 = meta?.perPy ? perPyFmt(hovPt.y, areaPy ?? undefined) : "";
                const bw = 150, bh = l3 ? 58 : 44;
                const bx = Math.min(Math.max(hovPt.cx - bw / 2, L), W - R - bw);
                const by = hovPt.cy - bh - 12 < T ? hovPt.cy + 12 : hovPt.cy - bh - 12;
                return (
                  <g pointerEvents="none">
                    <rect x={bx} y={by} width={bw} height={bh} rx={6} fill="#0F1A2E" opacity={0.95} />
                    <text x={bx + 10} y={by + 17} fontSize="11" fill={hovPt.color} fontWeight="700">{hovPt.name}</text>
                    <text x={bx + 10} y={by + 33} fontSize="12" fill="#fff" fontFamily="monospace">{hovPt.x} · {fmt(hovPt.y)}</text>
                    {l3 && <text x={bx + 10} y={by + 49} fontSize="11" fill="#aab2bf" fontFamily="monospace">평단가 {l3}</text>}
                  </g>
                );
              })()}
            </svg>
          )
      ) : (
        <div style={{ display: "grid", gap: 16, padding: "0 14px 14px" }}>
          {series.map((s) => (
            <SeriesTable key={s.kind} pk={pk} kind={s.kind} name={s.name} color={s.color} perPy={!!s.perPy} areaPy={areaPy ?? undefined}
              pts={s.pts} fmt={fmt} refresh={refresh} expanded={!!open[s.kind]} toggle={() => setOpen((o) => ({ ...o, [s.kind]: !o[s.kind] }))} />
          ))}
        </div>
      )}
    </div>
  );
}

function SeriesTable({ pk, kind, name, color, perPy, areaPy, pts, fmt, refresh, expanded, toggle }: {
  pk: string; kind: string; name: string; color: string; perPy: boolean; areaPy?: number;
  pts: SeriesPt[]; fmt: (n: number) => string; refresh: () => void; expanded: boolean; toggle: () => void;
}) {
  const [hover, setHover] = useState(false);
  const rows = [...pts].reverse();
  const shown = expanded ? rows : rows.slice(0, 3);
  const save = async (x: string, won: string) => { const y = parseInt(won, 10); if (validX(x) && y > 0) { await seriesApi.upsert(pk, kind, x.trim(), y); refresh(); } };   // 원 단위 입력(정밀)
  const del = async (x: string) => { await seriesApi.del(pk, kind, x); refresh(); };
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />{name}
      </div>
      <table className="wf" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <tbody>
          {shown.map((p) => <SeriesRow key={p.x} p={p} fmt={fmt} perPy={perPy} areaPy={areaPy} onSave={save} onDel={del} />)}
          {/* 빈 계열(광고 등)은 호버할 행이 없으니 draft 항상 노출, 행 있으면 호버 시만 */}
          <SeriesRow key="draft" p={null} fmt={fmt} perPy={perPy} areaPy={areaPy} onSave={save} onDel={del} hidden={!hover && pts.length > 0} />
        </tbody>
      </table>
      {rows.length > 3 && (
        <button className="btn" style={{ marginTop: 6, padding: "3px 10px", fontSize: 12 }} onClick={toggle}>
          {expanded ? "접기" : `더보기 (${rows.length - 3})`}
        </button>
      )}
    </div>
  );
}

function SeriesRow({ p, fmt, perPy, areaPy, onSave, onDel, hidden }: {
  p: SeriesPt | null; fmt: (n: number) => string; perPy: boolean; areaPy?: number;
  onSave: (x: string, eok: string) => void; onDel: (x: string) => void; hidden?: boolean;
}) {
  const draft = p == null;
  const [hover, setHover] = useState(false);
  const [xv, setXv] = useState(p?.x ?? "");
  const [xErr, setXErr] = useState(false);
  const [yEdit, setYEdit] = useState(false);
  const [yv, setYv] = useState("");
  const trySave = (x: string, y: string) => {
    if (!x.trim() || !y) return;
    if (!validX(x)) { setXErr(true); return; }
    setXErr(false); onSave(x, y);
  };
  return (
    <tr onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...(hidden ? { display: "none" } : {}), ...(draft ? { background: "var(--surface-2)" } : {}) }}>
      <td>{draft
        ? <input className="input" style={{ width: 96, padding: "3px 6px", fontSize: 12, borderColor: xErr ? "var(--up)" : undefined }}
            placeholder="YYYYMMDD" value={xv} onChange={(e) => { setXv(fmtDate(e.target.value)); if (xErr) setXErr(false); }}
            onBlur={() => trySave(xv, yv)} title={xErr ? "형식: YYYY · YYYY/MM · YYYY/MM/DD" : undefined} />
        : p!.x}</td>
      <td className="num">
        {yEdit
          ? <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
              <input className="input" style={{ width: 120, padding: "3px 6px", fontSize: 12 }} autoFocus placeholder="원(비우면 삭제)" value={yv}
                onChange={(e) => setYv(e.target.value.replace(/[^\d]/g, ""))}
                onBlur={() => { setYEdit(false); if (yv) trySave(draft ? xv : p!.x, yv); else if (!draft && p!.ov) onDel(p!.x); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setYEdit(false); }} />
              {yv && <span style={{ fontSize: 10, color: "var(--muted)" }}>{fmt(parseInt(yv, 10))}</span>}
            </span>
          : <span style={{ cursor: "pointer", display: "inline-block", minWidth: 40, minHeight: 15 }} title="클릭 = 수정(원 단위)"
              onClick={() => { setYv(p ? String(p.y) : ""); setYEdit(true); }}>{p ? fmt(p.y) : ""}</span>}
      </td>
      {perPy && <td className="num" style={{ color: "var(--muted)", fontSize: 12 }}>{p ? perPyFmt(p.y, areaPy) : ""}</td>}
      <td style={{ width: 30 }}>
        {!draft && p!.ov && (
          <button className="btn" style={{ padding: "1px 6px", fontSize: 12, color: p!.master ? "var(--ink-2)" : "var(--up)", visibility: hover ? "visible" : "hidden" }}
            onClick={() => onDel(p!.x)} title={p!.master ? "마스터 원본으로 되돌리기" : "삭제"}>{p!.master ? "↺" : "×"}</button>
        )}
      </td>
    </tr>
  );
}
