/* 빌탐정 브랜드 토큰 — frontend tokens.css에서 이식(광고용 잉크 무드) */
export const C = {
  bg: "#1A1714",        // 잉크 어둠(랜딩보다 반 톤 깊게)
  bldg: "#26211C",      // 건물 실루엣
  bldgEdge: "#332C25",  // 상단 모서리 미광
  window: "#2E2722",    // 불 꺼진 창
  windowDim: "#4A3E2E", // 희미한 생활광
  gold: "#E7C876",
  goldDeep: "#B99327",
  terra: "#C2571C",
  text: "#EDE8E1",
  muted: "#A79E92",
};

export const FONT = "Pretendard";

/* 결정적 난수(mulberry32) — 렌더 프레임마다 동일해야 함 */
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
