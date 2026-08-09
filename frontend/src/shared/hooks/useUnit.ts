import { useEffect, useState } from "react";

/** 면적 단위(평/㎡) — 화면마다 따로 두면 매물 상세에서 평으로 보다가 영업으로 넘어가면 ㎡가 된다.
 *  한 사람의 취향이지 화면의 속성이 아니라서 브라우저에 저장하고 앱 전체가 같은 값을 본다.
 *  (검색 필터 모달은 라벨 체계가 "평/㎡"로 따로 있어 아직 안 묶었다 — S01b 정리 때 같이 본다.) */
export type AreaUnit = "py" | "m2";

const KEY = "bt_area_unit";
const P = 3.305785;
const listeners = new Set<(u: AreaUnit) => void>();

function read(): AreaUnit {
  try {
    return localStorage.getItem(KEY) === "m2" ? "m2" : "py";
  } catch {
    return "py";
  }
}

export function useUnit() {
  const [unit, setLocal] = useState<AreaUnit>(read);
  useEffect(() => {
    const fn = (u: AreaUnit) => setLocal(u);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  const setUnit = (u: AreaUnit) => {
    try { localStorage.setItem(KEY, u); } catch { /* 사파리 프라이빗 등 — 세션 내 동작은 유지 */ }
    listeners.forEach((fn) => fn(u));
  };

  /** ㎡ 값 → 현재 단위 문자열. 값 없으면 "—". */
  const area = (m2?: number | null, digits = 1): string => {
    if (m2 == null || Number.isNaN(Number(m2))) return "—";
    const n = Number(m2);
    return unit === "py" ? `${(n / P).toFixed(digits)}평` : `${n.toFixed(digits)}㎡`;
  };

  return { unit, setUnit, area, label: unit === "py" ? "평" : "㎡" };
}
