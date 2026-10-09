// 출처 표기 + 추정 주의 — 평소엔 최소 노출, 호버로 펼침. (V-World 등 출처 표기로 영리 사용 가능)
import { Icon, type IconName } from "./Icon";

const SOURCES: { icon: IconName; label: string; by: string }[] = [
  { icon: "source", label: "공간정보", by: "브이월드 / 국토교통부" },
  { icon: "building", label: "건축물대장", by: "건축HUB" },
  { icon: "trend", label: "실거래가", by: "국토교통부" },
];

/** 지도·카드 구석의 작은 '출처' 태그 — 호버 시 출처 목록 + 이용약관 안내. */
export function SourceTag({ className }: { className?: string }) {
  return (
    <span className={"bt-src" + (className ? " " + className : "")}>
      <span className="bt-src-tag"><Icon name="info" size={12} /> 출처</span>
      <span className="bt-src-pop" role="tooltip">
        <b>데이터 출처</b>
        {SOURCES.map((s) => (
          <span key={s.label} className="bt-src-row">
            <Icon name={s.icon} size={14} />{s.label} · <em>{s.by}</em>
          </span>
        ))}
        <span className="bt-src-tos">전체 출처 · 라이선스 → 이용약관</span>
      </span>
    </span>
  );
}


