/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NAVER_MAP_KEY_ID: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// 네이버 지도 SDK 전역
declare global {
  interface Window {
    naver: any;
  }
}
export {};
