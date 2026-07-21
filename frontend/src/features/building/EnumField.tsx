import { useEnums } from "../../shared/hooks/useEnums";

/** enum 오버레이 필드 — 드롭다운(라벨=값, enums.md 정본). 선택 즉시 자동저장. specs S02 §5.2. */
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
  return (
    <div className="kv" style={{ alignItems: "center" }}>
      <span className="k">{label}</span>
      <select
        className="input"
        style={{ maxWidth: 150, padding: "4px 8px", fontSize: 13 }}
        value={value ?? "미지정"}
        onChange={(e) => onSave(e.target.value)}
      >
        {opts.length === 0 && <option>{value ?? "미지정"}</option>}
        {opts.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
      </select>
    </div>
  );
}
