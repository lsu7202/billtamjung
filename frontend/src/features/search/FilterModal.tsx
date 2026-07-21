import { useState } from "react";
import type { AttrFilters } from "../../shared/api/endpoints";

/** S01b 상세검색 필터 모달(베타 부분집합). 백엔드 _filter_sql 지원 필드만 노출.
 *  구조는 명세 §3.1을 따름: 헤더(평/㎡ 토글) · 대표조건 · 하단바(초기화·취소·적용).
 *  정식 예정: 섹터그룹·주용도 36종·듀얼슬라이더·수익률/광고가/매각일 필터. */

// 용도지역 다중선택(§3.3.1 다중선택 알약) — 마스터 분포 상위값
const USE_ZONES = [
  "제1종전용주거지역", "제2종전용주거지역", "제1종일반주거지역", "제2종일반주거지역",
  "제3종일반주거지역", "준주거지역", "근린상업지역", "일반상업지역", "중심상업지역",
  "유통상업지역", "준공업지역", "일반공업지역", "자연녹지지역",
];

const PY = 3.305785; // 1평 = 3.305785㎡

type Draft = {
  use_zones: string[];
  main_use: string;
  land_area_min: string; land_area_max: string;
  total_area_min: string; total_area_max: string;
  floors_above_min: string; floors_above_max: string;
  station_dist_max: string;
};

const EMPTY: Draft = {
  use_zones: [], main_use: "",
  land_area_min: "", land_area_max: "", total_area_min: "", total_area_max: "",
  floors_above_min: "", floors_above_max: "", station_dist_max: "",
};

function toDraft(f: AttrFilters): Draft {
  const s = (n?: number | null) => (n == null ? "" : String(n));
  return {
    use_zones: f.use_zones ?? [],
    main_use: f.main_use ?? "",
    land_area_min: s(f.land_area_min), land_area_max: s(f.land_area_max),
    total_area_min: s(f.total_area_min), total_area_max: s(f.total_area_max),
    floors_above_min: s(f.floors_above_min), floors_above_max: s(f.floors_above_max),
    station_dist_max: s(f.station_dist_max),
  };
}

function toFilters(d: Draft, unit: "m2" | "py"): AttrFilters {
  const num = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // 평 입력이면 ㎡로 환산해 저장(저장단위=㎡, §3.8)
  const area = (v: string): number | null => {
    const n = num(v);
    return n == null ? null : unit === "py" ? Math.round(n * PY) : n;
  };
  // 하한>상한 자동 스왑(§6)
  const range = (lo: number | null, hi: number | null): [number | null, number | null] =>
    lo != null && hi != null && lo > hi ? [hi, lo] : [lo, hi];
  const [laMin, laMax] = range(area(d.land_area_min), area(d.land_area_max));
  const [taMin, taMax] = range(area(d.total_area_min), area(d.total_area_max));
  const [flMin, flMax] = range(num(d.floors_above_min), num(d.floors_above_max));
  return {
    use_zones: d.use_zones.length ? d.use_zones : null,
    main_use: d.main_use.trim() || null,
    land_area_min: laMin, land_area_max: laMax,
    total_area_min: taMin, total_area_max: taMax,
    floors_above_min: flMin, floors_above_max: flMax,
    station_dist_max: num(d.station_dist_max),
  };
}

function countActive(f: AttrFilters): number {
  let n = 0;
  if (f.use_zones?.length) n++;
  if (f.main_use) n++;
  if (f.land_area_min != null || f.land_area_max != null) n++;
  if (f.total_area_min != null || f.total_area_max != null) n++;
  if (f.floors_above_min != null || f.floors_above_max != null) n++;
  if (f.station_dist_max != null) n++;
  return n;
}

export function FilterModal({
  initial, onApply, onClose,
}: {
  initial: AttrFilters;
  onApply: (f: AttrFilters) => void;
  onClose: () => void;
}) {
  const [unit, setUnit] = useState<"m2" | "py">("m2");
  const [d, setD] = useState<Draft>(() => toDraft(initial));
  const set = (k: keyof Draft, v: string | string[]) => setD((p) => ({ ...p, [k]: v }));
  const toggleZone = (z: string) =>
    setD((p) => ({ ...p, use_zones: p.use_zones.includes(z) ? p.use_zones.filter((x) => x !== z) : [...p.use_zones, z] }));

  const active = countActive(toFilters(d, unit));
  const unitLabel = unit === "py" ? "평" : "㎡";

  const Range = ({ label, kMin, kMax, ph }: { label: string; kMin: keyof Draft; kMax: keyof Draft; ph: string }) => (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input className="input" style={{ width: 100 }} inputMode="numeric" placeholder={`${ph} 이상`}
          value={d[kMin] as string} onChange={(e) => set(kMin, e.target.value)} />
        <span style={{ color: "var(--muted)" }}>~</span>
        <input className="input" style={{ width: 100 }} inputMode="numeric" placeholder={`${ph} 이하`}
          value={d[kMax] as string} onChange={(e) => set(kMax, e.target.value)} />
      </div>
    </div>
  );

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div className="panel" onClick={(e) => e.stopPropagation()} style={{
        width: "min(720px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 0,
      }}>
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
          <b style={{ fontSize: 16 }}>상세 검색 필터</b>
          <div style={{ display: "flex", marginLeft: 8 }}>
            <button className={`btn ${unit === "m2" ? "primary" : ""}`} style={{ borderRadius: "6px 0 0 6px", padding: "3px 10px", fontSize: 12 }} onClick={() => setUnit("m2")}>㎡</button>
            <button className={`btn ${unit === "py" ? "primary" : ""}`} style={{ borderRadius: "0 6px 6px 0", borderLeft: 0, padding: "3px 10px", fontSize: 12 }} onClick={() => setUnit("py")}>평</button>
          </div>
          <span style={{ flex: 1 }} />
          <button className="btn" style={{ padding: "3px 10px" }} onClick={onClose}>×</button>
        </div>

        {/* 본체 */}
        <div style={{ padding: 18, overflow: "auto", display: "grid", gap: 18 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>용도지역 <small style={{ color: "var(--muted)", fontWeight: 400 }}>다중선택</small></span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {USE_ZONES.map((z) => (
                <button key={z} className={`btn ${d.use_zones.includes(z) ? "primary" : ""}`}
                  style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => toggleZone(z)}>{z}</button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <Range label={`대지면적 (${unitLabel})`} kMin="land_area_min" kMax="land_area_max" ph={unitLabel} />
            <Range label={`연면적 (${unitLabel})`} kMin="total_area_min" kMax="total_area_max" ph={unitLabel} />
            <Range label="지상 층수" kMin="floors_above_min" kMax="floors_above_max" ph="층" />
            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>역과의 거리</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input className="input" style={{ width: 120 }} inputMode="numeric" placeholder="m 이하"
                  value={d.station_dist_max} onChange={(e) => set("station_dist_max", e.target.value)} />
                <span style={{ color: "var(--muted)", fontSize: 12 }}>m 이내</span>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>주용도 <small style={{ color: "var(--muted)", fontWeight: 400 }}>부분일치</small></span>
            <input className="input" style={{ maxWidth: 260 }} placeholder="예: 근린생활시설"
              value={d.main_use} onChange={(e) => set("main_use", e.target.value)} />
          </div>

          <p style={{ color: "var(--muted)", fontSize: 11, margin: 0 }}>
            수익률·광고가·매각일·용도지역 걸침·섹터그룹 필터는 정식 단계에서 추가됩니다.
          </p>
        </div>

        {/* 하단바 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderTop: "1px solid var(--line)" }}>
          <button className="btn" onClick={() => setD(EMPTY)}>전체 초기화</button>
          <span style={{ flex: 1, fontSize: 13, color: "var(--muted)" }}>적용 조건 <b className="num" style={{ color: "var(--ink)" }}>{active}</b>개</span>
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={() => { onApply(toFilters(d, unit)); onClose(); }}>적용</button>
        </div>
      </div>
    </div>
  );
}

export { countActive };
export type { AttrFilters };
