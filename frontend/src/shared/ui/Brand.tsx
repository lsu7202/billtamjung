// 빌탐정 브랜드 — ㅂ 심볼(#bt-mA) + 워드마크(Pretendard) + 로고 락업.
// 전제: <IconSprite/>가 마운트되어 있어야 심볼 참조 가능. CSS는 tokens.css(.bt-*).
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      <use href="#bt-mA" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={"bt-wordmark" + (className ? " " + className : "")}>
      빌탐정<span className="bt-dot">.</span>
    </span>
  );
}

export function Logo({ markSize = 24, className }: { markSize?: number; className?: string }) {
  return (
    <span className={"bt-logo" + (className ? " " + className : "")} aria-label="빌탐정">
      <BrandMark size={markSize} />
      <Wordmark />
    </span>
  );
}
