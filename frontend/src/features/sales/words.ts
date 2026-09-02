import type { StopStage } from "../../shared/api/endpoints";

/** 상태 낱말 — **한 벌**(2026-08-20).
 *
 *  칩에 쓰는 낱말은 여기서만 나온다. 예전엔 목록이 칸 이름(계약)을 그대로 썼는데,
 *  「그 칸에 와 있다」와 「그 칸을 끝냈다」가 같은 글자라 계약을 안 한 사람이 「계약」으로
 *  떴다. 이제 **낱말은 지금 칸의 상태**를 말하고, 진행 정도는 색이 말한다.
 *
 *    ○ 빈 원   시작 전      ● 회색  손댔지만 답 없음
 *    ● 노랑    진행 중      ● 초록  끝남          ● 빨강  멈춤(사유가 낱말)
 *
 *  접촉은 고정 낱말이 아니라 **값을 그대로** 보여준다 — 의사가 있으면 의사, 없으면 통화 결과.
 *  계약은 짝(매수자 하나)의 상태이고, 매물은 **그중 가장 앞선 것**을 쓴다(0127 nego_rank).
 */
export type CellState = "none" | "open" | "busy" | "done" | "stop";

/** 합의 단계(낱말 교체 2026-08-23, 서버 nego_rank(0127·0138)와 같은 순서).
 *  거래는 계약으로 끝나지 않는다 — 중도금·잔금이 남고 중개보수도 잔금 날 받는다(0138). */
export const NEGO = ["", "합의 전", "합의중", "계약예정", "계약완료", "중도금", "거래종료"] as const;

/** 짝(매수자 하나)의 합의 낱말. 서버 nego_rank 를 그대로 쓰고, 없을 때만 필드로 짐작한다.
 *  세 화면(현황판·매물 줄·매수자 모달)이 각자 판정하다 계약 뒤 상태가 어긋났다(2026-08-28). */
export function negoWord(p: {
  nego?: number | null; picked_at?: string | null; hope_price?: number | null;
  brief_how?: string[] | null; d6_sign?: boolean; d7_pay?: boolean;
}): string {
  const n = p.nego ?? 0;
  if (n >= 1 && n < NEGO.length) return NEGO[n];
  if (p.d7_pay) return "거래종료";
  if (p.d6_sign) return "계약완료";
  if (p.picked_at) return "계약예정";
  return (p.hope_price != null || (p.brief_how?.length ?? 0) > 0) ? "합의중" : "합의 전";
}

const LISTING: Record<string, Partial<Record<CellState, string>>> = {
  owner: { none: "소유자 미확보", open: "소유자명 확보", done: "연락처 확보" },
  touch: { none: "통화 전" },                       // 나머지는 값 그대로
  info:  { none: "정보 미확보", open: "정보 확보중", busy: "정보 확보중", done: "정보 확보" },
  match: { none: "매수자 없음" },                   // 나머지는 협의 단계가 낱말
  pay:   { none: "잔금일 미정", busy: "잔금일 잡힘", done: "잔금완료" },
  file:  { none: "신고 전", done: "신고완료" },
};

const BUYER: Record<string, Partial<Record<CellState, string>>> = {
  buyer: { none: "신규", open: "연락처만", done: "조건확인" },
  match: { none: "담은 매물 없음" },
  pay:   { none: "잔금일 미정", busy: "잔금일 잡힘", done: "잔금완료" },
  file:  { none: "신고 전", done: "신고완료" },
};

export interface WordRow {
  nego?: number | null;             // 협의 단계 1~4(0127)
  intent?: string | null;           // 매도 의사 — 접촉 칸의 값
  call_result?: string | null;      // 통화 결과 — 의사가 없을 때 쓰는 값
  stop_reason?: string | null;
  stop_stage?: StopStage | null;
}

/** 이 칸·이 상태를 뭐라고 부르나. 못 찾으면 null(칩이 칸 이름으로 물러선다) */
export function cellWord(row: WordRow, cell: string, state: CellState,
                         side: "listing" | "buyer" = "listing"): string | null {
  // 멈춤은 **사유가 낱말**이다 — 「멈춤」이라고만 쓰면 창을 열어야 이유를 안다
  if (state === "stop") return row.stop_reason || "멈춤";
  // 접촉 — 값을 그대로 보여준다(칸이 고정 낱말을 갖지 않는 유일한 자리)
  if (cell === "touch" && state !== "none") {
    return row.intent || row.call_result || "통화됨";
  }
  // 계약 — 협의 단계가 곧 낱말. 짝이 없으면(=협의 0) 칸의 기본 낱말
  if (cell === "match" && state !== "none") {
    const n = row.nego ?? 0;
    if (n >= 1 && n < NEGO.length) return NEGO[n];
  }
  return (side === "listing" ? LISTING : BUYER)[cell]?.[state] ?? null;
}
