import { api } from "./client";

export interface TokenOut { access_token: string; tier: string }
// vacant = 건물이 없는 「대」 필지(나대지). building_pk 가 없고 pnu 로 가리킨다(2026-08-27)
export interface Suggestion { kind: "building" | "region" | "station" | "vacant"; building_pk?: string | null; pnu?: string | null; addr: string; lng?: number | null; lat?: number | null; is_mine?: boolean; price?: number | null; sub?: string | null }
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
  /** 값의 출처가 갈리는 항목(0134) — 접두 없는 것이 팀 값, _est/_team 이 갈래 */
  sale_est_min?: number | null; sale_est_max?: number | null;
  roi_est_min?: number | null; roi_est_max?: number | null;
  rent_est_min?: number | null; rent_est_max?: number | null;
  deposit_est_min?: number | null; deposit_est_max?: number | null;
  pp_land_team_min?: number | null; pp_land_team_max?: number | null;
  pp_total_team_min?: number | null; pp_total_team_max?: number | null;
  gongsi_ratio_team_min?: number | null; gongsi_ratio_team_max?: number | null;
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
  pop_day_min?: number | null; pop_day_max?: number | null;
  urgencies?: string[] | null;
  owner_types?: string[] | null; relations?: string[] | null; cooperations?: string[] | null; kindnesses?: string[] | null;
  meongdos?: string[] | null; use_changes?: string[] | null; myeolsils?: string[] | null;
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
  /** 조건에 맞는 건수만 — 필터 창이 닫기 전에 결과 크기를 말한다(2026-08-27) */
  count: (p: { bjd_code?: string; polygon?: object; filters?: AttrFilters; mine_only?: boolean }) =>
    // bjd_code 는 SearchIn 이 아니라 filters 안으로 간다 — list 와 같은 어법이어야 같은 결과가 나온다
    api<{ total: number }>("/search/count", { method: "POST", body: JSON.stringify({
      polygon: p.polygon ?? null, mine_only: p.mine_only ?? false,
      filters: { bjd_code: p.bjd_code ?? null, ...(p.filters ?? {}) } }) }),
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
  reg_no?: string | null;        /** 개설등록번호(0128) */
  fee_rate?: number | null;      /** 중개보수 요율 % 기본값(0128) */
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

/** 유동인구 지도 — 250m 격자에 색(지배 용도)과 진하기(주간 인구)를 같이 준다. */
export interface PopCell { grid: string; geojson: unknown; pop: number | null; cat: string | null; n: number | null }
export interface BuildingPop {
  grid: string | null; day: number | null; night: number | null;
  peak: number | null; peak_hour: number | null; hourly: number[]; days: number | null;
  cells: PopCell[]; mix: Record<string, number>;
}
export const buildingsApi = {
  get: (pk: string) => api<Record<string, unknown>>(`/buildings/${pk}`),
  parcels: (pk: string) => api<Record<string, unknown>>(`/buildings/${pk}/parcels`),
  pop: (pk: string) => api<BuildingPop>(`/buildings/${pk}/pop`),
  scene: (pk: string) => api<{
    roads: { rn: string; road_bt: number | null; geojson: unknown }[];
    /** 법정 건폐/용적(%) 목록. 값이 하나면 [55], 걸쳐서 병기되면 [50,60] (0153). */
    legal_bcr: number[] | null; legal_far: number[] | null;
  }>(`/buildings/${pk}/scene`),
  // 나대지 — 건물이 없는 필지. building_pk 가 없어 pnu 로 가리킨다(2026-08-27).
  // 응답 모양은 건물용과 같게 맞췄다 — 같은 컴포넌트가 그린다.
  vacant: (pnu: string) => api<Record<string, unknown>>(`/buildings/parcels/${pnu}`),
  vacantPop: (pnu: string) => api<BuildingPop>(`/buildings/parcels/${pnu}/pop`),
  vacantScene: (pnu: string) => api<{
    roads: { rn: string; road_bt: number | null; geojson: unknown }[];
    /** 법정 건폐/용적(%) 목록. 값이 하나면 [55], 걸쳐서 병기되면 [50,60] (0153). */
    legal_bcr: number[] | null; legal_far: number[] | null;
  }>(`/buildings/parcels/${pnu}/scene`),
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

/** 보류 — 사다리 어느 칸에서든 겹치는 축(S04b §2.3).
 *  철회와 다르다: 철회는 죽은 것이고 보류는 **살아 있는 채로 멈춘 것**이다.
 *  보류 동안은 「연락할 차례」에서 빠지고, 사람이 풀면 다시 뜬다.
 *  깨울 날짜는 두지 않는다(0140) — 다시 볼 일이 정해져 있으면 그건 일정이다. */
export type StopStage = "owner" | "touch" | "intent" | "info" | "asset" | "match" | "find" | "deal";
export interface Stop {
  id: number; target_type: "listing" | "buyer" | "proposal"; target_id: string;
  stage: StopStage; reason: string | null;
  note: string | null; created_at: string;
  held_days: number | null;
  addr?: string | null; owner_name?: string | null; buyer_name?: string | null;
  /** target_type='proposal' 일 때만 — 어느 매물·누구의 짝인지 */
  proposal_pk?: string | null; proposal_buyer_id?: number | null;
}
export interface StopIn {
  target_type: Stop["target_type"]; target_id: string; stage: StopStage;
  reason?: string | null; note?: string | null;
}
export const stopsApi = {
  /** 한 대상에 열린 보류는 하나뿐 — 다시 부르면 덮어쓴다(사유가 둘이면 어느 쪽이 사실인지 모른다) */
  open: (body: StopIn) => api<{ id: number }>("/stops",
    { method: "POST", body: JSON.stringify(body) }),
  /** 푼다 — 지우지 않고 해제 표시만. 「왜 멈췄었나」가 남아야 같은 판단을 또 안 한다 */
  release: (id: number) => api(`/stops/${id}`, { method: "DELETE" }),
  list: (sleeping = false) => api<Stop[]>(`/stops${sleeping ? "?sleeping=true" : ""}`),
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
  median_per_area: number | null; median_price: number | null; sales: NearbySale[];
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
export interface RentFloor {
  floor: string; cur: number; mkt: number; diff: number; count: number;
  /** 보증금 — 이 건물 · 주변 시세(2026-08-25). 임대료와 같은 그릇에서 나온다 */
  cur_dep?: number; mkt_dep?: number;
}
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

// ── 영업관리(S04) — 매수자 · 짝(매수자×매물) · 접촉이력 ──────
/** 짝에는 상태 칸이 없다(0141). 상태는 사실에서 파생한다 — app.nego_rank(words.ts NEGO):
 *  0 죽음 · 1 합의 전 · 2 합의중 · 3 계약예정 · 4 계약완료 · 5 중도금 · 6 거래종료.
 *  「안 산다」는 짝 보류로 적는다(stopsApi · target_type='proposal'). */

/** 거절 사유 — 집계가 목적이라 적고 겹치지 않게. buyer_side는 매물 탓이 아니라 따로 센다. */
/** ③사다리 근거 필드(0093) — 부분 patch */
export interface DealPatch {
  briefed_on?: string; visited_on?: string; visit_note?: string;
  pre_contract_on?: string; pre_contract_amount?: number;
  commission_amount?: number; commission_split?: string; report_filed_on?: string;
  terms?: string;   /** 조건 협의 — 특약 원문 그대로(0097) */
  brief_how?: string[];  /** 브리핑 어디서(0123) — 현장·사무실·전화·자료 발송(복수) */
  brief_note?: string;   /** 브리핑 무엇을(0123) — 한 줄. 이게 곧 「했다」다 */
  picked?: boolean;      /** 채택(0113) — 이 사람과 간다. 매물당 하나 */
  pick_price?: number;   /** 채택과 함께 확정되는 가격 */
  vat_mode?: string;     /** 부가세 조건(0128) — 별도·포함 */
  down_payment?: number; /** 계약금(0128) */
  clear?: string[]; /** 되돌리기 — 이 필드들을 비운다(서버 화이트리스트) */
}
export interface DealDoc { phase: string; actor: string; code: string; label: string; done: boolean }
export const dealApi = {
  patch: (pid: number, body: DealPatch) =>
    api(`/proposals/${pid}/deal`, { method: "PATCH", body: JSON.stringify(body) }),
  docs: (pid: number) =>
    api<{ seller_corp: boolean; buyer_corp: boolean; items: DealDoc[] }>(`/proposals/${pid}/docs`),
  toggleDoc: (pid: number, code: string, done: boolean) =>
    api(`/proposals/${pid}/docs`, { method: "PUT", body: JSON.stringify({ code, done }) }),
};

/** 조건 세트 — 한 매수자가 "종로 수익형"과 "강남 신축부지"를 같이 들고 다닌다. */
export interface BuyerCondition {
  id: number; buyer_id: number; name: string; conditions_json: Record<string, unknown>;
}
export interface Buyer {
  id: number; name: string;
  phone: string | null;
  /** 업무 사다리(0090·0092) — 본인/대리인 · 긴급도 · 통화 결과 */
  is_agent?: boolean; urgency?: string | null; call_result?: string | null;
  /** ②사다리 파생(v_buyer_stage) — 합의 단계(nego)와 다른 층(준비도) */
  b_stage?: "have" | "touch" | "cond" | "match" | "done" | null;
  b1_buyer?: boolean; b4_match?: boolean;
  stop_id?: number | null; stop_stage?: StopStage | null; stop_reason?: string | null;
  /** 담당자 본인·대표가 아니면 연락처가 가려진다(개인정보 — S0M §3.4 경계) */
  phone_masked?: boolean;
  grade: string | null; source: string | null;
  age_band: string | null; gender: string | null;
  cooperation: string | null; kindness: string | null; exclusive: string | null;
  is_corp: boolean | null; memo: string | null;
  /** 계약서 인적사항(0128) — 주민등록번호는 어디에도 저장하지 않는다 */
  addr?: string | null; rep_name?: string | null; corp_no?: string | null; nationality?: string | null;
  /** 투자 가정(0133) — 자기자본(원)·대출금리(연 %)·취득 부대비용률(%). 미지정은 null */
  equity_won?: number | null; loan_rate?: number | null; fee_pct?: number | null;
  /** 사람 상태는 저장 안 한다(0087) — 장부에서 파생: 진행중(살아있는 제안) · 활성(30일 내 기록) · 휴면 */
  activity?: "진행중" | "활성" | "휴면";
  /** 리스트 칩용 — 이 사람의 제안 중 가장 앞선 관계 상태(파생·2026-08-16) */
  top_status?: string | null;
  conditions: BuyerCondition[];
  assignee_account_id: number | null; active_proposals: number; updated_at: string;
  /** 계약을 마쳤나(2026-08-20) — 목록을 「매수자 / 계약」으로 가르고, 추천에서도 빠진다 */
  dealt?: boolean;
  /** 협의 단계 1~4(0127) — 협의 전·협의중·계약예정·계약완료. 담은 매물 중 가장 앞선 것 */
  nego?: number | null;
}
export interface Proposal {
  terms?: string | null;   /** 조건 협의 — 특약 원문(0097) */
  brief_how?: string[] | null;  /** 브리핑 어디서(0123·복수) */
  brief_note?: string | null;   /** 브리핑 무엇을(0123) */
  picked_at?: string | null;    /** 채택 시각(0113) — 이 사람과 간다. 가격도 같이 확정된다 */
  buyer_dealt?: boolean;        /** 이 매수자가 **다른 매물에서** 계약을 마쳤다(2026-08-20) */
  listing_dealt?: boolean;      /** 이 매물이 **다른 매수자와** 계약을 마쳤다(2026-08-20) */
  /** 이 쌍에 걸린 일정(2026-08-19) — 창에서 만든 약속이 창에 보인다 */
  scheds?: { id: number; title: string; cat: string | null; on: string; at: string | null;
             state: string; method?: string | null }[]
    | string | null;
  /** 오간 값(2026-08-19) — 매도가 부른 값 · 매수가 부른 값이 번갈아. 최근 6개 */
  price_log?: { side: string | null; price: number; on: string }[] | string | null;
  /** 칸별 약속(2026-08-18) — 거래 칸은 일정이 정본: 잡았나(due_on) · 했나(done_on) */
  cell_sched?: Record<string, { done_on: string | null; due_on: string | null; due_id: number | null }>
    | string | null;
  /** ③사다리 파생(0093 v_proposal_stage) — 합의 단계(nego)와 다른 층(준비도) */
  d_stage?: "brief" | "visit" | "nego" | "pre" | "sign" | "pay" | "file" | "done" | "out" | null;
  d2_brief?: boolean; d3_visit?: boolean; d4_nego?: boolean; d5_pre?: boolean;
  d6_sign?: boolean; d7_pay?: boolean; d8_file?: boolean;
  briefed_on?: string | null; visited_on?: string | null; visit_note?: string | null;
  pre_contract_on?: string | null; pre_contract_amount?: number | null;
  vat_mode?: string | null;      /** 부가세 조건(0128) — 별도·포함. null=합의 전 */
  down_payment?: number | null;  /** 계약금(0128) — 잔금은 저장 안 함(파생) */
  /** 매수자 인적사항(0128). 전화는 담당자 본인·대표에게만 실린다(열람 경계 동일) */
  buyer_addr?: string | null; buyer_rep_name?: string | null;
  buyer_corp_no?: string | null; buyer_nationality?: string | null; buyer_is_corp?: boolean | null;
  buyer_phone?: string | null;
  commission_amount?: number | null; commission_split?: string | null;
  report_filed_on?: string | null;
  stop_id?: number | null; stop_reason?: string | null;
  id: number; buyer_id: number; building_pk: string; updated_at: string;
  /** 합의 단계(app.nego_rank) — 짝의 상태는 이 하나다. 낱말은 words.ts negoWord */
  nego?: number | null;
  /** 죽은 짝(옛 철회·계약파기). 살아 있으면 null */
  dropped_at?: string | null;
  report_id: number | null; note: string | null;
  buyer_name: string; buyer_grade: string | null;
  addr: string | null; land_area: number | null; total_area: number | null; use_zone: string | null;
  price: number | null; price_is_est: boolean;
  hope_price: number | null;   /** 매수희망가(0064) — 이 매수자가 이 건물을 사고 싶은 값 */
  deal_price: number | null;   /** 거래가(0069) — 계약으로 합의된 값 */
  /** 카드에서 값 판단을 하려면 기준이 같이 있어야 한다 — 배치(master.building_score·sale_est)에서 온다 */
  sale_est: number | null; vs_est_pct: number | null;
  score: number | null; score_grade: string | null; use_type: string | null;
  roi: number | null; photo_id: number | null;
  /** 연임대(마스터 추정·원) — 투자 시뮬의 수입 쪽(0133). roi 로 되돌려 곱하면 반올림이 섞인다 */
  annual_rent?: number | null;
  /** 이 매물의 다음 예정 약속 — 머리의 「상태 + 다음 일정」(2026-08-15) */
  next_sched_title?: string | null; next_sched_on?: string | null; next_sched_at?: string | null;
}
/** 이 사람의 장부 한 줄(app.contacts) — 장부는 하나다(0141) */
export interface BuyerEvent {
  id: number; status: string | null; note: string | null; kind: string | null;
  occurred_on: string | null; created_at: string; by_name: string | null;
}
/** 매도자 — 사람. 매물은 이 사람에게 1:N 으로 딸린다(listings.owner_id · 0058). */
export interface Owner {
  id: number; name: string | null; phone: string | null; phone_masked?: boolean;
  owner_type: string | null; relation: string | null;
  /** 계약서 인적사항(0128) — 주민등록번호는 어디에도 저장하지 않는다 */
  owner_addr?: string | null; owner_rep_name?: string | null;
  owner_corp_no?: string | null; owner_nationality?: string | null;
  cooperation: string | null; kindness: string | null;
  age_band: string | null; gender: string | null;
  note: string | null;
  n_listings: number; assignee_account_id: number | null; updated_at: string;
}
/** 매물 단위 합쳐 보기 — side: 어느 장부에서 온 줄인가 */
export interface TimelineRow {
  side: "buy" | "sell"; who: string | null; status: string | null; note: string | null;
  price: number | null; at: string; auto: boolean; by_name: string | null; channel: string | null;
  reply_to_event_id?: number | null;
  /** 이 줄이 낳았거나(원본) 이 줄을 낳은(거울) 일정 — 표시는 여기서 파생한다(2026-08-15) */
  sched_title?: string | null; sched_on?: string | null; sched_at?: string | null;
  sched_note?: string | null;
  /** 줄의 원본 — 삭제가 원본 장부로 가 닿는 길(매수줄=event, 매도줄=contact) */
  event_id?: number | null; event_pid?: number | null; contact_id?: number | null;
}
export interface Contact {
  id: number; target_type: string; target_id: string; kind: string | null;
  occurred_on: string; note: string | null;
  /** 이 접촉으로 단계가 무엇이 됐나(0059). 비면 단계는 그대로고 기록만 남은 것 */
  status: string | null;
  by_name?: string | null;
  /** 반대편 장부에서 전파돼 자동으로 선 줄(0067) — 사람이 쓴 게 아니다 */
  auto?: boolean;
  created_at?: string;
  /** 이 줄이 낳았거나(원본) 이 줄을 낳은(거울) 일정 — 표시는 여기서 파생한다(2026-08-15) */
  sched_title?: string | null; sched_on?: string | null; sched_at?: string | null;
  sched_note?: string | null;
}

/** 조건 항목별 충족 — 점수 하나로 뭉개지 않는다. "수익률만 0.5%p 모자란다"가 보여야 판단한다. */
export interface MatchCheck { label: string; ok: boolean; want: string; got: string }
export interface MatchingBuyer {
  id: number; name: string; grade: string | null; phone: string | null;
  matched: boolean;                   // 조건에 걸렸는지
  matched_condition: string | null;   // 어느 조건 세트로
  checks: MatchCheck[];               // 왜 맞는지 / 무엇이 걸리는지
  rejects: { reason: string; n: number }[];   // 과거에 접은 패턴(매물 탓 사유만)
  held: boolean;                      // 이미 담아 둔 사람인가
}

export interface BuyerMatch {
  building_pk: string; addr: string; price: number | null; roi: number | null;
  land_area: number | null; total_area: number | null;
  cond_name: string; grade: string | null; use_type: string | null;
}

/** 추천 한 줄의 근거 — 축마다 「원하는 값 / 이 매물 값」. 점수는 줄 세우는 데만 쓴다. */
export interface RecoCheck { label: string; ok: boolean; want: string; got: string }
export interface RecoListing {
  building_pk: string; addr: string | null; price: number | null; roi: number | null;
  land_area: number | null; total_area: number | null;
  mine: boolean; score: number; cond_name: string | null; taken: boolean; checks: RecoCheck[];
}
export interface RecoBuyer {
  id: number; name: string; grade: string | null; phone: string | null;
  score: number; has_condition: boolean; cond_name: string | null; taken: boolean; checks: RecoCheck[];
}

export const buyersApi = {
  list: () => api<Buyer[]>("/buyers"),
  /** 활동 — 접촉 + 제안 경위를 한 타임라인으로(장부는 둘, 읽기는 하나). */
  activity: (bid: number) => api<{ at: string; kind: string | null; status: string | null;
    note: string | null; addr: string | null; building_pk: string | null;
    reject_reason: string | null; reject_price: number | null; price: number | null;
    by_name: string | null }[]>(`/buyers/${bid}/activity`),
  /** 이 매수자 조건에 맞는 매물 — 사람→매물 방향. 추천은 출발점, 최종 담기는 지도·상세에서도. */
  matches: (bid: number, limit = 3) => api<BuyerMatch[]>(`/buyers/${bid}/matches?limit=${limit}`),
  /** 이 매물이 조건에 걸리는 매수자 — 매물을 받으면 첫 질문이 "누구한테 돌리지"다. */
  matching: (pk: string) => api<MatchingBuyer[]>(`/buildings/${pk}/matching-buyers`),
  /** 조건 기반 추천(2026-08-20) — O/X가 아니라 **얼마나 맞나**로 줄을 세운다.
   *  대상은 전 서울이고, 내 매물이면 mine 표식이 붙는다(담기 창이 읽는다). */
  recommend: (bid: number, limit = 20) =>
    api<{ needs_condition: boolean; items: RecoListing[] }>(`/buyers/${bid}/recommend?limit=${limit}`),
  recommendBuyers: (pk: string, limit = 20) =>
    api<{ items: RecoBuyer[] }>(`/buildings/${pk}/recommend-buyers?limit=${limit}`),
  /** 이 사람의 최근 움직임 — 매물을 가로질러 시간순(요약 카드가 읽는다) */
  events: (bid: number, limit = 12) => api<BuyerEvent[]>(`/buyers/${bid}/events?limit=${limit}`),
  create: (b: Omit<Partial<Buyer>, "conditions"> & { name: string }) =>
    api<{ id: number }>("/buyers", { method: "POST", body: JSON.stringify(b) }),
  update: (id: number, patch: Record<string, unknown>) =>
    api(`/buyers/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: number) => api(`/buyers/${id}`, { method: "DELETE" }),
  addCondition: (bid: number, name: string, conditions: Record<string, unknown>) =>
    api<{ id: number }>(`/buyers/${bid}/conditions`, { method: "POST", body: JSON.stringify({ name, conditions }) }),
  updateCondition: (cid: number, name: string, conditions: Record<string, unknown>) =>
    api(`/conditions/${cid}`, { method: "PATCH", body: JSON.stringify({ name, conditions }) }),
  removeCondition: (cid: number) => api(`/conditions/${cid}`, { method: "DELETE" }),
};

export const proposalsApi = {
  list: (p: { buyer_id?: number; building_pk?: string } = {}) => {
    const q = new URLSearchParams();
    if (p.buyer_id) q.set("buyer_id", String(p.buyer_id));
    if (p.building_pk) q.set("building_pk", p.building_pk);
    return api<Proposal[]>(`/proposals${q.toString() ? `?${q}` : ""}`);
  },
  /** 같은 (매수자, 매물)이면 새로 만들지 않고 그 행을 갱신한다 — 중복은 구조로 막혀 있다. */
  upsert: (b: { buyer_id: number; building_pk: string; report_id?: number; note?: string }) =>
    api<{ id: number }>("/proposals", { method: "POST", body: JSON.stringify(b) }),
  update: (id: number, patch: Record<string, unknown>) =>
    api<{ ok: true; contact_id: number | null }>(`/proposals/${id}`,
      { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: number) => api(`/proposals/${id}`, { method: "DELETE" }),
};

/** 「오늘」 — 공이 누구에게 있나(턴). 모든 건은 셋 중 하나:
 *  내 차례(지금 움직일 것) · 기다리는 중(상대 차례) · 시작해볼 곳(아직 아무도 안 움직임).
 *  기다리다 기한이 지나면 그 건은 스스로 내 차례로 올라온다. */
export interface TodayItem {
  kind: "살건지묻기" | "브리핑하기" | "재통화" | "첫전화" | "식은매수자" | "검토중" | "매도신호";
  side: "매수" | "매도";
  why: string;                        // 한 문장 — 이 건이 왜 여기 있는가
  days?: number | null;
  building_pk?: string; addr?: string | null;
  buyer_id?: number; buyer_name?: string; grade?: string | null;
  owner_name?: string | null; status?: string; price?: number | null;
  sell_score?: number; use_type?: string | null; sale_est?: number | null;
  sell_axes?: Record<string, { pt: number; years?: number; pct?: number; pp?: number; zone?: string }>;
}
/** 캘린더에서 온 줄 — 대시보드는 「오늘 뭐 하지」에 캘린더를 열지 않고 답한다 */
export interface TodaySched {
  id: number; side: "buy" | "sell"; title: string; on_date: string; state: string;
  /** 일정 종류(0088) — 계약·중도금·잔금·브리핑·임장·일반. 달력 카드의 색이 여기서 갈린다 */
  category?: string | null;
  /** 어디서 · 누가 온다 — 여럿이면 화면이 「외 N」으로 접는다 */
  place: string | null; people: string[];
  at_time: string | null;
  building_pk: string; proposal_id: number | null; buyer_id: number | null;
  who: string | null; addr: string | null;
  assignee_account_id: number | null; assignee_name: string | null;
  in_days: number;                     // 음수 = 지난 약속(밀린 것)
}
export interface TodayFeed {
  stats: { open_props: number; active_sellers: number; buyers: number; week_contacts: number };
  my_turn: TodayItem[]; waiting: TodayItem[]; starters: TodayItem[];
  /** 오늘 · 밀린 것 · 앞으로 7일 */
  today_sched: TodaySched[]; overdue: TodaySched[]; upcoming: TodaySched[];
  /** 돈의 세 층 — 손에 든 것(계약) · 협의 중 · 들고 있는 것(매물) */
  money: {
    contracted: number; contracted_n: number;
    negotiating: number; negotiating_n: number;
    listed: number; listed_n: number;
  };
  /** 이번 달에 일어난 사건 */
  month: { signed: number; broken: number };
  /** 단계별 건수 — 어디가 막혔나 */
  flow: { sell: Record<string, number>; buy: Record<string, number> };
}

/** 매도자 — 업무탭(listings)의 같은 행을 사람 관점으로. 수정은 기존 listings.patchBiz 재사용. */
export interface Seller {
  building_pk: string; owner_id: number | null; addr: string | null;
  owner_name: string | null; owner_phone: string | null; phone_masked?: boolean;
  owner_type: string | null; relation: string | null;
  /** 계약서 인적사항(0128) — 주민등록번호는 어디에도 저장하지 않는다 */
  owner_addr?: string | null; owner_rep_name?: string | null;
  owner_corp_no?: string | null; owner_nationality?: string | null;
  cooperation: string | null; kindness: string | null; intent: string | null;
  status: string | null; urgency: string | null;
  assignee_account_id: number | null; updated_at: string;
  land_area: number | null; total_area: number | null; price: number | null;
  listing_no: string | null; received_on: string | null;
  deal_price: number | null;   /** 거래가 — 계약 상태 제안의 합의값(파생) */
  ask_price: number | null;   /** 매도희망가 — S02 가격 협의와 같은 오버레이(ask_price) */
  list_price?: number | null;  /** 호가 — 사람이 내건 값(오버레이만, 합성 없음) */
  est_price?: number | null;   /** 빌탐정 추정가 — 산식(마스터) */
  roi: number | null;
  sell_score: number | null; use_type: string | null; photo_id: number | null;
  photo_n?: number | null; has_report?: boolean;   /** 자료 창의 파생 상태(정본=건물 상세) */
  photo_kinds?: Record<string, number> | string | null;   /** 종류별 사진 수(jsonb) */
  has_briefing?: boolean;   /** 브리핑자료 — 생성 폐지 상태(kind=analysis만)라 당분간 false */
  meongdo?: string | null; use_change?: string | null; myeolsil?: string | null;
  nohudo?: string | null; ipji?: string | null;
  ad_status?: string | null; ad_off?: string | null;
  co_sent_on?: string | null;      /** 공동중개 발송일(0098) — 노출의 다른 반쪽 */
  sell_on?: string | null; sell_vague?: string | null;   /** 매도 시기(0099) — 원함인 채의 정보 */
  rent_n?: number | null; rent_vac?: number | null;      /** 임대내역 요약(정본=건물 상세) */
  rent_check?: string | null;   /** 임대내역 확인 상태(0100) — null=안 받음 · 확인중. 받았다=파생 */
  owner_buyer_id?: number | null;  /** 소유자가 매수자 명단에도 있나(전화 일치) */
  last_on: string | null; last_kind: string | null; last_note: string | null;
  /** 칸별 최근 움직임 — **색 판정의 유일한 근거**(목록·레일·창이 같은 값을 본다) */
  cell_last_on?: Record<string, string | null> | string | null;
  /** 이 매물의 다음 예정 약속 — 머리의 「상태 + 다음 일정」(2026-08-15) */
  next_sched_title?: string | null; next_sched_on?: string | null; next_sched_at?: string | null;
  /** 소유자를 잡았나 — 관심(미확보) ↔ 매물(확보)을 가르는 축(2026-08-16) */
  has_owner?: boolean;
  owner_age_band?: string | null; owner_gender?: string | null; owner_note?: string | null;
  call_result?: string | null;   /** 마지막 통화 결과(0090) — 접촉 창·통화 칩이 같이 쓴다 */
  /** 사다리 단계 — 필드에서 **파생**된다(0091 app.v_listing_stage). 사람이 찍는 칸이 아니다.
   *  stage = 처음 못 넘은 칸. 여섯 칸을 다 넘으면 'find'(살 사람 찾는 중). */
  stage?: StopStage | "done" | null; passed?: number | null; info_filled?: number | null;
  /** 칸별 판정 — 사다리는 순서 강제가 아니라 지도. 칸은 각자 근거로 참이 되고 병렬로 진행된다 */
  s1_owner?: boolean; s2_touch?: boolean; s3_intent?: boolean;
  s4_info?: boolean; s5_asset?: boolean; s6_match?: boolean;
  /** 열린 멈춤 — 멈춘 동안은 「연락할 차례」에서 빠진다(S04b §2.3) */
  stop_id?: number | null; stop_stage?: StopStage | null; stop_reason?: string | null;
  /** 협의 단계 1~4(0127) — 이 매물에 붙은 매수자들 중 가장 앞선 것 */
  nego?: number | null;
  /** 나대지 매물(2026-08-27) — building_pk 가 'P'+pnu. 건물이 아니라 빈 땅이다 */
  is_vacant?: boolean | null;
}

/** 이 매물이 왜 안 나갔는지 — 제안을 돌리면 저절로 쌓이는 답 */
export interface RejectSummary {
  proposed: number; rejected: number; want_price: number | null;
  reasons: { reason: string; n: number; med_price: number | null }[];
}

/** F-23 1단계 — 명시 프로필. 「시작해볼 곳」의 조준값. */
export interface BrokerProfile {
  regions: string[] | null;      // 주 활동 구(시군구코드)
  style: 1 | 3 | 5 | null;       // 급매·회전 / 중간 / 관계·장기
  price_min: number | null; price_max: number | null;
  use_types: string[] | null;
}

export const salesApi = {
  /** 문장에서 누구(어느 매물) 얘기인지 — 이름·매물번호·주소·전화 뒷자리(목록 조회).
   *  via 가 listing/addr 이면 그 매물 장부로 라우팅한다 */
  find: (q: string) =>
    api<{ kind: "owner" | "buyer"; id: number; name: string;
          via: "name" | "listing" | "addr" | "phone" | "alias";
          building_pk: string | null; addr: string | null;
          proposal_id: number | null }[]>(
      `/sales/find?q=${encodeURIComponent(q)}`),
  /** 이 매물에 맞는 매수자 — 조건 매칭(기존 API 재사용) */
  matchingBuyers: (pk: string) =>
    api<{ id: number; name: string }[]>(`/buildings/${pk}/matching-buyers`),
  today: (mine = true) => api<TodayFeed>(`/sales/today?mine=${mine}`),
  profile: () => api<BrokerProfile>("/sales/profile"),
  putProfile: (b: BrokerProfile) => api("/sales/profile", { method: "PUT", body: JSON.stringify(b) }),
  sellers: (mine = false, owner_id?: number) =>
    api<Seller[]>(`/sales/sellers?mine=${mine}${owner_id ? `&owner_id=${owner_id}` : ""}`),
  /** 매도자 = 사람 하나(0058). 매수(app.buyers)와 같은 모양이라 화면도 같은 부품을 쓴다. */
  owners: (mine = false) => api<Owner[]>(`/sales/owners?mine=${mine}`),
  createOwner: (b: { name: string; phone?: string | null; owner_type?: string | null;
    relation?: string | null; cooperation?: string | null; kindness?: string | null;
    age_band?: string | null; gender?: string | null; note?: string | null }) =>
    api<{ id: number }>("/owners", { method: "POST", body: JSON.stringify(b) }),
  /** 매물을 이 매도자에게 붙인다 — 매물의 주인은 하나뿐(0058) */
  attachListing: (oid: number, building_pk: string) =>
    api(`/owners/${oid}/listings`, { method: "PUT", body: JSON.stringify({ building_pk }) }),
  /** 한 건물의 두 장부(매수 제안·매도 접촉)를 시간순으로 합쳐 본다 — 읽기 전용 */
  timeline: (building_pk: string) => api<TimelineRow[]>(`/sales/timeline?building_pk=${encodeURIComponent(building_pk)}`),
  rejectSummary: (pk: string) => api<RejectSummary>(`/buildings/${pk}/reject-summary`),
};

/** 일정(0070·0071) — 커밋에서 파서가 읽은 약속. 날짜가 떨어지는 것만 선다. */
export interface ScheduleRow {
  id: number; side: "buy" | "sell"; title: string; on_date: string;
  /** HH:MM:SS — null 이면 시간 미정(0073) */
  at_time: string | null;
  hint: string | null; building_pk: string; proposal_id: number | null;
  buyer_id: number | null; who: string | null; addr: string | null;
  /** 이 매물의 담당자 — 남의 약속은 보기만 한다 */
  assignee_account_id: number | null; assignee_name: string | null;
  /** 예정 · 완료(0074 — 취소는 없앴다. 깨진 약속은 지운다) */
  state: "예정" | "완료";
  /** 약속(옮기고 끝낼 수 있다) · 사건(계약·계약파기 — 캘린더에서 못 고친다) */
  kind: "약속" | "사건";
  /** ✓(완료)로 계약이 된 표 — 체크 해제로 되돌릴 수 있는 사건(2026-08-15) */
  promoted?: boolean;
  /** 일정 종류(0088) — 일반·계약·중도금·잔금. 계약은 완료(✓)가 곧 계약 체결 */
  category?: "일반" | "브리핑" | "임장" | "계약" | "중도금" | "잔금";
  moved_from: string | null;
  /** 이 약속을 만든 커밋 — 무슨 얘기 끝에 잡힌 약속인지 */
  src_note: string | null; src_on: string | null; src_by: string | null;
  /** 장소 — 매물이 아닌 곳(사무실·현장·법무사). 매물 주소는 addr 가 들고 있다 */
  place: string | null;
  /** 오는 사람들 — 계약 날엔 매도자와 매수자가 같이 온다. guest 는 우리 장부에 없는 사람 */
  people: { id: number; kind: "buyer" | "owner" | "guest"; ref_id: number | null;
            label: string | null; phone: string | null }[];
}

export const schedulesApi = {
  /** 맨손으로 만드는 일정(2026-08-25) — 매물도 사람도 안 붙을 수 있다 */
  create: (b: { title: string; on: string; at?: string | null; place?: string | null;
    category?: string | null; method?: string | null; building_pk?: string | null;
    people?: { kind: string; ref_id?: number; label?: string }[];
    assignee_account_id?: number }) =>
    api<{ id: number }>("/schedules", { method: "POST", body: JSON.stringify(b) }),
  range: (start: string, end: string, mine = false) =>
    api<ScheduleRow[]>(`/sales/schedule?start=${start}&end=${end}&mine=${mine}`),
  /** 끌어 옮기기 · 완료 — 손댄 일은 장부에도 자동으로 적힌다(0072) */
  patch: (id: number, b: {
    on_date?: string; at_time?: string; title?: string; place?: string;
    assignee_account_id?: number; category?: string;
    people?: { kind: string; ref_id?: number; label?: string; phone?: string }[];
    state?: string;
    amount?: number;   /** 돈이 오가는 약속의 금액(0128) — 중도금·잔금 */
  }) =>
    api<{ ok: boolean }>(`/schedules/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  /** 지우기 — 깨졌거나 잘못 들어온 줄. 장부의 문장은 그대로 남는다 */
  remove: (id: number) => api(`/schedules/${id}`, { method: "DELETE" }),
};

/** 한 사람의 모든 기록 — 매물을 가로질러 시간순(0076). 「매물 무관」 줄은 building_pk 가 없다 */
export interface PersonEvent {
  id: number; building_pk: string | null; addr: string | null;
  status: string | null; note: string | null; channel: string | null;
  auto: boolean; by_name: string | null; at: string;
  /** 어느 장부에서 온 줄인가 — 합본에서 지울 때 이걸로 API 를 가른다(id 는 테이블을 못 가른다) */
  src: "contact" | "event"; proposal_id: number | null;
  reply_to_event_id?: number | null;
  price?: number | null; reply_price?: number | null; reply_at?: string | null;
  /** 이 줄이 낳았거나(원본) 이 줄을 낳은(거울) 일정 — 표시는 여기서 파생한다(2026-08-15) */
  sched_title?: string | null; sched_on?: string | null; sched_at?: string | null;
  sched_note?: string | null;
}

/** 매도자 → 매수자 명단(0098) — 전화번호로 중복 방지. 이미 있으면 그 사람을 돌려준다 */
export const convertApi = {
  ownerToBuyer: (building_pk: string) =>
    api<{ buyer_id: number; created: boolean }>(
      `/listings/${encodeURIComponent(building_pk)}/owner-to-buyer`, { method: "POST" }),
  /** 전환 취소 — 명단에서 내린다(소프트 삭제) */
  ownerFromBuyer: (building_pk: string) =>
    api<{ buyer_id: number }>(
      `/listings/${encodeURIComponent(building_pk)}/owner-to-buyer`, { method: "DELETE" }),
};

/** 호가판(2026-08-19) — 값의 시간 흐름. 매도 쪽과 매수자별 값이 같은 축에 선다 */
export interface OfferBoard {
  sell: { id: number; field: string; prev: string | null; value: string | null; created_at: string }[];
  buys: { proposal_id: number; event_id: number; buyer_name: string | null; status: string; field: string;
          prev: string | null; value: string | null; created_at: string }[];
  events: { event_id: number; proposal_id: number; buyer_name: string | null; side: string | null;
            price: number; created_at: string }[];
}
/** 계약 문서(0128) — 종류별 한 판. body에 서식 칸 전체(주민등록번호 없음 — 서버가 마스킹). */
export const papersApi = {
  get: (pid: number) => api<Record<string, Record<string, unknown>>>(`/proposals/${pid}/papers`),
  put: (pid: number, kind: string, body: Record<string, unknown>) =>
    api(`/proposals/${pid}/papers`, { method: "PUT", body: JSON.stringify({ kind, body }) }),
};

export const boardApi = {
  get: (building_pk: string) =>
    api<OfferBoard>(`/sales/offer-board?building_pk=${encodeURIComponent(building_pk)}`),
  /** 잘못 기록된 값 하나를 이력에서 뺀다 — src=field(값 이벤트)·prop(제안 이벤트) */
  delEvent: (src: "field" | "prop", id: number) =>
    api(`/sales/offer-events/${src}/${id}`, { method: "DELETE" }),
};

export const contactsApi = {
  list: (target_type: string, target_id: string) =>
    api<Contact[]>(`/contacts?target_type=${target_type}&target_id=${encodeURIComponent(target_id)}`),
  create: (b: { target_type: string; target_id: string; kind?: string; occurred_on?: string;
    note?: string; status?: string; deal_price?: number;
    /** 문장에서 읽은 매매가·매도희망가(0078) — 서버가 오버레이에 쓰고 스냅샷을 남긴다 */
    list_price?: number; hope_price?: number;
    schedule?: unknown; schedule_op?: unknown }) =>
    api<{ id: number }>("/contacts", { method: "POST", body: JSON.stringify(b) }),
  /** 이 매물에 얽힌 사람들 — 약속 창의 참석자 후보(매도자 1 + 제안 걸린 매수자들) */
  people: (building_pk?: string | null) =>
    api<{ kind: "owner" | "buyer"; ref_id: number; label: string; sub: string | null }[]>(
      `/sales/people?building_pk=${encodeURIComponent(building_pk ?? "")}`),
  /** 한 사람의 합본 — 사람 장부 + 그가 얽힌 매물·제안 기록(읽기 전용) */
  personTimeline: (kind: "buyer" | "owner", person_id: number) =>
    api<PersonEvent[]>(`/sales/person-timeline?kind=${kind}&person_id=${person_id}`),
  /** 기록 삭제 — 지우면 남은 마지막 기록이 만든 단계로 되돌아간다(매수와 같은 규칙) */
  remove: (id: number) => api(`/contacts/${id}`, { method: "DELETE" }),
};
