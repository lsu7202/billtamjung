import { LoadingOverlay } from "../../shared/ui/Spinner";
import { createPortal } from "react-dom";
import { Fragment, useState, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { BuildingSheetModal } from "../building/BuildingSheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi, searchApi, marketApi, buildingsApi, parcelsApi, listingsApi, buyersApi, hiddenApi, seeksApi, interestApi, type AttrFilters, type HiddenRow, type MarketPinDTO, type SeekRow } from "../../shared/api/endpoints";
import { useIsBroker } from "../../shared/store/auth";
import { SideDetail, type ParcelListing } from "./SideDetail";
import type { RoadView } from "../../shared/map/Roadview";
import { ListingCard, ago } from "./ListingCard";
import { valueLabel } from "../../shared/map/mapCanvasLayer";
import { openParcel, mergeGeo } from "../../shared/map/geo";
import { MapPanel, MapPin } from "../../shared/map/MapPanel";
import { Conditions, activeCount, conditionChips, type Values, type RegionPick } from "./FilterModal";
import { pruneFilters, filterChips, KINDS, DEFAULT_KINDS, TRADE_TYPES } from "./filterConfig";
import "./search.css";
import { Icon } from "../../shared/ui/Icon";
import { useUnit } from "../../shared/hooks/useUnit";
import { SeekModal, ProposeModal, SeekLine, interestText } from "./SeekModal";

/** S01 매물 찾기 · S06 구해요 — 한 틀, 두 화면(09-30).
 *  매물 찾기(`/search`): 목록 = 매물(광고 · 내 매물). 필터는 매물에만 걸린다.
 *  구해요(`/seek`): 목록 = 전체(필터에 맞는 모든 건물 · 추정가) | 구해요(고객이 남긴 것). 누구나 같은 목록.
 *  필터(지역 · 영역 · 조건 · 매물유형)와 가격지표 설정은 세션 하나로 두 화면이 같이 쓴다. */



// 라벨이 곧 조건 키다 — 낱말을 통일한 판(2026-08-27)이라 옛 세션은 버린다.
// 서버는 extra=forbid 라 옛 키가 남아 있으면 검색 전체가 422 로 죽는다 — 판이 바뀌면 키를 올린다.
// v4(2026-08-28): 유동인구 등급 다섯 칸(float_pops)→실측 명수(pop_day_min/max),
//   등급·입지·건물용도(grades·ipjis·building_uses) 필터 폐지, 접어둠(hidden) 추가.
//   v3 때 이 주석만 고치고 키를 안 올려 옛 조건이 그대로 남았고, 검색이 통째로 422 였다.
const SESSION_KEY = "s01_search_state_v4";
const EXPLORE_KEY = "s08_explore_state_v1";
const SRC_LABEL = { mine: "내 매물", ad: "빌탐정 매물", market: "네이버 매물" } as const;
// 옛 판 스냅샷은 지운다 — 안 지우면 세션마다 죽은 조건이 쌓인다.
try { for (const k of Object.keys(sessionStorage)) if (k.startsWith("s01_search_state_") && k !== SESSION_KEY) sessionStorage.removeItem(k); } catch { /* 사파리 사생활 모드 */ }

/** 영업 탭에서 "지도에서 열기"로 넘어온 매수자 조건. 지도·필터·그리기로 다듬고 그 자리에서 되저장한다.
 *  조건 편집을 모달로만 두면 지도가 없어 영역 그리기를 쓸 수 없다. */
type BuyerCondNav = {
  buyer_id: number; buyer_name: string; cond_id: number | null; name: string;
  conditions: { values?: Values; regions?: RegionPick[]; polygon?: object | null; filters?: AttrFilters };
};

/** 가격지표 하나(실거래 · 매매시세 · 임대시세) — 켜고 끄기. 반경(100 · 300 · 500m) · 조건 적용(탐색 필터)은 걷었다(대표 10-04) */
type Ind = { on: boolean };
const IND0: Ind = { on: false };
/** 임대시세는 층을 골라서만 본다(대표 10-04) — 모든 층을 섞은 평당 월세는 내지 않는다. 승강기로 거른다 */
/** 지표마다 조건이 다르다(대표 10-04) — 하나로 묶지 않는다. 상세 조건(탐색 필터)은 걸지 않는다.
 *  실거래 = 실거래 유형(신고 갈래 trade_type, 여럿 · 비우면 전체) / 임대시세(탐색만) = 층(하나) · 승강기(대장만) · 종류.
 *  층은 지하 / 1층 / 2층 / 3층 이상 — 같은 건물에서 3층과 4~8층 평당 월세가 1~4%만 달라 한 묶음(10-04 실측) */
type IndOpt = { tradeTypes: string[]; floor: "B" | "1" | "2" | "3"; elev: "all" | "y" | "n"; use: "all" | "상가" | "사무실" };
const OPT0: IndOpt = { tradeTypes: [], floor: "1", elev: "all", use: "all" };
const RENT_FLOOR: Record<IndOpt["floor"], string> = { B: "지하", "1": "1층", "2": "2층", "3": "3층 이상" };
/** 구해요 전체 탭이 한 번에 받는 상한(대표 09-30). 넘으면 받지 않고 조건을 좁히게 한다 */
const SEEK_MAX = 1000;   // 1km 는 뺐다(대표 09-30)

export function SearchPage({ mode = "sale" }: { mode?: "sale" | "seek" | "explore" }) {
  // 매물 탐색(S08, 중개사만)은 매물 찾기와 같은 틀 — 원천만 셋(내 매물 · 빌탐정 매물 · 네이버 매물)이다
  const explore = mode === "explore";
  const sale = mode === "sale" || explore;
  // 탐색 조건은 따로 저장한다 — 고객용 화면(매물 찾기 · 구해요)으로 넘어가지 않게
  const SKEY = explore ? EXPLORE_KEY : SESSION_KEY;
  const loc = useLocation();
  // 상세보기(사양서) 모달 — 주소에 ?p=지번 을 붙인다(10-08). 뒤로가기가 닫고, 그 주소를 보내면 상세가 열린 채로 선다
  const [sp, setSp] = useSearchParams();
  const sheetPnu = sp.get("p");
  // 이 화면에서 연 상세보기만 「뒤로」로 닫는다(표시를 남긴다). 주소로 바로 들어왔거나 표시가 없으면 b 만 지운다 —
  // 전엔 history 길이만 보고 뒤로 가서, 다른 화면에서 넘어온 경우 탐색 밖으로 나가 버렸다
  // 이미 열려 있으면 기록을 새로 쌓지 않고 바꿔 끼운다(10-02) — 쌓으면 X 를 연 횟수만큼 눌러야 다 닫힌다
  const openSheet = (pnu: string) => {
    const n = new URLSearchParams(sp); n.set("p", pnu);
    const open = !!sp.get("p");
    setSp(n, open ? { replace: true, state: loc.state } : { state: { sheet: true } });
  };
  const closeSheet = () => {
    if ((loc.state as { sheet?: boolean } | null)?.sheet) nav2(-1);
    else { const n = new URLSearchParams(sp); n.delete("p"); setSp(n, { replace: true }); }
  };
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
    try { return JSON.parse(sessionStorage.getItem(SKEY) || "{}"); } catch { return {}; }
  });
  const [q, setQ] = useState((saved.q as string) ?? "");
  const [active, setActive] = useState(-1);
  const broker = useIsBroker();
  // 검색 탭(S05 §2) — 실거래 · 매매 · 전체. 예전 「추정가 / 실거래가」 토글을 대신한다.
  // 핀 값: 실거래=거래가 · 매매=광고가(내 매물은 매매가) · 전체=추정가
  // 보기(S05, 09-28 대표) — 켜고 끄는 칩 셋. 여러 개를 같이 켠다(밸류맵 방식, 슬라이드 아님).
  //   매매       광고 + 내 매물(중개사). 기본 켬. 목록이 이것을 보여 준다
  //   실거래     기간 안에 거래가 있던 건물. 매매와 같이 켜서 견준다. 목록엔 안 선다
  //   전체 건물  매물 밖까지 — 「매물 안에선 못 찾겠다」 할 때만 켠다. 기본 끔
  //   (09-30 S06) 보기 칩 셋을 걷었다. 매매는 매물 찾기 화면 그 자체, 실거래 · 추정가는 지도 오른쪽 위 가격지표,
  //   「전체 건물」은 구해요의 전체 탭이 맡는다.
  // 옛 세션의 1km 는 300m 로 돌린다
  const fixR = (d: Ind): Ind => ({ on: !!d.on });   // 옛 세션의 반경 · 조건 칸은 버린다
  const [deal, setDeal] = useState<Ind>(fixR({ ...IND0, ...(saved.indDeal as Ind) }));
  // 매매시세 · 임대시세(10-04) — 실거래와 같은 켜고 끄는 지표. 크롤링 자료라 중개사에게만. 조건 적용은 없다(범위만)
  // 탐색 원천 칸(S08 §3) — 켜고 끈다. 처음엔 셋 다
  const [src, setSrc] = useState<Record<"mine" | "ad" | "market", boolean>>(
    { mine: true, ad: true, market: true, ...(saved.src as object) });
  const [mrent, setMrent] = useState<Ind>(fixR({ ...IND0, ...(saved.indMrent as Ind) }));
  const [opt, setOpt] = useState<IndOpt>(() => {
    const o = { ...OPT0, ...(saved.indOpt as Partial<IndOpt>) };
    return { ...o, tradeTypes: (o.tradeTypes ?? []).filter((t) => (TRADE_TYPES as readonly string[]).includes(t)) };
  });
  const [setOpen, setSetOpen] = useState(false);   // 가격지표 설정 판(오른쪽에서 덮는다)
  // 구해요 목록 — 전체 | 구해요
  const [seekTab, setSeekTab] = useState<"all" | "seek">(saved.seekTab === "seek" ? "seek" : "all");
  const [seekFor, setSeekFor] = useState<{ pnu: string; addr: string } | null>(null);   // 구해요 남기기(고객)
  const [propose, setPropose] = useState<SeekRow | null>(null);                        // 제안 보내기(중개사)
  // 매물 유형(0246) — 사이드 판 칩과 필터 창이 같은 값. 빈 목록 = 다 봄. 옛 낱말(빌딩 등)이 세션에 남아 있으면 걸러 낸다
  const [kinds, setKinds] = useState<string[]>(((saved.kinds as string[]) ?? DEFAULT_KINDS).filter((k) => (KINDS as readonly string[]).includes(k)));
  const priceMode = "fair" as const;   // 핀마다 lens 를 싣는다(실거래 핀만 real)
  // 지도 화면 범위 — 지도가 멈출 때마다. 목록은 「현재 위치 매물 N개」를 눌러야 따라온다(디스코 방식)
  const [view, setView] = useState<{ bbox: [number, number, number, number]; zoom: number } | null>(null);
  const [listBox, setListBox] = useState<[number, number, number, number] | null>(null);
  // 실거래를 지도에서 견주는 눈금(밸류맵식). **기본은 대지면적 · 평**이다 — 연면적이 아니다.
  const [realBasis, setRealBasis] = useState<"total" | "land" | "bldg">((saved.realBasis as any) ?? "total");   // 기본 총액(밸류맵)
  // 면적 단위(평 · ㎡)는 앱 전체가 같은 값(useUnit) — 단가뿐 아니라 면적이 나오는 곳 전부에 걸린다(대표 09-30)
  const { unit: realUnit, setUnit: setRealUnit, area: areaOf } = useUnit();
  // 0 = 전체 · 기본 3년(대표 09-28). 10년은 뺐다(09-30) — 옛 세션에 10이 남아 있으면 3으로
  const [saleYears, setSaleYears] = useState<number>([0, 1, 3, 5].includes(saved.saleYears as number) ? (saved.saleYears as number) : 3);
  /** 한 해씩 고른 연도들(대표 09-30 — 범위가 아니라 하나씩 켠다). 고르면 `saleYears` 대신 이것이 이긴다.
   *
   *  **이건 「거르기」가 아니라 「보기 범위」다.** 검색 필터의 「실거래일」과 같은 값을 두
   *  곳에서 고치게 두면 어느 쪽이 이겼는지 아무도 모른다. 그래서 성격을 갈랐다 —
   *  필터는 **어떤 건물을 남길까**, 여기는 **어느 시기 거래를 볼까**(2026-09-05 확정). */
  const [saleYrs, setSaleYrs] = useState<number[]>(Array.isArray(saved.saleYrs) ? (saved.saleYrs as number[]) : []);
  // 그린 영역은 여러 개 쌓인다 — 예전엔 단일 객체라 새로 그리면 앞의 것이 사라졌다.
  // 서버로는 mergeGeo로 MultiPolygon 하나로 합쳐 보낸다(서버는 손댈 것이 없다).
  const [polygons, setPolygons] = useState<object[]>(
    pre ? (pre.polygon ? [pre.polygon] : []) : ((saved.polygons as object[]) ?? []));
  const polygon = mergeGeo(polygons);
  const [picked, setPicked] = useState<MapPin | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);   // 지도만 보고 싶을 때 접는다
  const [centerReq, setCenterReq] = useState<{ lng: number; lat: number; zoom?: number; bounds?: [number, number, number, number] } | null>(null);  // 지도 이동 요청
  // 정렬은 추정가순 하나다(2026-08-27) — 수익률순은 값이 있는 매물이 적어 줄이 거의 안 바뀌었다
  const [sort] = useState((saved.sort as string) ?? "price");
  // 매수자 조건을 싣고 왔으면 **그 조건만** 쓴다. 세션에 남아 있던 검색 조건이 섞이면
  // 새 조건을 만드는데 남의 조건이 미리 들어차 있고, 그대로 저장되면 잘못된 조건이 박힌다.
  // pruneFilters — 저장해 둔 조건은 지난 판 낱말을 들고 있다. 그대로 서버로 보내면
  // extra=forbid 에 걸려 검색이 통째로 422 로 죽는다(2026-08-28 실측).
  const [filters, setFilters] = useState<AttrFilters>(
    pruneFilters(pre ? pre.filters : saved.filters));
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
  // 거리뷰는 하나(09-28) — 사이드바 사진 ⤢ 가 지도 툴바 거리뷰를 크게 열고, 닫으면 사이드바가 그 자리를 이어받는다
  const [rvReq, setRvReq] = useState<(RoadView & { n: number }) | null>(null);
  const [rvBack, setRvBack] = useState<(RoadView & { n: number }) | null>(null);
  const [rvMedia, setRvMedia] = useState<{ adId: number; ids: number[] } | null>(null);
  // 숨기기(0197) — 계정마다 저장. 조건 · 창과 상관없이 계속 안 보이고 「다시 보기」로만 되돌린다
  const qc = useQueryClient();
  const hiddenQ = useQuery({ queryKey: ["hidden"], queryFn: hiddenApi.list });
  const hiddenRows = hiddenQ.data ?? [];
  const hidden = hiddenRows.map((h) => h.pnu);
  const [hidOpen, setHidOpen] = useState(false);
  const setHid = (f: (v: HiddenRow[]) => HiddenRow[]) => qc.setQueryData<HiddenRow[]>(["hidden"], (v) => f(v ?? []));
  const hide = (pnu: string, addr = "") => {
    setHid((v) => [{ pnu, addr, created_at: new Date().toISOString() }, ...v.filter((h) => h.pnu !== pnu)]);
    hiddenApi.hide(pnu).catch(() => qc.invalidateQueries({ queryKey: ["hidden"] }));
  };
  const unhide = (pnu: string | null) => {
    setHid((v) => (pnu ? v.filter((h) => h.pnu !== pnu) : []));
    (pnu ? hiddenApi.unhide(pnu) : hiddenApi.unhideAll()).catch(() => qc.invalidateQueries({ queryKey: ["hidden"] }));
  };
  /** 화면 낱말(`fValues`)로는 안 보이는데 서버로는 걸려 있는 조건.
   *  옛 매수자 조건이 `filters` 만 들고 있어 검색은 좁혀지는데 화면이 그대로였다(2026-09-05). */
  const shownLabels = new Set(conditionChips(fValues).map((c) => c.label));
  const onlyFilterChips = filterChips(filters).filter((c) => !shownLabels.has(c.label));
  // 조건 판(대표 09-30) — 모달이 아니라 사이드바가 통째로 조건 화면이 된다. 「적용 (N건)」을 눌렀을 때만 걸린다
  const [condOpen, setCondOpen] = useState(false);
  // 조건 화면이 열린 동안 그린 영역은 여기 쌓였다가 「적용」 때 걸린다(그리기 도구는 조건 화면 「지역」 옆, 09-30)
  const [condPolys, setCondPolys] = useState<object[]>([]);
  const [drawReq, setDrawReq] = useState<{ mode: "free" | "poly" | "circle" | null; n: number } | null>(null);
  const [drawMode, setDrawModeNow] = useState<"free" | "poly" | "circle" | null>(null);
  const openCond = () => { setCondPolys(polygons); setCondOpen(true); };
  const closeCond = () => { setCondOpen(false); setDrawFocus(false); setDrawReq((r) => ({ mode: null, n: (r?.n ?? 0) + 1 })); };
  // 그리기 화면(09-30) — 도구를 누르면 사이드바 · 조건 창이 숨고 지도만 남는다(살짝 어둡게).
  // 도형은 여러 개 이어 그릴 수 있고, 아래 「적용」을 눌러야 끝나며 조건 창으로 돌아간다
  const [drawFocus, setDrawFocus] = useState(false);
  const pickTool = (m: "free" | "poly" | "circle" | null) => {
    setDrawReq((r) => ({ mode: m, n: (r?.n ?? 0) + 1 }));
    if (m) setDrawFocus(true);
  };
  const endDraw = () => { setDrawFocus(false); setDrawReq((r) => ({ mode: null, n: (r?.n ?? 0) + 1 })); };
  const [pages, setPages] = useState<{ mine: number; normal: number }>((saved.pages as { mine: number; normal: number }) ?? { mine: 1, normal: 1 });

  // 조건 변경 시 스냅샷 저장(전환·새로고침 복원용)
  useEffect(() => {
    sessionStorage.setItem(SKEY, JSON.stringify({ q, indDeal: deal, indMrent: mrent, indOpt: opt, src, seekTab, kinds, realBasis, saleYears, saleYrs, polygons, sort, filters, fValues, fRegions, pages }));
  }, [q, deal, mrent, opt, src, seekTab, kinds, realBasis, saleYears, saleYrs, polygons, sort, filters, fValues, fRegions, pages]);
  // 담은 지역 전부(여러 구 · 동, 09-30). 서버가 목록을 받아 OR 로 건다
  const regionCodes = fRegions.map((r) => r.bjd_code);
  const bjd = regionCodes.length > 0;
  // 지역·영역이 바뀌어 매물 집합이 바뀌면 핀 레이어가 지도를 맞춘다(mapCanvasLayer.setPins) — 여기서 또 맞추지 않는다
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
  // 실거래 기간 → 서버. 연도를 직접 골랐으면 그 해부터, 0 = 전체(30년)
  const saleYearsSrv = saleYears || 30;
  const area = { bjd_code: polygon || !bjd ? undefined : regionCodes, polygon: polygon ?? undefined };
  const filtersK: AttrFilters = { ...filters, kinds: kinds.length ? kinds : undefined };
  // 실거래 · 추정가는 수가 많아 화면 범위로만, 가까이 당겼을 때만 부른다. 매매(광고 · 내 매물)는 적어서 서울 전역
  const NEAR = 15;
  const near = !!view && view.zoom >= NEAR;
  const indBox = (_d: Ind): [number, number, number, number] | null => (near ? view!.bbox : null);
  const salePins = useQuery<MapPin[]>({
    queryKey: ["pinsSale", mode, area, filtersK],
    queryFn: () => searchApi.pins({ ...area, filters: filtersK, sort, ...(explore ? { tab: "explore" } : { tab: "ad", chip: "ads" }) }) as Promise<MapPin[]>,
    enabled: sale, placeholderData: (prev) => prev,
  });
  const dealBox = indBox(deal);
  // 실거래는 탐색 필터를 싣지 않는다(상세 조건 없음, 10-04) — 실거래 유형 줄만(매물 유형과 다른 칸, 0246)
  const dealCond = { filters: { trade_types: opt.tradeTypes.length ? opt.tradeTypes : null } as AttrFilters };
  const dealPins = useQuery<MapPin[]>({
    queryKey: ["pinsDeal", dealBox, saleYearsSrv, saleYrs, dealCond],
    queryFn: () => searchApi.pins({ ...dealCond, tab: "deal", sale_years: saleYearsSrv, bbox: dealBox!,
      sale_year_list: saleYrs.length ? saleYrs : null }) as Promise<MapPin[]>,
    enabled: deal.on && !!dealBox, placeholderData: (prev) => prev,
  });
  // 임대시세 지표는 탐색에만(S08 §3 · 매물 찾기는 실거래만). 매매시세 지표는 걷었다 — 탐색의 네이버 매물이 같은 자료다
  const mrBox = broker && explore && mrent.on ? indBox(mrent) : null;
  const rentQ = { floor: opt.floor, elev: opt.elev, use: opt.use };
  const mrentQ = useQuery<MarketPinDTO[]>({ queryKey: ["mpins", "rent", mrBox, rentQ], queryFn: () => marketApi.pins("rent", mrBox!, rentQ),
    enabled: !!mrBox, placeholderData: (prev) => prev });
  // 구해요는 조건을 걸어야 결과가 나온다(대표 09-30). 조건 = 지역 · 그린 영역 · 필터 중 하나 이상.
  // 매물 유형은 늘 켜져 있는 값이라 조건으로 치지 않는다
  const hasCond = filterCount > 0 || polygons.length > 0 || onlyFilterChips.length > 0;
  // 먼저 건수만 센다. SEEK_MAX 를 넘으면 받지 않고 「조건을 더 좁혀 주세요」— 받은 결과는 늘 전부라 지도에 빠진 곳이 없다
  const seekCount = useQuery({
    queryKey: ["seekCount", area, filtersK],
    queryFn: () => searchApi.count({ ...area, filters: filtersK }),
    enabled: !sale && hasCond,
  });
  const seekN0 = seekCount.data?.total ?? null;
  const seekOk = hasCond && seekN0 != null && seekN0 <= SEEK_MAX;
  // 구해요 · 전체 — 조건에 맞는 모든 건물(추정가). 지도엔 가격표 없이 점만
  const seekAll = useQuery<MapPin[]>({
    queryKey: ["pinsSeekAll", area, filtersK],
    queryFn: () => searchApi.pins({ ...area, filters: filtersK, sort, tab: "all" }) as Promise<MapPin[]>,
    enabled: !sale && seekOk,
  });
  // 구해요 · 구해요 — 조건에 맞는 건물의 열린 구해요(서울 전역, 수가 적다)
  const seeksQ = useQuery({
    queryKey: ["seeks", area, filtersK],
    queryFn: () => seeksApi.search({ ...area, filters: filtersK }),
    enabled: !sale && hasCond, placeholderData: (prev) => prev,
  });
  // 숨긴 것은 **여기서** 뺀다. 지도도 목록도 같은 목록을 보므로 한 곳에서 거른다.
  const hideSet = new Set(hidden);
  const seekRows = hasCond ? (seeksQ.data ?? []).filter((x) => !hideSet.has(x.pnu)) : [];
  const seekN = new Map<string, number>();
  seekRows.forEach((x) => seekN.set(x.pnu, (seekN.get(x.pnu) ?? 0) + 1));
  const seekBldg: MapPin[] = [...new Map(seekRows.map((x) => [x.pnu, {
    pnu: x.pnu, addr: x.addr, lng: x.lng, lat: x.lat, col: "normal" as const,
    price: x.sale_est, sale_est: x.sale_est, land_area: x.land_area, total_area: x.total_area,
  }])).values()];
  const saleAll = sale ? (salePins.data ?? []).filter((p) => !hideSet.has(p.pnu)) : [];
  // 탐색 — 켠 원천만(S08 §3). 매물 찾기는 광고 하나라 거를 것이 없다
  const srcOf = (p: MapPin) => (p.kind === "mine" ? "mine" : p.kind === "market" ? "market" : "ad") as "mine" | "ad" | "market";
  const saleList = explore ? saleAll.filter((p) => src[srcOf(p)]) : saleAll;
  // 목록의 바탕 — 매물 찾기 = 매매, 구해요 = 전체(화면 안 건물) 또는 구해요가 열린 건물
  const baseList = sale ? saleList
    : seekTab === "all" ? (seekOk ? (seekAll.data ?? []).filter((p) => !hideSet.has(p.pnu)) : []) : seekBldg;
  const basePk = new Set(baseList.map((p) => p.pnu));
  // 한 건물엔 핀 하나 — 목록(매물 · 구해요) > 실거래
  // 범위 밖(줌이 멀거나 기준이 없음)이면 그리지 않는다 — 꺼진 조회도 옛 자리 핀을 placeholder 로 들고 있다
  const dealList = deal.on && dealBox ? (dealPins.data ?? []).filter((p) =>
    !basePk.has(p.pnu) && !hideSet.has(p.pnu) ) : [];
  // 시세 — 한 건물엔 핀 하나: 매물 > 실거래 > 매매시세 > 임대시세. 겹쳐 그리면 가격표끼리 덮여 못 읽는다
  const taken = new Set([...basePk, ...dealList.map((p) => p.pnu)]);
  const askPins = (rows: MarketPinDTO[] | undefined, d: Ind, box: unknown, kind: "mrent"): MapPin[] => {
    if (!d.on || !box) return [];
    const out = (rows ?? []).filter((x) => !taken.has(x.pnu) && !hideSet.has(x.pnu))
      .map((x) => ({ pnu: x.pnu, addr: x.addr, lng: x.lng, lat: x.lat, col: "normal" as const, price: null,
        kind, ask: x.v, askN: x.n, askHead: kind === "mrent" ? RENT_FLOOR[opt.floor] : undefined,
        askFoot: kind === "mrent" ? `${x.n}곳` : x.observed_on ? x.observed_on.slice(2).replace(/-/g, ".") : undefined, land_area: x.land_area, total_area: x.total_area, main_use_name: x.main_use_name }));
    out.forEach((x) => taken.add(x.pnu));
    return out;
  };
  const mrList = askPins(mrentQ.data, mrent, mrBox, "mrent");
  const mapPinList = [...mrList, ...dealList, ...baseList];
  // 핀 값 — 매매: 그 건물 1번 매물의 매매가(0226). 실거래: 거래가(lens real). 추정가 · 구해요: 추정가
  const mapPinsShown: MapPin[] = [
    ...mrList,
    // 색(대표 09-30): 매물 빨강 · 구해요 초록 · 실거래 파랑 · 추정가 흰 바탕 검정 글자
    ...dealList.map((p) => ({ ...p, kind: "deal" as const, lens: "real" as const })),
    // 매매 핀은 건물마다 하나 — **1번 매물**(순번은 서버 listings_now 한 곳)의 매매가. 없으면 「미정」(추정가로 대신 안 채운다)
    ...(sale ? saleList.filter((p) => (p.rank ?? 1) === 1).map((p) => {
      if (explore && p.kind === "market")
        return { ...p, kind: "msale" as const, ask: p.price ?? null, askFoot: p.mk_on ? p.mk_on.slice(2).replace(/-/g, ".") : undefined };
      const v = p.price ?? null;
      return { ...p, lens: "fair" as const, sale_est: v, price: v, text: p.kind === "sold" ? "거래완료" : "미정" };
    }) : baseList.map((p) => ({ ...p, lens: "fair" as const,
      // 구해요는 가격표 없이 점만(대표 09-30) — 구해요 탭 초록 점, 전체 탭 흰 점. 올리거나 고르면 가격표
      kind: seekTab === "seek" ? "seek" as const : "est" as const, price: p.sale_est ?? null, dot: true }))),
  ];
  const inBox = (p: MapPin, bx: [number, number, number, number] | null) =>
    !bx || (p.lng >= bx[0] && p.lng <= bx[2] && p.lat >= bx[1] && p.lat <= bx[3]);
  // 목록 = 목록 범위 안의 매매. 지역 · 영역을 걸었으면 범위를 안 따진다(그 조건이 이미 좁혔다)
  // 구해요 · 전체는 지도 화면 안을 그대로 부르므로 범위를 따로 두지 않는다
  const boxFor = bjd || polygon ? null : listBox;
  const SRC_ORDER = { mine: 0, ad: 1, market: 2 } as const;
  const listPins = sale ? saleList.filter((p) => inBox(p, boxFor))
    .sort((a, b) => explore ? SRC_ORDER[srcOf(a)] - SRC_ORDER[srcOf(b)] : Number(b.kind === "mine") - Number(a.kind === "mine")) : baseList;
  // 원천별 수 — 원천 칸 숫자(목록 범위 안, 켜고 끄기와 상관없이)
  const srcN = { mine: 0, ad: 0, market: 0 };
  if (explore) saleAll.filter((p) => inBox(p, boxFor)).forEach((p) => { srcN[srcOf(p)] += 1; });
  // 탐색 목록은 원천마다 60까지 — 네이버 매물이 많아도 내 매물 · 광고가 밀려나지 않는다
  const shown = explore ? (["mine", "ad", "market"] as const).flatMap((k) => listPins.filter((p) => srcOf(p) === k).slice(0, 60))
    : listPins.slice(0, 60);
  // 지도가 목록 범위를 벗어났나 → 「현재 위치 매물 N개」
  const boxMoved = sale && !bjd && !polygon && !!view && (!listBox || listBox.join() !== view.bbox.join());
  const nowN = view ? saleList.filter((p) => inBox(p, view.bbox)).length : 0;
  useEffect(() => { if (view && !listBox) setListBox(view.bbox); }, [view, listBox]);
  // 카드 한 장 = 매물 하나(0226). 네이버 매물은 카드 재료가 핀에 다 있다 — 내 매물 · 광고 매물만 부른다
  const cardIds = shown.filter((p) => p.kind !== "market" && p.listing_id != null).map((p) => p.listing_id as number);
  const cardsQ = useQuery({
    queryKey: ["listCards", cardIds.join()],
    queryFn: () => buildingsApi.cards(cardIds),
    enabled: sale && cardIds.length > 0, placeholderData: (prev) => prev,
  });
  const cardOf = new Map((cardsQ.data ?? []).map((c) => [c.listing_id, c]));
  // 관심 정도 — 광고(매물) 단위(0205). 목록에 선 광고만. 저장 수 · 오늘 본 사람 수
  const intAds = (cardsQ.data ?? []).flatMap((c) => (c.ad_id ? [c.ad_id] : [])).slice(0, 200);
  const intQ = useQuery({
    queryKey: ["interest", intAds.join()],
    queryFn: () => interestApi.of(intAds),
    enabled: sale && intAds.length > 0, placeholderData: (prev) => prev, staleTime: 60_000,
  });
  const intOf = new Map((intQ.data ?? []).map((x) => [x.ad_id, x]));
  const uv = { basis: realBasis, unit: realUnit };   // 총액 · 단가 — 지도와 목록이 같은 값을 본다

  const items = suggest.data ?? [];
  const go = (pnu: string) => openParcel(pnu);   // 리다이렉트=새탭(사이트 규칙)

  // 자동완성 선택 — 클릭 동작 통일(§3.1a 개편): 건물=지도 이동+선택 · 지역/역=지도 이동
  function pickFromSuggest(s: { kind?: string; building_pk?: string | null; pnu?: string | null; addr?: string; lng?: number | null; lat?: number | null; bjd_code?: string | null }) {
    setQ(""); setActive(-1);
    // 고른 대상 크기에 맞춰 확대한다 — 건물은 필지가 보여야 하고, 동·역은 주변이 보여야 한다.
    // 나대지는 필지 하나가 대상이라 건물과 같은 배율로 붙는다
    const zoom = s.kind === "region" ? 15 : s.kind === "station" ? 16 : 18;
    if (s.lng && s.lat) setCenterReq({ lng: s.lng, lat: s.lat, zoom });
    // 지역을 골랐으면 **그 동이 지역 필터가 된다** — 지도만 옮기면 핀은 「내 매물」뿐이라 빈 동네가 섰다(2026-09-06 대표 지적).
    if (s.kind === "region" && s.bjd_code) {
      setFRegions([{ bjd_code: s.bjd_code, label: (s.addr ?? "").replace("서울특별시 ", "") }]);
      resetPages();
    }
    // 건물 · 나대지 모두 지번으로 고른다(10-08) — 나대지는 동이 없는 지번일 뿐이다
    if ((s.kind === "building" || s.kind === "vacant" || !s.kind) && s.pnu) selectParcel(s.pnu);
  }
  // 지번 고르기 — 지도 클릭 · 자동완성 공통. 핀에 있으면 그 핀(분류색), 없으면 지번을 읽어 카드를 세운다
  // 지번의 핀 — 그 지번에 매물 줄이 여럿(탐색은 매물마다 한 줄)이면 **1번 매물**(지도에 서는 가격표의 매물)
  const pinOf = (pnu: string) => {
    const c = mapPinList.filter((p) => p.pnu === pnu);
    return c.find((p) => p.listing_id != null && (p.rank ?? 1) === 1) ?? c[0] ?? null;
  };
  // 매물 주인 → 핀 종류(색 · 판의 버튼)
  const kindOf = (owner: string | null | undefined): MapPin["kind"] =>
    owner === "mine" ? "mine" : owner === "office" ? "ad" : owner === "crawl" ? "market" : "normal";

  async function selectParcel(pnu: string) {
    const inPin = pinOf(pnu);
    if (inPin) { setPicked(inPin); return; }
    try {
      const b = await parcelsApi.get(pnu);
      // 핀에 없는 땅을 짚었을 때 — 이 땅의 1번 매물을 고른 것으로 연다(핀을 고른 것과 같은 규칙)
      const first = ((b.listings as ParcelListing[] | undefined) ?? [])[0];
      setPicked({
        pnu, building_pk: (b.rep_pk as string | null) ?? undefined, addr: String(b.addr ?? ""),
        lng: Number(b.lng), lat: Number(b.lat),
        col: b.my_listing_id != null ? "mine" : "normal",
        listing_id: first?.listing_id ?? null, rank: first?.rank ?? null, owner: first?.owner ?? null, office: first?.office ?? null,
        kind: kindOf(first?.owner),
        // 값은 핀에서 고를 때와 **같은 재료**로 채운다 — 매매가는 이 땅 1번 매물의 값, 수익률은 내 매물 값
        price: first?.price ?? null,
        roi: b.roi != null ? Number(b.roi) : null,
        sale_est: b.sale_est != null ? Number(b.sale_est) : null,
        land_area: b.parcel_area != null ? Number(b.parcel_area) : null,
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

  // 숨김 — 숨긴 건물 목록(하나씩 또는 전부 다시 보기). 두 화면 머리에 같이 선다
  const hidPill = hidden.length > 0 && (
                      <span className="hid-wrap">
                        <button className={`hid-pill ${hidOpen ? "on" : ""}`} onClick={() => setHidOpen(!hidOpen)}>
                          <Icon name="hide" size={12} />숨김 <b>{hidden.length}</b>
                        </button>
                        {/* 숨긴 건물 — 하나씩 또는 전부 다시 보기 */}
                        {hidOpen && (
                          <div className="hid-pop" onMouseLeave={() => setHidOpen(false)}>
                            {hiddenRows.map((h) => (
                              <div key={h.pnu} className="hid-row">
                                <span>{h.addr.replace("서울특별시 ", "").replace("번지", "") || h.pnu}</span>
                                <button title="다시 보기" onClick={() => unhide(h.pnu)}><Icon name="eye" size={14} /></button>
                              </div>
                            ))}
                            <button className="hid-all" onClick={() => { unhide(null); setHidOpen(false); }}>모두 다시 보기</button>
                          </div>
                        )}
                      </span>
                    );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
      {/* 검색·조건·건수·정렬은 전부 지도 위 패널 안으로 들어갔다(2026-08-27).
          예전엔 검색바·조건칩·결과바가 지도 위에 세 층으로 쌓여 지도가 그만큼 눌렸다. */}

      {/* 매수자 조건 편집 중 — 지도·필터·그리기로 다듬고 여기서 되저장한다 */}
      {bc && <BuyerCondBar bc={bc} values={fValues} regions={fRegions} filters={filters}
        polygon={polygon} onDone={() => nav2("/sales")} />}

      {/* 상세보기 = 사이드바를 늘린 판(10-01) — 사이드바(광고)는 그대로 두고 그 오른쪽을 덮는다 */}
      {sheetPnu && <BuildingSheetModal pnu={sheetPnu} onClose={closeSheet} left={panelOpen ? 72 + 400 : 72}
        onOpen={(pnu) => { const n = new URLSearchParams(sp); n.set("p", pnu); setSp(n, { replace: true, state: loc.state }); }} />}
      {seekFor && <SeekModal pnu={seekFor.pnu} addr={seekFor.addr} onClose={() => setSeekFor(null)}
        onDone={() => { setSeekFor(null); qc.invalidateQueries({ queryKey: ["seeks"] }); }} />}
      {propose && <ProposeModal seek={propose} onClose={() => setPropose(null)}
        onDone={() => { setPropose(null); qc.invalidateQueries({ queryKey: ["seeks"] }); }} />}

      {/* 지도 한 장(2026-08-27) — 지도가 바탕을 다 덮고 검색 패널이 그 위에 뜬다.
          예전엔 좌 360px + 우 지도로 칸을 나눠서, 패널을 접어도 지도가 안 넓어졌다.
          패널은 목록과 선택 카드를 번갈아 맡는다: 고르면 같은 자리가 카드가 된다.
          「2열 목록」 뷰는 지웠다(2026-08-28) — 뷰를 바꾸는 길이 없어져 옛 세션으로만
          닿는 죽은 화면이었고, 폐지한 보라와 설명글씨가 거기 남아 있었다. */}
      <div className={`map-one ${drawFocus ? "drawing" : ""}`}>
          <div className="map-canvas">
            {(salePins.isFetching || dealPins.isFetching || seekAll.isFetching || mrentQ.isFetching) && <LoadingOverlay label="불러오는 중" />}
            {/* 그리기 화면 — 지도를 살짝 어둡게(누름은 지도로 그대로 간다) + 아래 도구 · 적용 막대 */}
            {drawFocus && <div className="draw-dim" />}
            {drawFocus && (
              <div className="draw-bar">
                <div className="db-tools">
                  {([["free", "자유곡선"], ["poly", "다각형"], ["circle", "원"]] as const).map(([k, t]) => (
                    <button key={k} className={drawMode === k ? "on" : ""} onClick={() => pickTool(k)}>{t}</button>
                  ))}
                  {condPolys.length > 0 && <button className="clr" onClick={() => setCondPolys([])}>지우기</button>}
                </div>
                <button className="db-apply" onClick={endDraw}>적용</button>
              </div>
            )}
            <MapPanel
              pins={mapPinsShown}
              polygons={condOpen ? condPolys : polygons}
              polygonActive={(condOpen ? condPolys : polygons).length > 0}
              noDrawTool keepDraw drawReq={drawReq} onDrawMode={setDrawModeNow}
              selectedPnu={picked?.pnu ?? null}
              selectedCol={mapPinsShown.find((p) => p.pnu === picked?.pnu)?.kind ?? picked?.col ?? null}
              centerReq={centerReq}
              priceMode={priceMode}
              realView={{ basis: realBasis, unit: realUnit }}
              autoFit={false}
              onView={setView}
              rvReq={rvReq} rvMedia={picked ? rvMedia : null}
              onRvClose={(v) => { if (v) setRvBack((r) => ({ ...v, n: (r?.n ?? 0) + 1 })); }}
              onParcelClick={(pnu) => selectParcel(pnu)}
              onPick={(pnu) => setPicked(pinOf(pnu))}
              // 새 영역은 더한다(null = 전부 지우기). 여러 상권을 동시에 보는 게 현장 방식이다.
              onPolygon={(g) => {
                if (condOpen) { setCondPolys((ps) => (g ? [...ps, g] : [])); return; }   // 조건 화면에선 적용 전까지 대기
                setPolygons((ps) => (g ? [...ps, g] : [])); setPages({ mine: 1, normal: 1 });
              }}
            />
            {/* 가격지표 도구바(S06 §2, 대표 09-30) — 오른쪽 위 세로, 지도 모서리에 마진 없이 붙는다(왼쪽 판처럼).
                칸 사이도 붙은 그리드. 설정은 아이콘만, 나머지는 글자만.
                맨 위 설정 = 오른쪽에서 덮는 판. 실거래 = 켜고 끄기만. 단위 = 총액 → 토지 단가 → 건물 단가 */}
            <div className="mp-bar top">
              <button className={`mp-t set ${setOpen ? "open" : ""}`} title="가격지표 설정" onClick={() => setSetOpen(true)}>
                <Icon name="settings" size={18} /></button>
              {/* 추정가는 지표에서 뺐다(대표 09-30) — 매물 찾기는 실거래로 견주고, 추정가는 상세 · 구해요에서 본다 */}
              <button className={`mp-t ind-deal ${deal.on ? "on" : ""} ${deal.on && !near ? "mute" : ""}`}
                title={deal.on && !near ? "지도를 더 확대하면 보입니다" : undefined}
                onClick={() => setDeal({ ...deal, on: !deal.on })}>
                실거래
              </button>
              {broker && explore && ([["mrent", "임대시세", mrent, setMrent]] as const).map(([k, t, d, set]) => {
                const mute = d.on && !near;
                return (
                  <button key={k} className={`mp-t ind-${k} ${d.on ? "on" : ""} ${mute ? "mute" : ""}`}
                    title={mute ? "지도를 더 확대하면 보입니다" : undefined} onClick={() => set({ ...d, on: !d.on })}>
                    {t}{k === "mrent" && d.on && <i>{RENT_FLOOR[opt.floor]}</i>}
                  </button>
                );
              })}
              <button className="mp-t" onClick={() => setRealBasis(realBasis === "total" ? "land" : realBasis === "land" ? "bldg" : "total")}>
                {realBasis === "total" ? "총액" : <>{realBasis === "land" ? "토지단가" : "건물단가"}<small>/{realUnit === "py" ? "평" : "㎡"}</small></>}</button>
              {/* 평 · ㎡ — 누를 때마다 바뀐다. 앱 전체 면적 단위(useUnit)라 목록 · 상세 면적까지 같이 바뀐다 */}
              <button className="mp-t mp-unit" title="면적 단위" onClick={() => setRealUnit(realUnit === "py" ? "m2" : "py")}>
                <Icon name="swap" size={13} />{realUnit === "py" ? "평" : "㎡"}</button>
            </div>
            {setOpen && (
              <IndSettings deal={deal} setDeal={setDeal}
                market={broker && explore ? { mrent, setMrent } : null} opt={opt} setOpt={setOpt}
                saleYears={saleYears} saleYrs={saleYrs} setSaleYears={setSaleYears} setSaleYrs={setSaleYrs}
                basis={realBasis} setBasis={setRealBasis} unit={realUnit} setUnit={setRealUnit}
                onClose={() => setSetOpen(false)} />
            )}
          </div>

          {/* 떠 있는 패널 — 접으면 지도가 통째로 드러난다 */}
          {panelOpen && condOpen && drawFocus ? null : panelOpen && condOpen ? (
            <div className="mo-panel cond">
              <Conditions countTab={explore ? "explore" : sale ? "ad" : "all"} hideLabels={["매물 유형"]} profile={sale ? "sale" : "seek"}
                baseFilters={{ kinds: kinds.length ? kinds : undefined }}
                initialValues={fValues} initialRegions={fRegions} initialPolygon={polygon}
                onApply={(r) => {
                  // 매물 유형은 사이드바 줄이 맡는다 — 조건 판은 건드리지 않는다
                  const { kinds: _k, ...rf } = r.filters as AttrFilters; void _k;
                  setFilters(rf); setFValues(r.values); setFRegions(r.regions); setPolygons(condPolys); resetPages(); }}
                onClose={closeCond}
                draw={{ polygons: condPolys, mode: drawMode,
                  onMode: pickTool,
                  onClear: () => setCondPolys([]) }} />
            </div>
          ) : panelOpen ? (
            <div className={`mo-panel ${picked ? "detail" : ""}`}>
              {/* 건물을 고르면 상세가 판 전체를 쓴다(대표 09-28) — 검색 · 칩은 「‹ 목록」으로 돌아오면 다시 선다 */}
              {/* 검색 — 패널 머리. 자동완성은 그 아래로 편다 */}
              <div className="mo-search">
                <div className="mo-q">
                  <Icon name="search" size={16} />
                  <input placeholder="주소 또는 지명" value={q} autoComplete="off"
                    onChange={(e) => { setQ(e.target.value); setActive(-1); }} onKeyDown={onKey} />
                  {q.trim() && <button className="mo-x" onClick={() => { setQ(""); setActive(-1); }} title="지우기">
                    <Icon name="close" size={13} /></button>}
                </div>
                <button className={`mo-filter ${filterCount ? "on" : ""}`} onClick={openCond}>
                  조건{filterCount ? ` ${filterCount}` : ""}</button>
                {/* 숨김 — 목록 머리를 걷어(09-30) 검색 줄 필터 옆으로 옮겼다. 숨긴 건물이 있을 때만 선다 */}
                {hidPill}
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

              {/* 매물 유형 · 거래 유형(S06 §1, 대표 09-30) — 이름 한 칸 + 큼직한 버튼 줄. 매물 유형은 여러 개를 같이 켠다.
                  조건 판에선 이 줄을 따로 세우지 않는다. 거래 유형은 지금 매매 하나 — 두 화면 똑같이 선다 */}
              <div className="mo-type">
                <div className="mt-row wrap"><span>매물 유형</span>
                  <div className="mt-btns wrap g3">
                    {KINDS.map((k) => (
                      <button key={k} className={kinds.includes(k) ? "on" : ""}
                        onClick={() => setKinds((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]))}>{k}</button>
                    ))}
                  </div>
                </div>
                <div className="mt-row"><span>거래 유형</span>
                  <div className="mt-btns"><button className="on">매매</button></div>
                </div>
                {/* 원천(S08 §3) — 내 매물 → 빌탐정 매물 → 네이버 매물. 켜고 끈다. 수 = 목록 범위 안 */}
                {explore && (
                  <div className="mt-row"><span>보기</span>
                    <div className="mt-btns">
                      {(["mine", "ad", "market"] as const).map((k) => (
                        <button key={k} className={src[k] ? "on" : ""} onClick={() => setSrc({ ...src, [k]: !src[k] })}>
                          {SRC_LABEL[k]} <b className="num">{srcN[k].toLocaleString()}</b></button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {picked ? (
                <div className="mo-body sd-wrap">
                  <SideDetail picked={picked} broker={broker}
                    // 같은 지번의 다른 매물로 — 매물 번호 · 값 · 주인만 바뀐다(땅은 그대로)
                    onListing={(l) => setPicked({ ...picked, listing_id: l.listing_id, rank: l.rank, price: l.price, owner: l.owner, office: l.office,
                      kind: kindOf(l.owner), col: l.owner === "mine" ? "mine" : "normal" })}
                    onFull={(v) => setRvReq((r) => ({ ...v, n: (r?.n ?? 0) + 1 }))}
                    rvBack={rvBack} onMedia={setRvMedia}
                    onBack={() => setPicked(null)}
                    onDetail={(newTab) => (newTab ? go(picked!.pnu) : openSheet(picked!.pnu))}
                    onHide={() => { hide(picked!.pnu, picked!.addr); setPicked(null); }}
                    seekMode={!sale} sheetOpen={!!sheetPnu}
                    explore={explore ? {
                      // 담기(S08 §5) — 매물 등록과 같은 동작. 담당 = 누른 사람. 시장 호가는 어디에도 안 옮긴다
                      onClaim: async () => {
                        const me = await qc.fetchQuery({ queryKey: ["me"], queryFn: authApi.me });
                        // 담으면 내 매물이 새로 생긴다 — 판은 그 새 매물 번호로 옮겨 간다
                        const r = await listingsApi.claim(picked!.pnu, me.account_id);
                        setPicked({ ...picked!, listing_id: r.listing_id, rank: 1, owner: "mine", kind: "mine", col: "mine" });
                        qc.invalidateQueries({ queryKey: ["pinsSale"] }); qc.invalidateQueries({ queryKey: ["sellers"] });
                        qc.invalidateQueries({ queryKey: ["parcel", picked!.pnu] });
                      },
                      onOpen: () => nav2(picked!.listing_id != null ? `/sales?listing=${picked!.listing_id}` : `/sales?parcel=${picked!.pnu}`),
                    } : undefined}
                    onSeek={() => setSeekFor({ pnu: picked!.pnu, addr: picked!.addr })}
                    onPropose={setPropose} />
                </div>
              ) : (
              sale ? (
                <div className="mo-body">
                    {boxMoved && (
                      <button className="mo-here" onClick={() => setListBox(view!.bbox)}>
                        <Icon name="reset" size={12} />현재 위치 매물 <b className="num">{nowN}</b>개</button>
                    )}
                    {shown.map((p, i) => {
                      // 탐색은 원천마다 끊는다(S08 §3) — 묶음 머리 「내 매물 3」
                      const grp = explore && (i === 0 || srcOf(shown[i - 1]) !== srcOf(p))
                        ? <div className="ml-grp">{SRC_LABEL[srcOf(p)]}<b className="num">{srcN[srcOf(p)].toLocaleString()}</b></div> : null;
                      const pick = () => { setPicked(p); if (p.lng && p.lat) setCenterReq({ lng: p.lng, lat: p.lat }); };
                      if (explore && p.kind === "market") {
                        // 네이버 매물 카드 — 주소 · 매물유형 · 최저 호가 · 수집일 · 같은 건물 광고 수
                        const mp = valueLabel(p.price, { basis: realBasis, unit: realUnit }, p.land_area, p.total_area);
                        return (
                          <Fragment key={`${p.pnu}-${p.listing_id ?? ""}`}>{grp}
                            <ListingCard onClick={pick} kind="매매"
                              tag={p.major ? `#${p.major}` : ""}
                              title={p.addr.replace("서울특별시 ", "").replace("번지", "")}
                              price={mp ? `${mp}${realBasis === "total" ? "" : `/${realUnit === "py" ? "평" : "㎡"}`}` : ""}
                              sub={`대지 ${areaOf(p.land_area, 0)} · 연 ${areaOf(p.total_area, 0)}${p.mk_on ? ` · ${p.mk_on.slice(2).replace(/-/g, ".")}` : ""}${(p.mk_n ?? 0) > 1 ? ` · ${p.mk_n}곳` : ""}`} />
                          </Fragment>
                        );
                      }
                      // 카드 한 장 = 매물 하나(0226) — 매매가는 그 매물의 값 하나. 광고가 걸려 있으면 광고가 얼굴이다
                      const c = p.listing_id != null ? cardOf.get(p.listing_id) : undefined;
                      const face = c?.ad_id ? c : null;
                      // 가격은 지도와 같은 눈금(총액 · 토지/건물 단가) — 목록과 핀을 같은 단위로 견준다
                      const la = c?.land_area ?? p.land_area, ta = c?.total_area ?? p.total_area;
                      const fmt = (v: number | null | undefined) => valueLabel(v, uv, la, ta) ?? "—";
                      const unitSuf = realBasis === "total" ? "" : `/${realUnit === "py" ? "평" : "㎡"}`;
                      const priceV = c?.price ?? p.price;
                      const price = p.kind === "sold" ? ""
                        : face && face.price_open === false && !c?.mine ? "가격 비공개"
                        : priceV != null ? `${fmt(priceV)}${unitSuf}` : (c?.mine || p.kind === "mine" ? "미정" : "");
                      const photo = face?.ad_photo_id ? `/api/ads/${face.ad_id}/photos/${face.ad_photo_id}` : null;
                      return (
                        <Fragment key={`${p.pnu}-${p.listing_id ?? ""}`}>{grp}
                        <ListingCard onClick={pick}
                          // 윗줄 = 중개사(디스코식) — 광고면 올린 중개사 · 올린 지, 광고 없는 내 매물이면 우리 담당
                          agent={(face ? face.agent_name : c?.assignee_name) ?? null} agentPhoto={face?.agent_photo} rank={face?.agent_title ?? null}
                          office={c?.office ?? null}
                          when={face ? ago(face.ad_created_at ?? "") : c?.mine ? "내 매물" : ""}
                          tag={`${c?.use_type ? `#${c.use_type}` : ""}${p.kind === "sold" ? " · 거래완료" : ""}${
                            explore && p.kind === "mine" && (c?.my_hold || c?.my_status) ? ` · ${c.my_hold ?? c.my_status}` : ""}`}
                          // 제목(광고가 이 매물을 한 줄로) — 없으면 주소
                          title={face?.title || p.addr.replace("서울특별시 ", "").replace("번지", "")}
                          price={price}
                          sub={`대지 ${areaOf(c?.land_area ?? p.land_area, 0)} · 연 ${areaOf(c?.total_area ?? p.total_area, 0)}${
                            c?.floors_above != null ? ` · ${c.floors_above}F${c.floors_below ? ` / B${c.floors_below}` : ""}` : ""}`}
                          interest={face?.ad_id ? interestText(intOf.get(face.ad_id)) : null}
                          photo={photo}>
                          <button className="ml-hide" title="숨기기"
                            onClick={(e) => { e.stopPropagation(); hide(p.pnu, p.addr); }}>
                            <Icon name="hide" size={13} /></button>
                        </ListingCard>
                        </Fragment>
                      );
                    })}
                    {listPins.length > shown.length && <div className="sc-more" style={{ padding: "8px 14px" }}>외 {listPins.length - shown.length}개 · 지도를 좁혀 보세요</div>}
                    {listPins.length === 0 && !salePins.isFetching && (
                      <div className="sel-empty">조건에 맞는 매물이 없습니다</div>
                    )}
                  </div>
              ) : (
                <div className="mo-body">
                  {/* 머리 — 전체 | 구해요(S06 §3). 고객 · 중개사가 같은 목록을 본다 */}
                  <div className="ml-head">
                    <span className="ml-tabs">
                      <button className={seekTab === "all" ? "on" : ""} onClick={() => setSeekTab("all")}>
                        전체{seekN0 != null && hasCond && <b className="num">{seekN0.toLocaleString()}</b>}</button>
                      <button className={seekTab === "seek" ? "on" : ""} onClick={() => setSeekTab("seek")}>
                        구해요<b className="num">{seekRows.length}</b></button>
                    </span>
                  </div>
                  {!hasCond && <div className="sel-empty">지역이나 조건을 걸어 주세요</div>}
                  {seekTab === "all" && hasCond && seekN0 != null && seekN0 > SEEK_MAX &&
                    <div className="sel-empty"><b className="num">{seekN0.toLocaleString()}</b>건 · 조건을 더 좁혀 주세요</div>}
                  {seekTab === "all" && seekOk && baseList.length === 0 && !seekAll.isFetching && <div className="sel-empty">조건에 맞는 건물이 없습니다</div>}
                  {seekTab === "seek" && hasCond && seekRows.length === 0 && !seeksQ.isFetching && <div className="sel-empty">조건에 맞는 구해요가 없습니다</div>}
                  {baseList.map((p) => {
                    const n = seekN.get(p.pnu) ?? 0;
                    const it = "";   // 구해요 목록은 건물 단위라 관심(광고 단위)을 안 싣는다
                    return (
                      <div key={p.pnu} className="sk-b">
                        <div className="ml-row sk" onClick={() => { setPicked(p); if (p.lng && p.lat) setCenterReq({ lng: p.lng, lat: p.lat }); }}>
                          <div className="sk-l">
                            <span className="ml-a">{p.addr.replace("서울특별시 ", "").replace("번지", "")}</span>
                            {(it || (n > 0 && seekTab === "all")) && <span className="sk-sub num">{it}{n > 0 && seekTab === "all" && <em>구해요 {n}</em>}</span>}
                          </div>
                          <span className="ml-nums est">{valueLabel(p.sale_est ?? null, uv, p.land_area, p.total_area) ?? "—"}</span>
                          <button className="ml-hide" title="숨기기"
                            onClick={(e) => { e.stopPropagation(); hide(p.pnu, p.addr); }}><Icon name="hide" size={13} /></button>
                        </div>
                        {/* 구해요 탭 — 건물 아래 구해요마다 한 줄. 이름 · 연락처 · 가격은 없다 */}
                        {seekTab === "seek" && seekRows.filter((x) => x.pnu === p.pnu).map((x) => (
                          <SeekLine key={x.id} x={x} broker={broker} onPropose={() => setPropose(x)} />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )
              )}
            </div>
          ) : (
            <button className="mo-open" title="패널 펴기" onClick={() => setPanelOpen(true)}>›</button>
          )}
      </div>
    </div>
  );
}

/** 가격지표 설정 판(S06 §2, 대표 09-30) — 왼쪽 ☰ 판처럼 오른쪽 끝에서 지도 위를 덮는다.
 *  고르는 칸은 매물 유형 줄과 같은 그리드(칸이 줄을 꽉 채우고 고른 칸만 연파랑). 판 밖 · Esc 로 닫힌다 */
function IndSettings(p: {
  deal: Ind; setDeal: (d: Ind) => void;
  market: { mrent: Ind; setMrent: (d: Ind) => void } | null;
  opt: IndOpt; setOpt: (o: IndOpt) => void;
  saleYears: number; saleYrs: number[]; setSaleYears: (v: number) => void; setSaleYrs: (v: number[]) => void;
  basis: "total" | "land" | "bldg"; setBasis: (v: "total" | "land" | "bldg") => void;
  unit: "py" | "m2"; setUnit: (v: "py" | "m2") => void; onClose: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") p.onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [p]);
  const now = new Date().getFullYear();
  const u = p.unit === "py" ? "평" : "㎡";   // 단가 이름 뒤에 붙는 면적 단위
  const row = (label: string, cells: [string, boolean, () => void][], wrap: boolean | "g3" = false) => (
    <div className={`mt-row ${wrap ? "wrap" : ""}`}><span>{label}</span>
      <div className={`mt-btns ${wrap ? "wrap" : ""} ${wrap === "g3" ? "g3" : ""}`}>{cells.map(([t, on, f]) => <button key={t} className={on ? "on" : ""} onClick={f}>{t}</button>)}</div>
    </div>
  );
  const o = p.opt, setO = p.setOpt;
  // 실거래 유형(0246) — 여럿 고름, 고른 칸을 다시 누르면 풀린다. 아무것도 안 고르면 전체. 신고 갈래라 매물 유형과 다른 칸
  const types = (cur: string[], set: (v: string[]) => void) => row("실거래유형",
    TRADE_TYPES.map((k) => [k, cur.includes(k), () => set(cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k])] as [string, boolean, () => void]), "g3");
  // 묶음 머리 = 켜고 끄기(대표 09-30). 켜면 머리가 파랗게 차고, 꺼지면 아래 설정 줄이 통째로 회색
  const head = (label: string, d: Ind, set: (d: Ind) => void) => (
    <button className={`iset-h tg ${d.on ? "on" : ""}`} onClick={() => set({ ...d, on: !d.on })}>{label}</button>
  );
  return createPortal((
    <div className="iset-bg" onClick={p.onClose}>
      <aside className="iset" onClick={(e) => e.stopPropagation()}>
        <div className="iset-top"><b>가격지표 설정</b>
          <button className="iset-x" title="닫기" onClick={p.onClose}><Icon name="close" size={16} /></button></div>
        {head("실거래", p.deal, p.setDeal)}
        <div className={`mo-type ${p.deal.on ? "" : "off"}`}>
          {types(o.tradeTypes, (v) => setO({ ...o, tradeTypes: v }))}
          {row("기간", [[1, "1년"], [3, "3년"], [5, "5년"], [0, "전체"]].map(([v, t]) =>
            [t as string, !p.saleYrs.length && p.saleYears === v, () => { p.setSaleYrs([]); p.setSaleYears(v as number); }]))}
          {/* 연도 — 한 해씩 켜고 끈다(여러 해 같이). 하나라도 켜면 위 기간 대신 이것. 줄바꿈 격자 */}
          {row("연도", Array.from({ length: now - 2005 }, (_, i) => now - i).map((y) => [String(y), p.saleYrs.includes(y),
            () => p.setSaleYrs(p.saleYrs.includes(y) ? p.saleYrs.filter((x) => x !== y) : [...p.saleYrs, y])]), true)}
        </div>
        {p.market && (() => {
          const m = p.market;
          return <>
            {head("임대시세", m.mrent, m.setMrent)}
            <div className={`mo-type ${m.mrent.on ? "" : "off"}`}>
              {row("층", (["B", "1", "2", "3"] as IndOpt["floor"][]).map((f) =>
                [RENT_FLOOR[f], o.floor === f, () => setO({ ...o, floor: f })]))}
              {row("승강기", [["전체", o.elev === "all", () => setO({ ...o, elev: "all" })],
                ["있음", o.elev === "y", () => setO({ ...o, elev: "y" })],
                ["없음", o.elev === "n", () => setO({ ...o, elev: "n" })]])}
              {row("종류", [["전체", o.use === "all", () => setO({ ...o, use: "all" })],
                ["상가", o.use === "상가", () => setO({ ...o, use: "상가" })],
                ["사무실", o.use === "사무실", () => setO({ ...o, use: "사무실" })]])}
            </div>
          </>;
        })()}
        <div className="iset-h">단위</div>
        <div className="mo-type">
          {row("가격", [["총액", p.basis === "total", () => p.setBasis("total")],
            [`토지 단가/${u}`, p.basis === "land", () => p.setBasis("land")], [`건물 단가/${u}`, p.basis === "bldg", () => p.setBasis("bldg")]])}
          {row("면적", [["평", p.unit === "py", () => p.setUnit("py")], ["㎡", p.unit === "m2", () => p.setUnit("m2")]])}
        </div>
      </aside>
    </div>
  ), document.body);
}

/* 매수자 조건 저장 바 — 지금 화면의 조건(필터·지역·그린 영역)을 그대로 그 매수자에게 붙인다. */
function BuyerCondBar({ bc, values, regions, filters, polygon, onDone }: {
  bc: BuyerCondNav; values: Values; regions: RegionPick[]; filters: AttrFilters;
  polygon: object | null; onDone: () => void;
}) {
  const [name, setName] = useState(bc.name);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    // 접어둔 건물도 이 사람 조건에 붙는다 — 「이 사람 것은 아니다」라는 판단이라
    // 다른 매수자·다른 조건에서는 그대로 보인다(2026-08-28).
    // 숨김은 조건에 싣지 않는다(0197 — 계정마다 따로 저장)
    const conditions = { values, regions, polygon, filters };
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
