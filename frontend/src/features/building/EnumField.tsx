import { useState } from "react";
import { useEnums } from "../../shared/hooks/useEnums";

type Opt = { code: string; label: string };

const chipStyle = (on: boolean): React.CSSProperties => ({
  padding: "4px 11px", fontSize: 12, fontWeight: 600, borderRadius: 999, cursor: "pointer",
  border: `1px solid ${on ? "var(--signal)" : "var(--line-2)"}`,
  background: on ? "var(--signal-bg)" : "#fff", color: on ? "var(--signal)" : "var(--ink-2)",   // 선택=연한 강조(파란 채움 아님)
});
const triggerStyle: React.CSSProperties = {   // 트리거는 항상 중립(값 강조 없음)
  padding: "4px 11px", fontSize: 12, fontWeight: 600, borderRadius: 999, cursor: "pointer",
  border: "1px solid var(--line-2)", background: "#fff", color: "var(--ink-2)",
  display: "inline-flex", alignItems: "center", gap: 5,
};
const popStyle = (big: boolean): React.CSSProperties => ({
  position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 41, background: "#fff",
  border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow)", padding: 8,
  width: "max-content", maxWidth: 320, maxHeight: big ? 280 : undefined, overflowY: big ? "auto" : "visible",
});
const searchStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", marginBottom: 8, padding: "5px 9px", fontSize: 12,
  border: "1px solid var(--line-2)", borderRadius: 8,
};

/** 단일선택 칩 — 현재값 트리거(중립), 클릭 시 옵션 칩 드롭다운. 옵션 많으면 검색+스크롤. */
export function Chips({ opts, cur, onSelect }: { opts: Opt[]; cur: string; onSelect: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const curLabel = opts.find((o) => o.code === cur)?.label ?? cur;
  const big = opts.length > 12;
  const shown = q ? opts.filter((o) => o.label.includes(q)) : opts;
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button style={triggerStyle} onClick={() => { setOpen((v) => !v); setQ(""); }}>
        {curLabel}<span style={{ fontSize: 9, opacity: .65 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={popStyle(big)} onClick={(e) => e.stopPropagation()}>
            {big && <input autoFocus placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} style={searchStyle} />}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {shown.map((o) => (
                <button key={o.code} style={chipStyle(o.code === cur)}
                  onClick={() => { onSelect(o.code); setOpen(false); }}>{o.label}</button>
              ))}
            </div>
          </div>
        </>
      )}
    </span>
  );
}

/** 다중선택 칩 — 용도지역 걸침 등. 선택값 여러 개 유지(팝오버 안 닫힘), 검색+스크롤. */
export function ChipsMulti({ opts, selected, onChange, summary }: {
  opts: Opt[]; selected: string[]; onChange: (v: string[]) => void; summary: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const big = opts.length > 12;
  const shown = q ? opts.filter((o) => o.label.includes(q)) : opts;
  const toggle = (code: string) => onChange(selected.includes(code) ? selected.filter((x) => x !== code) : [...selected, code]);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button style={triggerStyle} onClick={() => { setOpen((v) => !v); setQ(""); }}>
        {summary || "미지정"}<span style={{ fontSize: 9, opacity: .65 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={popStyle(big)} onClick={(e) => e.stopPropagation()}>
            {big && <input autoFocus placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} style={searchStyle} />}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {shown.map((o) => (
                <button key={o.code} style={chipStyle(selected.includes(o.code))} onClick={() => toggle(o.code)}>{o.label}</button>
              ))}
            </div>
          </div>
        </>
      )}
    </span>
  );
}

/** enum 오버레이 필드 — 선택 즉시 자동저장. 전부 칩 드롭다운(대형은 검색). */
export function EnumField({ label, enumKey, value, onSave }: {
  label: string; enumKey: string; value?: string | null; onSave: (v: string) => void;
}) {
  const en = useEnums();
  const opts = en.options(enumKey);
  const cur = value ?? "미지정";
  return (
    <div className="kv" style={{ alignItems: "center" }}>
      <span className="k">{label}</span>
      <Chips opts={opts} cur={cur} onSelect={onSave} />
    </div>
  );
}
