/* 타이밍 정본(30fps) — 음원이 확정되면 이 비트맵만 곡 전개에 맞춰 수정한다.
   구조: 인트로(도시 부상) → 빌드업(카피 1·2) → 히트(스캔) → 드랍(단독 점등) → 아웃트로(로고) */
export const BEAT = {
  intro: [0, 55] as const,       // 도시 부상 + 카메라 진입 시작
  copy1: [20, 104] as const,     // "좋은 건물은"
  copy2: [112, 206] as const,    // "매물로 나오지 않습니다."
  copy3: [216, 314] as const,    // "그래서, 직접 찾아냅니다." (히트)
  scan: [222, 288] as const,     // 골드 스캔 스윕
  lightOn: [288, 324] as const,  // 히어로 점등(드랍)
  pulse: [324, 380] as const,    // 정적 · 골드 펄스
  cityOut: [376, 398] as const,
  logo: [394, 450] as const,
  vo: { c1: 22, c2: 114, c3: 218, brand: 404 },
};
export const DUR = 450;
