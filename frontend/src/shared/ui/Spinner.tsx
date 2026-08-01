/** 재사용 로딩 컴포넌트 — 전 화면 일관.
 *  <Spinner/>       : 회전 링(인라인). size(px)·색 조절.
 *  <Loading/>       : 컨테이너 중앙 정렬 + (선택)문구. 패널·모달·페이지 섹션에 삽입.
 *  스타일은 components.css의 .bt-spinner/.bt-loading (전역 keyframe). */

export function Spinner({ size = 22, stroke = 3, color = "var(--signal)" }: {
  size?: number; stroke?: number; color?: string;
}) {
  return (
    <span className="bt-spinner" role="status" aria-label="로딩 중"
      style={{ width: size, height: size, borderWidth: stroke, borderTopColor: color }} />
  );
}

/** 컨테이너를 꽉 채워 중앙에 스피너. 패널/모달/페이지 로딩 표준. */
export function Loading({ label, size = 30, minHeight = 160, pad }: {
  label?: string; size?: number; minHeight?: number | string; pad?: number;
}) {
  return (
    <div className="bt-loading" style={{ minHeight, padding: pad }}>
      <Spinner size={size} />
      {label && <div className="bt-loading-label">{label}</div>}
    </div>
  );
}

/** 부모(position:relative) 위 반투명 오버레이 스피너 — 기존 콘텐츠 위에 겹칠 때(예: 재조회 중). */
export function LoadingOverlay({ label, size = 30 }: { label?: string; size?: number }) {
  return (
    <div className="bt-loading bt-loading-overlay">
      <Spinner size={size} />
      {label && <div className="bt-loading-label">{label}</div>}
    </div>
  );
}
