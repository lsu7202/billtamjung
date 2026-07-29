import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { overlaysApi } from "../../shared/api/endpoints";
import { KV, NumCell, vPos } from "./KV";
import { EnumField, ChipsMulti } from "./EnumField";
import { TrendChart } from "./TrendChart";
import { InfoDot } from "../../shared/ui/InfoDot";
import { wonShort, manPerM2 } from "../../shared/format";

/* 플랫 정밀 지표 스타일 — 라벨(작게·muted·tracking) / 값(크게·mono) / 단위(작게·muted) */
const GL: React.CSSProperties = { fontSize: 11, color: "var(--muted)", letterSpacing: ".03em", marginBottom: 4 };
const GV: React.CSSProperties = { fontSize: 23, fontWeight: 800, lineHeight: 1 };
const GU: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--muted)", marginLeft: 2 };

/* 용도지역 전체(걸침 다중선택). code=label=풀네임(use_zone_mix 명과 일치). */
const ZONE_OPTS = ["제1종전용주거지역", "제2종전용주거지역", "제1종일반주거지역", "제2종일반주거지역", "제3종일반주거지역",
  "준주거지역", "중심상업지역", "일반상업지역", "근린상업지역", "유통상업지역", "전용공업지역", "일반공업지역", "준공업지역",
  "보전녹지지역", "생산녹지지역", "자연녹지지역", "보전관리지역", "생산관리지역", "계획관리지역", "농림지역", "자연환경보전지역", "미지정",
].map((z) => ({ code: z, label: z }));
type ZoneMix = { 명: string; 비중: number; 코드?: string }[];

/* 공시지가 추이 차트(라인만). 상승률 배지는 카드 우측 지표 영역에서 렌더. series=[[연도,원/㎡]]. */
function GongsiTrend({ series }: { series: [number, number][] }) {
  if (!series || series.length < 2) return null;
  const pts = series.map(([y, v]) => ({ x: String(y), y: v, sub: `${manPerM2(v)}/㎡` }));
  return <TrendChart points={pts} color="var(--c-gongsi)" fmt={(v) => manPerM2(v)} height={150} maxW={560} />;
}
/* 공시지가 상승률(10년·5년·전체) — 우측 지표 영역용 */
function gongsiRates(series: [number, number][]) {
  if (!series || series.length < 2) return null;
  const yrs = series.length, first = series[0][1], last = series[yrs - 1][1];
  const rate = first ? ((last - first) / first) * 100 : 0;
  const back = (n: number) => { const s = series[Math.max(0, yrs - 1 - n)]; return s && first ? ((last - s[1]) / s[1]) * 100 : null; };
  return { r5: yrs > 5 ? back(5) : null, r10: yrs > 10 ? back(10) : null, rate };
}
const ratePct = (v: number | null) => v == null ? "" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
/* 공시지가 표 — 연도별 단가(최신 위). 그래프/표 토글용. */
function GongsiTable({ series }: { series: [number, number][] }) {
  if (!series || series.length < 2) return null;
  return (
    <table className="wf">
      <thead><tr><th>연도</th><th className="num">공시지가 (만원/㎡)</th></tr></thead>
      <tbody>{[...series].reverse().map(([y, v]) => (<tr key={y}><td>{y}</td><td className="num">{manPerM2(v)}</td></tr>))}</tbody>
    </table>
  );
}

/** 필지 셀렉터(S02 §3.6) — 다필지 탭 전환 · 토지/규제/공시지가가 선택 필지 값으로 · 건물 요약(OR 집계).
 * 편집: 필지 오버레이(target_type='parcel', target_id=pnu). enum(지목·지형·도로접면·지세)+자유값(용도지역·토지이용·면적·공시지가).
 */
interface Parcel {
  role: string; pnu: string; area: number | string | null;
  jimok?: string; land_use?: string; slope?: string; shape?: string; road_frontage?: string;
  use_zone?: string; legal_bcr?: string; legal_far?: string; gongsi_latest?: number | string | null; total_gongsi?: number | string | null;
  gongsi_series: [number, number][];
  regs: Record<string, string>;
}
interface ParcelsResp { parcels: Parcel[]; reg_summary: Record<string, string>; count: number }

const REG_ALL = ["지구단위계획", "정비구역", "고도지구", "경관지구", "방화지구", "문화재보존"];   // 목업 순서(개발제한=마스터 컬럼 없음, 제외)
const REG_FIELD: Record<string, string> = {   // 규제 라벨 → 필지 오버레이 필드(백엔드 REG_LABELS 역매핑)
  "고도지구": "reg_godo", "지구단위계획": "reg_district", "정비구역": "reg_jeongbi",
  "경관지구": "reg_gyeong", "방화지구": "reg_banghwa", "문화재보존": "reg_munhwa",
};
const num = (x: unknown): number | null => (x == null || x === "" ? null : Number(x));
const pct = (x: unknown): string | null => (x == null || x === "" ? null : String(x).replace("%", ""));   // 법정건폐/용적: 마스터 "50%" → 숫자부만(중복 % 방지)

const PY = 3.305785;
export function ParcelBlock({ pk, useZoneMix, unit = "m2" }: { pk: string; useZoneMix?: unknown; unit?: "py" | "m2" }) {
  const [sel, setSel] = useState(0);
  const qc = useQueryClient();
  const q = useQuery<ParcelsResp>({
    queryKey: ["parcels", pk],
    queryFn: () => api<ParcelsResp>(`/buildings/${pk}/parcels`),
  });
  const parcels = q.data?.parcels ?? [];
  const p = parcels[sel];
  const pnu = p?.pnu ?? "";

  const save = useMutation({
    mutationFn: ({ field, value }: { field: string; value: string }) => overlaysApi.put(pnu, field, value, "parcel"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["parcels", pk] }),
  });
  const revert = useMutation({
    mutationFn: (field: string) => overlaysApi.revert(pnu, field, "parcel"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["parcels", pk] }),
  });
  const onSave = (field: string, value: string) => save.mutate({ field, value });
  const onRevert = (field: string) => revert.mutate(field);

  const area = num(p?.area);

  if (q.isLoading) return null;
  if (parcels.length === 0) return null;

  const summary = q.data?.reg_summary ?? {};
  const applied = Object.keys(summary);

  const parcelTag = parcels.length > 1 ? <small style={{ color: "var(--muted)", fontWeight: 400 }}>필지 {p.pnu.slice(-8)}</small> : null;
  return (
    <>
    {/* 토지정보 | 규제·특례 (2단) */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 14, alignItems: "start" }}>
    <div className="panel">
      <div className="sec-head">토지정보
        {parcels.length > 1 && <small style={{ color: "var(--muted)", fontWeight: 400 }}>다필지 {parcels.length}개 · 필지별 값</small>}
      </div>

      {/* 필지 탭(다필지) */}
      {parcels.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 14px 10px" }}>
          {parcels.map((pc, i) => (
            <button key={pc.pnu} className={`btn ${i === sel ? "primary" : ""}`} style={{ fontSize: 12, padding: "4px 10px" }}
              onClick={() => setSel(i)}>
              {pc.pnu.slice(-8)}{pc.role === "대표" && <span style={{ opacity: .7, marginLeft: 4 }}>대표</span>}
            </button>
          ))}
        </div>
      )}

      {/* 토지정보(선택 필지) — 목업 순서: 토지면적·지목·용도지역·이용상황·지형/형상·도로접면·지세·법정건폐/용적 */}
      <div className="kv-grid">
        <KV label="토지면적" field="area" value={area != null ? (unit === "py" ? `${(area / PY).toFixed(1)}평` : `${area.toLocaleString()}㎡`) : ""}
          editable current={area != null ? (unit === "py" ? +(area / PY).toFixed(1) : area) : ""}
          parse={(v) => String(unit === "py" ? parseFloat(v) * PY : parseFloat(v))} validate={vPos} onSave={onSave} onRevert={onRevert} />
        <EnumField label="지목" enumKey="jimok" value={p.jimok} onSave={(v) => onSave("jimok", v)} onRevert={() => onRevert("jimok")} />
        {/* 용도지역 = 걸침(다지역) 가능 → 다중선택. 오버라이드 없으면 건물 use_zone_mix(비중) 표시 */}
        {(() => {
          const mix: ZoneMix = Array.isArray(useZoneMix) ? useZoneMix : (typeof useZoneMix === "string" ? JSON.parse(useZoneMix || "[]") : []);
          const overridden = typeof p.use_zone === "string" && p.use_zone.includes(",");
          const selected = overridden ? p.use_zone!.split(",") : (mix.length ? mix.map((m) => m.명) : p.use_zone ? [p.use_zone] : []);
          // 비중(%)은 데이터엔 유지하되 화면 미표시(편집 시 사라지는 혼란 방지) — 명칭만 병기
          const summary = overridden ? selected.join(" · ") : (mix.length ? mix.map((m) => m.명).join(" · ") : (p.use_zone ?? ""));
          return (
            <div className="kv" style={{ alignItems: "center" }}><span className="k">용도지역</span>
              <ChipsMulti opts={ZONE_OPTS} selected={selected} summary={summary}
                onChange={(v) => onSave("use_zone", v.join(","))} onRevert={() => onRevert("use_zone")} />
            </div>
          );
        })()}
        <KV label="토지이용상황" field="land_use" value={p.land_use ?? ""} editable current={p.land_use ?? ""} onSave={onSave} onRevert={onRevert} />
        <EnumField label="지형/형상" enumKey="shape" value={p.shape} onSave={(v) => onSave("shape", v)} onRevert={() => onRevert("shape")} />
        <EnumField label="도로접면" enumKey="road_frontage" value={p.road_frontage} onSave={(v) => onSave("road_frontage", v)} onRevert={() => onRevert("road_frontage")} />
        <EnumField label="지세" enumKey="slope" value={p.slope} onSave={(v) => onSave("slope", v)} onRevert={() => onRevert("slope")} />
        {/* 법정 건폐/용적 = 🔀 조례파생, override 가능(한 줄 두 값 인라인 편집) */}
        <div className="kv"><span className="k">법정 건폐/용적</span>
          <span className="v num" style={{ display: "flex", gap: 5, alignItems: "center", justifyContent: "flex-end" }}>
            <NumCell v={pct(p.legal_bcr)} suffix="%" onSave={(x) => onSave("legal_bcr", x)} /> / <NumCell v={pct(p.legal_far)} suffix="%" onSave={(x) => onSave("legal_far", x)} />
          </span>
        </div>
      </div>
    </div>

    <div className="panel">
      {/* 규제 2레벨: 건물 요약(OR 집계) + 필지 상세 */}
      <div className="sec-head">규제·특례 {parcelTag}</div>
      <div style={{ padding: "12px 14px 8px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, marginRight: 2 }}>건물 요약</span>
        {applied.length === 0
          ? <span style={{ color: "var(--green)", fontSize: 12, fontWeight: 700 }}>규제 사항 없음 — 전 필지 해당 없음</span>
          : <>
            {applied.map((k) => <span key={k} className="tag stale" title={summary[k]}>{k}</span>)}
            <span style={{ color: "var(--muted)", fontSize: 12 }}>· 그 외 해당 없음</span>
          </>}
      </div>
      <div className="kv-grid" style={{ paddingTop: 0 }}>
        {REG_ALL.map((r) => (
          <KV key={r} label={r} field={REG_FIELD[r]} value={p.regs[r] ?? ""} editable
            current={p.regs[r] ?? ""} onSave={onSave} onRevert={onRevert} />
        ))}
      </div>
    </div>
    </div>
    </>
  );
}

/* 공시지가 카드(건물 대표필지 시계열) — 실거래와 좌우 페어용 독립 컴포넌트. 그래프/표 토글 + 지표 스택. */
export function GongsiCard({ series, totalGongsi, landArea }: { series: [number, number][]; totalGongsi: number | null; landArea: number | null }) {
  const [mode, setMode] = useState<"c" | "t">("c");
  if (!series || series.length < 2) return null;
  const gongsiLatest = series[series.length - 1][1];
  const total = totalGongsi ?? (gongsiLatest && landArea ? gongsiLatest * landArea : null);
  return (
    <div className="panel">
      <div className="sec-head">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 0, borderTop: "3px solid var(--c-gongsi)", display: "inline-block" }} />공시지가
        </span>
        <span style={{ marginLeft: "auto", display: "flex" }}>
          <button className={`btn ${mode === "c" ? "primary" : ""}`} style={{ padding: "4px 10px", fontSize: 12, borderRadius: "6px 0 0 6px" }} onClick={() => setMode("c")}>그래프</button>
          <button className={`btn ${mode === "t" ? "primary" : ""}`} style={{ padding: "4px 10px", fontSize: 12, borderRadius: "0 6px 6px 0", borderLeft: 0 }} onClick={() => setMode("t")}>표</button>
        </span>
      </div>
      <div style={{ display: "flex", gap: 20, alignItems: mode === "t" ? "flex-start" : "center", flexWrap: "wrap", padding: "6px 14px 12px" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0, maxWidth: 560 }}>
          {mode === "c" ? <GongsiTrend series={series} /> : <GongsiTable series={series} />}
        </div>
        <div style={{ flex: "1 1 164px", minWidth: 150, alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ paddingBottom: 12 }}>
            <div style={GL}>㎡당 공시지가</div>
            <div className="num" style={{ ...GV, color: "var(--c-gongsi)" }}>{manPerM2(gongsiLatest)}<span style={GU}>/㎡</span></div>
          </div>
          <div style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
            <div style={{ ...GL, display: "inline-flex", alignItems: "center" }}>공시지가 총액<InfoDot text="㎡당 공시지가 × 대지면적" /></div>
            <div className="num" style={{ ...GV, color: "var(--ink)" }}>{wonShort(total) || "—"}</div>
          </div>
          {(() => {
            const gr = gongsiRates(series);
            if (!gr) return null;
            const item = (lbl: string, v: number | null) => v == null ? null : (
              <span style={{ fontSize: 12.5 }}><span style={{ color: "var(--muted)" }}>{lbl}</span> <b className="num" style={{ color: v >= 0 ? "var(--up)" : "var(--down)" }}>{ratePct(v)}</b></span>
            );
            return (
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <div style={{ ...GL, marginBottom: 5 }}>공시지가 상승률</div>
                <div style={{ display: "flex", gap: 13, flexWrap: "wrap" }}>{item("5년", gr.r5)}{item("10년", gr.r10)}{item("전체", gr.rate)}</div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
