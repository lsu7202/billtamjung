import { useState } from "react";

/** ⓘ 정보 아이콘 — 호버/클릭 시 안내 툴팁. 추정값·산식 등 필드명 대신 아이콘으로 알림(정석 방식). */
export function InfoDot({ text, width = 210 }: { text: string; width?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", verticalAlign: "middle", marginLeft: 4 }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span role="img" aria-label="정보"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{
          width: 13, height: 13, borderRadius: "50%", border: "1px solid var(--muted)",
          color: "var(--muted)", fontSize: 9, lineHeight: "12px", textAlign: "center",
          cursor: "help", fontWeight: 700, fontStyle: "normal", fontFamily: "Georgia, serif", userSelect: "none",
        }}>i</span>
      {open && (
        <span style={{
          position: "absolute", bottom: "calc(100% + 7px)", left: "50%", transform: "translateX(-50%)",
          width, background: "var(--ink)", color: "#fff", fontSize: 11, lineHeight: 1.45,
          padding: "8px 10px", borderRadius: 7, zIndex: 60, boxShadow: "0 6px 18px rgba(0,0,0,.28)",
          fontWeight: 400, textAlign: "left", whiteSpace: "normal", pointerEvents: "none",
        }}>{text}</span>
      )}
    </span>
  );
}

/** 추정값 공통 안내문(법적 효력 없음). 필드별로 앞에 한 줄 덧붙여 사용. */
export const ESTIMATE_NOTE =
  "빌탐정 추정값입니다. 실거래가·감정평가가 아니며, 법적 효력이 없는 참고용 정보입니다.";
