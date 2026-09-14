import React from "react";
import {
  AbsoluteFill, Audio, Easing, Img, Sequence,
  interpolate, staticFile, useCurrentFrame,
} from "remotion";
import { FONT } from "./brand";
import VO from "./quest_vo.json";

/* 퀘스트 가이드 영상 — 퀘스트를 주고, 그 퀘스트를 푸는 조작을 보여준다.
   화면 위쪽 퀘스트 띠가 장이 풀릴 때마다 1/3 → 2/3 → 3/3으로 찬다.
   캡처는 프로덕션(billtamjung.web.app) 실화면. 내레이션=타입캐스트 ssfm-v30(Seohyeon). */

export const FPS = 30;
const W = 1920, H = 1080;
const IMG_W = 1440, IMG_H = 900;

/* 띠가 위를 차지하므로 캡처는 그 아래 액자 안에서만 움직인다 */
const BAR_H = 96;
const CARD_H = 930, CARD_W = Math.round((CARD_H * IMG_W) / IMG_H);   // 1488×930
const CARD_TOP = BAR_H + 24;

const MOVE = 20;      // 카메라 이동 프레임
const GAP = 7;        // 문장 사이
const SGAP = 13;      // 컷 사이
const TR = 14;        // 전환

const ease = Easing.bezier(0.65, 0, 0.2, 1);
const easeSoft = Easing.bezier(0.16, 1, 0.3, 1);

/* 화면 안에서 주목할 사각형 — 캡처 원본(1440×900) 기준 % */
type Rect = { x: number; y: number; w: number; h: number };
type Line = { k: keyof typeof VO; rect?: Rect };
type Cut = { img: string; lines: Line[]; quest: 0 | 1 | 2 | 3; clears?: boolean };

const R = {
  drawTools:  { x: 25, y: 94, w: 22, h: 6 },
  mapAll:     { x: 25, y: 20, w: 74, h: 76 },
  list:       { x: 0,  y: 21, w: 26, h: 22 },
  filterBtn:  { x: 33, y: 8,  w: 10, h: 6 },
  price:      { x: 48, y: 57, w: 25, h: 20 },
  landuse:    { x: 46, y: 57, w: 24, h: 34 },
  mainuse:    { x: 32, y: 58, w: 24, h: 30 },
  detailTop:  { x: 18, y: 7,  w: 62, h: 8 },
  analyzeBtn: { x: 88, y: 7,  w: 12, h: 8 },
  briefBtn:   { x: 79, y: 7,  w: 10, h: 8 },
  reportCover:{ x: 17, y: 17, w: 79, h: 74 },
  reportNav:  { x: 0,  y: 6,  w: 13, h: 92 },
  briefNav:   { x: 0,  y: 6,  w: 13, h: 45 },
  fullBtn:    { x: 91, y: 1,  w: 9,  h: 5 },
};

const CUTS: Cut[] = [
  { img: "map-before.png", quest: 0, lines: [{ k: "00", rect: R.mapAll }] },

  // ── 퀘스트 1 · 사대문 안쪽 40~60억 매물 찾기
  { img: "map-before.png", quest: 1, lines: [
      { k: "1a", rect: R.mapAll },
      { k: "1b", rect: R.drawTools },
      { k: "1c", rect: R.mapAll },
      { k: "1d", rect: R.list },
  ] },
  { img: "filter.png",         quest: 1, lines: [{ k: "1e", rect: R.filterBtn }] },
  { img: "filter-price.png",   quest: 1, lines: [{ k: "1f", rect: R.price }] },
  { img: "filter-landuse.png", quest: 1, lines: [{ k: "1g", rect: R.landuse }] },
  { img: "filter-mainuse.png", quest: 1, lines: [{ k: "1h", rect: R.mainuse }] },
  { img: "map-before.png",     quest: 1, lines: [{ k: "1i", rect: R.list }], clears: true },

  // ── 퀘스트 2 · 적정가 알아보기
  { img: "detail.png",  quest: 2, lines: [
      { k: "2a", rect: R.detailTop },
      { k: "2b", rect: R.analyzeBtn },
  ] },
  { img: "report1.png", quest: 2, lines: [
      { k: "2c", rect: R.reportCover },
      { k: "2d", rect: R.reportNav },
  ], clears: true },

  // ── 퀘스트 3 · 매수자 설명 자료 만들기
  { img: "detail.png",   quest: 3, lines: [{ k: "3a", rect: R.briefBtn }] },
  { img: "briefing.png", quest: 3, lines: [
      { k: "3b", rect: R.briefNav },
      { k: "3c", rect: R.fullBtn },
  ], clears: true },
];

const QUEST_LABEL = [
  "",
  "퀘스트 1 · 사대문 안쪽 40~60억 매물 찾기",
  "퀘스트 2 · 적정가 알아보기",
  "퀘스트 3 · 매수자 설명 자료 만들기",
];

/* ── 타임라인: 문장 길이(VO)를 그대로 컷 길이로 쓴다 ── */
const secs = (k: keyof typeof VO) => Math.round((VO[k] as number) * FPS);

type Placed = { cut: Cut; from: number; len: number; lines: { k: keyof typeof VO; from: number; len: number; rect?: Rect }[] };
const PLACED: Placed[] = [];
let cursor = 0;
for (const cut of CUTS) {
  const lines: Placed["lines"] = [];
  let inner = 0;
  cut.lines.forEach((l, i) => {
    const len = secs(l.k) + (i === 0 ? 0 : GAP) + MOVE;
    lines.push({ ...l, from: inner, len });
    inner += len;
  });
  PLACED.push({ cut, from: cursor, len: inner + SGAP, lines });
  cursor += inner + SGAP;
}
export const TOTAL = cursor + 40;

/* 퀘스트가 몇 개 풀렸는지 — clears 컷이 끝나는 프레임에서 오른다 */
const CLEAR_AT: number[] = [];
PLACED.forEach((p) => { if (p.cut.clears) CLEAR_AT.push(p.from + p.len - SGAP); });

/* ── 퀘스트 띠 ── */
const QuestBar: React.FC = () => {
  const f = useCurrentFrame();
  const cleared = CLEAR_AT.filter((c) => f >= c).length;

  // 지금 화면이 어느 퀘스트를 푸는 중인가
  const cur = PLACED.find((p) => f >= p.from && f < p.from + p.len)?.cut.quest ?? 3;
  const label = QUEST_LABEL[cur] || QUEST_LABEL[3];

  // 막대는 방금 오른 값으로 부드럽게 찬다
  const last = CLEAR_AT[cleared - 1] ?? 0;
  const grow = interpolate(f, [last, last + 18], [(cleared - 1) / 3, cleared / 3],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeSoft });
  const ratio = cleared === 0 ? 0 : grow;

  const drop = interpolate(f, [0, 18], [-BAR_H, 0], { extrapolateRight: "clamp", easing: easeSoft });
  const pop = cleared > 0 && f - last < 26
    ? interpolate(f - last, [0, 8, 26], [0, 1, 0], { extrapolateRight: "clamp" }) : 0;

  return (
    <div style={{
      position: "absolute", top: drop, left: 0, width: W, height: BAR_H,
      background: "#FFFFFF", borderBottom: "1px solid #E7E2D9",
      display: "flex", alignItems: "center", gap: 28, padding: "0 56px",
      fontFamily: FONT, boxSizing: "border-box",
    }}>
      <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.02em", color: "#262320" }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 8, borderRadius: 99, background: "#ECE8E0", overflow: "hidden" }}>
        <div style={{ width: `${ratio * 100}%`, height: "100%", borderRadius: 99, background: "#262320" }} />
      </div>
      {pop > 0 && (
        <span style={{
          fontSize: 22, fontWeight: 800, color: "#0E805B", background: "#E4F0E9",
          borderRadius: 99, padding: "6px 16px", opacity: pop,
          transform: `translateY(${(1 - pop) * 8}px)`, whiteSpace: "nowrap",
        }}>완료</span>
      )}
      <span style={{
        fontSize: 26, fontWeight: 800, color: "#262320",
        fontVariantNumeric: "tabular-nums", minWidth: 78, textAlign: "right",
      }}>{cleared} / 3</span>
    </div>
  );
};

/* ── 캡처 한 장 안에서 주목 지점으로 팬·줌 ── */
const Shot: React.FC<{ p: Placed }> = ({ p }) => {
  const f = useCurrentFrame();

  const view = (r?: Rect) => {
    if (!r) return { s: 1, x: 0, y: 0 };
    const s = Math.min(1.85, Math.max(1.05, Math.min(90 / r.w, 82 / r.h)));
    const cx = (r.x + r.w / 2) / 100, cy = (r.y + r.h / 2) / 100;
    // 액자 밖이 비지 않게 팬을 묶는다 — 가장자리를 겨눠도 여백이 생기지 않는다
    const maxX = (CARD_W * s - CARD_W) / 2, maxY = (CARD_H * s - CARD_H) / 2;
    const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    return {
      s,
      x: clamp((0.5 - cx) * CARD_W * s, maxX),
      y: clamp((0.5 - cy) * CARD_H * s, maxY),
    };
  };

  // 현재/직전 구간을 찾아 그 사이를 보간한다
  let cur = p.lines[0], prev = p.lines[0];
  for (const l of p.lines) if (f >= l.from) { prev = cur; cur = l; }
  const a = view(prev.rect), b = view(cur.rect);
  const t = interpolate(f, [cur.from, cur.from + MOVE], [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });

  const s = a.s + (b.s - a.s) * t;
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;

  const fade = interpolate(f, [0, TR], [0, 1], { extrapolateRight: "clamp", easing: easeSoft });
  const rise = interpolate(f, [0, TR], [26, 0], { extrapolateRight: "clamp", easing: easeSoft });

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{
        position: "absolute", top: CARD_TOP, left: (W - CARD_W) / 2,
        width: CARD_W, height: CARD_H, borderRadius: 14, overflow: "hidden",
        boxShadow: "0 26px 70px rgba(20,17,14,.45)", transform: `translateY(${rise}px)`,
      }}>
        <Img src={staticFile(`quest/${p.cut.img}`)} style={{
          position: "absolute", width: CARD_W, height: CARD_H,
          transform: `translate(${x}px, ${y}px) scale(${s})`, transformOrigin: "center",
        }} />
      </div>
    </AbsoluteFill>
  );
};

export const Quest: React.FC = () => (
  <AbsoluteFill style={{ background: "#F1EFEA", fontFamily: FONT }}>
    {PLACED.map((p, i) => (
      <Sequence key={i} from={p.from} durationInFrames={p.len + TR}>
        <Shot p={p} />
      </Sequence>
    ))}
    {PLACED.flatMap((p) =>
      p.lines.map((l) => (
        <Sequence key={`${p.from}-${l.k}`} from={p.from + l.from + MOVE} durationInFrames={secs(l.k) + 4}>
          <Audio src={staticFile(`vo/q${l.k}.wav`)} />
        </Sequence>
      )))}
    <QuestBar />
  </AbsoluteFill>
);
