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

export interface AttrFilters {
  use_zones?: string[] | null;
  jimoks?: string[] | null;
  road_frontages?: string[] | null;
  shapes?: string[] | null;
  slopes?: string[] | null;
  main_uses?: string[] | null;
  etc_use?: string | null;
  land_area_min?: number | null; land_area_max?: number | null;
  total_area_min?: number | null; total_area_max?: number | null;
  build_area_min?: number | null; build_area_max?: number | null;
  floors_above_min?: number | null; floors_above_max?: number | null;
  floors_below_min?: number | null; floors_below_max?: number | null;
  bcr_min?: number | null; bcr_max?: number | null;
  far_min?: number | null; far_max?: number | null;
  elevator_min?: number | null; elevator_max?: number | null;
  parking_min?: number | null; parking_max?: number | null;
  station_dist_max?: number | null;
  last_sale_min?: number | null; last_sale_max?: number | null;
  gongsi_min?: number | null; gongsi_max?: number | null;
  age_min?: number | null; age_max?: number | null;
}

export const searchApi = {
  suggest: (q: string) => api<Suggestion[]>(`/search/suggest?q=${encodeURIComponent(q)}`),
  regions: () => api<Record<string, { sgg_code: string; dongs: { bjd_code: string; dong: string; count: number }[] }>>("/search/regions"),
  list: (p: { bjd_code?: string; polygon?: object; filters?: AttrFilters; sort?: string; fav_only?: boolean; page_ad?: number; page_mine?: number; page_normal?: number }) =>
    api("/search", {
      method: "POST",
      body: JSON.stringify({
        polygon: p.polygon ?? null,
        filters: { bjd_code: p.bjd_code ?? null, ...(p.filters ?? {}) },
        sort: p.sort ?? "price", fav_only: p.fav_only ?? false,
        page_ad: p.page_ad ?? 1, page_mine: p.page_mine ?? 1, page_normal: p.page_normal ?? 1,
      }),
    }),
  snap: (polygon: object) =>                          // 자석 스냅(후처리): 그린 영역 → 필지 합집합 폴리곤
    api<{ polygon: object | null }>("/search/snap", { method: "POST", body: JSON.stringify({ polygon }) }),
  parcelAt: (lng: number, lat: number) =>              // 클릭 지점 필지 → building_pk
    api<{ building_pk: string | null; pnu: string | null }>(`/search/parcel-at?lng=${lng}&lat=${lat}`),
  parcelFor: (pk: string) =>                           // 건물 필지 합집합(선택 오버레이)
    api<{ polygon: { type: string; coordinates: unknown } | null }>(`/search/parcel/${pk}`),
};

export const creditsApi = {
  balance: () => api<Balance>("/credits"),
  entries: () => api<{ occurred_at: string; type: string; bucket: string; amount: number; reason: string; ref_id: number | null }[]>("/credits/entries"),
};

export const savedApi = {
  list: () => api<{ id: number; name: string; conditions_json: Record<string, unknown>; created_at: string }[]>("/saved-searches"),
  save: (name: string, conditions: Record<string, unknown>) =>
    api<{ id: number }>("/saved-searches", { method: "POST", body: JSON.stringify({ name, conditions }) }),
  remove: (id: number) => api(`/saved-searches/${id}`, { method: "DELETE" }),
};

export const buildingsApi = {
  get: (pk: string) => api<Record<string, unknown>>(`/buildings/${pk}`),
  parcels: (pk: string) => api<Record<string, unknown>>(`/buildings/${pk}/parcels`),
};

export const photosApi = {
  list: (pk: string) => api<{ id: number; url: string }[]>(`/buildings/${pk}/photos`),
  del: (pk: string, id: number) => api(`/buildings/${pk}/photos/${id}`, { method: "DELETE" }),
};

export const overlaysApi = {
  put: (target_id: string, field: string, value: string | null, target_type: "building" | "parcel" = "building") =>
    api("/overlays", { method: "PUT", body: JSON.stringify({ target_type, target_id, field, value }) }),
  revert: (target_id: string, field: string, target_type: "building" | "parcel" = "building") =>
    api("/overlays", { method: "DELETE", body: JSON.stringify({ target_type, target_id, field, value: null }) }),
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
  members: () => api<{ account_id: number; name: string; role: string }[]>("/listings/members"),
};

export const rentsApi = {
  list: (pk: string) => api<{ items: FloorRent[]; total: Record<string, number> }>(`/buildings/${pk}/floor-rents`),
  upsert: (pk: string, r: FloorRent) =>
    api(`/buildings/${pk}/floor-rents`, { method: "PUT", body: JSON.stringify(r) }),
  del: (pk: string, id: number) =>
    api(`/buildings/${pk}/floor-rents/${id}`, { method: "DELETE" }),
  outline: (pk: string) =>
    api<{ floor: string | null; use: string | null; exclusive_area: number | null }[]>(`/buildings/${pk}/floor-outline`),
};

export interface SeriesPt { x: string; y: number; ov: boolean; master: boolean }
export const seriesApi = {
  get: (pk: string) => api<Record<"gongsi" | "real" | "ad", SeriesPt[]>>(`/buildings/${pk}/series`),
  upsert: (pk: string, kind: string, x: string, y: number) =>
    api(`/buildings/${pk}/series`, { method: "PUT", body: JSON.stringify({ kind, x, y }) }),
  del: (pk: string, kind: string, x: string) =>
    api(`/buildings/${pk}/series?kind=${kind}&x=${encodeURIComponent(x)}`, { method: "DELETE" }),
};

export const marketApi = {
  nearby: (b: { center_lat: number; center_lng: number; radius_m: number }) =>
    api<Record<string, unknown>>("/market/nearby", { method: "POST", body: JSON.stringify(b) }),
};

export const reportsApi = {
  create: (building_pk: string, kind: "briefing" | "analysis", options: Record<string, unknown> = {}) =>
    api<{ report_id: number }>("/reports", { method: "POST", body: JSON.stringify({ building_pk, kind, options }) }),
  get: (id: number) => api<Report>(`/reports/${id}`),
  list: () => api<Report[]>("/reports"),
};

export interface EnumOpt { code: string; label: string; tier: string | null }

export const metaApi = {
  enums: () => api<Record<string, EnumOpt[]>>("/enums"),
  fields: () => api<Record<string, { label: string; unit: string | null; data_type: string; enum_key: string | null; editable: boolean; display_group: string }>>("/fields"),
};

export const extrasApi = {
  favToggle: (pk: string) => api<{ favorited: boolean }>(`/favorites/${pk}`, { method: "PUT" }),
  adPrices: (pk: string) => api<{ observed_on: string; price: number | null; is_mine: boolean; confirms: number }[]>(`/buildings/${pk}/ad-prices`),
  adPriceAdd: (pk: string, observed_on: string, price: number | null, is_mine: boolean) =>
    api(`/buildings/${pk}/ad-prices`, { method: "POST", body: JSON.stringify({ observed_on, price, is_mine }) }),
  wikiList: (pk: string) => api<Record<string, unknown>[]>(`/buildings/${pk}/wiki`),
  wikiPost: (pk: string, body: string, category?: string) =>
    api(`/buildings/${pk}/wiki`, { method: "POST", body: JSON.stringify({ body, category }) }),
  wikiVote: (postId: number) => api<{ voted: boolean }>(`/wiki/${postId}/vote`, { method: "PUT" }),
  memoList: (pk: string) => api<Record<string, unknown>[]>(`/buildings/${pk}/memos`),
  memoAdd: (pk: string, kind: "team" | "secret", body: string) =>
    api(`/buildings/${pk}/memos`, { method: "PUT", body: JSON.stringify({ kind, body }) }),
};
