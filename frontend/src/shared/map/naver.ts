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
/* 핀 색(S06, 대표 2026-09-30) — 무엇의 핀인가로 가른다.
   매물(광고 · 내 매물) 빨강 · 구해요 초록 · 실거래 파랑 · 추정가 흰 바탕 검정 글자. 거래완료 광고 회색.
   (09-28 판: 내 매물 파랑 · 광고 검정 · 일반 회색) */
export const PIN_COLORS: Record<string, string> = {
  mine: "#F04452",   // 빨강 — 매물(내 매물)
  ad: "#F04452",     // 빨강 — 매물(광고)
  sold: "#B0B8C1",   // 회색 — 거래완료 광고
  seek: "#03B26C",   // 초록 — 구해요
  deal: "#3182F6",   // 파랑 — 실거래
  est: "#FFFFFF",    // 흰 바탕 · 검정 글자 — 추정가
  msale: "#7B5CF0",  // 보라 — 매매시세(10-04)
  market: "#7B5CF0", // 보라 — 수집 매물(0226, 주인 crawl). msale 과 같은 색
  mrent: "#F08C00",  // 주황 — 임대시세(10-04)
  normal: "#8B95A1", // 회색 — 그 밖
  self: "#191F28",
};

export function priceLabel(price: number | null): string {
  if (price == null) return "—";
  // 100억 아래는 소수 한 자리(9.5억 · 13.5억) — 정수로 반올림하면 9.5억 매물이 「10억」으로 선다(2026-09-28)
  if (price >= 1e10) return `${Math.round(price / 1e8)}억`;
  if (price >= 1e8) return `${String(Math.round(price / 1e7) / 10).replace(/\.0$/, "")}억`;
  return `${Math.round(price / 1e4).toLocaleString()}만`;
}
