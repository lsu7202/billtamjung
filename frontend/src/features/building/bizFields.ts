/** 업무 필드 정의 — 업무탭(Sidebar)과 영업 매도 프로필이 **같은 목록·같은 라벨**을 렌더한다.
 *  두 화면은 같은 행(app.listings)을 읽고 쓰므로 말도 하나여야 한다(2026-08-10 감사).
 *  진행상태(jindo)는 여기 없다 — 상단에 따로 서는 segmented(업무탭)·칩(영업)이라서. */
export type BizRow = { label: string; k: string; kind: "enum" | "text"; extra: string };

export const BIZ_ROWS: BizRow[] = [
  { label: "긴급도", k: "urgency", kind: "enum", extra: "urgency" },
  { label: "소유자 타입", k: "owner_type", kind: "enum", extra: "owner_type" },
  { label: "소유자 명", k: "owner_name", kind: "text", extra: "성명/법인명" },
  { label: "관계", k: "relation", kind: "enum", extra: "relation" },
  { label: "협조도", k: "cooperation", kind: "enum", extra: "cooperation" },
  { label: "친절도", k: "kindness", kind: "enum", extra: "kindness" },
  { label: "매수의향서", k: "intent", kind: "enum", extra: "intent" },
  { label: "전화번호", k: "owner_phone", kind: "text", extra: "010-0000-0000" },
];
