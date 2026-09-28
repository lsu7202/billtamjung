import { LoadingOverlay } from "../../shared/ui/Spinner";
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { searchApi, buildingsApi, listingsApi, buyersApi, type AttrFilters } from "../../shared/api/endpoints";
import { useIsBroker } from "../../shared/store/auth";
import { SideDetail } from "./SideDetail";
import { AuthImg } from "../../shared/ui/AuthImg";
import { valueLabel } from "../../shared/map/mapCanvasLayer";
import { openDetail, mergeGeo } from "../../shared/map/geo";
import { MapPanel, MapPin } from "../../shared/map/MapPanel";
import { FilterModal, activeCount, conditionChips, type Values, type RegionPick } from "./FilterModal";
import { pruneFilters, filterChips, KINDS, DEFAULT_KINDS } from "./filterConfig";
import "./search.css";
import { Icon } from "../../shared/ui/Icon";
import { Segmented } from "../../shared/ui/Segmented";

/** S01 매물 통합검색 — 자동완성 + 지역(구/동) + 3열 목록 + 지도 뷰(핀·영역 그리기) */


const PY = 3.3058;                                    // ㎡→평
const pyOf = (m2?: number | null) => (m2 == null ? "—" : `${(m2 / PY).toFixed(m2 / PY < 100 ? 1 : 0)}평`);

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
  const broker = useIsBroker();
  // 검색 탭(S05 §2) — 실거래 · 매매 · 전체. 예전 「추정가 / 실거래가」 토글을 대신한다.
  // 핀 값: 실거래=거래가 · 매매=광고가(내 매물은 매매가) · 전체=추정가
  // 보기(S05, 09-28 대표) — 켜고 끄는 칩 셋. 여러 개를 같이 켠다(밸류맵 방식, 슬라이드 아님).
  //   매매       광고 + 내 매물(중개사). 기본 켬. 목록이 이것을 보여 준다
  //   실거래     기간 안에 거래가 있던 건물. 매매와 같이 켜서 견준다. 목록엔 안 선다
  //   전체 건물  매물 밖까지 — 「매물 안에선 못 찾겠다」 할 때만 켠다. 기본 끔
  const [layers, setLayers] = useState<{ sale: boolean; deal: boolean; all: boolean }>(
    (saved.layers as { sale: boolean; deal: boolean; all: boolean }) ?? { sale: true, deal: false, all: false });
  const [chip, setChip] = useState<"" | "mine" | "ads">("");     // 매매(중개사): 전체 · 내 매물 · 광고만
  // 매물 유형(0193) — 사이드 판 칩과 필터 창이 같은 값. 빈 목록 = 다 봄. 기본은 기타만 끈다
  const [kinds, setKinds] = useState<string[]>((saved.kinds as string[]) ?? DEFAULT_KINDS);
  const priceMode = "fair" as const;   // 핀마다 lens 를 싣는다(실거래 핀만 real)
  // 지도 화면 범위 — 지도가 멈출 때마다. 목록은 「현재 위치 매물 N개」를 눌러야 따라온다(디스코 방식)
  const [view, setView] = useState<{ bbox: [number, number, number, number]; zoom: number } | null>(null);
  const [listBox, setListBox] = useState<[number, number, number, number] | null>(null);
  // 실거래를 지도에서 견주는 눈금(밸류맵식). **기본은 대지면적 · 평**이다 — 연면적이 아니다.
  const [realBasis, setRealBasis] = useState<"total" | "land" | "bldg">((saved.realBasis as any) ?? "total");   // 기본 총액(밸류맵)
  const [realUnit, setRealUnit] = useState<"py" | "m2">((saved.realUnit as any) ?? "py");
  const [saleYears, setSaleYears] = useState<number>((saved.saleYears as number) ?? 3);   // 0 = 전체 · 기본 3년(대표 09-28)
  /** 시작 연도를 직접 고른 경우(밸류맵식). 고르면 `saleYears` 대신 이것이 이긴다.
   *
   *  **이건 「거르기」가 아니라 「보기 범위」다.** 검색 필터의 「실거래일」과 같은 값을 두
   *  곳에서 고치게 두면 어느 쪽이 이겼는지 아무도 모른다. 그래서 성격을 갈랐다 —
   *  필터는 **어떤 건물을 남길까**, 여기는 **어느 시기 거래를 볼까**(2026-09-05 확정).
   *  목록에서 빼지 않고 값만 지워 회색 점으로 세우는 것도 그래서다. */
  const [saleFrom, setSaleFrom] = useState<number | null>((saved.saleFrom as number) ?? null);
  // 범위의 끝 해(2013~2015). 없으면 지금까지. 연도를 두 번 누르면 시작 · 끝이 된다(대표 09-28)
  const [saleTo, setSaleTo] = useState<number | null>((saved.saleTo as number) ?? null);
  const [yrOpen, setYrOpen] = useState(false);
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
  const [hidden, setHidden] = useState<string[]>(
    pre ? ((pre as { hidden?: string[] }).hidden ?? []).map(String)
        : ((saved.hidden as string[]) ?? []).map(String));
  /** 화면 낱말(`fValues`)로는 안 보이는데 서버로는 걸려 있는 조건.
   *  옛 매수자 조건이 `filters` 만 들고 있어 검색은 좁혀지는데 화면이 그대로였다(2026-09-05). */
  const shownLabels = new Set(conditionChips(fValues).map((c) => c.label));
  const onlyFilterChips = filterChips(filters).filter((c) => !shownLabels.has(c.label));
  const [showFilter, setShowFilter] = useState(false);
  const [pages, setPages] = useState<{ mine: number; normal: number }>((saved.pages as { mine: number; normal: number }) ?? { mine: 1, normal: 1 });

  // 조건 변경 시 스냅샷 저장(전환·새로고침 복원용)
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ q, layers, kinds, realBasis, realUnit, saleYears, saleFrom, saleTo, polygons, sort, filters, fValues, fRegions, pages, hidden }));
  }, [q, layers, kinds, realBasis, realUnit, saleYears, saleFrom, saleTo, polygons, sort, filters, fValues, fRegions, pages, hidden]);
  const bjd = fRegions[0]?.bjd_code ?? "";                       // 단일지역(멀티는 백엔드 확장 예정)
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
  const saleYearsSrv = saleFrom ? new Date().getFullYear() - saleFrom + 1 : (saleYears || 30);
  const area = { bjd_code: polygon ? undefined : bjd || undefined, polygon: polygon ?? undefined };
  const filtersK: AttrFilters = { ...filters, kinds: kinds.length ? kinds : undefined };
  // 실거래 · 전체 건물은 수가 많아 화면 범위로만, 가까이 당겼을 때만 부른다. 매매(광고 · 내 매물)는 적어서 서울 전역
  const NEAR = 15;
  const near = !!view && view.zoom >= NEAR;
  const salePins = useQuery<MapPin[]>({
    queryKey: ["pinsSale", area, filtersK, chip],
    queryFn: () => searchApi.pins({ ...area, filters: filtersK, sort, tab: "ad", chip }) as Promise<MapPin[]>,
    enabled: layers.sale, placeholderData: (prev) => prev,
  });
  const dealPins = useQuery<MapPin[]>({
    queryKey: ["pinsDeal", view?.bbox, saleYearsSrv, saleFrom, saleTo],
    queryFn: () => searchApi.pins({ tab: "deal", sale_years: saleYearsSrv, bbox: view!.bbox,
      sale_from: saleFrom, sale_to: saleTo }) as Promise<MapPin[]>,
    enabled: layers.deal && near, placeholderData: (prev) => prev,
  });
  const allPins = useQuery<MapPin[]>({
    queryKey: ["pinsAll", area, filtersK, view?.bbox],
    queryFn: () => searchApi.pins({ ...area, filters: filtersK, sort, tab: "all", bbox: view!.bbox }) as Promise<MapPin[]>,
    enabled: layers.all && near, placeholderData: (prev) => prev,
  });
  // 접어둔 것은 **여기서** 뺀다. 지도도 목록도 같은 목록을 보므로 한 곳에서 거른다.
  const hideSet = new Set(hidden);
  const saleList = layers.sale ? (salePins.data ?? []).filter((p) => !hideSet.has(p.building_pk)) : [];
  const salePk = new Set(saleList.map((p) => p.building_pk));
  // 한 건물엔 핀 하나 — 매매 > 실거래 > 전체 건물
  // 「내 매물 · 광고만」으로 좁혔으면 지도도 그것만 — 실거래 · 전체 건물 핀은 잠시 내린다(대표 09-28)
  const narrow = chip !== "";
  const dealList = layers.deal && near && !narrow ? (dealPins.data ?? []).filter((p) => !salePk.has(p.building_pk) && !hideSet.has(p.building_pk)) : [];
  const dealPk = new Set(dealList.map((p) => p.building_pk));
  const allList = layers.all && near && !narrow ? (allPins.data ?? []).filter((p) => !salePk.has(p.building_pk) && !dealPk.has(p.building_pk) && !hideSet.has(p.building_pk)) : [];
  const mapPinList = [...allList, ...dealList, ...saleList];
  // 핀 값 — 매매: 광고 최저가(비공개면 없음) · 내 매물은 매매가. 실거래: 거래가(lens real). 전체 건물: 추정가
  const mapPinsShown: MapPin[] = [
    ...allList.map((p) => ({ ...p, kind: "normal" as const, lens: "fair" as const })),
    ...dealList.map((p) => ({ ...p, kind: "normal" as const, lens: "real" as const })),
    ...saleList.map((p) => ({ ...p, lens: "fair" as const, sale_est: p.kind === "mine" ? p.price : (p.ad_price_min ?? null) })),
  ];
  const inBox = (p: MapPin, bx: [number, number, number, number] | null) =>
    !bx || (p.lng >= bx[0] && p.lng <= bx[2] && p.lat >= bx[1] && p.lat <= bx[3]);
  // 목록 = 목록 범위 안의 매매. 지역 · 영역을 걸었으면 범위를 안 따진다(그 조건이 이미 좁혔다)
  const boxFor = bjd || polygon ? null : listBox;
  const listPins = saleList.filter((p) => inBox(p, boxFor))
    .sort((a, b) => Number(b.kind === "mine") - Number(a.kind === "mine"));
  const allInBox = allList.filter((p) => inBox(p, boxFor));
  // 지도가 목록 범위를 벗어났나 → 「현재 위치 매물 N개」
  const boxMoved = !bjd && !polygon && !!view && (!listBox || listBox.join() !== view.bbox.join());
  const nowN = view ? saleList.filter((p) => inBox(p, view.bbox)).length : 0;
  useEffect(() => { if (view && !listBox) setListBox(view.bbox); }, [view, listBox]);
  const cardsQ = useQuery({
    queryKey: ["listCards", listPins.slice(0, 60).map((p) => p.building_pk).join()],
    queryFn: () => buildingsApi.cards(listPins.slice(0, 60).map((p) => p.building_pk)),
    enabled: listPins.length > 0, placeholderData: (prev) => prev,
  });
  const cardOf = new Map((cardsQ.data ?? []).map((c) => [c.building_pk, c]));
  const uv = { basis: realBasis, unit: realUnit };   // 총액 · 단가 — 지도와 목록이 같은 값을 본다

  const items = suggest.data ?? [];
  const go = (pk: string) => openDetail(pk);   // 리다이렉트=새탭(사이트 규칙)

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
        roi_est: b.roi_est != null ? Number(b.roi_est) : null,   // 저장된 파생값(0174) — 핀과 같은 출처
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
      {/* 검색·조건·건수·정렬은 전부 지도 위 패널 안으로 들어갔다(2026-08-27).
          예전엔 검색바·조건칩·결과바가 지도 위에 세 층으로 쌓여 지도가 그만큼 눌렸다. */}

      {/* 매수자 조건 편집 중 — 지도·필터·그리기로 다듬고 여기서 되저장한다 */}
      {bc && <BuyerCondBar bc={bc} values={fValues} regions={fRegions} filters={filters}
        polygon={polygon} hidden={hidden} onDone={() => nav2("/sales")} />}

      {showFilter && (
        <FilterModal
          initialValues={{ ...fValues, "매물 유형": kinds }} initialRegions={fRegions} initialPolygon={polygon} initialHidden={hidden}
          onApply={(r) => {
            // 매물 유형은 사이드 판 칩과 한 값 — 필터 창에서 바꾸면 칩도 따라온다
            const { ["매물 유형"]: mk, ...rest } = r.values as Record<string, unknown>;
            setKinds(Array.isArray(mk) ? (mk as string[]) : []);
            const { kinds: _k, ...rf } = r.filters as AttrFilters; void _k;
            setFilters(rf); setFValues(rest as Values); setFRegions(r.regions); setPolygons(r.polygon ? [r.polygon] : []); setHidden(r.hidden ?? []); resetPages(); }}
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
            {(salePins.isFetching || dealPins.isFetching || allPins.isFetching) && <LoadingOverlay label="불러오는 중" />}
            <MapPanel
              pins={mapPinsShown}
              polygons={polygons}
              polygonActive={polygons.length > 0}
              selectedPk={picked?.building_pk ?? null}
              selectedCol={picked?.col ?? null}
              centerReq={centerReq}
              priceMode={priceMode}
              realView={{ basis: realBasis, unit: realUnit }}
              autoFit={false}
              onView={setView}
              onParcelClick={(pk) => { if (pk) selectBuilding(pk); }}
              onPick={(pk) => setPicked(mapPinList.find((p) => p.building_pk === pk) ?? null)}
              // 새 영역은 더한다(null = 전부 지우기). 여러 상권을 동시에 보는 게 현장 방식이다.
              onPolygon={(g) => { setPolygons((ps) => (g ? [...ps, g] : [])); setPages({ mine: 1, normal: 1 }); }}
            />
            {/* 총액 · 단가 — 지도 오른쪽 위(밸류맵 자리). 모든 가격(매물 · 실거래 · 추정 핀과 목록 카드)에 한꺼번에 걸린다 */}
            <div className="map-unit">
              <Segmented size="sm" value={realBasis === "total" ? "total" : "unit"}
                onChange={(v) => setRealBasis(v === "total" ? "total" : "land")}
                options={[{ value: "total", label: "총액" }, { value: "unit", label: "단가" }]} />
              {realBasis !== "total" && (
                <>
                  <Segmented size="sm" value={realBasis} onChange={setRealBasis}
                    options={[{ value: "land", label: "토지" }, { value: "bldg", label: "건물" }]} />
                  <Segmented size="sm" value={realUnit} onChange={setRealUnit}
                    options={[{ value: "py", label: "평" }, { value: "m2", label: "㎡" }]} />
                </>
              )}
            </div>
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
              {(fRegions.length > 0 || polygons.length > 0 || filterCount > 0
                || onlyFilterChips.length > 0) && (
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
                  {/* `values` 없이 `filters` 만 실려 온 조건 — 안 그리면 「안 걸렸다」로 읽힌다 */}
                  {onlyFilterChips.map((c) => (
                    <span key={c.label} className="chip">{c.label} {c.text}
                      <span className="x" onClick={() => { setFilters({}); resetPages(); }}>✕</span></span>
                  ))}
                </div>
              )}

              {/* 보기 — 켜고 끄는 칩(밸류맵). 매매는 목록, 실거래 · 전체 건물은 지도에 겹친다 */}
              <div className="mo-layers">
                {([["sale", "매매"], ["deal", "실거래"], ["all", "전체 건물"]] as const).map(([k, l]) => (
                  <span key={k} className={`ly ${layers[k] ? "on" : ""} ${narrow && k !== "sale" ? "mute" : ""}`}
                    title={narrow && k !== "sale" ? "내 매물 · 광고만으로 좁힌 동안은 안 보입니다" : undefined}>
                    <button onClick={() => { setLayers((v) => ({ ...v, [k]: !v[k] })); if (k === "deal") setYrOpen(false); }}>{l}
                      {k === "deal" && layers.deal && <small>{saleFrom ? `${saleFrom}~${saleTo ?? ""}` : saleYears ? `${saleYears}년` : "전체"}</small>}</button>
                    {/* 실거래 기간은 실거래 칩 옆 ▾ 에서(밸류맵 「실거래 필터」) — 건물 조건이 아니라 「어느 시기 거래를 견줄까」다 */}
                    {k === "deal" && layers.deal && (
                      <button className="ly-cv" title="기간" onClick={() => setYrOpen((v) => !v)}>▾</button>
                    )}
                  </span>
                ))}
              </div>
              {layers.deal && yrOpen && (
                <div className="mo-yr">
                  <div className="yr-q">
                    {[[1, "1년"], [3, "3년"], [5, "5년"], [10, "10년"], [0, "전체"]].map(([v, t]) => (
                      <button key={v as number} className={!saleFrom && saleYears === v ? "on" : ""}
                        onClick={() => { setSaleFrom(null); setSaleTo(null); setSaleYears(v as number); setYrOpen(false); }}>{t as string}</button>
                    ))}
                  </div>
                  {/* 연도 범위 — 한 번 누르면 그 해부터 지금까지, 한 번 더 누르면 거기까지(2013 → 2015 = 2013~2015). 세 번째는 새로 시작 */}
                  <div className="yr-y">
                    {Array.from({ length: new Date().getFullYear() - 2005 }, (_, i) => new Date().getFullYear() - i).map((y) => {
                      const inR = saleFrom != null && y >= saleFrom && y <= (saleTo ?? new Date().getFullYear());
                      return (
                        <button key={y} className={inR ? "on" : ""}
                          onClick={() => {
                            setSaleYears(0);
                            if (saleFrom == null || saleTo != null) { setSaleFrom(y); setSaleTo(null); return; }
                            if (y === saleFrom) { setSaleTo(null); return; }
                            setSaleFrom(Math.min(saleFrom, y)); setSaleTo(Math.max(saleFrom, y));
                          }}>{y}</button>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* 매물 유형 — 여러 개를 같이 켠다. 필터 창의 「매물 유형」과 같은 값 */}
              <div className="mo-kinds">
                {KINDS.map((k) => (
                  <button key={k} className={kinds.includes(k) ? "on" : ""}
                    onClick={() => setKinds((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]))}>{k}</button>
                ))}
              </div>
              {(layers.deal || layers.all) && !near && (
                <div className="mo-hint">실거래 · 전체 건물은 지도를 더 확대하면 보입니다</div>
              )}

              {/* 실거래 견주기 — 총액이냐 단가냐, 단가면 무엇으로 나누고 어느 단위로 낼 것이냐 */}
              {picked ? (
                <div className="mo-body sd-wrap">
                  <SideDetail picked={picked} broker={broker}
                    onBack={() => setPicked(null)}
                    onDetail={() => go(picked!.building_pk)}
                    onHide={() => { setHidden((v) => [...v, picked!.building_pk]); setPicked(null); }} />
                </div>
              ) : (
                <div className="mo-body">
                  {/* 머리 — 매물 N개 · (중개사) 전체 · 내 매물 · 광고만 */}
                  <div className="ml-head">
                    <span>매물 <b className="num">{layers.sale ? listPins.length : 0}</b>개{
                      salePins.isFetching ? " · 불러오는 중…" : ""}</span>
                    {broker && layers.sale && (
                      <span className="mo-chips2">
                        {([["", "전체"], ["mine", "내 매물"], ["ads", "광고만"]] as const).map(([v, l]) => (
                          <button key={v} className={chip === v ? "on" : ""} onClick={() => setChip(v)}>{l}</button>
                        ))}
                      </span>
                    )}
                    {hidden.length > 0 && (
                      <button className="hid-pill" onClick={() => setHidden([])}>
                        <Icon name="hide" size={12} />접어둠 <b>{hidden.length}</b>
                        <span className="hid-undo">펼치기</span>
                      </button>
                    )}
                  </div>
                  {boxMoved && layers.sale && (
                    <button className="mo-here" onClick={() => setListBox(view!.bbox)}>
                      <Icon name="reset" size={12} />현재 위치 매물 <b className="num">{nowN}</b>개</button>
                  )}
                  {!layers.sale && <div className="sel-empty">매매를 켜면 매물 목록이 섭니다</div>}
                  {listPins.slice(0, 60).map((p) => {
                    const c = cardOf.get(p.building_pk);
                    const ad = c && (c.ad_n ?? 0) > 0;
                    // 가격은 지도와 같은 눈금(총액 · 토지/건물 단가) — 목록과 핀을 같은 단위로 견준다
                    const la = c?.land_area ?? p.land_area, ta = c?.total_area ?? p.total_area;
                    const fmt = (v: number | null | undefined) => valueLabel(v, uv, la, ta) ?? "—";
                    const unitSuf = realBasis === "total" ? "" : `/${realUnit === "py" ? "평" : "㎡"}`;
                    const price = ad ? (c!.price_min == null ? "가격 비공개"
                        : c!.price_min === c!.price_max ? `매매 ${fmt(c!.price_min)}${unitSuf}` : `매매 ${fmt(c!.price_min)} ~ ${fmt(c!.price_max)}${unitSuf}`)
                      : c?.mine ? (c.my_price != null ? `매매 ${fmt(c.my_price)}${unitSuf}` : "매매가 미정") : "";
                    const photo = ad && c!.ad_photo_id ? `/api/ads/${c!.ad_id}/photos/${c!.ad_photo_id}` : null;
                    return (
                      <div key={p.building_pk} className="lc"
                        onClick={() => { setPicked(p); if (p.lng && p.lat) setCenterReq({ lng: p.lng, lat: p.lat }); }}>
                        <div className="lc-ph">{photo ? <AuthImg src={photo} /> : <Icon name="building" size={18} />}</div>
                        <div className="lc-b">
                          <div className="lc-t">
                            {c?.mine && <span className="ml-tag mine">내</span>}
                            {ad && <span className="ml-tag ad">광고{(c!.ad_n ?? 0) > 1 ? ` ${c!.ad_n}` : ""}</span>}
                            {c?.sold && !ad && <span className="ml-tag sold">거래완료</span>}
                            <b className="num">{price}</b>
                          </div>
                          <div className="lc-a">{(c?.main_use_name ?? "")}{c?.main_use_name ? " · " : ""}{p.addr.replace("서울특별시 ", "").replace("번지", "")}</div>
                          <div className="lc-s num">대지 {pyOf(c?.land_area ?? p.land_area)} · 연 {pyOf(c?.total_area ?? p.total_area)}{
                            c?.floors_above != null ? ` · ${c.floors_below ? `B${c.floors_below}/` : ""}${c.floors_above}F` : ""}</div>
                          {ad && <div className="lc-g">{c!.office_name}{c!.agent_name ? ` · ${c!.agent_name}` : ""}</div>}
                        </div>
                        <button className="ml-hide" title="접어두기"
                          onClick={(e) => { e.stopPropagation(); setHidden((v) => [...v, p.building_pk]); }}>
                          <Icon name="hide" size={13} /></button>
                      </div>
                    );
                  })}
                  {listPins.length > 60 && <div className="sc-more" style={{ padding: "8px 14px" }}>외 {listPins.length - 60}개 · 지도를 좁혀 보세요</div>}
                  {layers.sale && listPins.length === 0 && !salePins.isFetching && (
                    <div className="sel-empty">조건에 맞는 매물이 없습니다</div>
                  )}
                  {/* 매물 밖 건물 — 전체 건물을 켰을 때만. 추정가 */}
                  {layers.all && near && !narrow && (
                    <>
                      <div className="ml-head sub"><span>매물 밖 건물 <b className="num">{allInBox.length}</b>동</span></div>
                      {allInBox.slice(0, 60).map((p) => (
                        <div key={p.building_pk} className="ml-row" onClick={() => setPicked(p)}>
                          <span className="ml-a">{p.addr.replace("서울특별시 ", "").replace("번지", "")}</span>
                          <span className="ml-nums est">{valueLabel(p.sale_est ?? null, uv, p.land_area, p.total_area) ?? "—"}</span>
                        </div>
                      ))}
                    </>
                  )}
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
