import { useEffect, useRef, useState } from "react";
import type { Photo } from "../api/endpoints";

/** 슬롯 배치 — 브리핑 칸 비율에 맞춰 확대·위치를 맞춘다.
 *  원본 슬롯이 세로로 길어(서류 스캔) 가로 사진을 그대로 넣으면 잘리거나 여백이 크다.
 *  원본은 건드리지 않고 {zoom,x,y}만 저장한다(마스터 불변 + 오버레이와 같은 원칙). */
export type Fit = { zoom: number; x: number; y: number };
export const DEFAULT_FIT: Fit = { zoom: 1, x: 0.5, y: 0.5 };

/** 저장된 배치값을 CSS로 — 어디서 그리든 같은 결과가 나오게 한 곳에서만 만든다. */
export function fitStyle(t: Photo["transform"] | Fit | null | undefined): React.CSSProperties {
  const f = { ...DEFAULT_FIT, ...(t ?? {}) };
  return {
    width: "100%", height: "100%", display: "block",
    objectFit: "cover", objectPosition: `${f.x * 100}% ${f.y * 100}%`,
    transform: f.zoom !== 1 ? `scale(${f.zoom})` : undefined,
    transformOrigin: `${f.x * 100}% ${f.y * 100}%`,
  };
}

/** 배치 편집기 — 슬롯 비율을 실제 크기로 보여주고 드래그·휠(또는 슬라이더)로 맞춘다. */
export function PhotoFitEditor({
  src, ratio, value, onChange, height = 300,
}: { src: string; ratio: number; value: Fit; onChange: (f: Fit) => void; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [hint, setHint] = useState(true);

  useEffect(() => { const t = setTimeout(() => setHint(false), 2600); return () => clearTimeout(t); }, []);

  const clamp = (v: number) => Math.min(1, Math.max(0, v));

  function down(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: value.x, y: value.y };
    setHint(false);
  }
  function move(e: React.PointerEvent) {
    const d = drag.current, el = box.current;
    if (!d || !el) return;
    // 확대할수록 같은 픽셀 이동이 더 크게 움직이면 안 되므로 zoom으로 나눈다.
    const w = el.clientWidth * value.zoom, h = el.clientHeight * value.zoom;
    onChange({ ...value, x: clamp(d.x - (e.clientX - d.px) / w), y: clamp(d.y - (e.clientY - d.py) / h) });
  }
  function up(e: React.PointerEvent) {
    drag.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }
  function wheel(e: React.WheelEvent) {
    onChange({ ...value, zoom: Math.min(3, Math.max(1, +(value.zoom - e.deltaY * 0.0015).toFixed(2))) });
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onWheel={wheel}
        style={{
          position: "relative", height, aspectRatio: String(ratio), margin: "0 auto",
          maxWidth: "100%", overflow: "hidden", borderRadius: 8, background: "#EEF0F4",
          border: "1px solid var(--line-2)", cursor: drag.current ? "grabbing" : "grab", touchAction: "none",
        }}>
        <img src={src} alt="" draggable={false} style={fitStyle(value)} />
        {/* 슬롯 경계 — 브리핑에서 실제로 보이는 범위 */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,.6)" }} />
        {hint && (
          <div style={{
            position: "absolute", left: "50%", bottom: 10, transform: "translateX(-50%)",
            background: "rgba(26,31,43,.82)", color: "#fff", fontSize: 11.5, padding: "5px 10px",
            borderRadius: 999, pointerEvents: "none", whiteSpace: "nowrap",
          }}>끌어서 위치 · 휠로 확대</div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", flex: "0 0 auto" }}>확대</span>
        <input type="range" min={1} max={3} step={0.01} value={value.zoom} style={{ flex: 1 }}
          onChange={(e) => onChange({ ...value, zoom: Number(e.target.value) })} />
        <span className="num" style={{ fontSize: 12, width: 38, textAlign: "right" }}>{value.zoom.toFixed(2)}×</span>
        <button className="btn" style={{ padding: "3px 10px", fontSize: 11.5 }}
          onClick={() => onChange({ ...DEFAULT_FIT })}>초기화</button>
      </div>
    </div>
  );
}
