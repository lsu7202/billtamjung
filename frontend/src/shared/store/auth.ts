import { create } from "zustand";

interface AuthState {
  access: string | null;
  setAuth: (access: string) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  access: null,
  setAuth: (access) => set({ access }),
  clear: () => set({ access: null }),
}));

/** 계정 종류(S05, 2026-09-28) — 토큰에 실린 kind. 중개사만 매물관리 · 팀 칸 · 크롤링 자료를 쓴다.
 *  화면은 하나고, 이 값은 「그 기능을 그릴지」만 가른다. 막는 곳은 API 다. 0191 이전 토큰엔 kind 가 없다 = 중개사 */
export function kindOf(access: string | null): "중개사" | "고객" {
  if (!access) return "중개사";
  try {
    const b = access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b.padEnd(b.length + (4 - (b.length % 4)) % 4, "="))));
    return JSON.parse(json).kind === "고객" ? "고객" : "중개사";
  } catch { return "중개사"; }
}
/** 손님(10-01) — 로그인 없이 매물 찾기 · 구해요 · 상세보기 · 소식을 본다. 손님은 중개사가 아니다 */
export const useIsGuest = () => useAuth((s) => !s.access);
export const useIsBroker = () => useAuth((s) => !!s.access && kindOf(s.access) === "중개사");
/** 첫 화면(2026-09-30) — 빌탐정(AI 어시스턴트)이 첫 화면이다. 어시스턴트는 아직 중개사만이라 고객은 탐색 */
export const homeOf = (access: string | null) => (access && kindOf(access) === "중개사" ? "/assistant" : "/search");
