import React from "react";
import {
  AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence,
  interpolate, staticFile, useCurrentFrame,
} from "remotion";
import { FONT } from "./brand";
import VO from "./quest_vo.json";
import PARTS_ALL from "./guide_parts.json";
import PARTS_Q1 from "./guide_parts_q1.json";
import PARTS_Q2 from "./guide_parts_q2.json";
import PARTS_Q3 from "./guide_parts_q3.json";

/* 빌탐정 가이드 — 직접 찍은 화면(public/guide-raw.mp4 · 원본은 ad/원본/)을 재료로 만든 편집본.
 *
 * 캡처를 주로 쓰고, 움직임이 있어야 하는 곳(그리기·발표)만 영상을 쓴다.
 * 촬영본에 마우스 커서가 이미 찍혀 있어 따로 그리지 않는다.
 * 조각 하나 = 문장 하나 — 이 규칙이 깨지면 나레이션이 겹친다. */

export const FPS = 30;
const W = 1920, H = 1080;
const BAR = 88;
const easeSoft = Easing.bezier(0.16, 1, 0.3, 1);
const F = (s: number) => Math.round(s * FPS);

type Part = {
  k?: keyof typeof VO; len: number; src?: "still" | "clip" | "shot"; at?: number | string; speed?: number;
  focus?: Focus;   // 원본 비율(0~1) 기준 강조 사각형
  note?: string;   // 상자 옆에 붙는 설명 — 아래 자막과 겹치지 않게 상자 근처에 둔다
};

/* 자막 = 나레이션 그대로(숫자만 쓰는 표기로) */
const TEXT: Record<string, string> = {
  i1: "오늘 풀 퀘스트는 세 개입니다",
  i2: "하나. 사대문 안에서 조건에 맞는 매물 찾기",
  i3: "둘. 그 건물이 얼마짜리인지 따져보기",
  i4: "셋. 고객에게 내놓을 자료 만들기",
  i5: "보시고 그대로 따라 하시면 됩니다",
  "1p": "첫 번째 퀘스트 — 사대문 안쪽에서 40억~60억 매물 찾기",
  "1m": "사대문은 행정구역이 아닙니다 · 구·동 단위로 딱 떨어지지 않습니다",
  "1a": "자, 해보겠습니다 — 지도 도구에서 자유곡선",
  "1b": "사대문을 감싸듯 그립니다 · 손이 지나간 자리가 검색 범위가 됩니다",
  "1c": "이제 조건을 하나씩 좁혀보겠습니다",
  "1d": "매매가 40억~60억 · 적정가엔 오차가 있으니 여유 있게",
  "1e": "역 300m 이내 · 대지 50평 · 연면적 100평 이상",
  "1f": "엘리베이터와 주차 각 1대 이상",
  "1g": "용도 — 근린생활·판매·의료·업무시설",
  "1h": "여덟 개 조건으로 11건이 남았습니다",
  "1i": "파란 라벨이 제 매물 · 일반 매물과 한눈에 구분",
  "2p": "두 번째 퀘스트 — 얼마짜리인지 따져보기",
  "2a": "중구 초동 53-5",
  "2b": "매매가 56억 · 예상수익률 3.0% — 주변 실거래·임대시세로 추정한 값",
  "2c": "매력도 C등급 · 57.6점",
  "2d": "역 260m·용도지역은 우수 / 도로접면·연식은 아쉬움",
  "2e": "이 값들을 바탕으로 적정가가 나옵니다 · 실제와 다르면 직접 고칠 수 있습니다",
  "2f": "업무 탭에는 제가 적어둔 기록이 남아 있습니다",
  "2g": "소유자가 팔아달라고 연락한 날, 통화하며 알게 된 것들",
  "2h": "협조적인지 · 얼마나 급한지 · 매도 의사가 확실한지",
  "2i": "몇 달 뒤에도 이 기록을 보면 어떻게 접근할지 떠오릅니다",
  "3p": "마지막 — 고객에게 내놓을 자료 만들기",
  "3a": "중개인 코멘트 — 「충무로역 도보 3분 · 대로변 코너」",
  "3b": "제가 쓴 문장이 자료에 그대로 들어갑니다",
  "3c": "일곱 장이 만들어집니다 · 건물 개요에 코멘트가",
  "3d": "입체 지적도 · 층별 임대정보 · 사진과 서류까지 자동으로",
  "3e": "빌탐정 리포트는 열 장",
  "3f": "애니메이션 모드로 그대로 발표합니다",
  "3g": "여기까지 전부, 버튼 한 번으로 자동 생성된 것입니다",
  "99": "이제 직접 해보실 차례입니다",
};

/* 「예시 데이터」를 띄울 구간 — 소유자 기록은 실제가 아니라 시연용이다 */
const SAMPLE = new Set(["2f", "2g", "2h", "2i"]);

const QUEST_OF = (k: string) => (k.startsWith("i") ? 0 : k === "99" ? 3 : Number(k[0]));
const LABEL = ["", "퀘스트 1 · 조건에 맞는 매물 찾기", "퀘스트 2 · 얼마짜리인지 따져보기", "퀘스트 3 · 고객에게 낼 자료 만들기"];
const CLEAR_AT = new Set(["1i", "2i", "3g"]);      // 이 문장이 끝나면 퀘스트 완료

/* ── 배치 ── */
type Placed = Part & { start: number; frames: number };
function layout(parts: Part[]) {
  const placed: Placed[] = [];
  let cur = 0;
  for (const p of parts) {
    const frames = F(p.len);
    placed.push({ ...p, start: cur, frames });
    cur += frames;
  }
  return { placed, total: cur, clears: placed.filter((p) => p.k && CLEAR_AT.has(p.k)).map((p) => p.start + p.frames) };
}
const ALL = layout(PARTS_ALL as Part[]);
const Q1 = layout(PARTS_Q1 as Part[]);
const Q2 = layout(PARTS_Q2 as Part[]);
const Q3 = layout(PARTS_Q3 as Part[]);
export const TOTAL = ALL.total;
export const TOTAL_Q1 = Q1.total, TOTAL_Q2 = Q2.total, TOTAL_Q3 = Q3.total;

/* ── 퀘스트 띠 ── */
const Bar: React.FC<{ L: ReturnType<typeof layout>; base?: number }> = ({ L, base = 0 }) => {
  const f = useCurrentFrame();
  const hit = L.clears.filter((c) => f >= c).length;
  const done = base + hit;
  const idx = L.placed.findIndex((x) => f >= x.start && f < x.start + x.frames);
  let q = 3;
  for (let i = idx; i >= 0; i--) {
    const k = L.placed[i]?.k;
    if (k) { q = QUEST_OF(k); break; }
  }
  if (q === 0) return null;
  const last = L.clears[hit - 1] ?? 0;
  const ratio = hit === 0 ? base / 3
    : interpolate(f, [last, last + 16], [(done - 1) / 3, done / 3],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeSoft });
  const pop = hit > 0 && f - last < 30
    ? interpolate(f - last, [0, 7, 30], [0, 1, 0], { extrapolateRight: "clamp" }) : 0;
  return (
    <div style={{
      position: "absolute", top: 0, left: 0, width: W, height: BAR, background: "#FFFFFF",
      borderBottom: "1px solid #E7E2D9", display: "flex", alignItems: "center", gap: 24,
      padding: "0 52px", fontFamily: FONT, boxSizing: "border-box",
    }}>
      <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.02em", color: "#262320" }}>{LABEL[q]}</span>
      <div style={{ flex: 1, height: 8, borderRadius: 99, background: "#ECE8E0", overflow: "hidden" }}>
        <div style={{ width: `${ratio * 100}%`, height: "100%", borderRadius: 99, background: "#262320" }} />
      </div>
      {pop > 0 && (
        <span style={{
          fontSize: 20, fontWeight: 800, color: "#0E805B", background: "#E4F0E9",
          borderRadius: 99, padding: "5px 14px", opacity: pop, whiteSpace: "nowrap",
        }}>완료</span>
      )}
      <span style={{ fontSize: 24, fontWeight: 800, color: "#262320", fontVariantNumeric: "tabular-nums" }}>
        {done} / 3
      </span>
    </div>
  );
};

const Caption: React.FC<{ text: string; sample?: boolean }> = ({ text, sample }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 6], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, bottom: 44, display: "flex",
      flexDirection: "column", alignItems: "center", gap: 10, fontFamily: FONT, opacity: o,
    }}>
      {sample && (
        <span style={{
          background: "#C0392B", color: "#fff", fontSize: 22, fontWeight: 800,
          padding: "6px 16px", borderRadius: 99, letterSpacing: ".04em",
        }}>예시 데이터</span>
      )}
      <span style={{
        background: "rgba(26,23,20,.9)", color: "#F4F1EA", fontSize: 33, fontWeight: 700,
        letterSpacing: "-.015em", padding: "13px 30px", borderRadius: 12, maxWidth: 1560,
        textAlign: "center", lineHeight: 1.35,
      }}>{text}</span>
    </div>
  );
};


/* 강조 — 누르는 자리에 빨간 상자를 띄우고 그쪽으로 확대한다.
 *
 * 원본은 2560×1600 이고 화면은 1920×(1080-띠) 다. contain 으로 넣으므로 좌우에 여백이 생긴다.
 * 좌표는 원본 비율(0~1)로 받아 그 여백까지 계산해 옮긴다 —
 * 픽셀 좌표로 적었다가 해상도가 달라 박스가 엉뚱한 데 그려졌다. */
const VIEW_H = H - BAR;
const SRC_RATIO = 2560 / 1600;
const FIT = Math.min(W / SRC_RATIO, VIEW_H) / VIEW_H;      // 세로 기준 축소율
const DISP_H = VIEW_H * FIT, DISP_W = DISP_H * SRC_RATIO;
const OFF_X = (W - DISP_W) / 2, OFF_Y = (VIEW_H - DISP_H) / 2;
const IN = 10;

type Focus = [number, number, number, number];

/** 원본 비율 → 화면 픽셀(확대 전) */
const toPx = ([fx, fy, fw, fh]: Focus) => ({
  x: OFF_X + fx * DISP_W, y: OFF_Y + fy * DISP_H,
  w: fw * DISP_W, h: fh * DISP_H,
});

function focusMotion(f: number, focus?: Focus) {
  if (!focus) return { scale: 1, ox: 0, oy: 0, on: 0 };
  const r = toPx(focus);
  const k = interpolate(f, [0, IN], [0, 1], { extrapolateRight: "clamp", easing: easeSoft });
  // 화면 가장자리에 붙은 대상(지도 도구 등)은 확대하면 프레임 밖으로 밀린다 — 상자만 띄운다
  const [, fy, , fh] = focus;
  const atEdge = fy + fh > 0.9 || fy < 0.06;
  const want = atEdge ? 1
    : Math.min(1.28, Math.max(1.06, Math.min((W * 0.80) / r.w, (VIEW_H * 0.72) / r.h)));
  const scale = 1 + (want - 1) * k;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const maxX = Math.max(0, (DISP_W * scale) / 2 - W / 2);
  const maxY = Math.max(0, (DISP_H * scale) / 2 - VIEW_H / 2);
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  return {
    scale,
    ox: clamp((W / 2 - cx) * scale, maxX),
    oy: clamp((VIEW_H / 2 - cy) * scale, maxY),
    on: k,
  };
}

const Box: React.FC<{ focus: Focus; m: ReturnType<typeof focusMotion> }> = ({ focus, m }) => {
  const r = toPx(focus);
  const pad = 9;
  // 확대·이동과 똑같이 변환해야 상자가 대상 위에 정확히 얹힌다
  const X = (r.x - pad - W / 2) * m.scale + W / 2 + m.ox;
  const Y = (r.y - pad - VIEW_H / 2) * m.scale + VIEW_H / 2 + m.oy;
  return (
    <div style={{
      position: "absolute", left: X, top: Y,
      width: (r.w + pad * 2) * m.scale, height: (r.h + pad * 2) * m.scale,
      border: `${Math.max(3, 4 * m.scale)}px solid #E23A2E`, borderRadius: 10,
      boxShadow: "0 0 0 5px rgba(226,58,46,.20), 0 0 26px rgba(226,58,46,.45)",
      opacity: m.on, pointerEvents: "none", boxSizing: "border-box",
    }} />
  );
};


/* 상자 옆 설명 — 화면 아래 자막과 겹치면 둘 다 안 읽힌다.
   상자 위에 자리가 있으면 위에, 없으면 아래에 붙인다. */
const Note: React.FC<{ focus: Focus; m: ReturnType<typeof focusMotion>; text: string }> = ({ focus, m, text }) => {
  const f = useCurrentFrame();
  const r = toPx(focus);
  const X = (r.x - W / 2) * m.scale + W / 2 + m.ox;
  const Yt = (r.y - VIEW_H / 2) * m.scale + VIEW_H / 2 + m.oy;
  const Yb = (r.y + r.h - VIEW_H / 2) * m.scale + VIEW_H / 2 + m.oy;
  const above = Yt > 130;
  const o = interpolate(f, [IN, IN + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{
      position: "absolute", left: Math.max(24, Math.min(X, W - 900)),
      top: above ? Yt - 86 : Math.min(Yb + 20, VIEW_H - 110),
      maxWidth: 880, opacity: o,
    }}>
      <span style={{
        display: "inline-block", background: "#E23A2E", color: "#fff",
        fontSize: 31, fontWeight: 800, letterSpacing: "-.015em",
        padding: "12px 22px", borderRadius: 10, lineHeight: 1.3,
        boxShadow: "0 8px 26px rgba(0,0,0,.35)",
      }}>{text}</span>
    </div>
  );
};

/* 정지 컷은 아주 천천히 밀어준다 — 완전히 멈춰 있으면 영상이 죽는다 */
const Still: React.FC<{ at: number | string; focus?: Focus; note?: string }> = ({ at, focus, note }) => {
  const f = useCurrentFrame();
  const m = focusMotion(f, focus);
  return (
    <div style={{ position: "absolute", top: BAR, left: 0, width: W, height: VIEW_H, overflow: "hidden" }}>
      <Img src={staticFile(typeof at === "string" ? `stills/${at}.png` : `stills/s${String(at).replace(".", "_")}.png`)}
        style={{ position: "absolute", width: W, height: VIEW_H, objectFit: "contain",
          transform: `translate(${m.ox}px, ${m.oy}px) scale(${m.scale})` }} />
      {focus && <Box focus={focus} m={m} />}
      {focus && note && <Note focus={focus} m={m} text={note} />}
    </div>
  );
};

const Clip: React.FC<{ at: number; speed?: number; focus?: Focus }> = ({ at, speed, focus }) => {
  const f = useCurrentFrame();
  const m = focusMotion(f, focus);
  return (
    <div style={{ position: "absolute", top: BAR, left: 0, width: W, height: VIEW_H, overflow: "hidden" }}>
      <OffthreadVideo src={staticFile("guide-raw.mp4")} startFrom={F(at)} playbackRate={speed ?? 1} muted
        style={{ position: "absolute", width: W, height: VIEW_H, objectFit: "contain",
          transform: `translate(${m.ox}px, ${m.oy}px) scale(${m.scale})` }} />
      {focus && <Box focus={focus} m={m} />}
    </div>
  );
};

/* ── 여는 카드 ── */
const IntroCard: React.FC<{ step: number }> = ({ step }) => {
  const f = useCurrentFrame();
  const rise = interpolate(f, [0, 14], [0, 1], { extrapolateRight: "clamp", easing: easeSoft });
  const rows = [
    ["1", "사대문 안에서 조건에 맞는 매물 찾기"],
    ["2", "그 건물이 얼마짜리인지 따져보기"],
    ["3", "고객에게 내놓을 자료 만들기"],
  ];
  return (
    <AbsoluteFill style={{
      background: "#1A1714", fontFamily: FONT, display: "flex", flexDirection: "column",
      justifyContent: "center", paddingLeft: 200, gap: 44,
    }}>
      <div style={{ opacity: rise }}>
        <div style={{ color: "#E7C876", fontSize: 25, fontWeight: 800, letterSpacing: ".16em" }}>빌탐정</div>
        <div style={{ color: "#EDE8E1", fontSize: 72, fontWeight: 800, letterSpacing: "-.035em", marginTop: 10 }}>
          오늘의 퀘스트 <span style={{ color: "#E7C876" }}>3</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {rows.map(([n, t], i) => {
          const on = step >= i + 1;
          return (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 24, opacity: on ? 1 : 0.24 }}>
              <span style={{
                width: 58, height: 58, borderRadius: "50%", display: "grid", placeItems: "center",
                background: on ? "#E7C876" : "#2C2823", color: on ? "#1A1714" : "#6E655A",
                fontSize: 28, fontWeight: 800,
              }}>{n}</span>
              <span style={{ color: "#EDE8E1", fontSize: 42, fontWeight: 700, letterSpacing: "-.025em" }}>{t}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Movie: React.FC<{ L: ReturnType<typeof layout>; base?: number }> = ({ L, base = 0 }) => (
  <AbsoluteFill style={{ background: "#262320", fontFamily: FONT }}>
    {L.placed.map((p, i) => {
      const intro = p.k?.startsWith("i") ? ["i1", "i2", "i3", "i4", "i5"].indexOf(p.k) : -1;
      return (
        <Sequence key={i} from={p.start} durationInFrames={p.frames}>
          {p.src === "still" || p.src === "shot" ? <Still at={p.at!} focus={p.focus} note={p.note} />
            : p.src === "clip" ? <Clip at={p.at as number} speed={p.speed} focus={p.focus} />
            : <IntroCard step={intro} />}
          {p.k && <Audio src={staticFile(`vo/q${p.k}.wav`)} />}
          {p.src && p.k && <Caption text={TEXT[p.k] ?? ""} sample={SAMPLE.has(p.k)} />}
          {p.focus && <Sequence from={IN}><Audio src={staticFile("sfx/click.wav")} volume={0.5} /></Sequence>}
        </Sequence>
      );
    })}
    {L.clears.map((c, i) => (
      <Sequence key={`c${i}`} from={c - 4} durationInFrames={F(0.8)}>
        <Audio src={staticFile("sfx/clear.wav")} volume={0.55} />
      </Sequence>
    ))}
    <Bar L={L} base={base} />
  </AbsoluteFill>
);

export const GuideEdit: React.FC = () => <Movie L={ALL} />;
export const GuideQ1: React.FC = () => <Movie L={Q1} />;
export const GuideQ2: React.FC = () => <Movie L={Q2} base={1} />;   // 앞 퀘스트에서 채운 칸을 이어받는다
export const GuideQ3: React.FC = () => <Movie L={Q3} base={2} />;
