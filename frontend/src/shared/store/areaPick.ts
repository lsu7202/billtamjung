import { create } from "zustand";
import { MAJOR_TYPES } from "../map/eventIcon";
import type { IconName } from "../ui/Icon";

/** 주변 소식에서 고른 줄과 지도의 「전부/주요」 — 목록(입지 탭)과 사이드바 지도가 다른 컴포넌트라
 *  같이 보는 자리가 필요하다. 목록에서 고르면 지도 아이콘이 반짝이고, 아이콘을 누르면 목록이 간다. */
interface AreaPick {
  pick: number | null;
  types: IconName[];                // 켜진 종류(지도 핀). 기본 주요 일곱
  years: number;                    // 1·3·5 · 0=전체. 목록 칩과 지도 핀이 같이 본다(기본 1년)
  setPick: (id: number | null) => void;
  setTypes: (v: IconName[]) => void;
  setYears: (y: number) => void;
}
export const useAreaPick = create<AreaPick>((set) => ({
  pick: null, types: MAJOR_TYPES, years: 1,
  setPick: (pick) => set({ pick }),
  setTypes: (types) => set({ types }),
  setYears: (years) => set({ years }),
}));
