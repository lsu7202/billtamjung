import type { Seller } from "../../shared/api/endpoints";

/** 급매 = 급함 칸이 「급함」 이상 */
export const isUrgent = (r: Pick<Seller, "urgency">) => r.urgency === "매우급함" || r.urgency === "급함";
