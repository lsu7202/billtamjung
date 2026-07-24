import { useEnums } from "../../shared/hooks/useEnums";

/** 단일선택 칩(S01b형) — 선택값 하이라이트, 클릭 즉시 저장. BuildingPage·Sidebar 공용. */
export function Chips({ opts, cur, onSelect }: { opts: { code: string; label: string }[]; cur: string; onSelect: (code: string) => void }) {
  const chip = (on: boolean): React.CSSProperties => ({
    padding: "4px 11px", fontSize: 12, fontWeight: 600, borderRadius: 999, cursor: "pointer",
    border: `1px solid ${on ? "var(--signal)" : "var(--line-2)"}`,
    background: on ? "var(--signal)" : "#fff", color: on ? "#fff" : "var(--ink-2)",
  });
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>
      {opts.map((o) => <button key={o.code} style={chip(cur === o.code)} onClick={() => onSelect(o.code)}>{o.label}</button>)}
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

  if (opts.length > 0 && opts.length <= 10) {   // 칩 형태(S01b 정합)
    return (
      <div className="kv" style={{ alignItems: "flex-start" }}>
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
