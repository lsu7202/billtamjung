import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { overlaysApi } from "../../shared/api/endpoints";
import { SeriesBlock } from "./SeriesBlock";
import { KV, NumCell, vPos, vNonNeg } from "./KV";
import { EnumField, ChipsMulti } from "./EnumField";

/* 용도지역 전체(걸침 다중선택). code=label=풀네임(use_zone_mix 명과 일치). */
const ZONE_OPTS = ["제1종전용주거지역", "제2종전용주거지역", "제1종일반주거지역", "제2종일반주거지역", "제3종일반주거지역",
  "준주거지역", "중심상업지역", "일반상업지역", "근린상업지역", "유통상업지역", "전용공업지역", "일반공업지역", "준공업지역",
  "보전녹지지역", "생산녹지지역", "자연녹지지역", "보전관리지역", "생산관리지역", "계획관리지역", "농림지역", "자연환경보전지역", "미지정",
].map((z) => ({ code: z, label: z }));
type ZoneMix = { 명: string; 비중: number; 코드?: string }[];

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
const eok = (n: number | null) => {   // 억+만 정밀표기 · 0=빈칸
  if (n == null || n === 0) return "";
  const m = Math.round(n / 1e4) * 1e4, e = Math.floor(m / 1e8), man = Math.round((m % 1e8) / 1e4);
  return e && man ? `${e}억 ${man.toLocaleString()}만` : e ? `${e}억` : `${man.toLocaleString()}만`;
};
const man = (n: number | null) => (n == null || n === 0 ? "" : `${Math.round(n / 1e4).toLocaleString()}만/㎡`);

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
  const gongsiLatest = num(p?.gongsi_latest);
  const totalGongsi = useMemo(() => {
    if (!gongsiLatest || !area) return null;
    return gongsiLatest * area;   // 총공시지가 = 단가 × 그 필지 면적(합산 아님)
  }, [gongsiLatest, area]);

  if (q.isLoading) return null;
  if (parcels.length === 0) return null;

  const summary = q.data?.reg_summary ?? {};
  const applied = Object.keys(summary);

  return (
    <div className="panel">
      <div className="sec-head">토지정보 · 규제
        <small style={{ color: "var(--muted)", fontWeight: 400 }}>
          {parcels.length > 1 ? `다필지 ${parcels.length}개 · 필지별 값(합산 안 함)` : "단일 필지"} · 값 클릭 = 수정
        </small>
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
        <EnumField label="지목" enumKey="jimok" value={p.jimok} onSave={(v) => onSave("jimok", v)} />
        {/* 용도지역 = 걸침(다지역) 가능 → 다중선택. 오버라이드 없으면 건물 use_zone_mix(비중) 표시 */}
        {(() => {
          const mix: ZoneMix = Array.isArray(useZoneMix) ? useZoneMix : (typeof useZoneMix === "string" ? JSON.parse(useZoneMix || "[]") : []);
          const overridden = typeof p.use_zone === "string" && p.use_zone.includes(",");
          const selected = overridden ? p.use_zone!.split(",") : (mix.length ? mix.map((m) => m.명) : p.use_zone ? [p.use_zone] : []);
          const summary = overridden
            ? selected.join(" · ")
            : mix.length
              ? mix.map((m) => (m.비중 < 0.999 ? `${m.명} ${Math.round(m.비중 * 100)}%` : m.명)).join(" · ")
              : (p.use_zone ?? "");
          return (
            <div className="kv" style={{ alignItems: "center" }}><span className="k">용도지역</span>
              <ChipsMulti opts={ZONE_OPTS} selected={selected} summary={summary}
                onChange={(v) => onSave("use_zone", v.join(","))} />
            </div>
          );
        })()}
        <KV label="이용상황" field="land_use" value={p.land_use ?? ""} editable current={p.land_use ?? ""} onSave={onSave} onRevert={onRevert} />
        <EnumField label="지형/형상" enumKey="shape" value={p.shape} onSave={(v) => onSave("shape", v)} />
        <EnumField label="도로접면" enumKey="road_frontage" value={p.road_frontage} onSave={(v) => onSave("road_frontage", v)} />
        <EnumField label="지세" enumKey="slope" value={p.slope} onSave={(v) => onSave("slope", v)} />
        {/* 법정 건폐/용적 = 🔀 조례파생, override 가능(한 줄 두 값 인라인 편집) */}
        <div className="kv"><span className="k">법정 건폐/용적</span>
          <span className="v num" style={{ display: "flex", gap: 5, alignItems: "center", justifyContent: "flex-end" }}>
            <NumCell v={pct(p.legal_bcr)} suffix="%" onSave={(x) => onSave("legal_bcr", x)} /> / <NumCell v={pct(p.legal_far)} suffix="%" onSave={(x) => onSave("legal_far", x)} />
          </span>
        </div>
      </div>

      {/* 규제 2레벨: 건물 요약(OR 집계) + 필지 상세(값 클릭=수정 · 구역명 자유입력·"해당 없음"=미해당) */}
      <div className="sec-head" style={{ fontSize: 13 }}>규제·특례</div>
      <div style={{ padding: "0 14px 8px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
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

      {/* 공시지가(선택 필지) 시계열 + 총공시지가 */}
      <div style={{ borderTop: "1px solid var(--line)" }}>
        <SeriesBlock title="공시지가" color="#1E5AF0" unitLabel="원/㎡"
          points={p.gongsi_series.map(([y, v]) => ({ x: String(y), y: v }))}
          fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}만`} />
      </div>
      <div className="kv-grid" style={{ paddingTop: 0 }}>
        <KV label="최신 공시지가" field="gongsi_latest" calc
          value={man(gongsiLatest)} editable current={gongsiLatest != null ? Math.round(gongsiLatest / 1e4) : ""}
          parse={(v) => String(Math.round(parseFloat(v) * 1e4))} validate={vNonNeg} onSave={onSave} onRevert={onRevert} />
        {/* 총공시지가 = 🔀 자동(단가×면적) or 직접입력(억) */}
        <KV label="총공시지가" field="total_gongsi" calc
          value={eok(num(p.total_gongsi) ?? totalGongsi)} editable
          current={(num(p.total_gongsi) ?? totalGongsi) != null ? +(((num(p.total_gongsi) ?? totalGongsi) as number) / 1e8).toFixed(2) : ""}
          parse={(v) => String(Math.round(parseFloat(v) * 1e8))} validate={vNonNeg} onSave={onSave} onRevert={onRevert} />
      </div>
    </div>
  );
}
