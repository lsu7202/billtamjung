import { useState } from "react";
import { Icon } from "../../shared/ui/Icon";
import { useEnums } from "../../shared/hooks/useEnums";

type Opt = { code: string; label: string };

const chipStyle = (on: boolean): React.CSSProperties => ({
  padding: "4px 11px", fontSize: 12, fontWeight: on ? 700 : 600, borderRadius: 999, cursor: "pointer",   // 선택=굵게
  border: `1px solid ${on ? "var(--signal)" : "var(--line-2)"}`,
  background: on ? "var(--signal-bg)" : "#fff", color: on ? "var(--signal)" : "var(--ink-2)",
});
// 트리거: 값 선택 시 굵고 진하게(값=굵게 통일) · 미지정은 흐리게(지금대로)
const triggerStyle = (has: boolean): React.CSSProperties => ({
  padding: "4px 11px", fontSize: 12, fontWeight: has ? 700 : 500, borderRadius: 999, cursor: "pointer",
  border: "1px solid var(--line-2)", background: "#fff", color: has ? "var(--ink)" : "var(--muted)",
  display: "inline-flex", alignItems: "center", gap: 5,
});
const popStyle = (big: boolean): React.CSSProperties => ({
  position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 41, background: "#fff",
  border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow)", padding: 8,
  width: "max-content", maxWidth: 320, maxHeight: big ? 280 : undefined, overflowY: big ? "auto" : "visible",
});
const searchStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", marginBottom: 8, padding: "5px 9px", fontSize: 12,
  border: "1px solid var(--line-2)", borderRadius: 8,
};

const revertLink: React.CSSProperties = {
  display: "block", width: "100%", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)",
  background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--muted)", textAlign: "left",
};

/** 단일선택 칩 — 현재값 트리거(중립), 클릭 시 옵션 칩 드롭다운. 옵션 많으면 검색+스크롤. onRevert=마스터 원본. */
export function Chips({ opts, cur, onSelect, onRevert }: { opts: Opt[]; cur: string; onSelect: (code: string) => void; onRevert?: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const curLabel = opts.find((o) => o.code === cur)?.label ?? cur;
  const big = opts.length > 12;
  const shown = q ? opts.filter((o) => o.label.includes(q)) : opts;
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button style={triggerStyle(cur !== "미지정")} onClick={() => { setOpen((v) => !v); setQ(""); }}>
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
            {onRevert && <button style={revertLink} onClick={() => { onRevert(); setOpen(false); }}><Icon name="undo" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />마스터 원본으로 되돌리기</button>}
          </div>
        </>
      )}
    </span>
  );
}

/** 다중선택 칩 — 용도지역 걸침 등. 선택값 여러 개 유지(팝오버 안 닫힘), 검색+스크롤. */
export function ChipsMulti({ opts, selected, onChange, summary, onRevert }: {
  opts: Opt[]; selected: string[]; onChange: (v: string[]) => void; summary: string; onRevert?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const big = opts.length > 12;
  const shown = q ? opts.filter((o) => o.label.includes(q)) : opts;
  const toggle = (code: string) => onChange(selected.includes(code) ? selected.filter((x) => x !== code) : [...selected, code]);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button style={triggerStyle(selected.length > 0)} onClick={() => { setOpen((v) => !v); setQ(""); }}>
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
            {onRevert && <button style={revertLink} onClick={() => { onRevert(); setOpen(false); }}><Icon name="undo" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />마스터 원본으로 되돌리기</button>}
          </div>
        </>
      )}
    </span>
  );
}

/** enum 오버레이 필드 — 선택 즉시 자동저장. 전부 칩 드롭다운(대형은 검색). onRevert=마스터 원본. */
export function EnumField({ label, enumKey, value, onSave, onRevert }: {
  label: string; enumKey: string; value?: string | null; onSave: (v: string) => void; onRevert?: () => void;
}) {
  const en = useEnums();
  const opts = en.options(enumKey);
  const cur = value ?? "미지정";
  return (
    <div className="kv" style={{ alignItems: "center" }}>
      <span className="k">{label}</span>
      <Chips opts={opts} cur={cur} onSelect={onSave} onRevert={onRevert} />
    </div>
  );
}
