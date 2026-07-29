import { useState } from "react";
import { seriesApi, type SeriesPt } from "../../shared/api/endpoints";
import { TrendChart } from "./TrendChart";
import { MetricStack } from "./ReportPrimitives";
import { perPyMan } from "../../shared/format";

/** 거래 시세 — 실거래·광고를 각각 별도 카드로 나란히. 카드별 단일계열 그래프 + 편집표 + 상승률.
 * 공시지가는 토지 섹션(ParcelBlock)에 값+추이로 통합. 그래프 겹쳐 비교는 '리포트' 탭. specs S02 §3.7.
 */
const validX = (x: string) => /^\d{4}([/-]\d{1,2}([/-]\d{1,2})?)?$/.test(x.trim());
const fmtDate = (s: string): string => {
  const d = s.replace(/\D/g, "").slice(0, 6);
  return d.length <= 4 ? d : `${d.slice(0, 4)}/${d.slice(4)}`;
};
const perPyFmt = (y: number, areaPy?: number) => perPyMan(y, areaPy);

export function MarketTrend({ pk, data, fmt, refresh, areaPy }: {
  pk: string; data: Record<"gongsi" | "real" | "ad", SeriesPt[]>; fmt: (n: number) => string; refresh: () => void; areaPy?: number | null;
}) {
  // 실거래 = 주카드(항상). 광고 = 거의 안 쓰므로 접이식(데이터 없으면 접힘, 클릭해 입력).
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <SeriesCard pk={pk} kind="real" name="실거래가" color="var(--c-real)" perPy pts={data.real ?? []} fmt={fmt} refresh={refresh} areaPy={areaPy ?? undefined} />
      <SeriesCard pk={pk} kind="ad" name="광고가" color="var(--c-ad)" dashed perPy pts={data.ad ?? []} fmt={fmt} refresh={refresh} areaPy={areaPy ?? undefined} collapsible />
    </div>
  );
}

/* 단일 계열 카드 — 그래프(TrendChart)/표 토글 + 상승률. collapsible=광고처럼 접이식. */
function SeriesCard({ pk, kind, name, color, dashed, perPy, pts, fmt, refresh, areaPy, collapsible }: {
  pk: string; kind: string; name: string; color: string; dashed?: boolean; perPy: boolean;
  pts: SeriesPt[]; fmt: (n: number) => string; refresh: () => void; areaPy?: number; collapsible?: boolean;
}) {
  const [mode, setMode] = useState<"c" | "t">("c");
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(collapsible ? pts.length === 0 : false);
  const first = pts[0]?.y ?? 0, last = pts[pts.length - 1]?.y ?? 0;
  const rate = first ? ((last - first) / first) * 100 : 0;
  const chartPts = pts.map((p) => ({ x: p.x, y: p.y, sub: perPy && areaPy ? `평당 ${perPyFmt(p.y, areaPy)}` : undefined }));

  return (
    <div className="panel">
      <div className="sec-head" style={collapsible ? { cursor: "pointer" } : undefined}
        onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {collapsible && <span style={{ color: "var(--muted)", fontSize: 12 }}>{collapsed ? "▸" : "▾"}</span>}
          <span style={{ width: 14, height: 0, borderTop: `3px ${dashed ? "dashed" : "solid"} ${color}`, display: "inline-block" }} />{name}
          {collapsible && <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 12 }}>{pts.length ? `· ${pts.length}건` : "· 입력 없음"}</span>}
        </span>
        <span style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          {!collapsed && (
            <span style={{ display: "flex" }} onClick={(e) => e.stopPropagation()}>
              <button className={`btn ${mode === "c" ? "primary" : ""}`} style={{ padding: "4px 10px", fontSize: 12, borderRadius: "6px 0 0 6px" }} onClick={() => setMode("c")}>그래프</button>
              <button className={`btn ${mode === "t" ? "primary" : ""}`} style={{ padding: "4px 10px", fontSize: 12, borderRadius: "0 6px 6px 0", borderLeft: 0 }} onClick={() => setMode("t")}>표</button>
            </span>
          )}
        </span>
      </div>

      {!collapsed && (mode === "c" ? (
        pts.length === 0
          ? <div style={{ padding: "4px 14px 14px" }}><p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "12px 0" }}>데이터가 없습니다 — 표에서 시점을 추가하세요</p></div>
          : (
            <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap", padding: "4px 14px 14px" }}>
              <div style={{ flex: "1 1 300px", minWidth: 0, maxWidth: 560 }}>
                <TrendChart points={chartPts} color={color} dashed={dashed} fmt={fmt} height={150} />
              </div>
              <div style={{ flex: "1 1 168px" }}>
                <MetricStack items={[
                  { label: "최근가", value: fmt(last), accent: color },
                  ...(perPy && areaPy ? [{ label: "평당", value: perPyFmt(last, areaPy) }] : []),
                  { label: "거래", value: `${pts.length}건` },
                  ...(pts.length >= 2 ? [{ label: "상승률", value: (<span style={{ fontSize: 13, fontWeight: 700, color: rate >= 0 ? "var(--up)" : "var(--down)" }}>전체 {rate >= 0 ? "+" : ""}{rate.toFixed(1)}%</span>) }] : []),
                ]} />
              </div>
            </div>
          )
      ) : (
        <div style={{ padding: "0 14px 14px" }}>
          <SeriesTable pk={pk} kind={kind} perPy={perPy} areaPy={areaPy} pts={pts} fmt={fmt} refresh={refresh}
            expanded={open} toggle={() => setOpen((o) => !o)} />
        </div>
      ))}
    </div>
  );
}

function SeriesTable({ pk, kind, perPy, areaPy, pts, fmt, refresh, expanded, toggle }: {
  pk: string; kind: string; perPy: boolean; areaPy?: number;
  pts: SeriesPt[]; fmt: (n: number) => string; refresh: () => void; expanded: boolean; toggle: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [draftKey, setDraftKey] = useState(0);
  const rows = [...pts].reverse();
  const shown = expanded ? rows : rows.slice(0, 3);
  const save = async (x: string, won: string): Promise<boolean> => {
    const y = parseInt(won, 10);
    if (!validX(x) || !(y > 0)) return false;
    await seriesApi.upsert(pk, kind, x.trim(), y); refresh(); return true;
  };
  const del = async (x: string) => { await seriesApi.del(pk, kind, x); refresh(); };
  return (
    <div>
      <table className="wf" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <tbody>
          {shown.map((p) => <SeriesRow key={p.x} p={p} fmt={fmt} perPy={perPy} areaPy={areaPy} onSave={save} onDel={del} />)}
          <SeriesRow key={`draft-${draftKey}`} p={null} fmt={fmt} perPy={perPy} areaPy={areaPy}
            onSave={async (x, y) => { if (await save(x, y)) setDraftKey((k) => k + 1); }} onDel={del} hidden={!hover && pts.length > 0} />
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
            value={xv} onChange={(e) => { setXv(fmtDate(e.target.value)); if (xErr) setXErr(false); }}
            onBlur={() => trySave(xv, yv)} title={xErr ? "형식: YYYY 또는 YYYY/MM" : undefined} />
        : p!.x}</td>
      <td className="num">
        {yEdit
          ? <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
              <input className="input" style={{ width: 120, padding: "3px 6px", fontSize: 12 }} autoFocus value={yv}
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
