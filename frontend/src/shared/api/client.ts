// fetch 래퍼: Bearer 부착 + 401 시 refresh 1회 재시도(01-상세설계 §6)
import { useAuth } from "../store/auth";

const BASE = "/api";

export async function refresh(): Promise<string | null> {
  const r = await fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" });
  if (!r.ok) return null;
  const j = await r.json();
  useAuth.getState().setAuth(j.access_token, j.tier);
  return j.access_token as string;
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
