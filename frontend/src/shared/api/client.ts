// fetch 래퍼: Bearer 부착 + 401 시 refresh 1회 재시도(01-상세설계 §6)
import { useAuth } from "../store/auth";

const BASE = "/api";

// 토큰이 만료되면 화면의 여러 쿼리가 동시에 401을 받는다(로그: 401 10여 건이 한 번에).
// 각자 refresh를 부르면 같은 요청이 그 수만큼 나가므로, 진행 중인 것 하나를 공유한다.
let inflight: Promise<string | null> | null = null;

export async function refresh(): Promise<string | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" });
      if (!r.ok) return null;
      const j = await r.json();
      useAuth.getState().setAuth(j.access_token, j.tier);
      return j.access_token as string;
    } finally {
      // 다음 만료 때 다시 시도할 수 있게 비운다(마이크로태스크 뒤 — 동시 호출자는 위에서 공유)
      setTimeout(() => { inflight = null; }, 0);
    }
  })();
  return inflight;
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const access = useAuth.getState().access;
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (access) headers.set("Authorization", `Bearer ${access}`);

  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: "include" });

  if (res.status === 401 && retry) {
    const t = await refresh();
    if (t) return api<T>(path, init, false);
    useAuth.getState().clear();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? res.statusText);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** 인증 헤더 실은 파일 다운로드(Bearer는 <a href>로 못 실어서 blob으로). */
export async function apiBlob(path: string, retry = true): Promise<Blob> {
  const access = useAuth.getState().access;
  const headers = new Headers();
  if (access) headers.set("Authorization", `Bearer ${access}`);
  const res = await fetch(`${BASE}${path}`, { headers, credentials: "include" });
  if (res.status === 401 && retry) {
    const t = await refresh();
    if (t) return apiBlob(path, false);
    useAuth.getState().clear();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? res.statusText);
  }
  return res.blob();
}
