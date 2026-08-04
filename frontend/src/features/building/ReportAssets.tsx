/** 분석보고서 브랜드/아이콘 — 네이비 모노라인(AI티 방지). 로고·인장 씰은 임시(브랜드 확정 전). */
import { useEffect, useRef, useState } from "react";

/* 숫자 카운트업 — 마운트 시 0→end 이징. fmt로 포맷. 슬라이드 진입마다 재생하려면 key로 리마운트. */
export function CountUp({ end, dur = 950, fmt, delay = 0 }: { end: number; dur?: number; fmt?: (v: number) => string; delay?: number }) {
  const [v, setV] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    if (!end) { setV(0); return; }
    let raf = 0, t0 = 0;
    const start = () => {
      const tick = (t: number) => {
        if (!t0) t0 = t;
        const p = Math.min(1, (t - t0) / dur);
        setV(end * (1 - Math.pow(1 - p, 3)));      // easeOutCubic
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const to = setTimeout(start, delay);
    ref.current = end;
    return () => { clearTimeout(to); cancelAnimationFrame(raf); };
  }, [end, dur, delay]);
  return <>{fmt ? fmt(v) : Math.round(v).toLocaleString()}</>;
}

/* 빌탐정 로고 — 건물 글리프 + 워드마크. cqw로 슬라이드 스케일 대응(size=글리프 폭 cqw). */
export function Logo({ mono, size = 2.6 }: { mono?: boolean; size?: number }) {
  const ink = mono ? "#fff" : "var(--navy)";
  const sub = mono ? "#8fb0e0" : "var(--blue)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: `${size * 0.28}cqw` }}>
      {/* ㅂ 심볼 — 빌탐정의 첫 글자 = 두 채의 빌딩(골드 창) */}
      <svg width={`${size}cqw`} height={`${size}cqw`} viewBox="0 0 28 28" fill="none" style={{ flex: "0 0 auto" }}>
        <rect x="4" y="5" width="5" height="18" rx="1.3" fill={ink} />
        <rect x="17" y="5" width="5" height="18" rx="1.3" fill={ink} />
        <rect x="4" y="12.6" width="18" height="4.2" rx="1.3" fill={ink} />
        <rect x="4" y="18.4" width="18" height="4.2" rx="1.3" fill={ink} />
        <rect x="5.6" y="7.2" width="3.4" height="3.2" rx=".5" fill="#E7C876" />
      </svg>
      <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1 }}>
        <b style={{ fontSize: `${size * 0.72}cqw`, fontWeight: 800, color: ink, letterSpacing: "-.01em" }}>빌탐정</b>
        <span style={{ fontSize: `${size * 0.32}cqw`, fontWeight: 700, color: sub, letterSpacing: ".14em" }}>BILLTAMJUNG</span>
      </span>
    </span>
  );
}

/* 점수 원형 게이지 — 마운트 시 호(arc)가 0→score% 그려짐 + 중앙 숫자 카운트업. 박스 대신 데이터 시각화. */
export function ScoreRing({ score, grade, gradeColor, size = 18 }:
  { score: number; grade: string; gradeColor: string; size?: number }) {
  const [off, setOff] = useState(100);
  useEffect(() => { const t = setTimeout(() => setOff(100 - Math.max(0, Math.min(100, score))), 80); return () => clearTimeout(t); }, [score]);
  return (
    <div style={{ position: "relative", width: `${size}cqw`, height: `${size}cqw`, flex: "0 0 auto" }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="50" cy="50" r="43" fill="none" stroke="var(--rl)" strokeWidth="7" />
        <circle cx="50" cy="50" r="43" fill="none" stroke={gradeColor} strokeWidth="7" strokeLinecap="round"
          pathLength={100} strokeDasharray="100" strokeDashoffset={off}
          style={{ transition: "stroke-dashoffset 1.3s cubic-bezier(.22,1,.36,1)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
        <span className="num" style={{ fontSize: `${size * 0.34}cqw`, fontWeight: 800, color: "var(--navy)" }}><CountUp end={score} dur={1300} fmt={(v) => v.toFixed(1)} /></span>
        <span style={{ fontSize: `${size * 0.13}cqw`, fontWeight: 800, color: gradeColor, marginTop: `${size * 0.03}cqw` }}>{grade}등급</span>
      </div>
    </div>
  );
}

/* 임시 건물 아트 — 야경 유리타워(줌인/표지 공용). 실사 교체 예정. 두 모드(덱·애니메이션)가 공유. */
/** 표지·인트로 배경 — frontend/public/report-cover.jpg 가 있으면 그 사진, 없으면 기본 SVG.
 *  ▶ 표지 이미지 바꾸려면: frontend/public/report-cover.jpg (또는 .png) 로 파일만 교체. */
export function BuildingArt() {
  const [imgFail, setImgFail] = useState(false);
  if (!imgFail)
    return <img src="/report-cover.jpg" alt="" onError={() => setImgFail(true)}
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />;
  const cols = 7, rows = 16;
  return (
    <svg viewBox="0 0 400 520" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ display: "block" }}>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1224" /><stop offset=".55" stopColor="#132038" /><stop offset="1" stopColor="#1b2c4a" />
        </linearGradient>
        <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#26374f" /><stop offset="1" stopColor="#16233a" />
        </linearGradient>
      </defs>
      <rect width="400" height="520" fill="url(#sky)" />
      <rect x="20" y="230" width="70" height="290" fill="#0e1930" opacity=".7" />
      <rect x="320" y="200" width="70" height="320" fill="#0e1930" opacity=".7" />
      <rect x="120" y="90" width="160" height="430" rx="4" fill="url(#glass)" stroke="#3a5478" strokeWidth="1.2" />
      {Array.from({ length: rows }).flatMap((_, r) =>
        Array.from({ length: cols }).map((_, c) => {
          const lit = (r * 13 + c * 7) % 5 < 2;
          return <rect key={`${r}-${c}`} x={130 + c * 20.6} y={104 + r * 25.5} width="15" height="17" rx="1.5"
            fill={lit ? "#ffe6a8" : "#1c2c46"} opacity={lit ? 0.92 : 0.85} />;
        })
      )}
      <rect x="150" y="470" width="100" height="50" fill="#ffdf9e" opacity=".95" />
      <rect x="150" y="470" width="100" height="50" fill="none" stroke="#3a5478" />
      <rect x="192" y="484" width="16" height="36" fill="#0b1224" />
    </svg>
  );
}

/* 인장 씰 — 원형 스탬프(건물 + 빌탐정 공식 분석 + ★). 임시 그래픽. */
export function Seal({ size = 11, mono }: { size?: number; mono?: boolean }) {
  const ink = mono ? "#e6edf8" : "var(--navy)";
  const accent = mono ? "#8fb0e0" : "var(--blue)";
  const star = mono ? "#ffd98a" : "#E1A93C";
  return (
    <svg width={`${size}cqw`} height={`${size}cqw`} viewBox="0 0 120 120" style={{ display: "block", flex: "0 0 auto" }}>
      <circle cx="60" cy="60" r="56" fill="none" stroke={ink} strokeWidth="2.5" />
      <circle cx="60" cy="60" r="49" fill="none" stroke={ink} strokeWidth="1" opacity=".5" />
      <path id="seal-top" d="M60 16 a44 44 0 0 1 0 88 a44 44 0 0 1 0 -88" fill="none" />
      <text fontSize="10" fontWeight="700" fill={ink} letterSpacing="3">
        <textPath href="#seal-top" startOffset="6%">빌탐정 부동산 가치분석</textPath>
      </text>
      <g transform="translate(44,40)">
        <rect x="0" y="5" width="6" height="31" rx="1.5" fill={ink} />
        <rect x="25" y="5" width="6" height="31" rx="1.5" fill={accent} />
        <rect x="0" y="17" width="31" height="5.5" rx="1.5" fill={ink} />
        <rect x="0" y="27.5" width="31" height="5.5" rx="1.5" fill={ink} />
        <rect x="2.5" y="8" width="4.5" height="4" rx=".6" fill={star} />
      </g>
      <text x="60" y="92" textAnchor="middle" fontSize="9.5" fontWeight="800" fill={ink} letterSpacing="1">공식 분석</text>
      <text x="60" y="104" textAnchor="middle" fontSize="11" fill={star} letterSpacing="2">★★★★★</text>
    </svg>
  );
}

/* 모노라인 아이콘 — stroke=currentColor, fill none. 색 남발 방지(네이비 단색). */
const P: Record<string, React.ReactNode> = {
  medal: <><circle cx="12" cy="9" r="5.5" /><path d="M8.5 13.5 7 21l5-2.5L17 21l-1.5-7.5" /></>,
  house: <><path d="M4 11 12 4l8 7" /><path d="M6 10v10h12V10" /><path d="M10 20v-6h4v6" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="M8 16l3-4 3 2 4-6" /></>,
  coins: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3 3 7 3s7-1.3 7-3v-6" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".6" fill="currentColor" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9z" /><path d="M8.5 11l1.5 1.5 3-3M8.5 16l1.5 1.5 3-3" /></>,
  road: <><path d="M6 21 9 3h6l3 18" /><path d="M12 5v3M12 11v3M12 17v2" strokeDasharray="0" /></>,
  train: <><rect x="6" y="4" width="12" height="13" rx="2.5" /><path d="M6 12h12M9.5 20l-2 2M14.5 20l2 2" /><circle cx="9" cy="14.5" r=".8" fill="currentColor" /><circle cx="15" cy="14.5" r=".8" fill="currentColor" /></>,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" /><path d="M16 6.5a3 3 0 0 1 0 5.8M17 14.5c2.3.4 4 2.5 4 5" /></>,
  zone: <><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z" /><path d="M9 4v13M15 6.5v13" /></>,
  calendar: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /><circle cx="9" cy="13" r=".7" fill="currentColor" /><circle cx="13" cy="13" r=".7" fill="currentColor" /></>,
  elevator: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M12 3v18M9 9l-1.5 2h3zM15 15l1.5-2h-3z" /></>,
  tools: <><path d="M14.5 6.5a3.5 3.5 0 0 0-4.7 4.3L4 16.6 7.4 20l5.8-5.8a3.5 3.5 0 0 0 4.3-4.7l-2.3 2.3-2-2 2.3-2.3z" /></>,
  mountain: <><path d="M3 19h18L14 7l-3.5 6-2-2.5L3 19z" /></>,
  slope: <><path d="M4 20 20 6M4 20h16" /></>,
  pin: <><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></>,
  car: <><path d="M4 16v-3l2-5h12l2 5v3" /><path d="M3 16h18v3h-3v-2H6v2H3v-3z" /><circle cx="7.5" cy="16" r="1.3" /><circle cx="16.5" cy="16" r="1.3" /></>,
  won: <><circle cx="12" cy="12" r="9" /><path d="M8 9l2 6 2-4 2 4 2-6M7.5 12h9" /></>,
  bag: <><path d="M7 8V6.5a5 5 0 0 1 10 0V8" /><path d="M5 8h14l1 12H4L5 8z" /></>,
  swap: <><path d="M7 8h11l-3-3M17 16H6l3 3" /></>,
  bulb: <><path d="M9 17h6M10 21h4" /><path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1 1.3 1 2.5h6c0-1.2.2-1.8 1-2.5A6 6 0 0 0 12 3z" /></>,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2" /></>,
};
export function Icon({ name, size = 2.4, color = "var(--navy)", stroke = 1.7 }:
  { name: keyof typeof P | string; size?: number; color?: string; stroke?: number }) {
  return (
    <svg width={`${size}cqw`} height={`${size}cqw`} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
      {P[name] ?? P.won}
    </svg>
  );
}
