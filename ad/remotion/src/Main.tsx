import React from "react";
import {
  AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig,
  Easing, staticFile, continueRender, delayRender, spring, Audio,
} from "remotion";
import { C, FONT } from "./brand";
import { BEAT } from "./timing";
import { City3D } from "./City3D";

/* 음원 — 분석 결과: 15.3s 지점 리프트 → 점등(comp 288f=9.6s)에 정렬되게 171f(5.7s)부터 재생 */
const MUSIC = "music.mp3";
const MUSIC_OFFSET = 171;

let loaded = false;
const useFont = () => {
  const [h] = React.useState(() => (loaded ? null : delayRender("font")));
  React.useEffect(() => {
    if (h == null) return;
    const f = new FontFace(FONT, `url(${staticFile("fonts/PretendardVariable.woff2")})`, { weight: "45 920" } as FontFaceDescriptors);
    f.load().then((ff) => { document.fonts.add(ff); loaded = true; continueRender(h); });
  }, [h]);
};

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

/* ── 카피 — 한 호흡 블러 디졸브 + 골드 광택 스윕(스캔과 같은 시각 언어) ── */
const Kinetic: React.FC<{ range: readonly [number, number]; text: string; punch?: boolean; size?: number }> =
({ range, text, punch, size = 92 }) => {
  const f = useCurrentFrame();
  const [a, b] = range;
  if (f < a || f > b + 8) return null;
  const inO = interpolate(f, [a, a + 22], [0, 0.96], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
  const exitO = interpolate(f, [b - 10, b], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bl = interpolate(f, [a, a + 24], [14, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
  const settle = interpolate(f, [a, b], [1.045, 0.995], { easing: Easing.bezier(0.2, 0.6, 0.3, 1) });
  // 골드 광택 스윕 — 등장 직후 한 번, 글자 위를 천천히 지나감
  const sweep = interpolate(f, [a + 14, a + (punch ? 46 : 58)], [-30, 130], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.4, 0, 0.3, 1) });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{
        fontFamily: FONT, fontWeight: 750, fontSize: size, whiteSpace: "pre",
        letterSpacing: "-0.02em", lineHeight: 1.25,
        opacity: inO * exitO,
        transform: `translateY(-64px) scale(${settle})`,
        filter: `blur(${bl}px)`,
        backgroundImage: `linear-gradient(105deg, #F2ECDF ${sweep - 22}%, #FFE9AE ${sweep}%, #F2ECDF ${sweep + 22}%)`,
        WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
        textShadow: "0 0 52px rgba(231,200,118,.22)",
      }}>{text}</div>
    </AbsoluteFill>
  );
};

/* ── 로고 ── */
const Logo: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [a] = BEAT.logo;
  if (f < a) return null;
  const bar = (i: number) => spring({ frame: f - a - i * 5, fps, config: { damping: 16, mass: 0.7 } });
  const winPop = spring({ frame: f - a - 26, fps, config: { damping: 11, mass: 0.6 } });
  const wordO = interpolate(f, [a + 22, a + 38], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const wordX = interpolate(f, [a + 22, a + 40], [24, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });
  const bars: [number, number, number, number, number][] = [
    [11.5, 8, 8, 32, 0], [28.5, 8, 8, 32, 1], [11.5, 20.5, 25, 7, 2], [11.5, 33, 25, 7, 3],
  ];
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
        <svg width={124} height={155} viewBox="10 6.5 28 35">
          {bars.map(([x, y, w, h, i]) => {
            const p = bar(i);
            return <rect key={i} x={x} y={y + (1 - p) * 14} width={w} height={h} rx={2.6} fill={C.terra} opacity={p} />;
          })}
          <rect x={13.6} y={11.5} width={3.8} height={3.8} rx={1} fill={C.gold}
            opacity={winPop} transform={`translate(${15.5 * (1 - winPop)} ${13.4 * (1 - winPop)}) scale(${winPop})`} />
        </svg>
        <div style={{
          fontFamily: FONT, fontWeight: 800, fontSize: 118, color: C.text,
          letterSpacing: "-0.035em", opacity: wordO, transform: `translateX(${wordX}px)`, lineHeight: 1,
        }}>빌탐정<span style={{ color: C.gold }}>.</span></div>
      </div>
    </AbsoluteFill>
  );
};

/* ── 시네마 그레이드: 레터박스 + 비네트 + 그레인 ── */
const Grade: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: "radial-gradient(115% 85% at 50% 38%, rgba(0,0,0,0) 52%, rgba(0,0,0,.52) 100%)" }} />
      <svg width={1920} height={1080} style={{ position: "absolute", opacity: 0.05, transform: `translate(${(f * 7) % 42 - 21}px, ${(f * 13) % 42 - 21}px) scale(1.06)` }}>
        <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" /></filter>
        <rect width="1920" height="1080" filter="url(#n)" />
      </svg>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 132, background: "#000" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 132, background: "#000" }} />
    </AbsoluteFill>
  );
};

export const Main: React.FC = () => {
  useFont();
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <City3D />
      <Grade />
      {/* 엔드카드 반전 — 도시·그레인 위로 순수 블랙, 로고만 남김 */}
      <AbsoluteFill style={{ background: "#000",
        opacity: interpolate(f, BEAT.cityOut, [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} />
      <Logo />
      <AbsoluteFill style={{ background: C.bg, opacity: interpolate(f, [0, 14], [1, 0], { extrapolateRight: "clamp" }), pointerEvents: "none" }} />
      <Audio src={staticFile(MUSIC)} trimBefore={MUSIC_OFFSET}
        volume={(fr) => interpolate(fr, [0, 20, 400, 448], [0, 0.75, 0.75, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    </AbsoluteFill>
  );
};
