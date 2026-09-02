import { create } from "zustand";

/** 화면 → 대화창으로 흐르는 맥락(2026-08-14).
 *
 *  대화창이 되묻던 조건(누구·어느 매물)은 화면이 이미 알고 있다 — 매도 탭에서 윤미경의
 *  49-9 를 보고 있으면 그게 대상이다. 각 판이 자기 선택을 여기 적어 두면 대화창이 읽는다.
 *  바에는 **점선 칩**으로 항상 보인다(유저가 인지 못 한 채 남의 장부에 적히면 안 된다).
 *  문장에 다른 이름을 쓰면 그 이름이 이긴다 — 명시가 추적을 이긴다.
 */
export interface TradeCtx {
  kind: "owner" | "buyer";
  id: number;
  label: string;
  building_pk?: string | null;
  addr?: string | null;
  proposal_id?: number | null;
}

interface S {
  ctx: TradeCtx | null;
  /** 캘린더가 보고 있는 날 — 날짜 없는 약속의 기본값 */
  day: string | null;
  /** 명령으로 캘린더를 열 때 짚을 날(한 번 쓰고 비운다) */
  navDate: string | null;
  setCtx: (c: TradeCtx | null) => void;
  setDay: (d: string | null) => void;
  setNavDate: (d: string | null) => void;
}

export const useTradeCtx = create<S>((set) => ({
  ctx: null, day: null, navDate: null,
  setCtx: (ctx) => set({ ctx }),
  setDay: (day) => set({ day }),
  setNavDate: (navDate) => set({ navDate }),
}));
