import React from "react";
import {
  AbsoluteFill, Audio, Easing, OffthreadVideo, Sequence,
  interpolate, staticFile, useCurrentFrame,
} from "remotion";
import { FONT } from "./brand";
import VO from "./quest_vo.json";
import PARTS_JSON from "./quest_parts.json";

/* 퀘스트 가이드 영상 — 프로덕션 실조작 녹화 위에 얹는 편집본.
 *
 * 원본(quest-raw.webm)은 193초다. 대기 구간을 잘라 2분에 맞춘다.
 * 자를 위치는 눈대중이 아니라 녹화 때 남긴 조작 시각(quest_marks.json)에서 가져온다.
 * 각 퀘스트는 세 박자 — ① 제시(정지) ② 방법(예고 상자) ③ 실연. */

export const FPS = 30;
const W = 1920, H = 1080;
const BAR = 92;                                   // 퀘스트 띠 높이
const easeSoft = Easing.bezier(0.16, 1, 0.3, 1);

/** 조각 하나 = 나레이션 한 문장 + 그 문장이 설명하는 화면 구간.
 *
 * 문장이 화면 구간보다 길면 화면을 그만큼 느리게 돌린다(정지시키지 않는다).
 * 이렇게 해야 문장이 다음 조각으로 넘어가 겹치는 일이 없다 — 앞선 판의 실패 원인이었다. */
type Part = {
  quest: 0 | 1 | 2 | 3;
  from: number;                  // 원본 시각(초)
  to: number;
  k?: keyof typeof VO;           // 이 조각에서 읽을 문장 (없으면 무음 — 빨리감기 구간)
  fast?: number;                 // 배속(생성 대기)
  clearAtEnd?: boolean;
  zx?: number; zy?: number;      // 누른 지점(원본 1920×1080 좌표) — 그쪽으로 확대한다
  zt?: number;                   // 조각 시작 후 몇 초에 눌렀는지
};

/* 편집표는 make_parts.py가 녹화 마크에서 뽑는다 — 손으로 초를 적지 않는다 */
const PARTS = PARTS_JSON as Part[];

const LABEL = [
  "",
  "퀘스트 1 · 사대문 안쪽 40~60억 매물 찾기",
  "퀘스트 2 · 적정가 알아보기",
  "퀘스트 3 · 매수자 설명 자료 만들기",
];

/* 나레이션 문장 — 자막으로도 깐다(소리 끄고 보는 사람이 많다) */
/* 자막 = 나레이션 문장 그대로. 숫자만 읽는 표기에서 쓰는 표기로 되돌린다. */
const TEXT: Record<string, string> = {
  "00": "퀘스트 세 개를 차례로 풀어보겠습니다. 보시고 그대로 따라 하시면 됩니다.",
  "1p": "첫 번째 퀘스트입니다. 사대문 안쪽에서, 40억에서 60억 사이 매물을 찾습니다.",
  "1m1": "사대문은 행정구역이 아니라서 구나 동으로는 검색되지 않습니다. 지도에 직접 그려야 합니다.",
  "1m2": "그린 다음, 필터에서 금액과 용도 조건을 겁니다.",
  "1a": "자, 그럼 직접 해보겠습니다.",
  "1b": "지도 도구에서 자유곡선을 고릅니다.",
  "1c": "사대문을 감싸듯 그립니다. 반듯하지 않아도 됩니다.",
  "1d": "놓으면 그 안의 건물만 남습니다.",
  "1e": "필터를 엽니다.",
  "1f": "매매가를 40억에서 60억으로 넣습니다.",
  "1x": "적정가에는 오차가 있으니, 실제로는 범위를 조금 여유 있게 잡는 편이 좋습니다.",
  "1g": "토지이용상황에서 상업용 빌딩을 고릅니다.",
  "1h": "주용도는 제2종근린생활시설로 합니다.",
  "1i": "역과의 거리를 300m로 넣어 역세권으로 좁힙니다.",
  "1j": "적용을 누르면 조건에 맞는 것만 남습니다.",
  "2p": "두 번째 퀘스트입니다. 찾은 건물 가운데 하나를 골라, 적정가를 알아봅니다.",
  "2m": "매물 상세 화면 오른쪽 위에 매물 분석하기 버튼이 있습니다.",
  "2a": "자, 해보겠습니다. 하나를 골라 상세보기를 누릅니다.",
  "2b": "오른쪽 위, 매물 분석하기.",
  "2c": "잠시 기다리면 첫 장에 적정가가 나옵니다.",
  "2d": "실거래가는 근처에서 실제로 얼마에 거래됐는지 보여줍니다.",
  "2e": "공시지가는 땅값이 실거래의 몇 배에서 형성되는지 알려줍니다.",
  "2f": "임대수익은 주변 시세로 임대료를 추정해 수익률을 냅니다.",
  "2g": "이 셋을 합친 결론이 마지막 장입니다.",
  "3p": "마지막 퀘스트입니다. 매수자에게 보여줄 설명 자료를 만듭니다.",
  "3m": "사진과 서류는 매물 상세의 업로드 사진에서 첨부하실 수 있습니다.",
  "3a": "자, 눌러보겠습니다. 브리핑 자료.",
  "3b": "일곱 장짜리 자료가 나옵니다.",
  "3c": "입체 지적도로 땅 모양과 건물 배치를 보여주고,",
  "3d": "층별 임대정보와 올려둔 사진이 그대로 들어갑니다.",
  "3e": "전체화면을 누르면 이대로 고객 앞에서 띄울 수 있습니다.",
  "99": "이제 직접 해보실 차례입니다.",
};

/* 여는 화면 길이 — 본편은 이만큼 뒤로 밀린다 */
const INTRO_SAY: (keyof typeof VO)[] = ["i1", "i2", "i3", "i4", "i5"];
const INTRO_LEN = INTRO_SAY.reduce((n, k) => n + Math.round(((VO[k] as number) + 0.35) * FPS), 0);

/* ── 타임라인 배치 ── */
const F = (sec: number) => Math.round(sec * FPS);
type Placed = Part & { start: number; len: number; rate: number };
const PLACED: Placed[] = [];
let cur = 0;
for (const p of PARTS) {
  const secs = (p.to - p.from) / (p.fast ?? 1);
  PLACED.push({ ...p, start: cur, len: F(secs), rate: p.fast ?? 1 });
  cur += F(secs);
}
const OUTRO = F(3.2);
export const TOTAL = INTRO_LEN + cur + OUTRO;

const CLEARS = PLACED.filter((p) => p.clearAtEnd).map((p) => INTRO_LEN + p.start + p.len);


/* ── 여는 화면 · 오늘의 퀘스트 ──
   문서를 따로 주지 않으므로, 무엇을 할지 영상이 먼저 알려준다. */
const IntroCard: React.FC = () => {
  const f = useCurrentFrame();
  // 문장 하나가 끝나면 다음 줄이 켜진다
  let acc = 0;
  const on: number[] = [];
  INTRO_SAY.forEach((k, i) => { on[i] = acc; acc += Math.round(((VO[k] as number) + 0.35) * FPS); });
  const rows = [
    ["1", "사대문 안쪽에서 40억~60억 매물 찾기"],
    ["2", "그중 한 건물의 적정가 알아보기"],
    ["3", "매수자에게 보여줄 설명 자료 만들기"],
  ];
  const rise = (at: number) => interpolate(f, [at, at + 12], [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeSoft });

  return (
    <AbsoluteFill style={{
      background: "#1A1714", fontFamily: FONT, display: "flex", flexDirection: "column",
      justifyContent: "center", paddingLeft: 190, gap: 46,
    }}>
      <div style={{ opacity: rise(0) }}>
        <div style={{ color: "#E7C876", fontSize: 26, fontWeight: 800, letterSpacing: ".16em" }}>빌탐정</div>
        <div style={{ color: "#EDE8E1", fontSize: 74, fontWeight: 800, letterSpacing: "-.035em", marginTop: 10 }}>
          오늘의 퀘스트 <span style={{ color: "#E7C876" }}>3</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        {rows.map(([n, t], i) => {
          const o = rise(on[i + 1]);
          return (
            <div key={n} style={{
              display: "flex", alignItems: "center", gap: 26,
              opacity: 0.25 + 0.75 * o, transform: `translateX(${(1 - o) * 26}px)`,
            }}>
              <span style={{
                width: 62, height: 62, borderRadius: "50%", display: "grid", placeItems: "center",
                background: o > 0.5 ? "#E7C876" : "#2C2823", color: o > 0.5 ? "#1A1714" : "#6E655A",
                fontSize: 30, fontWeight: 800,
              }}>{n}</span>
              <span style={{ color: "#EDE8E1", fontSize: 44, fontWeight: 700, letterSpacing: "-.025em" }}>{t}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/* ── 퀘스트 띠 ── */
const Bar: React.FC = () => {
  const f = useCurrentFrame();
  const done = CLEARS.filter((c) => f >= c).length;
  const part = PLACED.find((p) => f >= p.start && f < p.start + p.len);
  const q = part?.quest ?? 3;
  const last = CLEARS[done - 1] ?? 0;
  const ratio = done === 0 ? 0
    : interpolate(f, [last, last + 16], [(done - 1) / 3, done / 3],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeSoft });
  const pop = done > 0 && f - last < 30
    ? interpolate(f - last, [0, 7, 30], [0, 1, 0], { extrapolateRight: "clamp" }) : 0;
  const drop = interpolate(f, [0, 16], [-BAR, 0], { extrapolateRight: "clamp", easing: easeSoft });

  return (
    <div style={{
      position: "absolute", top: drop, left: 0, width: W, height: BAR,
      background: "#FFFFFF", borderBottom: "1px solid #E7E2D9", display: "flex",
      alignItems: "center", gap: 26, padding: "0 54px", fontFamily: FONT, boxSizing: "border-box",
    }}>
      <span style={{ fontSize: 29, fontWeight: 800, letterSpacing: "-.02em", color: "#262320" }}>
        {LABEL[q] || LABEL[3]}
      </span>
      <div style={{ flex: 1, height: 8, borderRadius: 99, background: "#ECE8E0", overflow: "hidden" }}>
        <div style={{ width: `${ratio * 100}%`, height: "100%", borderRadius: 99, background: "#262320" }} />
      </div>
      {pop > 0 && (
        <span style={{
          fontSize: 21, fontWeight: 800, color: "#0E805B", background: "#E4F0E9",
          borderRadius: 99, padding: "5px 15px", opacity: pop, whiteSpace: "nowrap",
          transform: `translateY(${(1 - pop) * 8}px)`,
        }}>완료</span>
      )}
      <span style={{
        fontSize: 25, fontWeight: 800, color: "#262320",
        fontVariantNumeric: "tabular-nums", minWidth: 74, textAlign: "right",
      }}>{done} / 3</span>
    </div>
  );
};

/* ── 자막 ── */
const Caption: React.FC<{ text: string }> = ({ text }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 6], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, bottom: 46, display: "flex", justifyContent: "center",
      fontFamily: FONT, opacity: o,
    }}>
      <span style={{
        background: "rgba(26,23,20,.88)", color: "#F4F1EA", fontSize: 34, fontWeight: 700,
        letterSpacing: "-.015em", padding: "13px 30px", borderRadius: 12, maxWidth: 1500,
        textAlign: "center", lineHeight: 1.35,
      }}>{text}</span>
    </div>
  );
};

/* ── 조각 하나 ── */
/* 영상은 1920×1080 그대로다. 띠가 위를 차지하므로 남는 높이에 **비율대로 맞춰 넣는다**.
   전에는 크기를 그대로 두고 위로 밀어서 위아래가 잘렸다. */
const VIEW_H = H - BAR;
const FIT = VIEW_H / H;                       // 0.914
const VIEW_W = Math.round(W * FIT);           // 1756
const SIDE = Math.round((W - VIEW_W) / 2);

const ZOOM = 1.35;                            // 클릭 지점 확대 배율
const IN = 14, HOLD = 26, OUT = 12;           // 들어가고 · 머물고 · 빠지고 (프레임)

const Shot: React.FC<{ p: Placed }> = ({ p }) => {
  const f = useCurrentFrame();

  // 누른 순간 그 지점으로 살짝 들어갔다 빠진다 — 작은 버튼도 읽히게
  let scale = 1, ox = 0, oy = 0;
  if (p.zx != null && p.zt != null) {
    const c = F(p.zt) - IN;                   // 누르기 직전부터 들어간다
    const k = interpolate(f, [c, c + IN, c + IN + HOLD, c + IN + HOLD + OUT], [0, 1, 1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeSoft });
    scale = 1 + (ZOOM - 1) * k;
    // 누른 지점이 화면 가운데로 오도록 민다(가장자리는 여백이 생기지 않게 묶는다)
    const maxX = (VIEW_W * scale - VIEW_W) / 2, maxY = (VIEW_H * scale - VIEW_H) / 2;
    const cx = (p.zx / W - 0.5) * VIEW_W * scale;
    const cy = (p.zy! / H - 0.5) * VIEW_H * scale;
    ox = -Math.max(-maxX, Math.min(maxX, cx)) * k;
    oy = -Math.max(-maxY, Math.min(maxY, cy)) * k;
  }

  return (
    <AbsoluteFill>
      <div style={{
        position: "absolute", top: BAR, left: SIDE, width: VIEW_W, height: VIEW_H,
        overflow: "hidden", borderRadius: 4,
      }}>
        <OffthreadVideo
          src={staticFile("quest-raw.webm")}
          startFrom={F(p.from)}
          playbackRate={p.rate}
          muted
          style={{
            position: "absolute", width: VIEW_W, height: VIEW_H,
            transform: `translate(${ox}px, ${oy}px) scale(${scale})`, transformOrigin: "center",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

export const QuestEdit: React.FC = () => (
  <AbsoluteFill style={{ background: "#262320", fontFamily: FONT }}>
    <Sequence durationInFrames={INTRO_LEN}>
      <IntroCard />
      {INTRO_SAY.map((k, i) => {
        const from = INTRO_SAY.slice(0, i).reduce((n, x) => n + Math.round(((VO[x] as number) + 0.35) * FPS), 0);
        return (
          <Sequence key={k} from={from} durationInFrames={Math.round((VO[k] as number) * FPS) + 8}>
            <Audio src={staticFile(`vo/q${k}.wav`)} />
          </Sequence>
        );
      })}
    </Sequence>
    {PLACED.map((p, i) => (
      <Sequence key={i} from={INTRO_LEN + p.start} durationInFrames={p.len}>
        <Shot p={p} />
      </Sequence>
    ))}

    {/* 나레이션 + 자막 — 조각마다 한 문장, 조각 시작에 붙인다 */}
    {PLACED.filter((p) => p.k).map((p) => (
      <Sequence key={`say-${p.start}`} from={INTRO_LEN + p.start} durationInFrames={Math.round((VO[p.k!] as number) * FPS) + 8}>
        <Audio src={staticFile(`vo/q${p.k}.wav`)} />
        <Caption text={TEXT[p.k!] ?? ""} />
      </Sequence>
    ))}

    {/* 퀘스트가 풀리는 순간 — 완료음 */}
    {CLEARS.map((c, i) => (
      <Sequence key={`c${i}`} from={c} durationInFrames={F(0.7)}>
        <Audio src={staticFile("sfx/clear.wav")} />
      </Sequence>
    ))}

    <Sequence from={INTRO_LEN}><Bar /></Sequence>

    {/* 닫는 말 */}
    <Sequence from={INTRO_LEN + cur} durationInFrames={OUTRO}>
      <AbsoluteFill style={{ background: "#1A1714", display: "grid", placeItems: "center", gap: 18 }}>
        <div style={{ color: "#EDE8E1", fontSize: 62, fontWeight: 800, letterSpacing: "-.03em" }}>
          빌탐정<span style={{ color: "#E7C876" }}>.</span>
        </div>
        <div style={{ color: "#A79E92", fontSize: 30 }}>이제 직접 해보실 차례입니다</div>
      </AbsoluteFill>
      <Audio src={staticFile("vo/q99.wav")} />
    </Sequence>
  </AbsoluteFill>
);
