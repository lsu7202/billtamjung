import React from "react";
import {
  AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence, continueRender, delayRender,
  interpolate, staticFile, useCurrentFrame,
} from "remotion";
import { C, FONT } from "./brand";
import VO from "./manual_vo.json";
import ANN from "./annotations.json";

/* 매뉴얼 설명 영상 — 캡처 한 장 안에서 설명 지점으로 팬·줌하고,
   씬이 바뀔 때만 회전 푸시로 전환한다. 내레이션=타입캐스트 ssfm-v30(Seohyeon). */

export const FPS = 30;
const W = 1920, H = 1080;
const IMG_W = 1440, IMG_H = 900;          // 캡처 원본(annotations.json 기준)
/* 화면을 꽉 채우지 않는다 — 캡처는 고정된 액자 안에서만 움직이고,
   좌우로 넉넉한 여백, 위는 좁게, 아래는 자막 자리를 둔다. */
const CARD_H = 940, CARD_W = Math.round((CARD_H * IMG_W) / IMG_H);   // 1504×940
const CARD_TOP = 34;
const CAP_BAND = H - CARD_TOP - CARD_H;                              // 106px 자막 띠

const MOVE = 22;      // 카메라 이동 프레임(≈0.73s)
const GAP = 8;        // 문장 사이
const SGAP = 14;      // 씬 사이
const TR = 15;        // 전환 프레임

const ease = Easing.bezier(0.65, 0, 0.2, 1);      // 카메라 — 무겁게 출발, 부드럽게 정지
const easeSoft = Easing.bezier(0.16, 1, 0.3, 1);

type Rect = { x: number; y: number; w: number; h: number; n?: number };
type Line = { k: string; n?: number; rect?: Rect };
type Scene = { img?: string; lines: Line[]; kind?: "outro"; clip?: string; clipLen?: number; trans?: "y" | "x" | "zoom" };

const SCENES: Scene[] = [
  { clip: "intro.mp4", clipLen: 120, lines: [], trans: "y" },   // ad/download.mp4 — 브랜드 인트로
  { img: "01-검색.png", trans: "y",
    lines: [{ k: "01a", n: 1 }, { k: "01b", n: 2 }, { k: "01c", n: 3 }] },
  { img: "12-조건팝오버.png", trans: "x",
    lines: [{ k: "02a", n: 1 }, { k: "02b", n: 2 }, { k: "02c", n: 3 }, { k: "02d", n: 4 },
            { k: "02e", n: 5 }, { k: "02f", n: 6 }, { k: "02g" }] },
  { img: "13-그리기도구.png", trans: "y",
    lines: [{ k: "03a", n: 1 }, { k: "03b", n: 2 }, { k: "03c", n: 3 }] },
  { img: "02-리포트요약.png", trans: "x",
    lines: [{ k: "04a", n: 1 }, { k: "04b", n: 2 }, { k: "04c", n: 3 }, { k: "04d", n: 4 }] },
  { img: "14-값수정.png", trans: "y",
    lines: [{ k: "05a", rect: { x: 0.6, y: 74, w: 37, h: 22, n: 1 } }] },
  { img: "15-층별임대.png", trans: "y",
    lines: [{ k: "05b", n: 1 }, { k: "05c", n: 3 }] },
  { img: "06-검토.png", trans: "y",
    lines: [{ k: "06a", n: 1 }, { k: "06b", n: 2 }, { k: "06c", n: 3 }, { k: "06d", n: 4 }] },
  { img: "07-리포트1.png", trans: "y",
    lines: [{ k: "r1", rect: { x: 0.7, y: 6.5, w: 11.5, h: 92 } }] },
  { img: "08-리포트2.png", trans: "zoom",
    lines: [{ k: "r2", rect: { x: 45.5, y: 42, w: 49, h: 22 } }] },
  { kind: "outro", lines: [{ k: "07" }] },
];

/* ── 타임라인 ── */
const dur = (k: string) => Math.round(((VO as Record<string, number>)[k] ?? 3) * FPS);
type Built = Scene & { start: number; len: number; cues: { k: string; at: number; len: number; r: Rect | null }[] };

const box = (scene: Scene, l: Line): Rect | null => {
  if (l.rect) return l.rect;
  if (l.n == null || !scene.img) return null;
  const marks = (ANN as any)[scene.img] as any[] | undefined;
  const m = marks?.find((x) => x.n === l.n);
  return m ? { x: m.x, y: m.y, w: m.w, h: m.h, n: m.n } : null;
};

export const TIMELINE: Built[] = (() => {
  let t = 0;
  return SCENES.map((s) => {
    const start = t;
    const cues = s.lines.map((l) => {
      const len = dur(l.k) + GAP;
      const cue = { k: l.k, at: t - start, len, r: box(s, l) };
      t += len;
      return cue;
    });
    if (s.clip) t += s.clipLen ?? 120;
    t += SGAP;
    return { ...s, start, len: t - start, cues };
  });
})();
export const TOTAL = TIMELINE[TIMELINE.length - 1].start + TIMELINE[TIMELINE.length - 1].len + 20;

/* ── 카메라 — 초점 사각형을 화면 중앙에 담는 scale/translate ── */
const camFor = (r: Rect | null) => {
  if (!r) return { s: 1, tx: 0, ty: 0 };
  const rw = (r.w / 100) * CARD_W, rh = (r.h / 100) * CARD_H;
  const s = Math.min(3.2, Math.max(1, Math.min((CARD_W * 0.62) / rw, (CARD_H * 0.62) / rh)));
  let tx = -(((r.x + r.w / 2) / 100) * CARD_W - CARD_W / 2);
  let ty = -(((r.y + r.h / 2) / 100) * CARD_H - CARD_H / 2);
  // 액자 안이 빈 곳 없이 캡처로만 채워지도록 이동량 제한
  const limX = (CARD_W * (s - 1)) / 2 / s;
  const limY = (CARD_H * (s - 1)) / 2 / s;
  tx = Math.max(-limX, Math.min(limX, tx));
  ty = Math.max(-limY, Math.min(limY, ty));
  return { s, tx, ty };
};

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/* ── 씬 한 장 ── */
const Shot: React.FC<{ scene: Built; f: number }> = ({ scene, f }) => {
  if (scene.clip) return (
    <AbsoluteFill style={{ background: "#fff" }}>
      <OffthreadVideo src={staticFile(scene.clip)} />
    </AbsoluteFill>
  );
  if (scene.kind) return <Card kind={scene.kind} f={f} />;

  let i = 0;
  while (i < scene.cues.length - 1 && f >= scene.cues[i + 1].at) i++;
  const cur = scene.cues[i];
  const prev = i > 0 ? scene.cues[i - 1] : null;

  const a = camFor(prev ? prev.r : null);
  const b = camFor(cur.r);
  const local = f - cur.at;
  const p = ease(interpolate(local, [0, MOVE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

  const s = lerp(a.s, b.s, p);
  const tx = lerp(a.tx, b.tx, p);
  const ty = lerp(a.ty, b.ty, p);

  const shown = cur.r;
  const bo = interpolate(local, [MOVE - 8, MOVE + 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bs = 1 + (1 - easeSoft(bo)) * 0.06;

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <div style={{
        position: "absolute", left: (W - CARD_W) / 2, top: CARD_TOP, width: CARD_W, height: CARD_H,
        borderRadius: 12, overflow: "hidden",
        boxShadow: "0 26px 70px rgba(0,0,0,.5), 0 0 0 1px rgba(237,232,225,.07)",
      }}>
        <div style={{ width: "100%", height: "100%", position: "relative", transform: `scale(${s}) translate(${tx}px, ${ty}px)` }}>
          <Img src={staticFile(`shots/${scene.img}`)} style={{ width: "100%", height: "100%", display: "block" }} />
          {shown && (
            <div style={{
              position: "absolute",
              left: `${shown.x}%`, top: `${shown.y}%`, width: `${shown.w}%`, height: `${shown.h}%`,
              border: `${3 / s}px solid ${C.terra}`, borderRadius: `${6 / s}px`,
              background: `rgba(194,87,28,${0.07 * bo})`,
              boxShadow: `0 0 ${26 / s}px rgba(194,87,28,${0.5 * bo})`,
              opacity: bo, transform: `scale(${bs})`, transformOrigin: "center",
            }}>
              {shown.n != null && (
                <div style={{
                  position: "absolute", left: `${-13 / s}px`, top: `${-13 / s}px`,
                  width: `${26 / s}px`, height: `${26 / s}px`, borderRadius: "50%",
                  background: C.terra, color: "#fff", fontFamily: FONT, fontWeight: 800,
                  fontSize: `${15 / s}px`, display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: `0 ${2 / s}px ${8 / s}px rgba(0,0,0,.4)`,
                }}>{shown.n}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ── 인트로 · 아웃트로 ── */
const Card: React.FC<{ kind: "outro"; f: number }> = ({ kind, f }) => {
  const p = easeSoft(interpolate(f, [0, 26], [0, 1], { extrapolateRight: "clamp" }));
  return (
    <AbsoluteFill style={{ background: "#000", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", opacity: p, transform: `translateY(${(1 - p) * 16}px)` }}>
        <Img src={staticFile("logo.png")} style={{ height: 96, display: "block", margin: "0 auto" }} />
        <div style={{
          fontFamily: FONT, fontWeight: 500, fontSize: 26, letterSpacing: "0.22em",
          color: C.muted, marginTop: 34,
        }}>무 료 베 타</div>
      </div>
    </AbsoluteFill>
  );
};

/* ── 전환 — 큐브 회전 푸시(빈 공간 없음) ── */
const Cube: React.FC<{ axis: "y" | "x"; p: number; a: React.ReactNode; b: React.ReactNode }> = ({ axis, p, a, b }) => {
  const d = axis === "y" ? W : H;
  const th = 90 * p;
  const inner = axis === "y"
    ? `translateZ(${-d / 2}px) rotateY(${-th}deg)`
    : `translateZ(${-d / 2}px) rotateX(${th}deg)`;
  const faceB = axis === "y" ? `rotateY(90deg) translateZ(${d / 2}px)` : `rotateX(-90deg) translateZ(${d / 2}px)`;
  const faceA = `translateZ(${d / 2}px)`;
  return (
    <AbsoluteFill style={{ background: C.bg, perspective: 2600 }}>
      <AbsoluteFill style={{ transformStyle: "preserve-3d", transform: inner }}>
        <AbsoluteFill style={{ transform: faceA, backfaceVisibility: "hidden" }}>{a}</AbsoluteFill>
        <AbsoluteFill style={{ transform: faceB, backfaceVisibility: "hidden" }}>{b}</AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ── 자막 ── */
const CAPTION: Record<string, string> = {
  "01a": "주소를 알면 검색창에. 동 이름·역 이름도 됩니다",
  "01b": "고르면 왼쪽에 요약 카드",
  "01c": "상세보기 → 건물의 모든 정보",
  "02a": "주소를 모를 때는 필터. 먼저 지역을 정하고",
  "02b": "왼쪽에서 분야를 고른 뒤",
  "02c": "원하는 조건을 누릅니다",
  "02d": "슬라이더로 끌거나 숫자를 직접 입력",
  "02e": "지정한 조건은 위에 쌓이고",
  "02f": "적용을 누르면 결과가 나옵니다",
  "02g": "용적률 여유분, 오래 거래 없던 건물 — 남들이 안 보는 조건까지",
  "03a": "행정동으로 자를 수 없는 범위는 직접 그립니다",
  "03b": "자유곡선 · 다각형 · 필지에 붙는 자석 올가미",
  "03c": "그린 영역 안쪽만 결과에 남습니다",
  "04a": "빌탐정 적정가 — 토지와 건물로 나눠 비교, 연식·시점 보정",
  "04b": "실거래가·공시지가와 나란히",
  "04c": "예상수익률",
  "04d": "매력도 등급",
  "05a": "값을 클릭해 바로 수정 — 자동 저장, 원본은 보존",
  "05b": "층을 누르면 호실이 펼쳐지고",
  "05c": "아는 계약만 입력하면 수익률이 실측 기준으로",
  "06a": "계산에 쓰인 주변 거래가 모두 나열됩니다",
  "06b": "맞지 않는 사례는 체크 해제",
  "06c": "조정할 때마다 다시 계산 — 여기까지 크레딧 0",
  "06d": "생성을 누르면 리포트가 만들어집니다",
  "r1": "표지 · 핵심 요약 · 가격 근거 · 주변 거래 · 수익 분석 — 열 장",
  "r2": "적정가 · 예상수익률 · 매력도 등급이 첫 장에 정리됩니다",
  "07": "검색과 상세 조회는 무료입니다",
};

const Caption: React.FC<{ f: number }> = ({ f }) => {
  let text = "", at = 0;
  for (const s of TIMELINE) for (const c of s.cues) {
    if (f >= s.start + c.at && f < s.start + c.at + c.len) { text = CAPTION[c.k] ?? ""; at = s.start + c.at; }
  }
  if (!text) return null;
  const p = easeSoft(interpolate(f - at, [0, 10], [0, 1], { extrapolateRight: "clamp" }));
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, bottom: 0, height: CAP_BAND,
      display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
    }}>
      <div style={{
        opacity: p, transform: `translateY(${(1 - p) * 8}px)`,
        fontFamily: FONT, fontWeight: 550, fontSize: 36, letterSpacing: "-0.02em",
        color: C.text, textAlign: "center", maxWidth: CARD_W,
      }}>{text}</div>
    </div>
  );
};

/* ── 본체 ── */
let fontLoaded = false;
export const Manual: React.FC = () => {
  const [h] = React.useState(() => (fontLoaded ? null : delayRender("font")));
  React.useEffect(() => {
    if (h == null) return;
    const ff = new FontFace(FONT, `url(${staticFile("fonts/PretendardVariable.woff2")})`, { weight: "45 920" } as FontFaceDescriptors);
    ff.load().then((x) => { document.fonts.add(x); fontLoaded = true; continueRender(h); });
  }, [h]);

  const f = useCurrentFrame();
  let idx = 0;
  while (idx < TIMELINE.length - 1 && f >= TIMELINE[idx + 1].start) idx++;
  const cur = TIMELINE[idx];
  const next = TIMELINE[idx + 1];

  // 전환은 씬 경계 앞뒤로 걸친다
  const toNext = next ? next.start - f : Infinity;
  const inTrans = next && toNext <= TR && toNext > -TR;

  let view: React.ReactNode;
  if (inTrans && next) {
    const p = Easing.bezier(0.72, 0, 0.18, 1)((TR - toNext) / (TR * 2));
    const A = <Shot scene={cur} f={f - cur.start} />;
    const B = <Shot scene={next} f={Math.max(0, f - next.start)} />;
    if (cur.trans === "zoom") {
      view = (
        <AbsoluteFill style={{ background: C.bg }}>
          <AbsoluteFill style={{ transform: `scale(${1 + p * 0.55})`, opacity: 1 - p }}>{A}</AbsoluteFill>
          <AbsoluteFill style={{ transform: `scale(${0.86 + p * 0.14})`, opacity: p }}>{B}</AbsoluteFill>
        </AbsoluteFill>
      );
    } else {
      view = <Cube axis={(cur.trans ?? "y") as "y" | "x"} p={p} a={A} b={B} />;
    }
  } else {
    view = <Shot scene={cur} f={f - cur.start} />;
  }

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {view}
      <Caption f={f} />
      {TIMELINE.flatMap((s) => s.cues.map((c) => (
        <Sequence key={c.k} from={s.start + c.at} durationInFrames={c.len} layout="none">
          <Audio src={staticFile(`vo/m${c.k}.wav`)} />
        </Sequence>
      )))}
    </AbsoluteFill>
  );
};
