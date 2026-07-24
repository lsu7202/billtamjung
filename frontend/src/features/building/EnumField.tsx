import { useState } from "react";
import { useEnums } from "../../shared/hooks/useEnums";

const chipStyle = (on: boolean): React.CSSProperties => ({
  padding: "4px 11px", fontSize: 12, fontWeight: 600, borderRadius: 999, cursor: "pointer",
  border: `1px solid ${on ? "var(--signal)" : "var(--line-2)"}`,
  background: on ? "var(--signal)" : "#fff", color: on ? "#fff" : "var(--ink-2)",
});

/** 단일선택 칩 — 현재값만 표시, 클릭 시 옵션 칩 드롭다운(S01b vchip형). 선택 즉시 저장. */
export function Chips({ opts, cur, onSelect }: { opts: { code: string; label: string }[]; cur: string; onSelect: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const curLabel = opts.find((o) => o.code === cur)?.label ?? cur;
  const has = cur !== "미지정";
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button style={{ ...chipStyle(has), display: "inline-flex", alignItems: "center", gap: 5 }} onClick={() => setOpen((v) => !v)}>
        {curLabel}<span style={{ fontSize: 9, opacity: .65 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 41, background: "#fff",
            border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow)", padding: 8,
            display: "flex", flexWrap: "wrap", gap: 4, width: "max-content", maxWidth: 280 }}>
            {opts.map((o) => (
              <button key={o.code} style={chipStyle(cur === o.code)}
                onClick={() => { onSelect(o.code); setOpen(false); }}>{o.label}</button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

/** enum 오버레이 필드 — 선택 즉시 자동저장. 소형(≤10)은 칩(S01b형), 대형(주용도·지목 등)은 드롭다운. */
export function EnumField({
  label, enumKey, value, onSave,
}: {
  label: string;
  enumKey: string;
  value?: string | null;
  onSave: (v: string) => void;
}) {
  const en = useEnums();
  const opts = en.options(enumKey);
  const cur = value ?? "미지정";

  if (opts.length > 0 && opts.length <= 10) {   // 칩 드롭다운(S01b vchip형)
    return (
      <div className="kv" style={{ alignItems: "center" }}>
        <span className="k">{label}</span>
        <Chips opts={opts} cur={cur} onSelect={onSave} />
      </div>
    );
  }

  return (   // 대형 enum(주용도 38·지목 28·도로접면 13 등)은 드롭다운 유지
    <div className="kv" style={{ alignItems: "center" }}>
      <span className="k">{label}</span>
      <select className="input" style={{ maxWidth: 150, padding: "4px 8px", fontSize: 13 }}
        value={cur} onChange={(e) => onSave(e.target.value)}>
        {opts.length === 0 && <option>{cur}</option>}
        {opts.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
      </select>
    </div>
  );
}
