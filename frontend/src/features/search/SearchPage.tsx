import { LoadingOverlay } from "../../shared/ui/Spinner";
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { searchApi, buildingsApi, listingsApi, marketApi, buyersApi, type AttrFilters, type NearbySales } from "../../shared/api/endpoints";
import { openDetail, mergeGeo } from "../../shared/map/geo";
import { MapPanel, MapPin } from "../../shared/map/MapPanel";
import { TradeCompare } from "../building/TradeCompare";
import { FilterModal, activeCount, conditionChips, type Values, type RegionPick } from "./FilterModal";
import { pruneFilters } from "./filterConfig";
import { RoadviewMini } from "../../shared/map/Roadview";
import "./search.css";
import { Icon } from "../../shared/ui/Icon";
import { Segmented } from "../../shared/ui/Segmented";

/** S01 매물 통합검색 — 자동완성 + 지역(구/동) + 3열 목록 + 지도 뷰(핀·영역 그리기) */

interface Hit {
  building_pk: string; addr: string; price: number | null; last_sale_price: number | null; roi: number | null;
  price_is_est?: boolean;   // 매매가가 추정가 대체(팀 매매가 미입력)
  lng: number; lat: number;
  land_area: number | null; floors_above: number | null; floors_below: number | null;
}
interface Col { items: Hit[]; total: number; page: number; pages: number }
interface SearchResult { mine: Col; normal: Col }

const won = (n: number | null) =>
  n == null ? "—" : n >= 1e8 ? `${Math.round(n / 1e8)}억` : `${Math.round(n / 1e4).toLocaleString()}만`;

const PY = 3.3058;                                    // ㎡→평
const py = (m2?: number | null) => (m2 == null ? "—" : (m2 / PY).toFixed(m2 / PY < 100 ? 1 : 0));
const pyl = (m2?: number | null) => (m2 == null ? "—" : `${py(m2)}평`);   // 단위까지(같은 줄에 층수가 붙어서)

/** 지도 선택 매물 요약 카드 — 배치·마스터 즉시값만. 사이드바는 대기 없이 떠야 한다.
 *  수익률은 classified가 총임대료(층별 실측 합계 ?? 직접 입력 총액) × 12 ÷ 값 으로 산출해
 *  핀에 실려옴(picked.roi). 추정 임대는 안 섞는다(0134).
 *  매력도·활용유형도 이제 배치다(0038) — 남은 라이브 계산값(미래가치·사옥적합도)만 리포트에서. */
function SelCard({ picked, bldg, nearby, onDetail, onHide }: {
  picked: MapPin; bldg?: Record<string, unknown>; nearby?: NearbySales;
  onDetail: () => void;
  /** 접어두기 — 목록 줄에만 있던 것을 여기에도 둔다(2026-08-29).
   *  고르고 나서야 「아니네」가 판가름 나는데, 그때 목록으로 되돌아가 그 줄을 다시
   *  찾아 호버해야 했다. 판단이 난 자리에서 접을 수 있어야 한다. */
  onHide: () => void;
}) {
  const num = (k: string) => (bldg && bldg[k] != null ? Number(bldg[k]) : null);
  const land = num("land_area") ?? picked.land_area ?? null;
  const total = num("total_area");
  const fa = num("floors_above") ?? picked.floors_above ?? null;
  const fb = num("floors_below") ?? picked.floors_below ?? null;
  const fair = picked.sale_est ?? null;   // 추정가=배치값만(핀에 이미 실림) → 즉시. 매매가와 구분.
  const eok1 = (v: number | null) => v == null ? "—" : v >= 1e8 ? `${(v / 1e8).toFixed(0)}억` : `${Math.round(v / 1e4).toLocaleString()}만`;
  // 본매물 막대는 **실거래가 있으면 실거래**, 없으면 추정가다(2026-08-28).
  // 예전엔 늘 추정가였는데 「주변 실거래」 제목 아래 서 있어 이 건물 실거래로 읽혔다.
  // 실거래가 아예 없는 건물(삼성동 78)에서 값이 뜨니, 상세에 들어가면 실거래 탭이 비어 있었다.
  const realPer = picked.last_sale_price && total
    ? Math.round(picked.last_sale_price / (total / 3.305785)) : null;
  const estPer = fair && total ? Math.round(fair / (total / 3.305785)) : null;

  return (
    <div className="sel-card">
      {picked.lng && picked.lat
        ? <RoadviewMini lng={picked.lng} lat={picked.lat} className="sel-road" />
        : <div className="sel-road" />}
      <div className="sel-body">
        <div className="sel-addr">{picked.addr.replace("서울특별시 ", "").replace("번지", "")}
          <span className={`ml-tag ${picked.col}`}>{picked.col === "mine" ? "내" : "일반"}</span>
        </div>
        {/* 건물 상세 머리줄과 **같은 문법**이다(2026-08-27) — 고르는 화면과 여는 화면이
            같은 값을 같은 얼굴로 보여야, 눌러 들어갔을 때 「그 건물이 맞나」를 다시 안 센다.
            값은 추정 짝(연파랑)과 실측 짝(회색)으로 가른다: 추정가·추정 수익률은 둘 다
            시스템이 낸 값이고, 매매가·수익률은 둘 다 팀이 아는 값이다. 섞지 않는다. */}
        <div className="sel-pills">
          <span className="hd-grp est">
            <span className="pill"><i>빌탐정 추정가</i><b>{eok1(fair)}</b></span>
            <span className={`pill ${picked.roi_est != null ? "" : "off"}`}><i>추정 수익률</i>
              <b>{picked.roi_est != null ? `${picked.roi_est}%` : "—"}</b></span>
            <em className="hd-badge">추정</em>
          </span>
          {/* 실측 짝 — 팀 매매가가 없으면(price_is_est) 짝 전체를 비운다.
              price 는 매매가가 없을 때 추정가로 대체되고, 백엔드 roi 도 그 대체값을 분모로 쓴다.
              그대로 쓰면 추정 분모가 실측 자리로 새어 들어온다 — 그래서 매매가가 있을 때만 센다. */}
          {(() => {
            const hasPrice = picked.price_is_est === false && !!picked.price;
            return (
              <span className="hd-grp real">
                <span className={`pill ${hasPrice ? "" : "off"}`}><i>매매가</i>
                  <b>{hasPrice ? eok1(picked.price) : "—"}</b></span>
                <span className={`pill ${hasPrice && picked.roi != null ? "" : "off"}`}><i>수익률</i>
                  <b>{hasPrice && picked.roi != null ? `${picked.roi}%` : "—"}</b></span>
              </span>
            );
          })()}
          <span className="pill"><i>대지</i><b>{pyl(land)}</b></span>
          <span className="pill"><i>연면적</i><b>{pyl(total)}</b></span>
          <span className="pill"><i>층수</i>
            <b>{fb ? `B${fb}/` : ""}{fa != null ? `${fa}F` : "—"}</b></span>
          {num("score") != null && (
            <span className="pill"><i>매력도</i>
              <b>{Math.round(num("score")!)}{bldg?.grade ? ` ${bldg.grade}` : ""}</b></span>
          )}
        </div>
        {/* 실거래 비교 — 건물 상세 실거래 탭과 **같은 부품**을 쓴다(2026-08-28).
            같은 컴포넌트라 두 화면의 값이 어긋날 수 없다. */}
        <TradeCompare title="실거래" note="실거래가 · 평당"
          near={{ price: nearby?.median_price ?? null, per: nearby?.median_per_area ?? null }}
          mine={{ price: picked.last_sale_price ?? null, per: realPer }}
          est={{ price: fair, per: estPer }} />
        <div className="sel-acts">
          <button className="sel-detail" onClick={onDetail}>상세보기 →</button>
          <button className="sel-hide" title="이 조건에서 접어두기" onClick={onHide}>
            <Icon name="hide" size={14} />접어두기</button>
        </div>
      </div>
    </div>
  );
}

// 라벨이 곧 조건 키다 — 낱말을 통일한 판(2026-08-27)이라 옛 세션은 버린다.
// 서버는 extra=forbid 라 옛 키가 남아 있으면 검색 전체가 422 로 죽는다 — 판이 바뀌면 키를 올린다.
// v4(2026-08-28): 유동인구 등급 다섯 칸(float_pops)→실측 명수(pop_day_min/max),
//   등급·입지·건물용도(grades·ipjis·building_uses) 필터 폐지, 접어둠(hidden) 추가.
//   v3 때 이 주석만 고치고 키를 안 올려 옛 조건이 그대로 남았고, 검색이 통째로 422 였다.
const SESSION_KEY = "s01_search_state_v4";
// 옛 판 스냅샷은 지운다 — 안 지우면 세션마다 죽은 조건이 쌓인다.
try { for (const k of Object.keys(sessionStorage)) if (k.startsWith("s01_search_state_") && k !== SESSION_KEY) sessionStorage.removeItem(k); } catch { /* 사파리 사생활 모드 */ }

/** 영업 탭에서 "지도에서 열기"로 넘어온 매수자 조건. 지도·필터·그리기로 다듬고 그 자리에서 되저장한다.
 *  조건 편집을 모달로만 두면 지도가 없어 영역 그리기를 쓸 수 없다. */
type BuyerCondNav = {
  buyer_id: number; buyer_name: string; cond_id: number | null; name: string;
  conditions: { values?: Values; regions?: RegionPick[]; polygon?: object | null; filters?: AttrFilters };
};

export function SearchPage() {
  const loc = useLocation();
  const nav2 = useNavigate();
  const [bc] = useState<BuyerCondNav | null>(() => (loc.state as { buyerCond?: BuyerCondNav } | null)?.buyerCond ?? null);
  /** 조건을 **적용만** 하고 열 때(매수자 명함의 조건 클릭·저장조건 불러오기·2026-08-16).
   *  편집 바(BuyerCondBar)는 안 뜬다 — 보러 온 사람에게 저장 창을 들이밀지 않는다. */
  const [ac] = useState<{ values?: Values; regions?: RegionPick[]; polygon?: object | null;
    filters?: AttrFilters } | null>(
    () => (loc.state as { applyCond?: Record<string, unknown> } | null)?.applyCond as never ?? null);
  const pre = bc?.conditions ?? ac;
  // 세션 유지: 검색 조건·뷰·페이지를 sessionStorage에 저장 → 상세 다녀오거나 새로고침해도 복원(S01 [MVP])
  const [saved] = useState<Record<string, unknown>>(() => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "{}"); } catch { return {}; }
  });
  const [q, setQ] = useState((saved.q as string) ?? "");
  const [active, setActive] = useState(-1);
  const [priceMode, setPriceMode] = useState<"fair" | "real">((saved.priceMode as "fair" | "real") ?? "fair");   // 핀 태그 가격
  // 실거래를 지도에서 견주는 눈금(밸류맵식). **기본은 대지면적 · 평**이다 — 연면적이 아니다.
  const [realBasis, setRealBasis] = useState<"total" | "land" | "bldg">((saved.realBasis as any) ?? "land");
  const [realUnit, setRealUnit] = useState<"py" | "m2">((saved.realUnit as any) ?? "py");
  const [saleYears, setSaleYears] = useState<number>((saved.saleYears as number) ?? 0);   // 0 = 전체
  // 그린 영역은 여러 개 쌓인다 — 예전엔 단일 객체라 새로 그리면 앞의 것이 사라졌다.
  // 서버로는 mergeGeo로 MultiPolygon 하나로 합쳐 보낸다(서버는 손댈 것이 없다).
  const [polygons, setPolygons] = useState<object[]>(
    pre ? (pre.polygon ? [pre.polygon] : []) : ((saved.polygons as object[]) ?? []));
  const polygon = mergeGeo(polygons);
  const [picked, setPicked] = useState<MapPin | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);   // 지도만 보고 싶을 때 접는다
  const [centerReq, setCenterReq] = useState<{ lng: number; lat: number; zoom?: number } | null>(null);  // 지도 중심 이동 요청
  // 정렬은 추정가순 하나다(2026-08-27) — 수익률순은 값이 있는 매물이 적어 줄이 거의 안 바뀌었다
  const [sort] = useState((saved.sort as string) ?? "price");
  // 매수자 조건을 싣고 왔으면 **그 조건만** 쓴다. 세션에 남아 있던 검색 조건이 섞이면
  // 새 조건을 만드는데 남의 조건이 미리 들어차 있고, 그대로 저장되면 잘못된 조건이 박힌다.
  // pruneFilters — 저장해 둔 조건은 지난 판 낱말을 들고 있다. 그대로 서버로 보내면
  // extra=forbid 에 걸려 검색이 통째로 422 로 죽는다(2026-08-28 실측).
  const [filters, setFilters] = useState<AttrFilters>(
    pruneFilters(pre ? pre.filters : saved.filters));
  /** 팀이 넣은 값으로 거르고 있나(2026-08-27).
   *  매매가·총임대료·상태 같은 조건은 담은 매물에만 있어서, 걸면 결과가 내 매물로 좁혀진다.
   *  처음 쓰는 사람이 「매매가 100억 이하」를 걸고 0건을 보면 필터가 고장난 줄 안다 —
   *  0건이 아니라 **무엇 중에 0건인지**를 말해야 그 오해가 안 생긴다. */
  const teamKeys = ["price_min", "price_max", "roi_min", "roi_max",
    "deposit_total_min", "deposit_total_max", "rent_total_min", "rent_total_max",
    "mgmt_total_min", "mgmt_total_max", "roi_exvac_min", "roi_exvac_max", "vacant",
    "pp_land_team_min", "pp_land_team_max", "pp_total_team_min", "pp_total_team_max",
    "gongsi_ratio_team_min", "gongsi_ratio_team_max",
    "urgencies", "meongdos", "use_changes", "myeolsils",
    "owner_types", "relations", "cooperations", "kindnesses", "assignees",
    "owner_name", "listing_no", "received_from", "received_to", "intent", "has_phone", "has_photo"];
  const byTeam = teamKeys.some((k) => {
    const v = (filters as Record<string, unknown>)[k];
    return v != null && (!Array.isArray(v) || v.length > 0);
  });

  const [fValues, setFValues] = useState<Values>(
    pre ? (pre.values ?? {}) : ((saved.fValues as Values) ?? {}));
  const [fRegions, setFRegions] = useState<RegionPick[]>(
    pre ? (pre.regions ?? []) : ((saved.fRegions as RegionPick[]) ?? []));
  /** 접어둔 건물 — 「봤는데 필요 없다」(2026-08-28).
   *  건물에 붙이지 않고 **조건에 붙인다.** 같은 건물도 조건이 바뀌면 다시 볼 값이고,
   *  매수자 조건에서 접었다면 「이 사람 것은 아니다」라는 뜻이지 「없는 건물」이 아니다.
   *  그래서 저장 조건과 한 몸으로 다니고, 서버에 따로 보관하지 않는다.
   *
   *  **문자열이다**(2026-08-29). building_pk 는 최장 22자리 text 인데 숫자로 바꿔 다뤘더니
   *  자바스크립트가 16자리에서 정밀도를 잃어(1e21) 서버가 422 를 내고 **검색이 통째로**
   *  사라졌다. 11,270동이 해당했다. 키는 원래 생긴 대로 다룬다.
   *
   *  **거르는 것도 화면이 한다.** 질의 조건으로 두니 접을 때마다 전체를 다시 불러와
   *  지도가 초기화됐다. 이미 받은 목록에서 빼면 그만이다. */
  const [hidden, setHidden] = useState<string[]>(
    pre ? ((pre as { hidden?: string[] }).hidden ?? []).map(String)
        : ((saved.hidden as string[]) ?? []).map(String));
  const [showFilter, setShowFilter] = useState(false);
  const [pages, setPages] = useState<{ mine: number; normal: number }>((saved.pages as { mine: number; normal: number }) ?? { mine: 1, normal: 1 });

  // 조건 변경 시 스냅샷 저장(전환·새로고침 복원용)
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ q, priceMode, realBasis, realUnit, saleYears, polygons, sort, filters, fValues, fRegions, pages, hidden }));
  }, [q, priceMode, realBasis, realUnit, saleYears, polygons, sort, filters, fValues, fRegions, pages, hidden]);
  const bjd = fRegions[0]?.bjd_code ?? "";                       // 단일지역(멀티는 백엔드 확장 예정)
  const filterCount = activeCount(fValues, fRegions);
  const resetPages = () => setPages({ mine: 1, normal: 1 });

  // 자동완성 디바운스(180ms) — 타이핑마다 요청하지 않음(§3.1a 속도)
  const [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 180); return () => clearTimeout(t); }, [q]);
  const suggest = useQuery({
    queryKey: ["suggest", dq],
    queryFn: () => searchApi.suggest(dq),
    enabled: dq.length > 0,
    placeholderData: (prev) => prev,   // 새 결과 오기 전 이전 목록 유지(깜빡임 제거)
  });
  // 지역도 영역도 없으면 = 첫 화면. 빈 화면 대신 내 매물을 보여준다 —
  // 로그인하고 들어와서 지역을 고르기 전까지 아무것도 안 뜨는 게 제일 큰 불만이었다.
  // 팀이 넣은 값으로 거를 때도 내 매물만 본다(2026-08-27) — 남의 건물엔 매매가도 총임대료도
  // 상태도 없어서 「일반」 열이 뜰 이유가 없다. 조건을 지우면 저절로 두 열로 돌아간다.
  const mineOnly = (!bjd && !polygon) || byTeam;
  // 영역(폴리곤)이 있으면 지역범위 대체(S01 §3.6c)
  const result = useQuery<SearchResult>({
    queryKey: ["search3", bjd, polygon, sort, filters, pages, mineOnly],
    queryFn: () =>
      searchApi.list({
        bjd_code: polygon ? undefined : bjd || undefined,
        polygon: polygon ?? undefined, filters, sort, mine_only: mineOnly,
        page_mine: pages.mine, page_normal: pages.normal,
      }) as Promise<SearchResult>,
  });
  // 지도 핀 — 리스트는 페이징하되 지도엔 조건에 맞는 '전체' 매물을 표시(페이징 없음)
  const mapPins = useQuery<MapPin[]>({
    queryKey: ["mapPins", bjd, polygon, sort, filters, mineOnly],
    queryFn: () => searchApi.pins({
      bjd_code: polygon ? undefined : bjd || undefined,
      polygon: polygon ?? undefined, filters, sort, mine_only: mineOnly,
    }) as Promise<MapPin[]>,
    placeholderData: (prev) => prev,   // 조건이 바뀌어도 옛 핀을 들고 있는다 — 지도가 안 비워진다
  });
  // 접어둔 것은 **여기서** 뺀다. 지도도 목록도 같은 목록을 보므로 한 곳에서 거른다.
  const hideSet = new Set(hidden);
  const mapPinList = (mapPins.data ?? []).filter((p) => !hideSet.has(p.building_pk));
  // 거래 시기 거르기 — **목록에서 빼지 않는다.** 건물은 그대로 있고 견줄 실거래만 없는 것이라
  // 값을 지워 회색 점으로 세운다. 목록에서 빼면 검색 결과가 지도 눈금 따라 흔들린다.
  const ymCut = saleYears
    ? (() => { const d = new Date(); d.setFullYear(d.getFullYear() - saleYears);
               return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`; })()
    : null;
  const mapPinsShown = (priceMode === "real" && ymCut)
    ? mapPinList.map((p) => (p.last_sale_ym && p.last_sale_ym >= ymCut ? p : { ...p, last_sale_price: null }))
    : mapPinList;
  // 내 매물이 늘 먼저 선다 — 값순 안에서 담당 매물만 위로 올린다(2026-08-28 회귀 복구).
  const listPins = mineOnly ? mapPinList
    : [...mapPinList].sort((a, b) => Number(b.col === "mine") - Number(a.col === "mine"));

  const items = suggest.data ?? [];
  const go = (pk: string) => openDetail(pk);   // 리다이렉트=새탭(사이트 규칙)

  // 자동완성 선택 — 클릭 동작 통일(§3.1a 개편): 건물=지도 이동+선택 · 지역/역=지도 이동
  function pickFromSuggest(s: { kind?: string; building_pk?: string | null; pnu?: string | null; addr?: string; lng?: number | null; lat?: number | null }) {
    setQ(""); setActive(-1);
    // 고른 대상 크기에 맞춰 확대한다 — 건물은 필지가 보여야 하고, 동·역은 주변이 보여야 한다.
    // 나대지는 필지 하나가 대상이라 건물과 같은 배율로 붙는다
    const zoom = s.kind === "region" ? 15 : s.kind === "station" ? 16 : 18;
    if (s.lng && s.lat) setCenterReq({ lng: s.lng, lat: s.lat, zoom });
    if (s.kind === "building" || (!s.kind && s.building_pk)) selectBuilding(s.building_pk!);   // 핀에 있으면 그 핀, 없으면 조회
    // 나대지도 건물과 같은 흐름이다(2026-08-27): 지도 이동 + 선택 카드, 상세는 카드에서.
    // 처음엔 바로 상세로 보냈는데, 건물만 두 단계고 땅만 한 단계면 같은 검색이 다르게 움직인다.
    else if (s.kind === "vacant" && s.pnu) selectVacant(s.pnu, s.addr ?? "", s.lng ?? null, s.lat ?? null);
  }
  // 필지 클릭 → 매물 선택(부동산플래닛식). 검색결과면 그 핀(분류색), 아니면 건물 조회 후 내매물/일반 판정
  async function selectVacant(pnu: string, addr: string, lng: number | null, lat: number | null) {
    const pk = `P${pnu}`;                       // 나대지 매물 키 — listings 가 이 형태로 담는다
    const [v, listing] = await Promise.all([
      buildingsApi.vacant(pnu).catch(() => null),
      listingsApi.get(pk).catch(() => null),
    ]);
    setPicked({
      building_pk: pk, addr: addr || String(v?.addr ?? ""),
      lng: lng ?? Number(v?.lng), lat: lat ?? Number(v?.lat),
      col: listing?.registered ? "mine" : "normal",
      price: null,
      land_area: v?.area != null ? Number(v.area) : null,
      // 연면적·층수·추정가·수익률은 없는 값이다 — 카드가 「—」로 말한다
    });
  }

  async function selectBuilding(pk: string) {
    const inPin = mapPinList.find((p) => p.building_pk === pk);
    if (inPin) { setPicked(inPin); return; }
    try {
      const [b, listing] = await Promise.all([
        buildingsApi.get(pk),
        listingsApi.get(pk).catch(() => null),
      ]);
      setPicked({
        building_pk: pk, addr: String(b.addr ?? ""),
        lng: Number(b.lng), lat: Number(b.lat),
        col: listing?.registered ? "mine" : "normal",
        // 값 두 짝은 핀에서 고를 때와 **같은 재료**로 채운다(2026-08-27).
        // 예전엔 검색으로 고른 매물만 roi_est·price_is_est 가 비어, 같은 건물인데
        // 목록에서 누르면 추정 수익률이 뜨고 검색으로 들어오면 「—」로 떴다.
        price: b.sale_price != null ? Number(b.sale_price) : null,
        price_is_est: b.sale_price == null,
        roi: b.roi != null ? Number(b.roi) : null,               // 마스터 수익률(buildings.get)
        roi_est: b.est_annual_rent != null && b.sale_est
          ? Math.round((Number(b.est_annual_rent) / Number(b.sale_est)) * 1e4) / 100 : null,
        sale_est: b.sale_est != null ? Number(b.sale_est) : null, // 배치 추정가 — 사이드바가 핀과 동일하게 표시
        land_area: b.land_area != null ? Number(b.land_area) : null,
        floors_above: b.floors_above != null ? Number(b.floors_above) : null,
        floors_below: b.floors_below != null ? Number(b.floors_below) : null,
      });
    } catch { /* 조회 실패 무시 */ }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" && items.length) { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && items[active]) { pickFromSuggest(items[active]); return; }   // 선택 항목
      // 「마포구」를 치고 바로 엔터를 치면 자동완성(180ms 디바운스)이 아직 안 와 있어 아무 일도 안 났다(2026-09-04).
      // 지금 친 글자로 그 자리에서 한 번 묻고 첫 항목으로 간다. 목록이 옛 글자의 것이어도 같은 길이다.
      const typed = q.trim();
      if (!typed) return;
      if (dq === typed && items[0]) { pickFromSuggest(items[0]); return; }
      searchApi.suggest(typed).then((list) => { if (list[0]) pickFromSuggest(list[0]); }).catch(() => {});
    }
    else if (e.key === "Escape") setQ("");
  }

  // 지도 요약카드 가격추이(§3.6) — 선택 매물만 상세 데이터 로드
  const pickedBldg = useQuery({
    queryKey: ["pickBldg", picked?.building_pk],
    // 나대지(P+pnu)는 필지 API 가 안다 — 카드가 읽는 필드 이름에 맞춰 옮긴다
    queryFn: async () => {
      const pk = picked!.building_pk;
      if (!pk.startsWith("P")) return buildingsApi.get(pk);
      const v = await buildingsApi.vacant(pk.slice(1));
      return { ...v, land_area: v.area } as Record<string, unknown>;
    },
    enabled: !!picked,
  });
  // 주변 실거래 — 매물을 고른 뒤 따로 불러온다(약 190ms). 카드는 먼저 뜨고 그래프만 채워진다.
  const nearbySales = useQuery({
    queryKey: ["nearbySales", picked?.building_pk],
    queryFn: () => marketApi.nearbySales(picked!.building_pk), enabled: !!picked,
  });

  const total = result.data ? result.data.mine.total + result.data.normal.total : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
      {/* 검색·조건·건수·정렬은 전부 지도 위 패널 안으로 들어갔다(2026-08-27).
          예전엔 검색바·조건칩·결과바가 지도 위에 세 층으로 쌓여 지도가 그만큼 눌렸다. */}

      {/* 매수자 조건 편집 중 — 지도·필터·그리기로 다듬고 여기서 되저장한다 */}
      {bc && <BuyerCondBar bc={bc} values={fValues} regions={fRegions} filters={filters}
        polygon={polygon} hidden={hidden} onDone={() => nav2("/sales")} />}

      {showFilter && (
        <FilterModal
          initialValues={fValues} initialRegions={fRegions} initialPolygon={polygon} initialHidden={hidden}
          onApply={(r) => { setFilters(r.filters); setFValues(r.values); setFRegions(r.regions); setPolygons(r.polygon ? [r.polygon] : []); setHidden(r.hidden ?? []); resetPages(); }}
          onClose={() => setShowFilter(false)}
          onDraw={() => setShowFilter(false)}
        />
      )}

      {/* 지도 한 장(2026-08-27) — 지도가 바탕을 다 덮고 검색 패널이 그 위에 뜬다.
          예전엔 좌 360px + 우 지도로 칸을 나눠서, 패널을 접어도 지도가 안 넓어졌다.
          패널은 목록과 선택 카드를 번갈아 맡는다: 고르면 같은 자리가 카드가 된다.
          「2열 목록」 뷰는 지웠다(2026-08-28) — 뷰를 바꾸는 길이 없어져 옛 세션으로만
          닿는 죽은 화면이었고, 폐지한 보라와 설명글씨가 거기 남아 있었다. */}
      <div className="map-one">
          <div className="map-canvas">
            {mapPins.isFetching && <LoadingOverlay label="불러오는 중" />}
            <MapPanel
              pins={mapPinsShown}
              polygons={polygons}
              polygonActive={polygons.length > 0}
              selectedPk={picked?.building_pk ?? null}
              selectedCol={picked?.col ?? null}
              centerReq={centerReq}
              priceMode={priceMode}
              realView={{ basis: realBasis, unit: realUnit }}
              onParcelClick={(pk) => { if (pk) selectBuilding(pk); }}
              onPick={(pk) => setPicked(mapPinList.find((p) => p.building_pk === pk) ?? null)}
              // 새 영역은 더한다(null = 전부 지우기). 여러 상권을 동시에 보는 게 현장 방식이다.
              onPolygon={(g) => { setPolygons((ps) => (g ? [...ps, g] : [])); setPages({ mine: 1, normal: 1 }); }}
            />
          </div>

          {/* 떠 있는 패널 — 접으면 지도가 통째로 드러난다 */}
          {panelOpen ? (
            <div className="mo-panel">
              {/* 검색 — 패널 머리. 자동완성은 그 아래로 편다 */}
              <div className="mo-search">
                <div className="mo-q">
                  <Icon name="search" size={16} />
                  <input placeholder="주소 또는 지명" value={q} autoComplete="off"
                    onChange={(e) => { setQ(e.target.value); setActive(-1); }} onKeyDown={onKey} />
                  {q.trim() && <button className="mo-x" onClick={() => { setQ(""); setActive(-1); }} title="지우기">
                    <Icon name="close" size={13} /></button>}
                </div>
                <button className={`mo-filter ${filterCount ? "on" : ""}`} onClick={() => setShowFilter(true)}>
                  필터{filterCount ? ` ${filterCount}` : ""}</button>
                <button className="mo-fold" title="패널 접기" onClick={() => setPanelOpen(false)}>‹</button>
                {q.trim() && (
                  <div className="ac-drop">
                    {items.map((sg, i) => (
                      <div key={`${sg.kind}-${sg.building_pk ?? sg.addr}`} className={`ac-item ${i === active ? "active" : ""}`}
                        onMouseDown={() => pickFromSuggest(sg)} onMouseEnter={() => setActive(i)}>
                        <Icon name={sg.kind === "region" ? "map" : sg.kind === "station" ? "subway"
                          : sg.kind === "vacant" ? "circle" : "building"} size={13} style={{ flex: "0 0 auto", opacity: .8 }} />
                        {sg.is_mine && <span className="tag mine" style={{ fontSize: 9.5, flex: "0 0 auto" }}>내</span>}
                        <span className="ac-addr">{sg.addr.replace("서울특별시 ", "")}</span>
                        {sg.sub && <span className="ac-sub">{sg.sub}</span>}
                        {sg.price ? <span className="num ac-p">{(sg.price / 1e8).toFixed(1)}억</span> : null}
                      </div>
                    ))}
                    {items.length === 0 && <div className="ac-item ac-none">일치하는 결과가 없습니다</div>}
                  </div>
                )}
              </div>

              {/* 담은 조건 — 지역 · 그린 영역 · 필터 */}
              {(fRegions.length > 0 || polygons.length > 0 || filterCount > 0) && (
                <div className="mo-chips">
                  {fRegions.map((r) => (
                    <span key={r.bjd_code} className="chip">{r.label}
                      <span className="x" onClick={() => setFRegions(fRegions.filter((x) => x.bjd_code !== r.bjd_code))}>✕</span></span>
                  ))}
                  {polygons.map((_, i) => (
                    <span className="chip" key={i}>그린 영역{polygons.length > 1 ? ` ${i + 1}` : ""}
                      <span className="x" onClick={() => { setPolygons((ps) => ps.filter((_, j) => j !== i)); resetPages(); }}>✕</span></span>
                  ))}
                  {conditionChips(fValues).map((c) => (
                    <span key={c.label} className="chip">{c.label} {c.text}
                      <span className="x" onClick={() => setFValues((st) => { const n = { ...st }; delete n[c.label]; return n; })}>✕</span></span>
                  ))}
                </div>
              )}

              {/* 핀 값 · 범례 · 정렬 */}
              <div className="mo-top">
                <Segmented value={priceMode} onChange={setPriceMode} size="sm"
                  options={[{ value: "fair", label: "추정가" }, { value: "real", label: "실거래가" }]} />
                <span className="sp" />
                <span className="mo-lg"><b style={{ background: "var(--blue)" }} />내</span>
                <span className="mo-lg"><b style={{ background: "var(--muted)" }} />일반</span>
              </div>

              {/* 실거래 견주기 — 총액이냐 단가냐, 단가면 무엇으로 나누고 어느 단위로 낼 것이냐 */}
              {priceMode === "real" && (
                <div className="mo-real">
                  <Segmented value={realBasis === "total" ? "total" : "unit"} size="sm"
                    onChange={(v) => setRealBasis(v === "total" ? "total" : "land")}
                    options={[{ value: "total", label: "총액" }, { value: "unit", label: "단가" }]} />
                  {realBasis !== "total" && (
                    <>
                      <Segmented value={realBasis} onChange={setRealBasis} size="sm"
                        options={[{ value: "land", label: "토지" }, { value: "bldg", label: "건물" }]} />
                      <Segmented value={realUnit} onChange={setRealUnit} size="sm"
                        options={[{ value: "py", label: "평" }, { value: "m2", label: "㎡" }]} />
                    </>
                  )}
                  <span className="yr">
                    {[[0, "전체"], [1, "1년"], [3, "3년"], [5, "5년"]].map(([v, t]) => (
                      <button key={v as number} className={saleYears === v ? "on" : ""}
                        onClick={() => setSaleYears(v as number)}>{t as string}</button>
                    ))}
                  </span>
                </div>
              )}

              {picked ? (
                <div className="mo-body">
                  <button className="mo-back" onClick={() => setPicked(null)}>‹ 목록</button>
                  <SelCard picked={picked} bldg={pickedBldg.data} nearby={nearbySales.data}
                    onDetail={() => go(picked!.building_pk)}
                    onHide={() => {
                      // 접었으면 그 건물은 이 조건에서 사라진다 — 고른 채로 두면 없는 것을 보고 있게 된다
                      setHidden((v) => [...v, picked!.building_pk]);
                      setPicked(null);
                    }} />
                </div>
              ) : (
                <div className="mo-body">
                  <div className="ml-head">
                    <span>{byTeam ? "내 매물 " : "이 영역 "}<b className="num">{mapPinList.length}</b>건{
                      mapPins.isFetching ? " · 불러오는 중…"
                      : mapPinList.length < total ? ` · 전체 ${total.toLocaleString()}건 中` : ""}</span>
                    {/* 접어둔 줄 되돌리기 — 접기는 건물이 아니라 **조건**에 붙는 값이라
                        조건을 저장하면 함께 저장되고, 다른 조건에선 그대로 보인다. */}
                    {hidden.length > 0 && (
                      <button className="hid-pill" onClick={() => setHidden([])}>
                        <Icon name="hide" size={12} />접어둠 <b>{hidden.length}</b>
                        <span className="hid-undo">펼치기</span>
                      </button>
                    )}
                  </div>
                  {listPins.slice(0, 100).map((p) => (
                    <div key={p.building_pk} className="ml-row"
                      onClick={() => { setPicked(p); if (p.lng && p.lat) setCenterReq({ lng: p.lng, lat: p.lat }); }}>
                      <span className="ml-a">{p.addr.replace("서울특별시 ", "").replace("번지", "")}
                        <span className={`ml-tag ${p.col}`}>{p.col === "mine" ? "내" : "일반"}</span>
                      </span>
                      {/* 값과 수익률은 늘 **같은 출신**으로 짝짓는다(0134). 출처는 색이 말한다:
                          연파랑은 빌탐정 추정가, 검정은 팀이 적은 값. */}
                      <span className={`ml-nums ${p.price_is_est ? "est" : ""}`}>{won(p.price)}
                        {p.price_is_est
                          ? (p.roi_est != null && <small> · {p.roi_est}%</small>)
                          : (p.roi != null && <small> · {p.roi}%</small>)}</span>
                      <button className="ml-hide" title="접어두기"
                        onClick={(e) => { e.stopPropagation(); setHidden((v) => [...v, p.building_pk]); }}>
                        <Icon name="hide" size={13} /></button>
                    </div>
                  ))}
                  {mapPinList.length > 100 && <div className="ml-row" style={{ justifyContent: "center", color: "var(--muted)", cursor: "default" }}>목록은 상위 100건 · 지도에서 전체 확인</div>}
                  {mapPinList.length === 0 && <div className="sel-empty">이 영역에 표시할 매물이 없습니다</div>}
                </div>
              )}
            </div>
          ) : (
            <button className="mo-open" title="패널 펴기" onClick={() => setPanelOpen(true)}>›</button>
          )}
      </div>
    </div>
  );
}

/* 매수자 조건 저장 바 — 지금 화면의 조건(필터·지역·그린 영역)을 그대로 그 매수자에게 붙인다. */
function BuyerCondBar({ bc, values, regions, filters, polygon, hidden, onDone }: {
  bc: BuyerCondNav; values: Values; regions: RegionPick[]; filters: AttrFilters;
  polygon: object | null; hidden: string[]; onDone: () => void;
}) {
  const [name, setName] = useState(bc.name);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    // 접어둔 건물도 이 사람 조건에 붙는다 — 「이 사람 것은 아니다」라는 판단이라
    // 다른 매수자·다른 조건에서는 그대로 보인다(2026-08-28).
    const conditions = { values, regions, polygon, filters, hidden };
    try {
      if (bc.cond_id) await buyersApi.updateCondition(bc.cond_id, name.trim() || "조건", conditions);
      else await buyersApi.addCondition(bc.buyer_id, name.trim() || "조건", conditions);
      onDone();
    } finally { setSaving(false); }
  };
  const n = activeCount(values, regions);
  return (
    <div className="bc-bar">
      <Icon name="filter" size={14} />
      <b>{bc.buyer_name}</b> 조건 편집 중
      <input className="input" value={name} onChange={(e) => setName(e.target.value)}
        placeholder="조건 이름" style={{ width: 150, padding: "4px 8px", fontSize: 12.5 }} />
      <span className="cnt">조건 {n}개{polygon ? " · 그린 영역" : ""}</span>
      <span style={{ flex: 1 }} />
      <button className="btn" onClick={onDone}>취소</button>
      <button className="btn primary" disabled={saving} onClick={save}>{saving ? "저장 중…" : "이 조건으로 저장"}</button>
    </div>
  );
}
