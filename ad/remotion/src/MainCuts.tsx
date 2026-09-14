import React from "react";
import {
  AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig,
  Easing, staticFile, continueRender, delayRender, spring, Audio,
} from "remotion";
import { C, FONT } from "./brand";
import { BEAT } from "./timing";
import { CityCuts } from "./CityCuts";

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
const easeTrans = Easing.bezier(0.7, 0, 0.2, 1);

/* ── 화면 전환 — 이중 렌더 진짜 푸시(공백 없음) + 마지막 줌 ── */
const TRANS: { at: number; kind: "push" | "zoom"; dir?: [number, number] }[] = [
  { at: 104, kind: "push", dir: [-1, 0] },
  { at: 206, kind: "push", dir: [1, 0] },
  { at: BEAT.lightOn[0], kind: "zoom" },
];
const TR = 9;
const transAt = (f: number) => {
  for (const t of TRANS) {
    if (f >= t.at - TR && f < t.at + TR) {
      return { ...t, p: easeTrans((f - (t.at - TR)) / (TR * 2)) };
    }
  }
  return null;
};

/* ── 중앙 고정 카피 — 씬 사이에 텀(배경만 흐르는 호흡 구간) ── */
const TEXTS: { range: readonly [number, number]; text: string; intro?: boolean }[] = [
  { range: [8, 104], text: "좋은 건물은" },
  { range: [104, 206], text: "매물로 나오지 않습니다." },      // 씬과 동일 구간 — 들어올 때 이미 화면에 붙어 있음
  { range: [206, BEAT.lightOn[0]], text: "그래서, 직접 찾아냅니다." },
];

const CenterCopy: React.FC<{ range: readonly [number, number]; text: string; frame: number; intro?: boolean }> = ({ range: [a, b], text, frame: f }) => {
  if (f < a || f >= b) return null;
  // 텍스트 자체 애니메이션 없음 — 등장·퇴장·오프닝 모두 화면(슬라이더) 트랜스폼에 실림
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{
        fontFamily: FONT, fontWeight: 750, fontSize: 96, letterSpacing: "-0.02em", whiteSpace: "pre",
        backgroundImage: "linear-gradient(180deg, #FFFDF4 8%, #F1EADA 45%, #CFC4AC 80%, #B7A88B 100%)",
        WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
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

/* ── 시네마 그레이드(고정 — 레터박스는 전환에도 움직이지 않음) ── */
const Grade: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: "radial-gradient(115% 85% at 50% 38%, rgba(0,0,0,0) 52%, rgba(0,0,0,.52) 100%)" }} />
      <svg width={1920} height={1080} style={{ position: "absolute", opacity: 0.05, transform: `translate(${(f * 7) % 42 - 21}px, ${(f * 13) % 42 - 21}px) scale(1.06)` }}>
        <filter id="n2"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" /></filter>
        <rect width="1920" height="1080" filter="url(#n2)" />
      </svg>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 132, background: "#000" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 132, background: "#000" }} />
    </AbsoluteFill>
  );
};

export const MainCuts: React.FC = () => {
  useFont();
  const f = useCurrentFrame();
  const tr = transAt(f);
  const texts = (cf: number) => TEXTS.map((t, i) => <CenterCopy key={i} range={t.range} text={t.text} frame={cf} intro={t.intro} />);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {!tr && (() => {
        const op = interpolate(f, [0, 52], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.2, 0.7, 0.3, 1) });
        const openT = f < 52
          ? `perspective(1700px) rotateY(${-14 * (1 - op)}deg) rotateZ(${-3 * (1 - op)}deg) translateX(${-5 * (1 - op)}%) scale(${0.92 + 0.08 * op})`
          : "none";
        return (
          <div style={{ position: "absolute", inset: 0, transform: openT, transformOrigin: "50% 50%" }}>
            <CityCuts />
            {texts(f)}
          </div>
        );
      })()}
      {tr && tr.kind === "push" && (() => {
        const cfOut = Math.min(f, tr.at - 1), cfIn = Math.max(f, tr.at);
        return (
          <>
            {/* 회전 푸시 — 나가는 화면은 비틀리며 돌아 나가고, 들어오는 화면은 반대 각에서 돌아 들어옴 */}
            <div style={{ position: "absolute", inset: 0,
              transform: `perspective(1700px) translateX(${tr.dir![0] * tr.p * 92}%) rotateY(${-tr.dir![0] * tr.p * 48}deg) rotateZ(${-tr.dir![0] * tr.p * 4}deg) scale(${1 - tr.p * 0.06})`,
              transformOrigin: "50% 50%" }}>
              <CityCuts camFrame={cfOut} />
              {texts(cfOut)}
            </div>
            <div style={{ position: "absolute", inset: 0,
              transform: `perspective(1700px) translateX(${-tr.dir![0] * (1 - tr.p) * 92}%) rotateY(${tr.dir![0] * (1 - tr.p) * 48}deg) rotateZ(${tr.dir![0] * (1 - tr.p) * 4}deg) scale(${0.94 + tr.p * 0.06})`,
              transformOrigin: "50% 50%" }}>
              <CityCuts camFrame={cfIn} />
              {texts(cfIn)}
            </div>
          </>
        );
      })()}
      {tr && tr.kind === "zoom" && (() => {
        const cfOut = Math.min(f, tr.at - 1), cfIn = Math.max(f, tr.at);
        return (
          <>
            {/* 들어오는 씬(아래) — 이어지는 줌 감속으로 안착 */}
            <div style={{ position: "absolute", inset: 0, transform: `scale(${1.14 - 0.14 * tr.p})`, transformOrigin: "50% 42%" }}>
              <CityCuts camFrame={cfIn} />
            </div>
            {/* 나가는 씬(위) — 확대되며 소멸 */}
            <div style={{ position: "absolute", inset: 0, transform: `scale(${1 + tr.p * 0.65})`, transformOrigin: "50% 42%",
              opacity: interpolate(tr.p, [0.25, 0.85], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
              <CityCuts camFrame={cfOut} />
              {texts(cfOut)}
            </div>
          </>
        );
      })()}
      <Grade />
      <AbsoluteFill style={{ background: "#000",
        opacity: interpolate(f, BEAT.cityOut, [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} />
      <Logo />
      <AbsoluteFill style={{ background: "#000", opacity: interpolate(f, [0, 14], [1, 0], { extrapolateRight: "clamp" }), pointerEvents: "none" }} />
      <Audio src={staticFile(MUSIC)} trimBefore={MUSIC_OFFSET}
        volume={(fr) => interpolate(fr, [0, 20, 400, 448], [0, 0.75, 0.75, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    </AbsoluteFill>
  );
};
