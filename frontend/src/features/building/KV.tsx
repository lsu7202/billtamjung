import { useState } from "react";

/* 인라인 편집 범위검증(§3.4 "타입별 검증"). BuildingPage·ParcelBlock 공유. */
export type Validate = (v: string) => string | null;
export const vRate100: Validate = (v) => { const n = parseFloat(v); if (Number.isNaN(n)) return "숫자를 입력하세요"; if (n < 0 || n > 100) return "0~100% 범위"; return null; };
export const vNonNeg: Validate = (v) => { const n = parseFloat(v); if (Number.isNaN(n)) return "숫자를 입력하세요"; if (n < 0) return "0 이상 값"; return null; };
export const vPos: Validate = (v) => { const n = parseFloat(v); if (Number.isNaN(n)) return "숫자를 입력하세요"; if (n <= 0) return "0보다 커야 함"; return null; };
const todayYmd = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
export const vYmd: Validate = (v) => { if (!/^\d{8}$/.test(v.replace(/-/g, ""))) return "YYYYMMDD 형식"; if (v.replace(/-/g, "") > todayYmd()) return "미래 날짜 불가"; return null; };

/* 마스터 표시 + 유저 오버레이 인라인 편집(값 클릭→수정→자동저장·검증·↺되돌리기). 최상위=편집 중 리마운트 방지 */
export interface KVProps {
  label: string; field?: string; value: React.ReactNode; unit?: string; editable?: boolean; calc?: boolean;
  validate?: Validate; current?: unknown; parse?: (v: string) => string;   // parse: 입력→저장값 변환(평→㎡·억→원)
  onSave?: (field: string, value: string) => void; onRevert?: (field: string) => void;
}
export function KV({ label, field, value, unit: u, editable, calc, validate, current, parse, onSave, onRevert }: KVProps) {
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
          <input className="input" style={{ maxWidth: 110, padding: "3px 8px", borderColor: err ? "var(--up)" : undefined }} autoFocus value={val}
            onChange={(e) => { setVal(e.target.value); if (err) setErr(null); }}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setErr(null); setEditing(false); } }} />
          {err && <span style={{ fontSize: 10, color: "var(--up)" }}>{err}</span>}
        </span>
      </div>
    );
  }
  return (
    <div className="kv"><span className="k">{label}</span>
      <span className="v num" style={{ ...(editable ? { cursor: "pointer" } : {}), ...(calc ? { color: "var(--signal)" } : {}) }}
        onClick={editable && field ? () => { setVal(String(current ?? "")); setErr(null); setEditing(true); } : undefined}
        title={editable ? "클릭 = 수정(자동저장)" : undefined}>
        {value}{u}
        {editable && field && (
          <button className="btn" style={{ marginLeft: 6, padding: "0 6px", fontSize: 11 }}
            onClick={(e) => { e.stopPropagation(); onRevert?.(field); }} title="마스터 원본으로 되돌리기">↺</button>
        )}
      </span>
    </div>
  );
}
