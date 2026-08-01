import { api, apiBlob } from "./client";

export interface TokenOut { access_token: string; tier: string }
export interface Suggestion { building_pk: string; addr: string; lng?: number | null; lat?: number | null }
export interface Balance { total: number; monthly: number; earned: number; purchased: number }
export interface FloorRent {
  id?: number; floor: string; unit_no: string; use?: string | null;
  exclusive_area?: number | null; contract_area?: number | null;
  deposit: number; rent: number; maintenance: number; is_vacant: boolean | null;   // null=미지정·false=임대중·true=공실
}
export interface Report {
  id: number; building_pk: string; kind: "analysis";
  status: "pending" | "generating" | "done" | "failed";
  credits_spent?: number; file_path?: string; created_at: string;
  is_stale?: boolean; addr?: string; failed_reason?: string;
  result_json?: { subject: CompsResponse["subject"]; preview: ReportPreview } | null;
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
  land_uses?: string[] | null;
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
  last_sale_years_min?: number | null; last_sale_years_max?: number | null;
  gongsi_min?: number | null; gongsi_max?: number | null;
  age_min?: number | null; age_max?: number | null;
  parcel_area_min?: number | null; parcel_area_max?: number | null;
  far_area_min?: number | null; far_area_max?: number | null;
  remodel_years_min?: number | null; remodel_years_max?: number | null;
  legal_bcr_min?: number | null; legal_bcr_max?: number | null;
  legal_far_min?: number | null; legal_far_max?: number | null;
  bcr_slack_min?: number | null; bcr_slack_max?: number | null;
  far_slack_min?: number | null; far_slack_max?: number | null;
  price_min?: number | null; price_max?: number | null;
  roi_min?: number | null; roi_max?: number | null;
  roi_exvac_min?: number | null; roi_exvac_max?: number | null;
  pp_land_min?: number | null; pp_land_max?: number | null;
  pp_total_min?: number | null; pp_total_max?: number | null;
  deposit_total_min?: number | null; deposit_total_max?: number | null;
  rent_total_min?: number | null; rent_total_max?: number | null;
  mgmt_total_min?: number | null; mgmt_total_max?: number | null;
  vacant?: string | null;
  gongsi_total_min?: number | null; gongsi_total_max?: number | null;
  gongsi_ratio_min?: number | null; gongsi_ratio_max?: number | null;
  gongsi_up5_min?: number | null; gongsi_up5_max?: number | null;
  gongsi_up10_min?: number | null; gongsi_up10_max?: number | null;
  sale_pnl_min?: number | null; sale_pnl_max?: number | null;
  sale_count_min?: number | null; sale_count_max?: number | null;
  float_pops?: string[] | null;
  statuses?: string[] | null; urgencies?: string[] | null; grades?: string[] | null; ipjis?: string[] | null;
  owner_types?: string[] | null; relations?: string[] | null; cooperations?: string[] | null; kindnesses?: string[] | null;
  building_uses?: string[] | null; meongdos?: string[] | null; use_changes?: string[] | null; myeolsils?: string[] | null; nohudos?: string[] | null;
  assignees?: number[] | null;
  owner_name?: string | null; listing_no?: string | null; intent?: string | null;
  has_phone?: string | null; has_photo?: string | null;
  received_from?: string | null; received_to?: string | null;
}

export interface MapPinDTO {
  building_pk: string; addr: string; lng: number; lat: number;
  col: "ad" | "mine" | "normal"; price: number | null;
  roi: number | null; last_sale_price: number | null; is_fav: boolean;
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
  pins: (p: { bjd_code?: string; polygon?: object; filters?: AttrFilters; sort?: string; fav_only?: boolean }) =>
    api<MapPinDTO[]>("/search/pins", {                // 지도 핀: 페이징 없이 전체 매물(경량)
      method: "POST",
      body: JSON.stringify({
        polygon: p.polygon ?? null,
        filters: { bjd_code: p.bjd_code ?? null, ...(p.filters ?? {}) },
        sort: p.sort ?? "price", fav_only: p.fav_only ?? false,
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
    api<{ floor: string | null; use: string | null; exclusive_area: number | null; rent_est: number | null; deposit_est: number | null }[]>(`/buildings/${pk}/floor-outline`),
};

export interface SeriesPt { x: string; y: number; ov: boolean; master: boolean }
export const seriesApi = {
  get: (pk: string) => api<Record<"gongsi" | "real", SeriesPt[]>>(`/buildings/${pk}/series`),
  upsert: (pk: string, kind: string, x: string, y: number) =>
    api(`/buildings/${pk}/series`, { method: "PUT", body: JSON.stringify({ kind, x, y }) }),
  del: (pk: string, kind: string, x: string) =>
    api(`/buildings/${pk}/series?kind=${kind}&x=${encodeURIComponent(x)}`, { method: "DELETE" }),
};

export const marketApi = {
  nearby: (b: { center_lat: number; center_lng: number; radius_m: number; building_pk?: string; polygon?: object | null; floors?: string[] }) =>
    api<Record<string, unknown>>("/market/nearby", { method: "POST", body: JSON.stringify(b) }),
};

export interface CompFields {
  road_frontage?: string | null; station_dist?: number | string | null; use_zone?: string | null;
  shape?: string | null; slope?: string | null; elevator?: string | null;
  approval_ym?: string | null; remodel_ym?: string | null; float_pop?: string | null;
}
export interface ReportComp {
  building_pk: string; addr: string; contract_ym: string; price: number; total_area: number;
  score: number; per_area: number; dist_m: number; lng: number; lat: number;
  is_outlier: boolean; fields: CompFields;
}
export interface FairBreakdown {
  gong: number | null; land: number | null; far: number | null;
  wg: number; base: number; alpha: number; comp_fair: number;
  beta?: number; income_val?: number | null; final?: number;
}
export interface CompUsed {
  building_pk: string; addr?: string | null; contract_ym?: string | null; price: number;
  area_py?: number | null; score?: number; per_now?: number; time_adj?: number; weight?: number;
}
export interface RentFloor { floor: string; cur: number; mkt: number; diff: number; count: number }
export interface ReportPreview {
  score: number; grade: string; fair_price: number | null; avg_per_pyeong: number | null;
  expected_roi: number | null; gap: number | null; ask_price: number | null; broker_price?: number | null;
  applied_rent?: number | null; expected_deposit?: number | null; market_applied?: boolean;
  breakdown?: FairBreakdown | null; rent_floors?: RentFloor[] | null; comps_used?: CompUsed[] | null;
  gongsi_ctx?: { nbhd_per_m2: number | null; mult: number | null; n: number } | null;
  rent_summary?: { floor_count: number; cur_rent: number; mkt_rent: number; cur_deposit: number; mkt_deposit: number; nearby_roi: number | null } | null;
  use_type?: { primary: string; scores: Record<string, number>; office_fit: number; util: number | null; reason: string; market: Record<string, number>; zones?: { geojson: unknown; cat: string; count: number }[];
    future?: { score: number | null; label: string | null; dev: number | null; upside: number | null; land: number | null; reason: string;
      far: number | null; legal_far: number | null; util: number | null; headroom_far: number | null;
      cur_rent: number | null; mkt_rent: number | null; upside_pct: number | null; land_rate5: number | null; land_annual: number | null } } | null;
}
export interface CompsResponse {
  subject: { addr: string; score: number; grade: string; items?: Record<string, number>;
    total_area: number | null; sale_price: number | null; total_rent: number | null;
    center: { lng: number; lat: number } | null; radius_m: number; polygon: boolean };
  preview: ReportPreview;
  comps: ReportComp[];
  rent_pins: { lng: number; lat: number }[];
  counts: { sale: number; rent: number };
}

export const reportsApi = {
  create: (building_pk: string, kind: "analysis" = "analysis", options: Record<string, unknown> = {}) =>
    api<{ report_id: number }>("/reports", { method: "POST", body: JSON.stringify({ building_pk, kind, options }) }),
  get: (id: number) => api<Report>(`/reports/${id}`),
  list: () => api<Report[]>("/reports"),
  download: async (id: number) => {
    const blob = await apiBlob(`/reports/${id}/download`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `빌탐정_분석보고서_${id}.pptx`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
  comps: (building_pk: string) => api<CompsResponse>(`/reports/comps/${building_pk}`),
  preview: (body: { building_pk: string; exclude: string[]; overrides: Record<string, CompFields>; include_market: boolean }) =>
    api<{ preview: ReportPreview; comp_scores: Record<string, number> }>("/reports/preview", { method: "POST", body: JSON.stringify(body) }),
};

export interface EnumOpt { code: string; label: string; tier: string | null }

export const metaApi = {
  enums: () => api<Record<string, EnumOpt[]>>("/enums"),
  fields: () => api<Record<string, { label: string; unit: string | null; data_type: string; enum_key: string | null; editable: boolean; display_group: string }>>("/fields"),
};

export const extrasApi = {
  favToggle: (pk: string) => api<{ favorited: boolean }>(`/favorites/${pk}`, { method: "PUT" }),
  wikiList: (pk: string) => api<Record<string, unknown>[]>(`/buildings/${pk}/wiki`),
  wikiPost: (pk: string, body: string, category?: string) =>
    api(`/buildings/${pk}/wiki`, { method: "POST", body: JSON.stringify({ body, category }) }),
  wikiVote: (postId: number) => api<{ voted: boolean }>(`/wiki/${postId}/vote`, { method: "PUT" }),
  wikiDel: (postId: number) => api(`/wiki/${postId}`, { method: "DELETE" }),
  memoList: (pk: string) => api<Record<string, unknown>[]>(`/buildings/${pk}/memos`),
  memoAdd: (pk: string, kind: "team" | "secret", body: string) =>
    api(`/buildings/${pk}/memos`, { method: "PUT", body: JSON.stringify({ kind, body }) }),
  memoDel: (pk: string, id: number) => api(`/buildings/${pk}/memos/${id}`, { method: "DELETE" }),
};
