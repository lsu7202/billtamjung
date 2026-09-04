import { useState, type ReactNode } from "react";
import { Icon } from "../../shared/ui/Icon";
import { Chips } from "./EnumField";
import { useEnums } from "../../shared/hooks/useEnums";
import type { Validate } from "./KV";

/** 건물 상세의 값 줄 — 통합 매물 모달과 같은 어법(shared/ui/row.css).
 *
 *  라벨 왼쪽 · 현재 값 오른쪽 · 없으면 「—」. 선은 없고 여백이 칸을 나눈다.
 *  치는 값은 값만 눌러 그 자리에서 입력칸이 되고, 고르는 값은 줄을 눌러 아래로 칩이 펼쳐진다.
 *
 *  팀이 고친 값은 파랗고 곁말에 대장 원본이 뜬다(buildings.get 의 `_edited`·`_master`).
 *  ↺는 고친 줄에 올렸을 때만 — 대장 값 그대로인 줄엔 되돌릴 게 없다(2026-08-25).
 */

/** 치는 값 한 줄. cur=편집 시작값(표시값과 다를 수 있다: 평↔㎡·억↔원) */
export function TextRow({ label, value, unit, cur, edited, master, ref_, parse, validate, onSave, onRevert, lock }: {
  label: string; value: ReactNode; unit?: string;
  cur?: unknown; edited?: boolean; master?: ReactNode;
  /** 참조값 — 대장이 본값이고 이건 옆에 작게만 선다(2026-09-04).
   *  승강기공단 대수, 계산 건폐·용적처럼 출처가 다른 값. 고친 줄이면 대장 곁말이 이긴다. */
  ref_?: ReactNode;
  parse?: (v: string) => string; validate?: Validate;
  onSave?: (v: string) => void; onRevert?: () => void;
  /** 정본이라 손댈 수 없는 줄(2026-08-28) — 국토부 원천과 100% 일치하는 값에 쓴다.
   *  커서도 hover 도 안 준다. 누를 수 있어 보이면 눌러 보게 된다. */
  lock?: boolean;
}) {
  const [ed, setEd] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const empty = value == null || value === "";

  function commit() {
    const raw = val.trim();
    if (!raw) { setEd(false); setErr(null); return; }        // 빈 입력은 저장 안 함(값을 삼키지 않는다)
    const e = validate?.(raw) ?? null;
    if (e) { setErr(e); return; }                            // 오류 → 편집 유지
    setErr(null); setEd(false);
    onSave?.(parse ? parse(raw) : raw);
  }

  if (ed && !lock) return (
    <div className="orow">
      <span className="who g">{label}</span><span className="cap" />
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
        <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input className="um-in" autoFocus value={val} style={{ width: 120, textAlign: "right", ...(err ? { boxShadow: "0 0 0 2px #F04452 inset" } : {}) }}
            onChange={(e) => { setVal(e.target.value); if (err) setErr(null); }}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setErr(null); setEd(false); } }} />
          {unit && <span style={{ fontSize: 12, fontWeight: 700, color: "#6B7684" }}>{unit}</span>}
        </span>
        {err && <span style={{ fontSize: 10.5, color: "#F04452", fontWeight: 700 }}>{err}</span>}
      </span>
      <span className="okpad" />
    </div>
  );

  return (
    <div className={lock ? "orow lock" : "orow"}>
      <span className="who g">{label}</span>
      {/* 고친 줄에만 대장 원본을 곁말로 — 「원래 얼마였더라」를 되돌려 보지 않아도 안다.
          대장이 비어 있던 칸이면 「대장 —」이라 적는다. 아무 말도 안 하면 우리가 채운 값인지 모른다 */}
      <span className="cap">{edited ? <>대장 {master ?? "—"}</> : ref_ ? <span className="refv">{ref_}</span> : ""}</span>
      {edited && <span className="dot" />}
      <span className={`ev ${empty ? "off" : ""} ${edited ? "ed" : ""}`}
        style={onSave && !lock ? { cursor: "pointer" } : undefined}
        onClick={onSave && !lock ? () => { setVal(String(cur ?? "")); setErr(null); setEd(true); } : undefined}>
        {empty ? "—" : <>{value}{unit}</>}
      </span>
      <span className="okpad">
        {edited && onRevert && (
          <span className="act">
            <button className="mini" title="대장 값으로 되돌리기" onClick={onRevert}>
              <Icon name="undo" size={12} /></button>
          </span>
        )}
      </span>
    </div>
  );
}

/** 층수 줄 — 지상·지하 두 값이 한 줄에 산다. 값을 각각 눌러 그 자리에서 고친다 */
export function FloorsRow2({ above, below, onSave }: {
  above: unknown; below: unknown; onSave: (f: string, v: string) => void;
}) {
  const cell = (v: unknown, f: string) => <Num v={v} onSave={(x) => onSave(f, x)} />;
  return (
    <div className="orow">
      <span className="who g">층수</span><span className="cap" />
      <span className="ev" style={{ display: "inline-flex", gap: 5, alignItems: "baseline" }}>
        지상 {cell(above, "floors_above")} · 지하 {cell(below, "floors_below")}
      </span>
      <span className="okpad" />
    </div>
  );
}

function Num({ v, onSave }: { v: unknown; onSave: (v: string) => void }) {
  const [ed, setEd] = useState(false);
  const [val, setVal] = useState("");
  if (ed) return (
    <input className="um-in" autoFocus value={val}
      style={{ width: 52, padding: "3px 8px", textAlign: "right", fontSize: 14 }}
      onChange={(e) => setVal(e.target.value.replace(/[^\d]/g, ""))}
      onBlur={() => { setEd(false); if (val !== "" && val !== String(v ?? "")) onSave(val); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }} />
  );
  return (
    <b style={{ cursor: "pointer", fontWeight: 800 }} title="클릭 = 수정"
      onClick={() => { setVal(String(v ?? "")); setEd(true); }}>{(v ?? "—") as ReactNode}</b>
  );
}

/** 고르는 값 한 줄 — 줄을 누르면 그 아래로 칩이 펼쳐진다(모달 정보 탭과 같다) */
export function EnumRow({ label, enumKey, value, edited, master, onSave, onRevert, lock }: {
  label: string; enumKey: string; value?: string | null; edited?: boolean; master?: string | null;
  onSave: (v: string) => void; onRevert?: () => void;
  /** 정본이라 손댈 수 없는 줄 — 칩을 펴지 않는다(2026-08-28) */
  lock?: boolean;
}) {
  const { options } = useEnums();
  const [open, setOpen] = useState(false);
  const opts = options(enumKey);
  const cur = value ?? "미지정";
  const label2 = opts.find((o) => o.code === cur)?.label ?? (cur === "미지정" ? null : cur);
  const mLabel = master ? (opts.find((o) => o.code === master)?.label ?? master) : null;
  return (
    <div className={`eitem ${open ? "open" : ""}`}>
      <div className={lock ? "orow lock" : "orow has"} onClick={lock ? undefined : () => setOpen((v) => !v)}>
        <span className="who g">{label}</span>
        <span className="cap">{edited ? `대장 ${mLabel ?? "—"}` : ""}</span>
        {edited && <span className="dot" />}
        <span className={`ev ${label2 ? "" : "off"} ${edited ? "ed" : ""}`}>{label2 ?? "—"}</span>
        <span className="okpad" />
      </div>
      {open && !lock && (
        <div className="eexp" onClick={(e) => e.stopPropagation()}>
          <Chips mode="inline" enumKey={enumKey} opts={opts} cur={cur}
            onSelect={(v) => { onSave(v); setOpen(false); }}
            onRevert={edited && onRevert ? () => { onRevert(); setOpen(false); } : undefined} />
        </div>
      )}
    </div>
  );
}
