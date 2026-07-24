import { useState } from "react";

/* 인라인 편집 범위검증(§3.4 "타입별 검증"). BuildingPage·ParcelBlock 공유. */
export type Validate = (v: string) => string | null;
export const vRate100: Validate = (v) => { const n = parseFloat(v); if (Number.isNaN(n)) return "숫자를 입력하세요"; if (n < 0 || n > 100) return "0~100% 범위"; return null; };
export const vNonNeg: Validate = (v) => { const n = parseFloat(v); if (Number.isNaN(n)) return "숫자를 입력하세요"; if (n < 0) return "0 이상 값"; return null; };
export const vPos: Validate = (v) => { const n = parseFloat(v); if (Number.isNaN(n)) return "숫자를 입력하세요"; if (n <= 0) return "0보다 커야 함"; return null; };
export const vInt: Validate = (v) => { if (!/^\d+$/.test(v.trim())) return "자연수(0 이상 정수)만"; return null; };   // 층수·엘베·주차
const todayYmd = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
export const vYmd: Validate = (v) => { if (!/^\d{8}$/.test(v.replace(/-/g, ""))) return "YYYYMMDD 형식"; if (v.replace(/-/g, "") > todayYmd()) return "미래 날짜 불가"; return null; };

/* 인라인 숫자 셀(클릭→수정→blur 저장) — 여러 값 한 줄 편집용(층수·법정건폐/용적 등). digitsOnly=자연수. */
export function NumCell({ v, onSave, digitsOnly, suffix, width = 48 }: { v: unknown; onSave: (v: string) => void; digitsOnly?: boolean; suffix?: string; width?: number }) {
  const [ed, setEd] = useState(false);
  const [val, setVal] = useState("");
  if (ed) return (
    <input className="input" style={{ width, padding: "2px 6px", textAlign: "right" }} autoFocus value={val}
      onChange={(e) => setVal(digitsOnly ? e.target.value.replace(/[^\d]/g, "") : e.target.value.replace(/[^\d.]/g, ""))}
      onBlur={() => { setEd(false); if (val !== "" && val !== String(v ?? "")) onSave(val); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }} />
  );
  return <b style={{ cursor: "pointer" }} title="클릭 = 수정" onClick={() => { setVal(String(v ?? "")); setEd(true); }}>{(v ?? "—") as React.ReactNode}{v != null && suffix}</b>;
}

/* 층수 통합 행(목업: "지상 N · 지하 N" 한 줄) — 지상/지하 각각 자연수 인라인 편집. */
export function FloorsRow({ above, below, onSave }: { above: unknown; below: unknown; onSave: (f: string, v: string) => void }) {
  return (
    <div className="kv"><span className="k">층수</span>
      <span className="v num" style={{ display: "flex", gap: 5, alignItems: "center", justifyContent: "flex-end" }}>
        지상 <NumCell v={above} digitsOnly onSave={(x) => onSave("floors_above", x)} /> · 지하 <NumCell v={below} digitsOnly onSave={(x) => onSave("floors_below", x)} />
      </span>
    </div>
  );
}

/* 마스터 표시 + 유저 오버레이 인라인 편집(값 클릭→수정→자동저장·검증·↺되돌리기). 최상위=편집 중 리마운트 방지 */
export interface KVProps {
  label: string; field?: string; value: React.ReactNode; unit?: string; editable?: boolean; calc?: boolean;
  validate?: Validate; current?: unknown; parse?: (v: string) => string;   // parse: 입력→저장값 변환(평→㎡·억→원)
  onSave?: (field: string, value: string) => void; onRevert?: (field: string) => void;
}
export function KV({ label, field, value, unit: u, editable, validate, current, parse, onSave, onRevert }: KVProps) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  function commit() {
    const e = validate && val ? validate(val) : null;
    if (e) { setErr(e); return; }                   // 오류 → 저장 안 함, 편집 유지
    setErr(null); setEditing(false);
    if (val && field) onSave?.(field, parse ? parse(val) : val);
  }
  if (editable && field && editing) {
    return (
      <div className="kv"><span className="k">{label}</span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input className="input" style={{ maxWidth: 110, padding: "3px 8px", borderColor: err ? "var(--up)" : undefined }} autoFocus value={val}
              onChange={(e) => { setVal(e.target.value); if (err) setErr(null); }}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setErr(null); setEditing(false); } }} />
            {/* ↺ = 편집 중에만 노출. mousedown preventDefault로 blur-commit 차단 후 되돌리기 */}
            <button className="btn" style={{ padding: "0 6px", fontSize: 11 }}
              onMouseDown={(e) => { e.preventDefault(); setErr(null); setEditing(false); onRevert?.(field); }}
              title="마스터 원본으로 되돌리기">↺</button>
          </span>
          {err && <span style={{ fontSize: 10, color: "var(--up)" }}>{err}</span>}
        </span>
      </div>
    );
  }
  const empty = value == null || value === "";
  const canEdit = !!(editable && field);
  return (
    <div className="kv"><span className="k">{label}</span>
      <span className="v num" style={{
        ...(canEdit ? { cursor: "pointer", display: "inline-block", minWidth: empty ? 44 : undefined, minHeight: "1.1em" } : {}),
      }}
        onClick={canEdit ? () => { setVal(String(current ?? "")); setErr(null); setEditing(true); } : undefined}
        title={editable ? "클릭 = 수정(자동저장)" : undefined}>
        {empty ? "" : <>{value}{u}</>}
      </span>
    </div>
  );
}
