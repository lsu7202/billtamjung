import { api } from "./client";

export interface TokenOut { access_token: string; tier: string }
export interface Suggestion { kind: "building" | "region" | "station"; building_pk?: string | null; addr: string; lng?: number | null; lat?: number | null; is_mine?: boolean; price?: number | null; sub?: string | null }
export interface Balance { total: number; monthly: number; earned: number; purchased: number }
export interface FloorRent {
  id?: number; floor: string; unit_no: string; use?: string | null;
  contract_area?: number | null;   // 면적은 이것 하나(0035) — 전용면적은 우리 데이터에 없다
  deposit: number; rent: number; maintenance: number; is_vacant: boolean | null;   // null=미지정·false=임대중·true=공실
}
export interface Report {
  id: number; building_pk: string; kind: "analysis" | "briefing";
  status: "pending" | "generating" | "done" | "failed";
  credits_spent?: number; created_at: string;
  is_stale?: boolean; addr?: string; failed_reason?: string;
  // 종류별로 모양이 다르다. analysis=우리 판단(subject·preview) · briefing=사실 나열(subject·office·floors·photos)
  result_json?: ({ subject: CompsResponse["subject"]; preview: ReportPreview } & Record<string, unknown>) | null;
}

export const authApi = {
  publicConfig: () => api<{ signups_open: boolean }>("/auth/public-config"),
  signup: (b: { email: string; password: string; name: string; office_name?: string; phone?: string; job_role?: string; referral_source?: string; interest_region?: string; gender?: string; terms_agreed: boolean; privacy_agreed: boolean; marketing_agreed?: boolean }) =>
    api<TokenOut>("/auth/signup", { method: "POST", body: JSON.stringify(b) }),
  login: (b: { email: string; password: string; remember?: boolean }) =>
    api<TokenOut>("/auth/login", { method: "POST", body: JSON.stringify(b) }),
  logout: () => api<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  changePassword: (current: string, next: string) =>
    api<{ ok: boolean }>("/auth/password", { method: "PATCH", body: JSON.stringify({ current, new: next }) }),
  resetRequest: (email: string) =>
    api<{ ok: boolean }>("/auth/password/reset-request", { method: "POST", body: JSON.stringify({ email }) }),
  resetConfirm: (token: string, next: string) =>
    api<{ ok: boolean }>("/auth/password/reset-confirm", { method: "POST", body: JSON.stringify({ token, new: next }) }),
  me: () => api<{ account_id: number; team_id: number; name: string; email: string; job_role: string | null; gender: string | null; tier: string }>("/auth/me"),
  patchProfile: (b: Record<string, string>) =>
    api<{ ok: boolean }>("/auth/profile", { method: "PATCH", body: JSON.stringify(b) }),
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
  roi: number | null; last_sale_price: number | null;
}

export const searchApi = {
  suggest: (q: string) => api<Suggestion[]>(`/search/suggest?q=${encodeURIComponent(q)}`),
  regions: () => api<Record<string, { sgg_code: string; dongs: { bjd_code: string; dong: string; count: number }[] }>>("/search/regions"),
  list: (p: { bjd_code?: string; polygon?: object; filters?: AttrFilters; sort?: string; page_mine?: number; page_normal?: number; mine_only?: boolean }) =>
    api("/search", {
      method: "POST",
      body: JSON.stringify({
        polygon: p.polygon ?? null,
        mine_only: p.mine_only ?? false,
        filters: { bjd_code: p.bjd_code ?? null, ...(p.filters ?? {}) },
        sort: p.sort ?? "price",
        page_mine: p.page_mine ?? 1, page_normal: p.page_normal ?? 1,
      }),
    }),
  pins: (p: { bjd_code?: string; polygon?: object; filters?: AttrFilters; sort?: string; mine_only?: boolean }) =>
    api<MapPinDTO[]>("/search/pins", {                // 지도 핀: 페이징 없이 전체 매물(경량)
      method: "POST",
      body: JSON.stringify({
        polygon: p.polygon ?? null,
        mine_only: p.mine_only ?? false,
        filters: { bjd_code: p.bjd_code ?? null, ...(p.filters ?? {}) },
        sort: p.sort ?? "price",
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

export interface Office {
  name: string; office_name: string | null; agent_name: string | null; agent_title: string | null;
  phone: string | null; fax: string | null; email: string | null; office_addr: string | null; has_logo: boolean;
}
/** 브리핑 표지·마무리에 들어가는 사무소 정보(0032) — 팀 단위. */
export const officeApi = {
  get: () => api<Office>("/team/office"),
  save: (b: Partial<Office>) => api("/team/office", { method: "PATCH", body: JSON.stringify(b) }),
  uploadLogo: (f: File) => {
    const fd = new FormData(); fd.append("file", f);
    return api("/team/office/logo", { method: "POST", body: fd });
  },
  delLogo: () => api("/team/office/logo", { method: "DELETE" }),
};

export const savedApi = {
  list: () => api<{ id: number; name: string; conditions_json: Record<string, unknown>; created_at: string }[]>("/saved-searches"),
  save: (name: string, conditions: Record<string, unknown>) =>
    api<{ id: number }>("/saved-searches", { method: "POST", body: JSON.stringify({ name, conditions }) }),
  /** 부분 수정 — 이름만 바꾸거나 조건만 덮어쓴다(둘 다 보내도 된다). */
  update: (id: number, patch: { name?: string; conditions?: Record<string, unknown> }) =>
    api(`/saved-searches/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: number) => api(`/saved-searches/${id}`, { method: "DELETE" }),
};

export const buildingsApi = {
  get: (pk: string) => api<Record<string, unknown>>(`/buildings/${pk}`),
  parcels: (pk: string) => api<Record<string, unknown>>(`/buildings/${pk}/parcels`),
};

export type PhotoKind = "exterior" | "interior" | "land_use" | "building_ledger" | "cadastral" | "etc";
export interface Photo {
  id: number; url: string; kind: PhotoKind; caption: string | null; sort_order: number;
  transform: { zoom: number; x: number; y: number } | null;   // 슬롯 배치 — 원본은 그대로
}
export const photosApi = {
  list: (pk: string) => api<Photo[]>(`/buildings/${pk}/photos`),
  upload: (pk: string, f: File, kind: PhotoKind, caption?: string) => {
    const fd = new FormData(); fd.append("file", f); fd.append("kind", kind);
    if (caption) fd.append("caption", caption);
    return api<{ id: number }>(`/buildings/${pk}/photos`, { method: "POST", body: fd });
  },
  patch: (pk: string, id: number, b: Partial<Pick<Photo, "kind" | "caption" | "sort_order" | "transform">>) =>
    api(`/buildings/${pk}/photos/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  del: (pk: string, id: number) => api(`/buildings/${pk}/photos/${id}`, { method: "DELETE" }),
};
export const PHOTO_KINDS: { k: PhotoKind; label: string; doc?: boolean }[] = [
  { k: "exterior", label: "건물 외관" },
  { k: "interior", label: "내부" },
  // 위치도·지적도는 지도 API로 자동 생성한다 — 업로드가 필요한 건 발급 서류뿐.
  { k: "building_ledger", label: "건축물대장", doc: true },
  { k: "land_use", label: "토지이용계획", doc: true },
  { k: "etc", label: "기타" },
];

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

export interface TeamMember { account_id: number; name: string; email: string; role: "owner" | "member"; is_me: boolean }
export interface TeamInvite { id: number; channel: string; target: string; token: string; expires_at: string; created_at: string }
export interface TeamInfo { id: number; name: string; my_role: "owner" | "member"; member_count: number; members: TeamMember[]; invites: TeamInvite[] }

export const teamApi = {
  get: () => api<TeamInfo>("/team"),
  rename: (name: string) => api<{ ok: boolean; name: string }>("/team", { method: "PATCH", body: JSON.stringify({ name }) }),
  invite: (target: string, channel: "email" | "phone" = "email") =>
    api<{ id: number; token: string; target: string; expires_at: string }>("/team/invites", { method: "POST", body: JSON.stringify({ target, channel }) }),
  resend: (id: number) =>
    api<{ id: number; token: string; target: string; expires_at: string }>(`/team/invites/${id}/resend`, { method: "POST" }),
  cancelInvite: (id: number) => api(`/team/invites/${id}`, { method: "DELETE" }),
  accept: (token: string) => api<TokenOut>("/team/invites/accept", { method: "POST", body: JSON.stringify({ token }) }),
  remove: (accountId: number) => api(`/team/members/${accountId}`, { method: "DELETE" }),
  leave: () => api<TokenOut>("/team/leave", { method: "POST" }),
};

export const rentsApi = {
  list: (pk: string) => api<{ items: FloorRent[]; total: Record<string, number>; hidden_floors: string[] }>(`/buildings/${pk}/floor-rents`),
  upsert: (pk: string, r: FloorRent) =>
    api(`/buildings/${pk}/floor-rents`, { method: "PUT", body: JSON.stringify(r) }),
  del: (pk: string, id: number) =>
    api(`/buildings/${pk}/floor-rents/${id}`, { method: "DELETE" }),
  hideFloor: (pk: string, floor: string, hidden: boolean) =>
    api(`/buildings/${pk}/floor-rents/hidden`, { method: "POST", body: JSON.stringify({ floor, hidden }) }),
  outline: (pk: string) =>
    api<{ floor: string | null; use: string | null; floor_area: number | null; rent_est: number | null; deposit_est: number | null }[]>(`/buildings/${pk}/floor-outline`),
};

export interface SeriesPt { x: string; y: number; ov: boolean; master: boolean }
export const seriesApi = {
  get: (pk: string) => api<Record<"gongsi" | "real", SeriesPt[]>>(`/buildings/${pk}/series`),
  upsert: (pk: string, kind: string, x: string, y: number) =>
    api(`/buildings/${pk}/series`, { method: "PUT", body: JSON.stringify({ kind, x, y }) }),
  del: (pk: string, kind: string, x: string) =>
    api(`/buildings/${pk}/series?kind=${kind}&x=${encodeURIComponent(x)}`, { method: "DELETE" }),
};

export interface NearbySale {
  building_pk: string; addr: string; dist_m: number; contract_ym: string;
  price: number; total_area: number | null; land_area: number | null; per_area: number | null;
}
export interface NearbySales {
  radius_m: number; years: number; total: number;
  excluded: number;                 // 이상치로 뺀 건수
  median_per_area: number | null; sales: NearbySale[];
}

export const marketApi = {
  /** 주변 실거래 — 지도 선택 카드용. 매각 사례만 가볍게(임대 comp 없음). */
  nearbySales: (pk: string, radius_m = 500, years = 5) =>
    api<NearbySales>(`/market/nearby-sales/${pk}?radius_m=${radius_m}&years=${years}`),
  nearby: (b: { center_lat: number; center_lng: number; radius_m: number; building_pk?: string; polygon?: object | null; floors?: string[];
                sale_years?: number; sale_price_min?: number | null; sale_price_max?: number | null }) =>
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
  score: number; grade: string; fair_price: number | null;
  avg_per_pyeong: number | null;   // 연면적 평단가 — 사례 비교(04)의 축
  avg_per_land?: number | null;    // 대지 평단가 — 핵심요약의 '평단가'(F-09c)
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
  create: (building_pk: string, kind: "analysis" | "briefing" = "analysis", options: Record<string, unknown> = {}) =>
    api<{ report_id: number }>("/reports", { method: "POST", body: JSON.stringify({ building_pk, kind, options }) }),
  get: (id: number) => api<Report>(`/reports/${id}`),
  list: () => api<Report[]>("/reports"),
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
  wikiList: (pk: string) => api<Record<string, unknown>[]>(`/buildings/${pk}/wiki`),
  wikiPost: (pk: string, body: string, category?: string) =>
    api(`/buildings/${pk}/wiki`, { method: "POST", body: JSON.stringify({ body, category }) }),
  wikiVote: (postId: number) => api<{ voted: boolean }>(`/wiki/${postId}/vote`, { method: "PUT" }),
  wikiReport: (postId: number, reason?: string) => api<{ ok: boolean }>(`/wiki/${postId}/report`, { method: "POST", body: JSON.stringify({ reason }) }),
  wikiDel: (postId: number) => api(`/wiki/${postId}`, { method: "DELETE" }),
  commentsList: (postId: number) => api<{ id: number; body: string; author: string; mine: boolean; created_at: string }[]>(`/wiki/${postId}/comments`),
  commentAdd: (postId: number, body: string) => api<{ id: number }>(`/wiki/${postId}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
  commentDel: (commentId: number) => api(`/wiki/comments/${commentId}`, { method: "DELETE" }),
  memoList: (pk: string) => api<Record<string, unknown>[]>(`/buildings/${pk}/memos`),
  memoAdd: (pk: string, kind: "team" | "secret", body: string) =>
    api(`/buildings/${pk}/memos`, { method: "PUT", body: JSON.stringify({ kind, body }) }),
  memoDel: (pk: string, id: number) => api(`/buildings/${pk}/memos/${id}`, { method: "DELETE" }),
};

// ── 영업관리(S04) — 매수자 · 제안 · 접촉이력 ─────────────────
/** 제안 상태 = 보드의 열. '후보'가 있어야 "골라놓고 아직 안 돌린 것"이 안 샌다. */
export const PROPOSAL_STATUSES = ["후보", "제안", "관심", "거절", "계약"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** 거절 사유 — 집계가 목적이라 적고 겹치지 않게. buyer_side는 매물 탓이 아니라 따로 센다. */
export const REJECT_REASONS = [
  { k: "price", label: "가격" }, { k: "roi", label: "수익률" },
  { k: "location", label: "위치·입지" }, { k: "condition", label: "건물 상태" },
  { k: "size", label: "규모" }, { k: "meongdo", label: "명도" },
  { k: "tenant", label: "임차 구성" }, { k: "use", label: "용도·규제" },
  { k: "buyer_side", label: "매수자 사정" }, { k: "etc", label: "기타" },
] as const;

export interface Buyer {
  id: number; name: string; phone: string | null; grade: string | null; source: string | null;
  is_corp: boolean | null; status: string; memo: string | null;
  conditions_json: Record<string, unknown>;
  assignee_account_id: number | null; active_proposals: number; updated_at: string;
}
export interface Proposal {
  id: number; buyer_id: number; building_pk: string; status: ProposalStatus;
  proposed_on: string | null; propose_count: number; channel: string | null;
  report_id: number | null; reject_reason: string | null; reject_price: number | null; note: string | null;
  buyer_name: string; buyer_grade: string | null;
  addr: string | null; land_area: number | null; total_area: number | null; use_zone: string | null;
  price: number | null; price_is_est: boolean;
}
export interface Contact {
  id: number; target_type: string; target_id: string; kind: string | null;
  occurred_on: string; note: string | null;
}

export interface MatchingBuyer {
  id: number; name: string; grade: string | null; phone: string | null;
  proposal_status: string | null;   // 이미 제안했으면 그 상태
}

export const buyersApi = {
  list: () => api<Buyer[]>("/buyers"),
  /** 이 매물이 조건에 걸리는 매수자 — 매물을 받으면 첫 질문이 "누구한테 돌리지"다. */
  matching: (pk: string) => api<MatchingBuyer[]>(`/buildings/${pk}/matching-buyers`),
  create: (b: Partial<Buyer> & { name: string; conditions?: Record<string, unknown> }) =>
    api<{ id: number }>("/buyers", { method: "POST", body: JSON.stringify(b) }),
  update: (id: number, patch: Record<string, unknown>) =>
    api(`/buyers/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: number) => api(`/buyers/${id}`, { method: "DELETE" }),
};

export const proposalsApi = {
  list: (p: { buyer_id?: number; building_pk?: string } = {}) => {
    const q = new URLSearchParams();
    if (p.buyer_id) q.set("buyer_id", String(p.buyer_id));
    if (p.building_pk) q.set("building_pk", p.building_pk);
    return api<Proposal[]>(`/proposals${q.toString() ? `?${q}` : ""}`);
  },
  /** 같은 (매수자, 매물)이면 새로 만들지 않고 그 행을 갱신한다 — 중복 제안은 구조로 막혀 있다. */
  upsert: (b: { buyer_id: number; building_pk: string; status?: ProposalStatus; channel?: string; report_id?: number; note?: string }) =>
    api<{ id: number }>("/proposals", { method: "POST", body: JSON.stringify(b) }),
  update: (id: number, patch: Record<string, unknown>) =>
    api(`/proposals/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: number) => api(`/proposals/${id}`, { method: "DELETE" }),
};

export const contactsApi = {
  list: (target_type: string, target_id: string) =>
    api<Contact[]>(`/contacts?target_type=${target_type}&target_id=${encodeURIComponent(target_id)}`),
  create: (b: { target_type: string; target_id: string; kind?: string; occurred_on?: string; note?: string }) =>
    api<{ id: number }>("/contacts", { method: "POST", body: JSON.stringify(b) }),
};
