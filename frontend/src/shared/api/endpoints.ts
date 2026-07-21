import { api } from "./client";

export interface TokenOut { access_token: string; tier: string }
export interface Suggestion { building_pk: string; addr: string }
export interface Balance { total: number; monthly: number; earned: number; purchased: number }
export interface FloorRent {
  id?: number; floor: string; unit_no: string; use?: string | null;
  exclusive_area?: number | null; contract_area?: number | null;
  deposit: number; rent: number; maintenance: number; is_vacant: boolean;
}
export interface Report {
  id: number; building_pk: string; kind: "briefing" | "analysis";
  status: "pending" | "generating" | "done" | "failed";
  credits_spent?: number; file_path?: string; created_at: string;
  is_stale?: boolean; addr?: string; failed_reason?: string;
}

export const authApi = {
  signup: (b: { email: string; password: string; name: string; office_name?: string }) =>
    api<TokenOut>("/auth/signup", { method: "POST", body: JSON.stringify(b) }),
  login: (b: { email: string; password: string }) =>
    api<TokenOut>("/auth/login", { method: "POST", body: JSON.stringify(b) }),
  logout: () => api<{ ok: boolean }>("/auth/logout", { method: "POST" }),
};

export const searchApi = {
  suggest: (q: string) => api<Suggestion[]>(`/search/suggest?q=${encodeURIComponent(q)}`),
  regions: () => api<Record<string, { sgg_code: string; dongs: { bjd_code: string; dong: string; count: number }[] }>>("/search/regions"),
  list: (p: { bjd_code?: string; polygon?: object; page_ad?: number; page_mine?: number; page_normal?: number }) =>
    api("/search", {
      method: "POST",
      body: JSON.stringify({
        polygon: p.polygon ?? null,
        filters: { bjd_code: p.bjd_code ?? null },
        page_ad: p.page_ad ?? 1, page_mine: p.page_mine ?? 1, page_normal: p.page_normal ?? 1,
      }),
    }),
};

export const creditsApi = {
  balance: () => api<Balance>("/credits"),
  entries: () => api<Record<string, unknown>[]>("/credits/entries"),
};

export const buildingsApi = {
  get: (pk: string) => api<Record<string, unknown>>(`/buildings/${pk}`),
};

export const overlaysApi = {
  put: (target_id: string, field: string, value: string | null) =>
    api("/overlays", { method: "PUT", body: JSON.stringify({ target_id, field, value }) }),
  revert: (target_id: string, field: string) =>
    api("/overlays", { method: "DELETE", body: JSON.stringify({ target_id, field, value: null }) }),
  revertAll: (target_id: string) =>
    api<{ reverted: number }>(`/overlays/all/${target_id}`, { method: "DELETE" }),
  distribution: (target_id: string) =>
    api<Record<string, { label: string; values: { value: string; count: number }[] }>>(
      `/overlays/distribution/${target_id}`),
};

export const listingsApi = {
  get: (pk: string) => api<Record<string, unknown>>(`/listings/${pk}`),
  claim: (building_pk: string, assignee_account_id: number | null) =>
    api("/listings/claim", { method: "PUT", body: JSON.stringify({ building_pk, assignee_account_id }) }),
  patchBiz: (building_pk: string, fields: Record<string, string | null>) =>
    api("/listings/biz", { method: "PATCH", body: JSON.stringify({ building_pk, fields }) }),
  mine: () => api<Record<string, unknown>[]>("/listings"),
};

export const rentsApi = {
  list: (pk: string) => api<{ items: FloorRent[]; total: Record<string, number> }>(`/buildings/${pk}/floor-rents`),
  upsert: (pk: string, r: FloorRent) =>
    api(`/buildings/${pk}/floor-rents`, { method: "PUT", body: JSON.stringify(r) }),
};

export const marketApi = {
  nearby: (b: { center_lat: number; center_lng: number; radius_m: number }) =>
    api<Record<string, unknown>>("/market/nearby", { method: "POST", body: JSON.stringify(b) }),
};

export const reportsApi = {
  create: (building_pk: string, kind: "briefing" | "analysis") =>
    api<{ report_id: number }>("/reports", { method: "POST", body: JSON.stringify({ building_pk, kind, options: {} }) }),
  get: (id: number) => api<Report>(`/reports/${id}`),
  list: () => api<Report[]>("/reports"),
};

export const extrasApi = {
  favToggle: (pk: string) => api<{ favorited: boolean }>(`/favorites/${pk}`, { method: "PUT" }),
  adPrices: (pk: string) => api<{ observed_on: string; price: number | null; is_mine: boolean; confirms: number }[]>(`/buildings/${pk}/ad-prices`),
  adPriceAdd: (pk: string, observed_on: string, price: number | null, is_mine: boolean) =>
    api(`/buildings/${pk}/ad-prices`, { method: "POST", body: JSON.stringify({ observed_on, price, is_mine }) }),
  wikiList: (pk: string) => api<Record<string, unknown>[]>(`/buildings/${pk}/wiki`),
  wikiPost: (pk: string, body: string, category?: string) =>
    api(`/buildings/${pk}/wiki`, { method: "POST", body: JSON.stringify({ body, category }) }),
  memoList: (pk: string) => api<Record<string, unknown>[]>(`/buildings/${pk}/memos`),
  memoAdd: (pk: string, kind: "team" | "secret", body: string) =>
    api(`/buildings/${pk}/memos`, { method: "PUT", body: JSON.stringify({ kind, body }) }),
};
