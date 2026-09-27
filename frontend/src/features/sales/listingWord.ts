import type { Seller } from "../../shared/api/endpoints";
import { cellWord, NEGO } from "./words";
import { LADDER, DEAL_LADDER, railBlock, cellsOf } from "./StageRail";

/** 매물 상태 낱말 — 보류 > 합의 축 > 준비 축 현재 칸. 표 줄과 모달 머리가 같은 말을 한다 */
export function stateWord(r: Seller): string {
  const n = (r as unknown as { nego?: number }).nego ?? 0;
  if (r.stop_id) return "보류";
  if (n >= 1 && n < NEGO.length) return NEGO[n];
  const now = railBlock(r, [...LADDER, ...DEAL_LADDER]);
  return cellWord(r as never, now?.key ?? "file", (cellsOf(r)[now?.key ?? "file"] ?? "none"), "listing")
    ?? now?.label ?? "완료";
}

/** 급매 = 급함 칸이 「급함」 이상 */
export const isUrgent = (r: Pick<Seller, "urgency">) => r.urgency === "매우급함" || r.urgency === "급함";
