import { api } from "./client";

export interface TokenOut { access_token: string; tier: string }
export interface Suggestion { building_pk: string; addr: string }
export interface Balance { total: number; monthly: number; earned: number; purchased: number }

export const authApi = {
  signup: (b: { email: string; password: string; name: string; office_name?: string }) =>
    api<TokenOut>("/auth/signup", { method: "POST", body: JSON.stringify(b) }),
  login: (b: { email: string; password: string }) =>
    api<TokenOut>("/auth/login", { method: "POST", body: JSON.stringify(b) }),
  logout: () => api<{ ok: boolean }>("/auth/logout", { method: "POST" }),
};

export const searchApi = {
  suggest: (q: string) => api<Suggestion[]>(`/search/suggest?q=${encodeURIComponent(q)}`),
  byPolygon: (polygon: object | null) =>
    api<Suggestion[]>("/search", { method: "POST", body: JSON.stringify({ polygon }) }),
};

export const creditsApi = {
  balance: () => api<Balance>("/credits"),
};

export const buildingsApi = {
  get: (pk: string) => api<Record<string, unknown>>(`/buildings/${pk}`),
};
