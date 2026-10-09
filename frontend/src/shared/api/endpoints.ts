import { api } from "./client";

export interface TokenOut { access_token: string }
// vacant = 건물이 없는 「대」 필지(나대지). building_pk 가 없고 pnu 로 가리킨다(2026-08-27)
export interface Suggestion { kind: "building" | "region" | "station" | "vacant"; building_pk?: string | null; pnu?: string | null;
  /** 그 지번 1번 매물(볼 수 있는 것 중, 0255) — 없으면 null */
  listing_id?: number | null; addr: string; lng?: number | null; lat?: number | null; is_mine?: boolean; price?: number | null; sub?: string | null
  /** 지역이면 법정동 코드 — 고르면 그 동이 지역 필터가 된다 */
  bjd_code?: string | null;
}
/** 임대 내역의 호실 한 줄(0185) — 호실은 **업체 단위**다(대장 전유부 아님) */
export interface FloorRent {
  id?: number;
  floor: string | null;            // null = 층 미상
  unit_no: string;
  contract_area?: number | null;   // 계약면적 ㎡ — 공실·평당가 셈의 기준
  excl_area?: number | null;       // 전용면적 ㎡(0190) — 보는 값
  deposit?: number | null; rent?: number | null; maintenance?: number | null;   // null = 모름
  tenant_name?: string | null;     // 상호명(0155). 모르면 null
  place_ref?: string | null;       // 매물 등록 때 원장에서 복사한 업체의 열쇠
  cat_nodes?: string[] | null;     // 업종 나무(조상까지) — 복사해 온 업체만. 팀이 만든 호실은 null(0189)
  /** 공실 체크(0208) — 체크 = 공실, 업체 있음 = 임대중, 둘 다 아님 = 모름 */
  vacant?: boolean;
  /** 서버 판정 — 업체(또는 임대료)가 있고 공실 체크가 없으면 임대중. 저장값이 아니다 */
  occupied?: boolean;
}

export const authApi = {
  publicConfig: () => api<{ signups_open: boolean }>("/auth/public-config"),
  signup: (b: { email: string; password: string; name: string; office_name?: string; phone?: string; job_role?: string; referral_source?: string; interest_region?: string; gender?: string; kind?: "중개사" | "고객"; terms_agreed: boolean; privacy_agreed: boolean; marketing_agreed?: boolean }) =>
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
  me: () => api<{ account_id: number; team_id: number; name: string; email: string; job_role: string | null; gender: string | null; phone?: string | null; kind?: string; job_title?: string | null;
    /** 프로필 사진(0219) — 있으면 주소. 본인 것은 photoBlob 로 받는다(고객 사진은 주소로 안 열린다) */ photo?: string | null }>("/auth/me"),
  uploadPhoto: (f: File) => { const fd = new FormData(); fd.append("file", f); return api<{ ok: boolean; photo: string }>("/auth/me/photo", { method: "POST", body: fd }); },
  deletePhoto: () => api<{ ok: boolean }>("/auth/me/photo", { method: "DELETE" }),
  patchProfile: (b: Record<string, string>) =>
    api<{ ok: boolean }>("/auth/profile", { method: "PATCH", body: JSON.stringify(b) }),
};

export interface AttrFilters {
  /** 모델과 같은 칸(09-30) — 주용도 부분일치(바깥 OR · 안쪽 AND) · 업체 · 규제 · 전면 도로폭 */
  use?: string[][] | null; biz_dnf?: string[][] | null; regulations?: string[] | null;
  road_front_min?: number | null; road_front_max?: number | null;
  bcr_over_min?: number | null; bcr_over_max?: number | null; far_over_min?: number | null; far_over_max?: number | null;
  /** 매물 유형(0246) — 상업용건물 · 상가/사무실 · 단독/다가구 · 연립/다세대 · 오피스텔 · 토지 · 공장/창고 · 숙박시설 · 기타건물 */
  kinds?: string[] | null;
  /** 실거래 유형(0246) — 실거래 보기에만. 매물 유형과 다른 칸 */
  trade_types?: string[] | null;
  /** 추정(_est)과 매매가(_sale)는 다른 항목이다(0134 · 0224). 매매가는 내 매물 · 빌탐정 광고 · 네이버 가운데 하나라도 */
  sale_est_min?: number | null; sale_est_max?: number | null;
  pp_land_sale_min?: number | null; pp_land_sale_max?: number | null;
  pp_total_sale_min?: number | null; pp_total_sale_max?: number | null;
  gongsi_ratio_sale_min?: number | null; gongsi_ratio_sale_max?: number | null;
  use_zones?: string[] | null;
  jimoks?: string[] | null;
  road_frontages?: string[] | null;
  shapes?: string[] | null;
  slopes?: string[] | null;
  land_uses?: string[] | null;
  main_uses?: string[] | null;
  etc_use?: string | null;
  /** 입주 업종 — 대장 용도가 아니라 실제 영업 중 업체로 거른다(0170).
   *  갈래(의료·먹자·판매·업무·유흥·생활서비스·교육)나 낱말(카페·학원). */
  biz?: string | null;
  biz_min?: number | null;
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
  /** 고르는 열쇠 = 지번(10-08). building_pk 는 그 지번의 대표 동(목록 카드 · 매물 열쇠가 아직 쓴다) */
  pnu: string; building_pk: string; addr: string; lng: number; lat: number;
  /** 매물(0226) — 줄 하나 = 매물 하나(매물 탭) · 건물 하나(건물 탭, 1번 매물). 매매가는 그 매물의 값 하나(없으면 null) */
  col: "ad" | "mine" | "normal"; price: number | null; sale_est?: number | null;
  listing_id?: number | null; rank?: number | null; owner?: "mine" | "office" | "crawl" | null; office?: string | null; ad_id?: number | null;
  roi: number | null; last_sale_price: number | null;
  /** 지도에서 실거래를 총액·단가로 견주는 재료(밸류맵식). 단가 기본 분모는 대지면적이다 */
  last_sale_ym?: string | null; land_area?: number | null; total_area?: number | null;
  /** 핀 종류(S05) — 내 매물 · 광고 · 거래완료 · 일반. 색이 이걸로 갈린다 */
  kind?: PinKind; ad_n?: number;
  /** 매물유형 — 팀이 고른 대분류, 없으면 네이버 유형(0246). 지도 전단 가운데 줄 · 탐색 카드 */
  major?: string | null;
  /** 실거래 보기 — 원천 건축물주용도, 없으면 실거래 유형(0246). 가격표 첫 칸 */
  trade_use?: string | null;
  /** 매물 탐색(S08) — 네이버 매물 수집일 · 그날 광고 수 */
  mk_on?: string | null; mk_n?: number | null;
}
export type PinKind = "mine" | "ad" | "sold" | "normal" | "market";
/** 건물의 매물 한 건(0226) — 건물 상세 「이 건물의 매물」. 순번(rank) 1 이 지도 핀에 서는 매물 */
export interface BuildingListing { owner: "mine" | "office" | "crawl"; office: string | null; price: number | null;
  price_on: string | null; rank: number }
/** 검색 탭(S05 §2) — 실거래 · 매매 · 전체. 화면은 하나고 탭만 바뀐다 */
export type SearchTab = "deal" | "ad" | "all" | "explore";

/** 사이드 판 광고 카드(누구나) — 가격 비공개면 price 는 null */
export type AdCard = {
  id: number; state: "노출" | "거래완료";
  /** 이 광고의 매물(10-08) — 판은 고른 매물의 광고를 이것으로 집는다 */
  listing_id: number; brokerage: "일반" | "전속"; use_type: string | null;
  price: number | null; price_open: boolean;
  title: string; body: string | null; posted_on: string; closed_on: string | null;
  phone: string | null; agent_name: string | null; agent_title: string | null; agent_photo?: string | null; office_name: string | null; reg_no: string | null;
  mine: boolean; photo_id: number | null;
  photo_ids: number[] | null; addr: string | null; updated_on: string | null;
  office_addr: string | null; rep_name: string | null; office_phone: string | null; created_at: string;
} & AdBasic;
/** 광고 기본정보(0196) — 대장에 없는, 광고한 중개사만 아는 값. 모르면 null */
export interface AdBasic {
  deposit: number | null; monthly_rent: number | null; loan: number | null; loan_open: boolean;
  move_in: "즉시입주" | "협의" | "날짜" | null; move_in_on: string | null;
}
/** 목록 카드(0226) — 카드 한 장 = 매물 하나. 주인(내 매물 · 다른 사무소 · 수집)마다 채워지는 칸이 다르다 */
export interface ListCard {
  listing_id: number; pnu: string; owner: "mine" | "office" | "crawl"; office: string | null;
  price: number | null; rank: number;
  addr: string; land_area: number | null; total_area: number | null;
  floors_above: number | null; floors_below: number | null; main_use_name: string | null; lng: number; lat: number;
  use_type: string | null;
  /** 광고 얼굴(다른 사무소 매물 · 광고를 건 내 매물) */
  ad_id: number | null; title: string | null; posted_on: string | null; ad_created_at: string | null; price_open: boolean | null;
  agent_name: string | null; agent_title?: string | null; agent_photo?: string | null; ad_photo_id: number | null;
  /** 내 매물만 */
  mine: boolean; assignee_name: string | null; my_status?: string | null; my_status_color?: string | null;
  my_hold?: string | null; received_on: string | null; my_photo_id: number | null;
  /** 수집 매물만 */
  mk_on?: string | null; mk_n?: number | null;
}
/** 매매시세 · 임대시세(중개사만, 0212) — 수집한 날마다 한 줄. 같은 것을 여러 중개사가 올린 광고는 가장 싼 하나(n_ads = 몇 건이었나) */
export interface MarketSaleRow { observed_on: string; price: number; posted_on: string | null; n_ads: number;
  land_area: number | null; total_area: number | null; use_type: string | null }
export interface MarketRentRow { floor: string | null; area_key: number; observed_on: string; contract_area: number;
  excl_area: number | null; deposit: number | null; rent: number | null; posted_on: string | null; n_ads: number; use_type: string | null }
export interface MarketData { sale: MarketSaleRow[]; rent: MarketRentRow[] }

export const searchApi = {
  /** 조건에 맞는 건수만 — 필터 창이 닫기 전에 결과 크기를 말한다(2026-08-27) */
  count: (p: { bjd_code?: string | string[]; polygon?: object; filters?: AttrFilters; mine_only?: boolean; tab?: SearchTab; chip?: "" | "mine" | "ads" }) =>
    // bjd_code 는 SearchIn 이 아니라 filters 안으로 간다 — list 와 같은 어법이어야 같은 결과가 나온다
    api<{ total: number }>("/search/count", { method: "POST", body: JSON.stringify({
      polygon: p.polygon ?? null, mine_only: p.mine_only ?? false, ...(p.tab ? { tab: p.tab } : {}), ...(p.chip ? { chip: p.chip } : {}),
      filters: { bjd_code: p.bjd_code ?? null, ...(p.filters ?? {}) } }) }),
  suggest: (q: string) => api<Suggestion[]>(`/search/suggest?q=${encodeURIComponent(q)}`),
  /** 규제 이름(토지이용계획) — 걸린 건물이 많은 것부터 */
  regulationNames: () => api<{ name: string; buildings: number }[]>("/search/regulations"),
  regions: () => api<Record<string, { sgg_code: string; dongs: { bjd_code: string; dong: string; count: number }[] }>>("/search/regions"),
  pins: (p: { bjd_code?: string | string[]; polygon?: object; filters?: AttrFilters; sort?: string; mine_only?: boolean;
              tab?: SearchTab; chip?: "" | "mine" | "ads"; sale_years?: number;
              sale_from?: number | null; sale_to?: number | null; sale_year_list?: number[] | null;
              bbox?: [number, number, number, number]; for_model?: boolean }) =>
    api<MapPinDTO[]>("/search/pins", {                // 지도 핀: 페이징 없이 전체 매물(경량)
      method: "POST",
      body: JSON.stringify({
        polygon: p.polygon ?? null,
        mine_only: p.mine_only ?? false,
        filters: { bjd_code: p.bjd_code ?? null, ...(p.filters ?? {}) },
        sort: p.sort ?? "price",
        tab: p.tab ?? "all", chip: p.chip ?? "", sale_years: p.sale_years ?? 3, bbox: p.bbox ?? null,
        sale_from: p.sale_from ?? null, sale_to: p.sale_to ?? null, sale_year_list: p.sale_year_list ?? null, for_model: p.for_model ?? false,
      }),
    }),
  parcelAt: (lng: number, lat: number) =>              // 클릭 지점 → 지번(부속지번이면 그 건물의 지번)
    api<{ pnu: string | null }>(`/search/parcel-at?lng=${lng}&lat=${lat}`),
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
  /** 사무소 홍보 사진(0236) — 홍보물 템플릿이 쓴다 */
  promoList: () => api<{ id: number; n: number }[]>("/team/office/promo"),
  uploadPromo: (f: File) => {
    const fd = new FormData(); fd.append("file", f);
    return api<{ id: number }>("/team/office/promo", { method: "POST", body: fd });
  },
  delPromo: (id: number) => api(`/team/office/promo/${id}`, { method: "DELETE" }),
};

/** 저장한 조건 — 내 조건(buyer_id 없음) + 우리 팀 고객에 붙은 조건(S09 · 0214, 팀 전체가 본다) */
export interface SavedSearch { id: number; name: string; conditions_json: Record<string, unknown>; created_at: string;
  buyer_id: number | null; buyer_name: string | null }
export const savedApi = {
  list: () => api<SavedSearch[]>("/saved-searches"),
  /** buyerId 를 주면 그 고객에 붙는다 */
  save: (name: string, conditions: Record<string, unknown>, buyerId?: number | null) =>
    api<{ id: number }>("/saved-searches", { method: "POST", body: JSON.stringify({ name, conditions, buyer_id: buyerId ?? null }) }),
  /** 부분 수정 — 이름만 바꾸거나 조건만 덮어쓴다(둘 다 보내도 된다). */
  update: (id: number, patch: { name?: string; conditions?: Record<string, unknown> }) =>
    api(`/saved-searches/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: number) => api(`/saved-searches/${id}`, { method: "DELETE" }),
};

/** 유동인구 지도 — 250m 격자에 색(지배 용도)과 진하기(주간 인구)를 같이 준다. */
export interface PopCell { geojson: unknown; pop: number | null }
export interface BuildingPop {
  day: number | null; night: number | null;
  peak: number | null; peak_hour: number | null; hourly: number[]; days: number | null;
  cells: PopCell[];
}
/** 동 하나(지번 안에서 고른 동)의 대장 카드. raw = 대장 원본만(팀 정정 안 섞음, 10-02) */
export const buildingsApi = {
  get: (pk: string, raw = false) => api<Record<string, unknown>>(`/buildings/${pk}${raw ? "?raw=true" : ""}`),
  /** 탐색 목록 카드 — 카드 한 장 = 매물 하나 */
  cards: (ids: number[]) => api<ListCard[]>("/ads/cards", { method: "POST", body: JSON.stringify({ ids }) }),
};
type Scene = {
  roads: { rn: string; road_bt: number | null; geojson: unknown }[];
  /** 법정 건폐/용적(%) 목록. 값이 하나면 [55], 걸쳐서 병기되면 [50,60] (0153). */
  legal_bcr: number[] | null; legal_far: number[] | null;
};
/** 지번 페이지(10-08 · 스펙 12 §3-5) — 열쇠는 지번 하나. 나대지도 같은 응답(동 목록이 비었을 뿐) */
export const parcelsApi = {
  get: (pnu: string) => api<Record<string, unknown>>(`/parcels/${pnu}`),
  lands: (pnu: string, raw = false) => api<Record<string, unknown>>(`/parcels/${pnu}/lands${raw ? "?raw=true" : ""}`),
  geom: (pnu: string) => api<{ polygon: { type: string; coordinates: unknown } | null }>(`/parcels/${pnu}/geom`),
  pop: (pnu: string) => api<BuildingPop>(`/parcels/${pnu}/pop`),
  scene: (pnu: string) => api<Scene>(`/parcels/${pnu}/scene`),
  trades: <T,>(pnu: string) => api<T[]>(`/parcels/${pnu}/trades`),
  /** 광고 카드(누구나) — 그 지번 매물들의 광고 */
  ads: (pnu: string) => api<AdCard[]>(`/parcels/${pnu}/ads`),
  /** 매매시세 · 임대시세(중개사만) */
  market: (pnu: string) => api<MarketData>(`/parcels/${pnu}/market`),
};

export type PhotoKind = "exterior" | "interior" | "land_use" | "building_ledger" | "cadastral" | "etc";
export interface Photo {
  id: number; url: string; kind: PhotoKind; caption: string | null; sort_order: number;
  transform: { zoom: number; x: number; y: number } | null;   // 슬롯 배치 — 원본은 그대로
}
/** 매물 사진(0255) — 매물 번호에 붙는다 */
export const photosApi = {
  list: (lid: number) => api<Photo[]>(`/listings/${lid}/photos`),
  upload: (lid: number, f: File, kind: PhotoKind, caption?: string) => {
    const fd = new FormData(); fd.append("file", f); fd.append("kind", kind);
    if (caption) fd.append("caption", caption);
    return api<{ id: number }>(`/listings/${lid}/photos`, { method: "POST", body: fd });
  },
  patch: (lid: number, id: number, b: Partial<Pick<Photo, "kind" | "caption" | "sort_order" | "transform">>) =>
    api(`/listings/${lid}/photos/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  del: (lid: number, id: number) => api(`/listings/${lid}/photos/${id}`, { method: "DELETE" }),
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
};

/** 매물(0255) — 부르는 열쇠는 매물 번호 하나. 등록할 때만 지번으로 */
export const listingsApi = {
  get: (lid: number) => api<Record<string, unknown>>(`/listings/${lid}`),
  /** 내 사무소의 그 지번 매물(없으면 null) */
  ofParcel: (pnu: string) => api<Record<string, unknown> | null>(`/listings/of-parcel/${pnu}`),
  claim: (pnu: string, assignee_account_id: number | null) =>
    api<{ ok: boolean; listing_id: number }>("/listings/claim", { method: "PUT", body: JSON.stringify({ pnu, assignee_account_id }) }),
  patchBiz: (listing_id: number, fields: Record<string, string | boolean | string[] | null>) =>
    api("/listings/biz", { method: "PATCH", body: JSON.stringify({ listing_id, fields }) }),
  mine: () => api<Record<string, unknown>[]>("/listings"),
  members: () => api<{ account_id: number; name: string; role: string }[]>("/listings/members"),
};

/** 상태(0199) — 사무소가 만들고(이름 · 색 · 순서) 매물 · 고객마다 손으로 고른다(부기사). 자동 판정은 없다 */
export interface StatusDef { id: number; name: string; color: string; sort: number; n: number }
export type StatusKind = "listing";   // 고객 상태는 0220 에서 지웠다
export const statusesApi = {
  list: (kind: StatusKind) => api<StatusDef[]>(`/statuses?kind=${kind}`),
  add: (kind: StatusKind, name: string, color: string) =>
    api<{ id: number }>("/statuses", { method: "POST", body: JSON.stringify({ kind, name, color }) }),
  edit: (id: number, p: { name?: string; color?: string }) => api(`/statuses/${id}`, { method: "PATCH", body: JSON.stringify(p) }),
  order: (kind: StatusKind, ids: number[]) => api("/statuses/order", { method: "PUT", body: JSON.stringify({ kind, ids }) }),
  /** 지우면 그 상태의 매물 · 고객을 moveTo 로(없으면 미지정) */
  remove: (id: number, moveTo: number | null) => api(`/statuses/${id}${moveTo != null ? `?move_to=${moveTo}` : ""}`, { method: "DELETE" }),
  setListing: (lid: number, b: { status_id: number | null; sold_on?: string | null; sold_price?: number | null; hold_reason?: string | null }) =>
    api(`/listings/${lid}/status`, { method: "PUT", body: JSON.stringify(b) }),
};

export interface TeamMember { account_id: number; name: string; email: string; role: "owner" | "member"; is_me: boolean; photo?: string | null; job_title?: string | null }
export interface TeamInvite { id: number; account_id: number; name: string; job_title: string | null; photo: string | null; expires_at: string | null; created_at: string }
/** 초대할 중개사 찾기 결과(0221) — 이메일은 가려서 온다 */
export interface TeamPerson { account_id: number; name: string; job_title: string | null; office: string | null; email: string; photo: string | null; invited: boolean }
/** 받은 초대(0221) */
export interface ReceivedInvite { id: number; office: string; inviter: string; photo: string | null; created_at: string }
export interface TeamInfo { id: number; name: string; my_role: "owner" | "member"; member_count: number; members: TeamMember[]; invites: TeamInvite[] }

export const teamApi = {
  get: () => api<TeamInfo>("/team"),
  people: (q: string) => api<TeamPerson[]>(`/team/people?q=${encodeURIComponent(q)}`),
  invite: (accountId: number) => api<{ ok: boolean; id: number }>("/team/invites", { method: "POST", body: JSON.stringify({ account_id: accountId }) }),
  cancelInvite: (id: number) => api(`/team/invites/${id}`, { method: "DELETE" }),
  received: () => api<ReceivedInvite[]>("/team/invites/received"),
  accept: (id: number) => api<TokenOut>(`/team/invites/${id}/accept`, { method: "POST" }),
  decline: (id: number) => api(`/team/invites/${id}/decline`, { method: "POST" }),
  remove: (accountId: number) => api(`/team/members/${accountId}`, { method: "DELETE" }),
  leave: () => api<TokenOut>("/team/leave", { method: "POST" }),
};

/** 주변 소식 한 줄 — 화면과 에이전트가 같은 것을 읽는다.
 *  날짜는 `on_date`(정확)와 `on_year`(연도만)가 **따로다.** 합쳐서 쓰면
 *  「2025년」이 2025-01-01 로 굳는다 — 고시일자가 있는 것은 일부뿐이다. */
export interface AreaEvent {
  id: number; kind: string; name: string | null;
  on_date: string | null; on_year: number | null;
  gosi_no: string | null; body: string | null;
  source: string; source_url: string | null;
  /** 해시태그 — 보도자료만 있다(주제·구·동·역·도로). 다른 원천은 빈 배열 */
  tags: string[];
  /** 지도 아이콘 자리(면이면 면 안의 점) */
  lng: number | null; lat: number | null;
}
/** 소식 한 줄 — 서울 전체. 주변 소식과 **같은 낱말**을 쓴다(갈래·날짜·출처).
 *  다른 것은 `located` 하나뿐이다 — 자리를 아는 줄만 주변 소식에 선다. */
export interface NewsItem extends Omit<AreaEvent, "id" | "lng" | "lat"> {
  src_table: string; src_key: string | null;
  /** 자리를 아는가. false 면 이 목록에만 서고 건물 반경엔 안 선다 */
  located: boolean;
}
export const newsApi = {
  list: (p?: { kind?: string; q?: string; year?: number; years?: number; tag?: string; limit?: number; cursor?: string }) => {
    const s = new URLSearchParams();
    if (p?.kind) s.set("kind", p.kind);
    if (p?.q) s.set("q", p.q);
    if (p?.year) s.set("year", String(p.year));
    if (p?.years) s.set("years", String(p.years));
    if (p?.tag) s.set("tag", p.tag);
    if (p?.limit) s.set("limit", String(p.limit));
    if (p?.cursor) s.set("cursor", p.cursor);
    const qs = s.toString();
    return api<{ items: NewsItem[]; next: string | null; kinds: string[] }>(
      `/news${qs ? `?${qs}` : ""}`);
  },
};

/** 검색 지도의 소식 핀 한 점 — 갈래·이름·출처로 화면이 아이콘을 정한다(eventIcon) */
export interface NewsPin { id: number; kind: string; name: string | null; source: string; source_url: string | null; on_date: string | null; on_year: number | null; lng: number; lat: number }
export const newsItemApi = {
  /** 지도 핀(area_event id) 하나를 소식 탭 모양으로 */
  get: (id: number) => api<{ item: NewsItem | null }>(`/news/item?id=${id}`),
};
export const newsPinsApi = {
  inBox: (b: { minlng: number; minlat: number; maxlng: number; maxlat: number }, years = 1) =>
    api<{ items: NewsPin[]; truncated: boolean }>(
      `/news/pins?minlng=${b.minlng}&minlat=${b.minlat}&maxlng=${b.maxlng}&maxlat=${b.maxlat}&years=${years}`),
};
export const eventsApi = {
  /** 주변 소식 — 지번 둘레(10-08) */
  list: (pnu: string, p?: { radius?: number; kind?: string; years?: number }) => {
    const q = new URLSearchParams();
    if (p?.radius) q.set("radius", String(p.radius));
    if (p?.kind) q.set("kind", p.kind);
    if (p?.years) q.set("years", String(p.years));
    const s = q.toString();
    return api<{ items: AreaEvent[]; radius: number }>(
      `/parcels/${pnu}/events${s ? `?${s}` : ""}`);
  },
};

/** 업체 원장 한 줄(LOCALDATA 인허가 + 소상공인 상가정보 합본). 층을 모르면 floor=null */
export interface Tenant {
  name: string; floor: string | null; area: number | null;
  biz: string | null; phone: string | null;
  /** 카카오에서 온 것은 화면에서만 붙는다(저장 안 함) */
  url?: string | null;
  /** 업종 나무(조상까지) — 크롤링 업체만(master.biz.cat_nodes). 원장으로 대신한 건물은 없다 */
  cat_nodes?: string[] | null;
}
/** 층별 정보(건물 상세)의 층 하나 — 대장과 원장만(2026-09-26 나눔). 팀 값은 임대 내역에 */
/** 대장 호실(전유부) — 집합건물만. **참조다.** 등기 단위라 실제 칸막이와 다를 수 있고,
 *  업체를 호실에 이을 자료가 없어(인허가엔 호 칸이 없다) 팀 줄과 맞추지 않는다. */
export interface LedgerRoom { excl_area: number; common_area: number | null }
export interface FloorGroup {
  floor: string; floor_area: number | null;
  uses: string[];           // 대장 층별개요 용도 — 업체가 없는 층도 무엇이 있는지는 안다
  rooms: LedgerRoom[];      // 대장 전유부. 빈 목록이면 전유부가 없는 건물(일반건물)
  ledger: Tenant[];
}
/** 임대 내역의 층 하나(0185) — 대장 층 뼈대 위에 팀 호실 줄. 층 머리 값(바닥면적·공실·월임대·추정)은 뺐다(2026-09-27) */
export interface LedgerFloor { floor: string; units: FloorRent[] }

/** 입주 이력 한 줄(2026-09-25) — LOCALDATA. 임대료는 없다. 「영업」은 신고상 상태다 */
export interface TenancyStint {
  name: string; biz: string | null; floor: string | null; area: number | null;
  open_on: string | null; close_on: string | null; state: string;
  /** 카카오에서 확인됐나. 인허가 「영업」만으로는 지금 있는지 모른다(2026-09-25 대표) */
  now: boolean;
}
export const historyApi = {
  get: (pk: string) => api<{ items: TenancyStint[]; ecommerce: number }>(`/buildings/${pk}/floors/history`),
};

export const rentsApi = {
  /** 층별 임대정보 **하나로** — 예전엔 층별개요·업체 원장·카카오·층별임대 넷을 받아 화면이 합쳤다.
   *  items·total 은 예전 /floor-rents 와 같은 모양이라 합계·되돌리기가 그대로 읽는다 */
  /** 임대 내역(내 매물) — 대장 층 위에 팀 호실 줄. total 의 돈은 돈 적힌 줄의 합, 공실면적은 매물 줄과 같은 함수 */
  /** pk = 매물 지번의 동 하나 · lid = 매물(임대 줄은 (매물, 동)마다 · 0255) */
  list: (pk: string, lid: number) => api<{ items: FloorRent[]; floors: LedgerFloor[]; unknown: FloorRent[];
    total: { deposit: number | null; rent: number | null; maintenance: number | null; vacant_area: number | null } }>(
    `/buildings/${pk}/floor-rents?listing_id=${lid}`),
  /** 층별 정보(건물 상세) — 대장과 원장 업체만 */
  info: (pk: string) => api<{ floors: FloorGroup[]; unknown: Tenant[] }>(`/buildings/${pk}/floors`),
  /** id 가 있으면 그 줄을 고친다. 호실이 빈 줄은 한 층에 여럿이라 (층, 호실)로는 못 집는다(0160) */
  /** 초기화 — 팀 줄을 다 지우고 원장 업체를 다시 복사(첫 상태) */
  reset: (pk: string, lid: number) => api<{ ok: boolean; seeded: number }>(`/buildings/${pk}/floor-rents/reset?listing_id=${lid}`, { method: "POST" }),
  upsert: (pk: string, lid: number, r: FloorRent) =>
    api<{ ok: boolean; id: number }>(`/buildings/${pk}/floor-rents?listing_id=${lid}`, { method: "PUT", body: JSON.stringify(r) }),
  del: (pk: string, lid: number, id: number) =>
    api(`/buildings/${pk}/floor-rents/${id}?listing_id=${lid}`, { method: "DELETE" }),
};

/** 임대시세 지도 핀(0212) — 건물 하나에 값 하나, 그 건물의 가장 최근 수집일.
 *  v = 고른 층 무리 공간들의 ㎡당 월세 가운데 값(원), n = 공간 수 */
export type MarketPinDTO = { pnu: string; addr: string; lng: number; lat: number; land_area: number | null;
  total_area: number | null; main_use_name: string | null; n: number; v: number | null; observed_on: string | null };
export const marketApi = {
  /** 조건: { floor, elev, use } */
  pins: (kind: "rent", b: [number, number, number, number], o: Record<string, string> = {}) =>
    api<MarketPinDTO[]>(`/market/pins?${new URLSearchParams({ kind, minlng: String(b[0]), minlat: String(b[1]),
      maxlng: String(b[2]), maxlat: String(b[3]), ...o })}`),
  nearby: (b: { center_lat: number; center_lng: number; radius_m: number; pnu?: string; polygon?: object | null; floors?: string[];
                sale_years?: number; sale_price_min?: number | null; sale_price_max?: number | null;
                /** 유사 기준(10-01) — 주용도 부분일치 · 같은 용도지역 · 같은 지목 */
                use_like?: string | null; use_zone?: string | null; jimok?: string | null }) =>
    // 매각 사례만(감사 2026-09-17). 임대 comps 는 임대 탭·보고서가 따로 낸다
    api<{ sales: Record<string, unknown>[]; radius_m: number }>("/market/nearby", { method: "POST", body: JSON.stringify(b) }),
};

export interface EnumOpt { code: string; label: string; tier: string | null }

export const metaApi = {
  enums: () => api<Record<string, EnumOpt[]>>("/enums"),
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
  /** 계약 날짜 · 중도금(0222) — 짝 칸. 예전엔 일정 줄이 그릇 */
  contract_on?: string; mid_on?: string; mid_amount?: number; balance_on?: string;
  clear?: string[]; /** 되돌리기 — 이 필드들을 비운다(서버 화이트리스트) */
}
export const dealApi = {
  patch: (pid: number, body: DealPatch) =>
    api(`/proposals/${pid}/deal`, { method: "PATCH", body: JSON.stringify(body) }),
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
  /** 고객 성격(S09 · 0214) — 중개사가 쓰던 고객 엑셀 열. 목표 · 건축의사 · 매수 시기 · 이해도 · 광고 매물 선호 · 빌탐정 계정 */
  goal?: string[] | null; build_intent?: "있음" | "없음" | "모름" | null; timing?: CustomerTiming | null;
  experience?: "처음" | "보유 경험" | null; regions?: string[] | null; prefer_ad?: boolean | null; account_id?: number | null;
  /** 희망매매가(원, 0216) — 그 사람의 형편. 조건의 매매가(검색 범위)와 따로 */
  budget_min?: number | null; budget_max?: number | null;
  /** 희망매매가 상관없음(0217) — 빈칸(모름)과 다르다 */
  budget_any?: boolean | null;
  /** 리스트 칩용 — 이 사람의 제안 중 가장 앞선 관계 상태(파생·2026-08-16) */
  top_status?: string | null;
  conditions: BuyerCondition[];
  assignee_account_id: number | null; active_proposals: number; updated_at: string;
}
export interface Proposal {
  terms?: string | null;   /** 조건 협의 — 특약 원문(0097) */
  brief_how?: string[] | null;  /** 브리핑 어디서(0123·복수) */
  brief_note?: string | null;   /** 브리핑 무엇을(0123) */
  picked_at?: string | null;    /** 채택 시각(0113) — 이 사람과 간다. 가격도 같이 확정된다 */
  /** 계약 날짜 · 중도금(0222) — 짝 칸. 일정은 매물 · 짝에 영향을 주지 않는다 */
  contract_on?: string | null; mid_on?: string | null; mid_amount?: number | null; balance_on?: string | null;
  /** 오간 값(2026-08-19) — 매도가 부른 값 · 매수가 부른 값이 번갈아. 최근 6개 */
  price_log?: { side: string | null; price: number; on: string }[] | string | null;
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
  id: number; buyer_id: number; listing_id: number; pnu: string | null; updated_at: string;
  /** 죽은 짝(옛 철회·계약파기). 살아 있으면 null */
  dropped_at?: string | null;
  note: string | null;
  buyer_name: string; buyer_grade: string | null;
  addr: string | null; land_area: number | null; total_area: number | null; use_zone: string | null;
  price: number | null;   /** 매매가(0224) — 보이는 것 가운데 가장 싼 값. 추정가를 섞지 않는다 */
  hope_price: number | null;   /** 매수희망가(0064) — 이 매수자가 이 건물을 사고 싶은 값 */
  deal_price: number | null;   /** 거래가(0069) — 계약으로 합의된 값 */
  /** 카드에서 값 판단을 하려면 기준이 같이 있어야 한다 — 배치(master.parcel_sale_est · 지번)에서 온다 */
  sale_est: number | null; vs_est_pct: number | null;
  roi: number | null; photo_id: number | null;
  /** 연임대(마스터 추정·원) — 투자 시뮬의 수입 쪽(0133). roi 로 되돌려 곱하면 반올림이 섞인다 */
  annual_rent?: number | null;
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

/** 추천 한 줄의 근거 — 축마다 「원하는 값 / 이 매물 값」. 점수는 줄 세우는 데만 쓴다. */
export interface RecoCheck { label: string; ok: boolean; want: string; got: string }
export interface RecoListing {
  pnu: string; building_pk: string | null; listing_id: number | null; addr: string | null; price: number | null; roi: number | null;
  land_area: number | null; total_area: number | null;
  mine: boolean; score: number; cond_name: string | null; taken: boolean; checks: RecoCheck[];
}
export interface RecoBuyer {
  id: number; name: string; grade: string | null; phone: string | null;
  score: number; has_condition: boolean; cond_name: string | null; taken: boolean; checks: RecoCheck[];
}

export const buyersApi = {
  list: () => api<Buyer[]>("/buyers"),
  /** 조건 기반 추천(2026-08-20) — O/X가 아니라 **얼마나 맞나**로 줄을 세운다.
   *  대상은 전 서울이고, 내 매물이면 mine 표식이 붙는다(담기 창이 읽는다). */
  recommend: (bid: number, limit = 20) =>
    api<{ needs_condition: boolean; items: RecoListing[] }>(`/buyers/${bid}/recommend?limit=${limit}`),
  recommendBuyers: (lid: number, limit = 20) =>
    api<{ items: RecoBuyer[] }>(`/listings/${lid}/recommend-buyers?limit=${limit}`),
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
  list: (p: { buyer_id?: number; listing_id?: number } = {}) => {
    const q = new URLSearchParams();
    if (p.buyer_id) q.set("buyer_id", String(p.buyer_id));
    if (p.listing_id) q.set("listing_id", String(p.listing_id));
    return api<Proposal[]>(`/proposals${q.toString() ? `?${q}` : ""}`);
  },
  /** 같은 (매수자, 매물)이면 새로 만들지 않고 그 행을 갱신한다 — 중복은 구조로 막혀 있다. */
  upsert: (b: { buyer_id: number; listing_id: number; note?: string }) =>
    api<{ id: number }>("/proposals", { method: "POST", body: JSON.stringify(b) }),
  update: (id: number, patch: Record<string, unknown>) =>
    api<{ ok: true; contact_id: number | null }>(`/proposals/${id}`,
      { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: number) => api(`/proposals/${id}`, { method: "DELETE" }),
};

/** 「오늘」 — 공이 누구에게 있나(턴). 모든 건은 셋 중 하나:
 *  내 차례(지금 움직일 것) · 기다리는 중(상대 차례) · 시작해볼 곳(아직 아무도 안 움직임).
 *  기다리다 기한이 지나면 그 건은 스스로 내 차례로 올라온다. */

/** 매도자 — 업무탭(listings)의 같은 행을 사람 관점으로. 수정은 기존 listings.patchBiz 재사용. */
export interface Seller {
  /** 매물 번호 · 대표 지번(0255). building_pk = 그 지번의 대표 동(동 카드 · 임대 내역을 열 때만). 나대지면 null */
  listing_id: number; pnu: string; building_pk: string | null; owner_id: number | null; addr: string | null;
  owner_name: string | null; owner_phone: string | null; phone_masked?: boolean;
  owner_type: string | null; relation: string | null;
  /** 계약서 인적사항(0128) — 주민등록번호는 어디에도 저장하지 않는다 */
  owner_addr?: string | null; owner_rep_name?: string | null;
  owner_corp_no?: string | null; owner_nationality?: string | null;
  cooperation: string | null; kindness: string | null; intent: string | null;
  urgency: string | null;
  assignee_account_id: number | null; updated_at: string;
  land_area: number | null; total_area: number | null;
  listing_no: string | null; received_on: string | null;
  deal_price: number | null;   /** 거래가 — 계약 상태 제안의 합의값(파생) */
  ask_price: number | null;   /** 매도희망가 — S02 가격 협의와 같은 오버레이(ask_price) */
  list_price?: number | null;  /** 이 매물의 매매가(0226) */
  est_price?: number | null;   /** 빌탐정 추정가 — 산식(마스터) */
  photo_id: number | null;
  photo_n?: number | null;   /** 자료 창의 파생 상태(정본=건물 상세) */
  photo_kinds?: Record<string, number> | string | null;   /** 종류별 사진 수(jsonb) */
  meongdo?: string | null; use_change?: string | null; myeolsil?: string | null;
  nohudo?: string | null; ipji?: string | null;
  /** 매물 표(0182) — 분류(여럿)·등급·전속·확인일(사람이 쓴 마지막 기록일)·층수 */
  building_major?: string | null;
  price_vs_market?: string | null;   /** 시세대비(0187) — 저렴·적정·비쌈 */
  building_use?: string[] | null; grade?: string | null; exclusive?: boolean | null;
  checked_on?: string | null; floors_above?: number | null; floors_below?: number | null;
  /** 광고 기본정보의 정본(0209) — 융자금 · 융자 표시 · 입주가능일 */
  loan?: number | null; loan_open?: boolean | null; move_in?: "즉시입주" | "협의" | "날짜" | null; move_in_on?: string | null;
  total_deposit?: number | null; total_rent?: number | null; total_mgmt?: number | null;
  vacant_area?: number | null; rent_full?: number | null;
  /** 이 매물의 매매가로 낸 값(0226) — 대지 평단가 · 수익률 · 만실 수익률 */
  pp_land?: number | null; roi?: number | null; roi_full?: number | null;
  sell_on?: string | null; sell_vague?: string | null;   /** 매도 시기(0099) — 원함인 채의 정보 */
  rent_n?: number | null;      /** 임대내역 요약(정본=건물 상세) */
  rent_check?: string | null;   /** 임대내역 확인 상태(0100) — null=안 받음 · 확인중. 받았다=파생 */
  owner_buyer_id?: number | null;  /** 소유자가 매수자 명단에도 있나(전화 일치) */
  last_on: string | null; last_kind: string | null; last_note: string | null;
  /** 소유자를 잡았나 — 관심(미확보) ↔ 매물(확보)을 가르는 축(2026-08-16) */
  has_owner?: boolean;
  owner_age_band?: string | null; owner_gender?: string | null; owner_note?: string | null;
  call_result?: string | null;   /** 마지막 통화 결과(0090) — 접촉 창·통화 칩이 같이 쓴다 */
  /** 상태(0199) — 사람이 고른다. 미지정이면 null. 완료면 매각일 · 매각금액 */
  status_id?: number | null; status_name?: string | null; status_color?: string | null;
  sold_on?: string | null; sold_price?: number | null;
  hold_reason?: string | null;   /** 보류 사유(0201) — 보류일 때만 */
  /** 살아 있는 광고(0191) — 노출 · 비노출과 기한 */
  ad_state?: "노출" | "비노출" | null; ad_expires?: string | null;
  /** 메모창 글을 이어 붙인 것 — 표 검색용 */
  memo_text?: string | null;
  /** 나대지 매물 — 동이 없는 지번. 건물이 아니라 빈 땅이다 */
  is_vacant?: boolean | null;
}

export const salesApi = {
  sellers: (mine = false, owner_id?: number) =>
    api<Seller[]>(`/sales/sellers?mine=${mine}${owner_id ? `&owner_id=${owner_id}` : ""}`),
  /** 매도자 = 사람 하나(0058). 매수(app.buyers)와 같은 모양이라 화면도 같은 부품을 쓴다. */
  owners: (mine = false) => api<Owner[]>(`/sales/owners?mine=${mine}`),
  /** 한 건물의 두 장부(매수 제안·매도 접촉)를 시간순으로 합쳐 본다 — 읽기 전용 */
  timeline: (lid: number) => api<TimelineRow[]>(`/sales/timeline?listing_id=${lid}`),
};

/** 일정(0070·0071) — 커밋에서 파서가 읽은 약속. 날짜가 떨어지는 것만 선다. */
export interface ScheduleRow {
  id: number; side: "buy" | "sell"; title: string; on_date: string;
  /** HH:MM:SS — null 이면 시간 미정(0073) */
  at_time: string | null;
  hint: string | null; listing_id: number | null; proposal_id: number | null;
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
    category?: string | null; method?: string | null; listing_id?: number | null;
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

/** 매도자 → 매수자 명단(0098) — 전화번호로 중복 방지. 이미 있으면 그 사람을 돌려준다 */
export const convertApi = {
  ownerToBuyer: (lid: number) =>
    api<{ buyer_id: number; created: boolean }>(`/listings/${lid}/owner-to-buyer`, { method: "POST" }),
  /** 전환 취소 — 명단에서 내린다(소프트 삭제) */
  ownerFromBuyer: (lid: number) =>
    api<{ buyer_id: number }>(`/listings/${lid}/owner-to-buyer`, { method: "DELETE" }),
};

/** 호가판(2026-08-19) — 값의 시간 흐름. 매도 쪽과 매수자별 값이 같은 축에 선다 */
export interface OfferBoard {
  sell: { id: number; field: string; value: string | null; created_at: string }[];
  buys: { proposal_id: number; event_id: number; field: string; value: string | null; created_at: string }[];
}
/** 계약 문서(0128) — 종류별 한 판. body에 서식 칸 전체(주민등록번호 없음 — 서버가 마스킹). */
export const papersApi = {
  get: (pid: number) => api<Record<string, Record<string, unknown>>>(`/proposals/${pid}/papers`),
  put: (pid: number, kind: string, body: Record<string, unknown>) =>
    api(`/proposals/${pid}/papers`, { method: "PUT", body: JSON.stringify({ kind, body }) }),
};

export const boardApi = {
  get: (lid: number) => api<OfferBoard>(`/sales/offer-board?listing_id=${lid}`),
  /** 잘못 기록된 값 하나를 이력에서 뺀다 — src=field(값 이벤트)·prop(제안 이벤트) */
  delEvent: (src: "field" | "prop", id: number) =>
    api(`/sales/offer-events/${src}/${id}`, { method: "DELETE" }),
};

export const contactsApi = {
  /** 사람 장부는 (buyer · owner, 사람 번호), 매물 장부는 ("listing", 매물 번호)(0255) */
  list: (target_type: string, id: string | number) =>
    api<Contact[]>(`/contacts?target_type=${target_type}&${target_type === "listing" ? "listing_id" : "target_id"}=${encodeURIComponent(String(id))}`),
  create: (b: { target_type: string; target_id?: string; listing_id?: number; kind?: string; occurred_on?: string;
    note?: string; status?: string; deal_price?: number;
    /** 문장에서 읽은 매매가·매도희망가(0078) — 서버가 오버레이에 쓰고 스냅샷을 남긴다 */
    list_price?: number; hope_price?: number;
    schedule?: unknown; schedule_op?: unknown }) =>
    api<{ id: number }>("/contacts", { method: "POST", body: JSON.stringify(b) }),
  /** 이 매물에 얽힌 사람들 — 약속 창의 참석자 후보(매도자 1 + 제안 걸린 매수자들) */
  people: (lid?: number | null) =>
    api<{ kind: "owner" | "buyer"; ref_id: number; label: string; sub: string | null }[]>(
      `/sales/people${lid != null ? `?listing_id=${lid}` : ""}`),
  /** 기록 삭제 — 지우면 남은 마지막 기록이 만든 단계로 되돌아간다(매수와 같은 규칙) */
  remove: (id: number) => api(`/contacts/${id}`, { method: "DELETE" }),
};

/* ── 광고(중개사) · 문의 — S05 2묶음(2026-09-28) ── */
export type UseType = "상업용건물" | "상가/사무실" | "단독/다가구" | "연립/다세대" | "오피스텔" | "토지" | "공장/창고" | "숙박시설" | "기타건물";
/** 광고 폼(0195) — 건물 스펙 · 위치 공개는 뺐다(카드 옆에 대장 값이 그대로 뜬다) */
export interface AdForm {
  use_type: UseType | null; brokerage: "일반" | "전속"; price: number | null; price_open: boolean;
  title: string | null; body: string | null; contact_phone: string | null;
  deposit: number | null; monthly_rent: number | null; loan: number | null; loan_open: boolean;
  move_in: "즉시입주" | "협의" | "날짜" | null; move_in_on: string | null;
}
export interface MyAd extends AdForm {
  id: number; state: "임시" | "노출" | "비노출" | "거래완료"; review: string; review_note: string | null;
  posted_on: string; expires_on: string; closed_on: string | null; expired: boolean; photo_ids: number[] | null;
}
export const adsApi = {
  /** 매물의 광고(없으면 null) + 폼 미리 채움 + 계약됐나 */
  ofListing: (lid: number) => api<{ ad: MyAd | null; draft: AdForm; contracted: boolean }>(`/listings/${lid}/ad`),
  /** publish=false 면 임시저장 */
  create: (lid: number, b: AdForm & { photo_ids: number[]; publish: boolean }) =>
    api<{ id: number }>(`/listings/${lid}/ad`, { method: "POST", body: JSON.stringify(b) }),
  update: (id: number, b: AdForm & { photo_ids: number[]; publish: boolean }) =>
    api(`/ads/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  state: (id: number, state: "노출" | "비노출" | "거래완료" | "삭제") =>
    api(`/ads/${id}/state`, { method: "PATCH", body: JSON.stringify({ state }) }),
  extend: (id: number) => api(`/ads/${id}/extend`, { method: "POST" }),
};
export type InquiryKind = "매수 문의" | "매도 문의" | "시세 문의";
export type InquiryStatus = "미확인" | "상담중" | "종료";
/** 받은 문의(S09) — 고객 배경은 문의 순간 사본(profile_snap). 고객이 나중에 프로필을 고쳐도 그대로 */
export interface Inquiry {
  id: number; kind: InquiryKind; body: string | null; name: string; phone: string;
  status: InquiryStatus; sell_addr: string | null; created_at: string; updated_at: string;
  ad_id: number | null; seek_id: number | null; account_id: number; pnu: string | null;
  ad_title: string | null; addr: string; handled_name: string | null;
  profile_snap: Partial<CustomerProfile> | null;
  /** 문의 순간 고객이 프로필에 저장한 조건 사본 · 붙은 우리 고객(고객으로 등록) */
  wants_snap: { name: string; conditions_json: Record<string, unknown> }[] | null;
  buyer_id: number | null; buyer_name: string | null;
  /** 같은 고객 계정이 우리 팀에 보낸 문의 수 · 이 문의의 메모 수 */
  same_n: number; note_n: number;
}
export interface InquiryNote { id: number; body: string; created_at: string; author: string | null }
/* ── 고객 쪽(S05 §5 · §6 · S09) ── 고객이 직접 적는 배경. 모르면 비움 */
export type CustomerTiming = "3개월 안" | "6개월 안" | "1년 안" | "미정";
export interface CustomerProfile {
  /** 칸 이름 · 값은 중개사 고객 기록(Buyer)과 같다(0214) — 고객으로 등록할 때 그대로 옮겨진다 */
  goal: string[] | null; build_intent: "있음" | "없음" | "모름" | null;
  regions: string[] | null; budget_min: number | null; budget_max: number | null;
  budget_any: boolean | null; equity_won: number | null; timing: CustomerTiming | null; experience: "처음" | "보유 경험" | null;
  is_corp: boolean | null; note: string | null;
}
export interface SaveRow {
  id: number; pnu: string | null; ad_id: number | null; memo: string | null; created_at: string; addr: string;
  ad_title: string | null; ad_state: string | null; ad_price: number | null; live_ads: number;
  /** 고객 마이페이지 매물 표(10-04) — 기한 지남 · 대장 면적 · 올린 사무소 · 첫 사진 */
  ad_expired?: boolean | null; land_area?: number | null; total_area?: number | null; office_name?: string | null; photo_id?: number | null;
}
/** 최근 본 매물(30일, ad_views) — 매물 표 한 줄 */
export interface RecentRow {
  ad_id: number; viewed_on: string; pnu: string | null; addr: string; ad_title: string | null; ad_state: string | null;
  ad_expired: boolean | null; ad_price: number | null; land_area: number | null; total_area: number | null;
  office_name: string | null; photo_id: number | null;
}
export interface MyInquiry {
  id: number; kind: string; body: string | null; status: string; created_at: string; pnu: string | null;
  ad_title: string | null; office_name: string | null; addr: string;
}
export const customerApi = {
  profile: () => api<CustomerProfile>("/customer/profile"),
  saveProfile: (b: CustomerProfile) => api<{ ok: boolean }>("/customer/profile", { method: "PUT", body: JSON.stringify({ ...b, goal: b.goal ?? [], regions: b.regions ?? [] }) }),
  saves: () => api<SaveRow[]>("/saves"),
  recent: () => api<RecentRow[]>("/customer/recent"),
  /** 저장은 광고(매물) 단위(0205) — 이 광고를 저장했나 */
  savesOf: (adId: number) => api<{ id: number }[]>(`/saves/ad/${adId}`),
  save: (ad_id: number) => api<{ id: number | null }>("/saves", { method: "POST", body: JSON.stringify({ ad_id }) }),
  unsave: (id: number) => api(`/saves/${id}`, { method: "DELETE" }),
  report: (adId: number, reason: "거래완료" | "표시정보 다름", body: string | null) =>
    api<{ id: number }>(`/ads/${adId}/report`, { method: "POST", body: JSON.stringify({ reason, body }) }),
  myInquiries: () => api<MyInquiry[]>("/inquiries/mine"),
};

/** 구해요 · 관심 정도(S06, 0202) — 목록은 누구나 같다(이름 · 연락처 없이). 가격 칸은 없다 */
export interface SeekRow {
  id: number; pnu: string; note: string | null; state: "열림" | "마감"; cap: number; created_at: string;
  days_left: number; n_prop: number; mine: boolean; our: "보냄" | "채택" | "거절" | null;
  budget_min: number | null; budget_max: number | null; goal: string[] | null;
  addr: string; lng: number; lat: number; sale_est: number | null; land_area: number | null; total_area: number | null;
}
export interface SeekProposal {
  id: number; state: "보냄" | "채택" | "거절"; message: string | null; created_at: string;
  office_name: string | null; agent_name: string | null; listing_id: number | null; listing_addr: string | null;
}
export interface MySeek {
  id: number; pnu: string; note: string | null; state: "열림" | "마감" | "닫힘"; cap: number; created_at: string;
  expires_on: string; days_left: number; addr: string; proposals: SeekProposal[];
}
/** 관심 — 광고(매물)마다 저장한 사람 수 · 오늘 본 사람 수(0205) */
export interface Interest { ad_id: number; saves: number; today: number }
export const seeksApi = {
  /** 조건(검색 요청과 같은 몸통)에 맞는 건물의 열린 구해요 */
  search: (p: { bjd_code?: string | string[]; polygon?: object; filters?: AttrFilters }) =>
    api<SeekRow[]>("/seeks/search", { method: "POST", body: JSON.stringify({
      polygon: p.polygon ?? null, filters: { bjd_code: p.bjd_code ?? null, ...(p.filters ?? {}) } }) }),
  of: (pnu: string) => api<SeekRow[]>(`/seeks/parcel/${encodeURIComponent(pnu)}`),
  add: (pnu: string, note: string | null) =>
    api<{ id: number }>("/seeks", { method: "POST", body: JSON.stringify({ pnu, note }) }),
  mine: () => api<MySeek[]>("/seeks/mine"),
  extend: (id: number) => api(`/seeks/${id}/extend`, { method: "POST" }),
  close: (id: number) => api(`/seeks/${id}`, { method: "DELETE" }),
  propose: (id: number, listing_id: number | null, message: string | null) =>
    api<{ id: number }>(`/seeks/${id}/proposals`, { method: "POST", body: JSON.stringify({ listing_id, message }) }),
  pick: (pid: number, b: { name: string; phone: string; consent: boolean }) =>
    api<{ inquiry_id: number }>(`/proposals/${pid}/pick`, { method: "POST", body: JSON.stringify(b) }),
  reject: (pid: number) => api(`/proposals/${pid}/reject`, { method: "POST" }),
};
export const interestApi = {
  view: (ad_id: number) => api("/views", { method: "POST", body: JSON.stringify({ ad_id }) }),
  of: (adIds: number[]) => api<Interest[]>(`/interest?ads=${adIds.join(",")}`),
};

/** 숨기기(0197 · 0253) — 계정마다 안 보는 지번. 조건과 상관없이 계속 안 보인다 */
export interface HiddenRow { pnu: string; addr: string; created_at: string }
export const hiddenApi = {
  list: () => api<HiddenRow[]>("/hidden"),
  hide: (pnu: string) => api<{ ok: boolean }>("/hidden", { method: "POST", body: JSON.stringify({ pnu }) }),
  unhide: (pnu: string) => api<{ ok: boolean }>(`/hidden/${encodeURIComponent(pnu)}`, { method: "DELETE" }),
  unhideAll: () => api<{ ok: boolean }>("/hidden", { method: "DELETE" }),
};
export const inquiriesApi = {
  send: (b: { ad_id: number; kind: InquiryKind; body?: string | null; name: string; phone: string;
              consent: boolean; sell_addr?: string | null;
              /** 프로필이 비었을 때 폼에서 고르는 세 칸(S09 §2) — 프로필 빈 칸에도 남는다 */
              goal?: string[] | null; budget_min?: number | null; budget_max?: number | null; timing?: CustomerTiming | null }) =>
    api<{ id: number }>("/inquiries", { method: "POST", body: JSON.stringify(b) }),
  list: () => api<Inquiry[]>("/inquiries"),
  count: () => api<{ unread: number }>("/inquiries/count"),
  status: (id: number, status: InquiryStatus) =>
    api(`/inquiries/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  /** 고객으로 등록(S09) — 같은 계정 고객이 있으면 붙이고, 없으면 만들어 문의 당시 배경 · 조건으로 채운다 */
  toCustomer: (id: number) => api<{ buyer_id: number; created: boolean }>(`/inquiries/${id}/customer`, { method: "POST" }),
  notes: (id: number) => api<InquiryNote[]>(`/inquiries/${id}/notes`),
  addNote: (id: number, body: string) => api<{ id: number }>(`/inquiries/${id}/notes`, { method: "POST", body: JSON.stringify({ body }) }),
  delNote: (id: number, nid: number) => api(`/inquiries/${id}/notes/${nid}`, { method: "DELETE" }),
};
