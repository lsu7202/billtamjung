import { EVENT_TYPES } from "./eventIcon";
import type { IconName } from "../ui/Icon";

/** 지도 소식 판(2026-09-06 대표 확정) — 「소식」 버튼 하나를 누르면 열린다.
 *  위엔 기간 칩(1년 기본), 아래엔 종류 아홉 줄: 아이콘 · 이름 · 지금 화면 안 개수. 줄을 누르면 켜고 끈다 —
 *  켜진 줄은 파랑, 꺼진 줄은 회색. 토글 스위치는 없다. 처음엔 주요 일곱이 켜져 있다.
 *  `only` 를 주면 그 종류만 세운다(사이드바 = 이 건물 반경 안에 있는 종류만). */
export function NewsFilterPanel({ years, onYears, types, onTypes, counts, only, compact, onAll }: {
  years: number; onYears: (y: number) => void;
  types: IconName[]; onTypes: (v: IconName[]) => void;
  counts?: Partial<Record<IconName, number>>;
  only?: IconName[];
  compact?: boolean;
  /** 「전체보기 ›」 — 서울 전체 소식 화면(/news)으로. 레일에서 소식을 뺀 자리(2026-09-30) */
  onAll?: () => void;
}) {
  const on = new Set(types);
  const rows = only ? EVENT_TYPES.filter((t) => only.includes(t.icon)) : EVENT_TYPES;
  return (
    <div className={`ev-pan ${compact ? "compact" : ""}`}>
      {!compact && <div className="ev-ph">소식{onAll && <button className="ev-all-link" onClick={onAll}>전체보기 ›</button>}</div>}
      <div className="ev-yrs">
        {([[1, "1년"], [3, "3년"], [5, "5년"], [0, "전체"]] as const).map(([v, t]) => (
          <button key={t} className={years === v ? "on" : ""} onClick={() => onYears(v)}>{t}</button>
        ))}
      </div>
      {rows.map((t) => (
        <button key={t.icon} className={`ev-ty ${on.has(t.icon) ? "on" : ""}`}
          onClick={() => onTypes(on.has(t.icon) ? types.filter((x) => x !== t.icon) : [...types, t.icon])}>
          <span className="i"><svg><use href={`#bt-${t.icon}`} /></svg></span>
          <span className="l">{t.label}</span>
          {counts && <span className="n">{counts[t.icon] ?? 0}</span>}
        </button>
      ))}
    </div>
  );
}
