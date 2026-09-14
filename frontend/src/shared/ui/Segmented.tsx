import type { CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";

export type SegOption<T extends string> = { value: T; label?: string; icon?: IconName; title?: string };

/** 슬라이딩 노브 세그먼트 토글 — 상태 전환에 애니메이션(평↔㎡·매물↔지도 등). 이전 2-버튼 하드스위치 대체. */
export function Segmented<T extends string>({
  value, options, onChange, size = "md", className = "", style,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
  style?: CSSProperties;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const vars = { "--seg-n": options.length, "--seg-i": idx } as CSSProperties;
  return (
    <div className={`bt-seg bt-seg-${size} ${className}`} role="tablist" style={{ ...vars, ...style }}>
      <span className="bt-seg-knob" aria-hidden />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? "on" : ""}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={size === "sm" ? 13 : 15} />}
          {o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}
