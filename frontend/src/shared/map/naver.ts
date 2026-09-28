/** 네이버 지도 SDK 로더(신 Maps: oapi + ncpKeyId). specs 네이버지도-연동 §1. */
let loading: Promise<any> | null = null;

export function loadNaver(): Promise<any> {
  if (window.naver?.maps) return Promise.resolve(window.naver);
  if (loading) return loading;
  const key = import.meta.env.VITE_NAVER_MAP_KEY_ID;
  loading = new Promise((resolve, reject) => {
    // 인증 실패는 스크립트 onload 뒤에 비동기로 온다. SDK가 부르는 전역 훅으로 받아
    // 여기서 끊지 않으면 window.naver.maps가 null인 채로 진행돼 지도 이후 코드가 전부 터진다.
    const fail = (msg: string) => { loading = null; reject(new Error(msg)); };
    (window as any).navermap_authFailure = () =>
      fail("네이버 지도 인증 실패 — 키·도메인 등록을 확인해 주세요");
    const s = document.createElement("script");
    s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${key}&submodules=panorama,geocoder`;
    s.onload = () => {
      // onload는 인증 결과와 무관하게 뜬다 — 실제 사용 가능한지 확인하고 넘긴다.
      if (window.naver?.maps?.Map) resolve(window.naver);
      else setTimeout(() => (window.naver?.maps?.Map
        ? resolve(window.naver)
        : fail("네이버 지도를 불러오지 못했습니다")), 1200);
    };
    s.onerror = () => fail("네이버 지도 SDK 로드 실패 — 네트워크·차단 프로그램을 확인해 주세요");
    document.head.appendChild(s);
  });
  return loading;
}

/** 주소·대표 지명(강남역 등) → 좌표. 지오코더 서브모듈. 실패/미해석 시 null. */
export async function geocode(query: string): Promise<{ lng: number; lat: number } | null> {
  const naver = await loadNaver();
  return new Promise((resolve) => {
    if (!naver.maps.Service?.geocode) return resolve(null);
    naver.maps.Service.geocode({ query }, (status: any, res: any) => {
      const a = status === naver.maps.Service.Status.OK ? res?.v2?.addresses?.[0] : null;
      resolve(a ? { lng: Number(a.x), lat: Number(a.y) } : null);
    });
  });
}

/** 분류색(전 화면 통일 — 네이버지도-연동 §2) */
/* 핀 색(S05, 2026-09-28 · 토스 결) — 뜻 하나씩. 내 매물 파랑 · 광고 검정 · 거래완료 · 일반(추정) 회색.
   보라(일반)는 색 체계 확정(08-24) 때 폐지됐는데 핀에 남아 있었다 */
export const PIN_COLORS: Record<string, string> = {
  mine: "#3182F6",   // 파랑 — 내 매물
  ad: "#191F28",     // 검정 — 광고
  sold: "#B0B8C1",   // 회색 — 거래완료 광고
  normal: "#8B95A1", // 회색 — 추정 · 실거래
  self: "#191F28",
};

export function priceLabel(price: number | null): string {
  if (price == null) return "—";
  return price >= 1e8 ? `${Math.round(price / 1e8)}억` : `${Math.round(price / 1e4)}만`;
}
