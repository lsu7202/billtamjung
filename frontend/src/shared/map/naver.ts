/** 네이버 지도 SDK 로더(신 Maps: oapi + ncpKeyId). specs 네이버지도-연동 §1. */
let loading: Promise<any> | null = null;

export function loadNaver(): Promise<any> {
  if (window.naver?.maps) return Promise.resolve(window.naver);
  if (loading) return loading;
  const key = import.meta.env.VITE_NAVER_MAP_KEY_ID;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${key}&submodules=panorama`;
    s.onload = () => resolve(window.naver);
    s.onerror = () => reject(new Error("네이버 지도 SDK 로드 실패 — 콘솔 도메인 등록(localhost:5173) 확인"));
    document.head.appendChild(s);
  });
  return loading;
}

/** 분류색(전 화면 통일 — 네이버지도-연동 §2) */
export const PIN_COLORS: Record<string, string> = {
  ad: "#0E9F6E",
  mine: "#1E5AF0",
  normal: "#6E56E8",
  self: "#0F1A2E",
};

export function priceLabel(price: number | null): string {
  if (price == null) return "—";
  return price >= 1e8 ? `${Math.round(price / 1e8)}억` : `${Math.round(price / 1e4)}만`;
}
