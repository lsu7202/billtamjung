import { useState } from "react";
import { Icon } from "../../shared/ui/Icon";

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
export const formatPhone = (v: string): string => {   // 전화번호 자동 하이픈(휴대폰·서울02·지역번호)
  const d = v.replace(/[^\d]/g, "").slice(0, 11);
  if (d.startsWith("02")) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  if (d.length <= 3) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;   // 10자리 = 3-3-4
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;                     // 11자리(휴대폰) = 3-4-4
};

export const wonToEok = (won: unknown): string => {   // 원(콤마 허용) → "45억"/"45.23억" (0=빈칸)
  const n = Number(String(won ?? "").replace(/,/g, ""));
  if (!n || Number.isNaN(n)) return "";
  const e = n / 1e8;
  return Number.isInteger(e) ? `${e}억` : `${e.toFixed(2)}억`;
};

/** 금액 입력 파서 — 중개인이 말하는 대로 친다. "1500억" · "15억5000만" · "1500.1억" · "1,500,000,000".
 *  단위가 없으면 원 그대로다(기존 입력법 그대로). 해석 불가면 null.
 *  숫자만 남기고 지우던 예전 방식은 "1500억"을 1500원으로, "1500.1"을 15001로 만들었다. */
export function parseWon(text: string): number | null {
  const t = String(text).replace(/[\s,]/g, "");
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));          // 단위 없음 = 원
  const UNIT: Record<string, number> = { 조: 1e12, 억: 1e8, 만: 1e4, 천: 1e3, 원: 1 };
  // 단위 조각을 순서대로 훑는다 — 조각 사이에 단위 없는 꼬리가 붙으면(15억5000) 마지막 단위의 1/10000로 본다
  const re = /(\d+(?:\.\d+)?)(조|억|만|천|원)?/g;
  let m: RegExpExecArray | null, sum = 0, last = 0, seen = false;
  while ((m = re.exec(t))) {
    const n = Number(m[1]);
    if (m[2]) { sum += n * UNIT[m[2]]; last = UNIT[m[2]]; seen = true; }
    else if (last >= 1e4) sum += n * (last / 1e4);                     // 15억5000 → 5000만
    else return null;
  }
  return seen && sum > 0 ? Math.round(sum) : null;
}

export interface KVProps {
  label: string; field?: string; value: React.ReactNode; unit?: string; editable?: boolean; calc?: boolean;
  validate?: Validate; current?: unknown; parse?: (v: string) => string;   // parse: 입력→저장값 변환(평→㎡·억→원)
  money?: boolean;   // 금액: 원 단위 입력 + 실시간 억 표시(노출은 억)
  format?: (v: string) => string;   // 텍스트 라이브 포맷(전화번호 하이픈 등)
  onSave?: (field: string, value: string) => void; onRevert?: (field: string) => void;
}
export function KV({ label, field, value, unit: u, editable, validate, current, parse, money, format, onSave, onRevert }: KVProps) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  function commit() {
    // 금액은 억·만 표기를 받아 원 단위로 정규화한다. 해석 불가는 오류로 세워 값을 삼키지 않는다.
    let raw = val;
    if (money && val.trim()) {
      const w = parseWon(val);
      if (w == null) { setErr("금액을 알아볼 수 없습니다 — 예: 15억 · 15억5000만 · 1500000000"); return; }
      raw = String(w);
    }
    const e = validate && raw ? validate(raw) : null;
    if (e) { setErr(e); return; }                   // 오류 → 저장 안 함, 편집 유지
    setErr(null); setEditing(false);
    if (raw && field) onSave?.(field, parse ? parse(raw) : raw);
  }
  if (editable && field && editing) {
    return (
      <div className="kv"><span className="k">{label}</span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input className="input" inputMode={money ? "numeric" : undefined}
              style={{ maxWidth: money ? 120 : 110, padding: "3px 8px", textAlign: money ? "right" : undefined, borderColor: err ? "var(--up)" : undefined }} autoFocus value={val}
              onChange={(e) => {
                if (money) {
                  const t = e.target.value.replace(/[^\d.,조억만천원]/g, "");
                  // 순수 숫자면 예전처럼 콤마를 붙여 읽기 쉽게, 단위가 섞이면 친 그대로 둔다
                  const d = t.replace(/,/g, "");
                  setVal(/^\d+$/.test(d) ? Number(d).toLocaleString() : t);
                }
                else setVal(format ? format(e.target.value) : e.target.value);
                if (err) setErr(null);
              }}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setErr(null); setEditing(false); } }} />
            {money && <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 40 }}>{wonToEok(parseWon(val) ?? "") || "—"}</span>}
            {/* ↺ = 편집 중에만 노출. mousedown preventDefault로 blur-commit 차단 후 되돌리기 */}
            <button className="btn" style={{ padding: "0 6px", fontSize: 11 }}
              onMouseDown={(e) => { e.preventDefault(); setErr(null); setEditing(false); onRevert?.(field); }}
              title="마스터 원본으로 되돌리기"><Icon name="undo" size={13} /></button>
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
        onClick={canEdit ? () => { setVal(money && current ? Number(String(current).replace(/,/g, "")).toLocaleString() : String(current ?? "")); setErr(null); setEditing(true); } : undefined}
        title={editable ? "클릭 = 수정(자동저장)" : undefined}>
        {empty ? "" : <>{value}{u}</>}
      </span>
    </div>
  );
}
