import { LoadingOverlay } from "../../shared/ui/Spinner";
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { searchApi, buildingsApi, listingsApi, marketApi, buyersApi, type AttrFilters, type NearbySales } from "../../shared/api/endpoints";
import { openDetail, mergeGeo } from "../../shared/map/geo";
import { MapPanel, MapPin } from "../../shared/map/MapPanel";
import { FilterModal, activeCount, conditionChips, type Values, type RegionPick } from "./FilterModal";
import { CompareBar } from "../building/ReportPrimitives";
import { RoadviewMini } from "../../shared/map/Roadview";
import "./search.css";
import { Icon } from "../../shared/ui/Icon";
import { Segmented } from "../../shared/ui/Segmented";

/** S01 매물 통합검색 — 자동완성 + 지역(구/동) + 3열 목록 + 지도 뷰(핀·영역 그리기) */

interface Hit {
  building_pk: string; addr: string; price: number | null; last_sale_price: number | null; roi: number | null;
  price_is_est?: boolean;   // 매매가가 적정가 대체(팀 매매가 미입력)
  lng: number; lat: number;
  land_area: number | null; floors_above: number | null; floors_below: number | null;
}
interface Col { items: Hit[]; total: number; page: number; pages: number }
interface SearchResult { mine: Col; normal: Col }

const COLS = [
  { key: "mine" as const, label: "내 매물", color: "var(--blue)" },
  { key: "normal" as const, label: "일반", color: "var(--purple)" },
];

const won = (n: number | null) =>
  n == null ? "—" : n >= 1e8 ? `${Math.round(n / 1e8)}억` : `${Math.round(n / 1e4).toLocaleString()}만`;

const PY = 3.3058;                                    // ㎡→평
const py = (m2?: number | null) => (m2 == null ? "—" : (m2 / PY).toFixed(m2 / PY < 100 ? 1 : 0));

/** 지도 선택 매물 요약 카드 — 마스터 즉시값만(적정가·수익률·층수·면적·시세추이). 수익률은 classified가
 *  마스터(rent_est÷매매가)로 산출해 핀에 실려옴(picked.roi). 라이브 계산값(매력도·투자유형·미래가치)만
 *  리포트에서 — 사이드바는 대기 없이 바로 뜨도록 배치/마스터 값으로 한정. */
function SelCard({ picked, bldg, nearby, onDetail }: {
  picked: MapPin; bldg?: Record<string, unknown>; nearby?: NearbySales;
  onDetail: () => void;
}) {
  const num = (k: string) => (bldg && bldg[k] != null ? Number(bldg[k]) : null);
  const land = num("land_area") ?? picked.land_area ?? null;
  const total = num("total_area");
  const fa = num("floors_above") ?? picked.floors_above ?? null;
  const fb = num("floors_below") ?? picked.floors_below ?? null;
  const fair = picked.sale_est ?? null;   // 적정가=배치값만(핀에 이미 실림) → 즉시. 매매가와 구분.
  const eok1 = (v: number | null) => v == null ? "—" : v >= 1e8 ? `${(v / 1e8).toFixed(0)}억` : `${Math.round(v / 1e4).toLocaleString()}만`;
  // 본매물 막대 = **적정가** ÷ 연면적평. 카드 머리에 적정가를 띄워놓고 막대는 매매가로 그리면
  // 두 숫자가 어긋난다. 사례도 실거래 ÷ 연면적평이라 같은 축이다.
  const subjPer = fair && total ? Math.round(fair / (total / 3.305785)) : null;
  return (
    <div className="sel-card">
      {picked.lng && picked.lat
        ? <RoadviewMini lng={picked.lng} lat={picked.lat} className="sel-road" />
        : <div className="sel-road" />}
      <div className="sel-body">
        <div className="sel-addr">{picked.addr.replace("서울특별시 ", "").replace("번지", "")}
          <span className={`ml-tag ${picked.col}`}>{picked.col === "mine" ? "내" : "일반"}</span>
        </div>
        {/* 마스터 즉시값만(매력도·투자유형·미래가치는 리포트에서 — 대기 방지) */}
        <div className="sel-metrics">
          <div className="m"><div className="mk">빌탐정 적정가</div><div className="mv" style={{ color: "var(--signal)" }}>{eok1(fair)}</div></div>
          <div className="m"><div className="mk">예상수익률</div><div className="mv">{picked.roi == null ? "—" : `${picked.roi}%`}</div></div>
          <div className="m"><div className="mk">층수</div><div className="mv">{fb ? `B${fb}` : ""}{fb ? "/" : ""}{fa != null ? `${fa}F` : "—"}</div></div>
          <div className="m wide"><div className="mk">면적 (평)</div>
            <div className="sel-area"><span><i>대지</i>{py(land)}</span><span><i>연면적</i>{py(total)}</span></div>
          </div>
        </div>
        {/* 주변 실거래 — "이 매물이 어느 정도인가"에 답하는 자리.
            자기 실거래 이력이 있는 건물은 13.5%뿐이라(2026-08-09 실측) 자기 이력만 그리면 대개 빈 칸이었다.
            축은 연면적 평단가 — 리포트 04 비교와 같아서 두 화면이 같은 말을 한다.
            차트만 둔다. 반경·건수·중앙값을 글자로 덧붙이면 그래프가 읽히기 전에 글부터 읽힌다. */}
        <div className="sel-spark">
          <div className="sh"><span>주변 실거래 평단가</span>
            <small style={{ color: "var(--muted)", fontWeight: 400 }}>연면적 만원/평</small></div>
          {nearby && nearby.sales.length > 0 ? (
            <CompareBar height={140} refLabel={false} fmt={(v) => `${Math.round(v / 1e4).toLocaleString()}`}
              refLine={nearby.median_per_area ? { value: nearby.median_per_area, label: "" } : null}
              items={[
                // 가까운 순 5건 — 좁은 칸이라 더 넣으면 막대가 붙고 값이 겹친다.
                // x축은 거리다. 목록 없이도 "얼마나 가까운 사례인지"가 축에서 읽힌다.
                ...nearby.sales.slice(0, 5).filter((x) => x.per_area).map((x) => ({
                  label: `${x.dist_m}m`, value: x.per_area!, color: "var(--navy)",
                })),
                ...(subjPer ? [{ label: "본매물", value: subjPer, color: "var(--blue)", strong: true }] : []),
              ]} />
          ) : (
            <div style={{ color: "var(--muted)", fontSize: 12, padding: "14px 2px" }}>
              {nearby ? "반경 내 최근 실거래가 없습니다" : "\u00a0"}
            </div>
          )}
        </div>
        <button className="sel-detail" onClick={onDetail}>상세보기 →</button>
      </div>
    </div>
  );
}

const SESSION_KEY = "s01_search_state_v1";

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
  // 세션 유지: 검색 조건·뷰·페이지를 sessionStorage에 저장 → 상세 다녀오거나 새로고침해도 복원(S01 [MVP])
  const [saved] = useState<Record<string, unknown>>(() => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "{}"); } catch { return {}; }
  });
  const [q, setQ] = useState((saved.q as string) ?? "");
  const [active, setActive] = useState(-1);
  const [view, setView] = useState<"list" | "map">((saved.view as "list" | "map") ?? "map");   // 기본 = 지도 우선
  const [priceMode, setPriceMode] = useState<"fair" | "real">((saved.priceMode as "fair" | "real") ?? "fair");   // 핀 태그 가격
  // 그린 영역은 여러 개 쌓인다 — 예전엔 단일 객체라 새로 그리면 앞의 것이 사라졌다.
  // 서버로는 mergeGeo로 MultiPolygon 하나로 합쳐 보낸다(서버는 손댈 것이 없다).
  const [polygons, setPolygons] = useState<object[]>(
    bc?.conditions.polygon ? [bc.conditions.polygon] : ((saved.polygons as object[]) ?? []));
  const polygon = mergeGeo(polygons);
  const [picked, setPicked] = useState<MapPin | null>(null);
  const [centerReq, setCenterReq] = useState<{ lng: number; lat: number; zoom?: number } | null>(null);  // 지도 중심 이동 요청
  const [sort, setSort] = useState((saved.sort as string) ?? "price");
  // 매수자 조건을 싣고 왔으면 그 조건으로 시작한다(세션 복원보다 우선)
  const [filters, setFilters] = useState<AttrFilters>(bc?.conditions.filters ?? (saved.filters as AttrFilters) ?? {});
  const [fValues, setFValues] = useState<Values>(bc?.conditions.values ?? (saved.fValues as Values) ?? {});
  const [fRegions, setFRegions] = useState<RegionPick[]>(bc?.conditions.regions ?? (saved.fRegions as RegionPick[]) ?? []);
  const [showFilter, setShowFilter] = useState(false);
  const [barCollapsed, setBarCollapsed] = useState(false);      // 검색바 접기(공간 절약)
  const [pages, setPages] = useState<{ mine: number; normal: number }>((saved.pages as { mine: number; normal: number }) ?? { mine: 1, normal: 1 });

  // 조건 변경 시 스냅샷 저장(전환·새로고침 복원용)
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ q, view, priceMode, polygons, sort, filters, fValues, fRegions, pages }));
  }, [q, view, priceMode, polygons, sort, filters, fValues, fRegions, pages]);
  const bjd = fRegions[0]?.bjd_code ?? "";                       // 단일지역(멀티는 백엔드 확장 예정)
  const filterCount = activeCount(fValues, fRegions);
  const resetPages = () => setPages({ mine: 1, normal: 1 });
  const doSearch = () => { resetPages(); result.refetch(); };   // 명시적 재조회(페이지 1 + 강제 refetch)

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
  const mineOnly = !bjd && !polygon;
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
    enabled: view === "map",
  });
  const mapPinList = mapPins.data ?? [];

  const items = suggest.data ?? [];
  const go = (pk: string) => openDetail(pk);   // 리다이렉트=새탭(사이트 규칙)

  // 자동완성 선택 — 클릭 동작 통일(§3.1a 개편): 건물=지도 이동+선택 · 지역/역=지도 이동
  function pickFromSuggest(s: { kind?: string; building_pk?: string | null; lng?: number | null; lat?: number | null }) {
    setQ(""); setActive(-1);
    setView("map");
    // 고른 대상 크기에 맞춰 확대한다 — 건물은 필지가 보여야 하고, 동·역은 주변이 보여야 한다.
    const zoom = s.kind === "region" ? 15 : s.kind === "station" ? 16 : 18;
    if (s.lng && s.lat) setCenterReq({ lng: s.lng, lat: s.lat, zoom });
    if (s.kind === "building" || (!s.kind && s.building_pk)) selectBuilding(s.building_pk!);   // 핀에 있으면 그 핀, 없으면 조회
  }
  function toMap(h: Hit, key: "mine" | "normal") {   // 목록 [지도위치] → 지도뷰 + 그 매물로 중심 이동
    setPicked({ ...h, col: key });
    if (h.lng && h.lat) setCenterReq({ lng: h.lng, lat: h.lat, zoom: 18 });
    setView("map");
  }
  // 필지 클릭 → 매물 선택(부동산플래닛식). 검색결과면 그 핀(분류색), 아니면 건물 조회 후 내매물/일반 판정
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
        price: null,
        roi: b.roi != null ? Number(b.roi) : null,               // 마스터 수익률(buildings.get)
        sale_est: b.sale_est != null ? Number(b.sale_est) : null, // 배치 적정가 — 사이드바가 핀과 동일하게 표시
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
      if (active >= 0 && items[active]) pickFromSuggest(items[active]);   // 선택 항목
      else if (items[0]) pickFromSuggest(items[0]);                        // 미선택 시 첫 항목
    }
    else if (e.key === "Escape") setQ("");
  }

  // 지도 요약카드 가격추이(§3.6) — 선택 매물만 상세 데이터 로드
  const pickedBldg = useQuery({
    queryKey: ["pickBldg", picked?.building_pk],
    queryFn: () => buildingsApi.get(picked!.building_pk), enabled: !!picked,
  });
  // 주변 실거래 — 매물을 고른 뒤 따로 불러온다(약 190ms). 카드는 먼저 뜨고 그래프만 채워진다.
  const nearbySales = useQuery({
    queryKey: ["nearbySales", picked?.building_pk],
    queryFn: () => marketApi.nearbySales(picked!.building_pk), enabled: !!picked,
  });

  const total = result.data ? result.data.mine.total + result.data.normal.total : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
      {/* 검색바 — 헤더에 밀착 + 접기/펼치기로 공간 절약 */}
      <div className="panel" style={{ padding: barCollapsed ? 0 : 16, borderTopLeftRadius: 0, borderTopRightRadius: 0, flex: "0 0 auto" }}>
        {barCollapsed ? (
          /* 접힘: 거의 안 보이는 얇은 띠(펼치기 핸들만) */
          <button onClick={() => setBarCollapsed(false)} title="검색바 펼치기"
            style={{ width: "100%", border: 0, background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 11, padding: "2px 0", lineHeight: 1, letterSpacing: 4 }}>
            ▾
          </button>
        ) : (<>
        <div className="toolbar">
          <div className="s01-search" style={{ flex: "1 1 300px", maxWidth: 460 }}>
            <button className="s01-go" onClick={doSearch} title="검색"><Icon name="search" size={19} /></button>
            <input placeholder="주소 또는 지명 검색 (예: 강남역)"
              value={q} onChange={(e) => { setQ(e.target.value); setActive(-1); }} onKeyDown={onKey} autoComplete="off" />
            {q.trim() && <button className="s01-clear" onClick={() => { setQ(""); setActive(-1); }} title="지우기"><Icon name="close" size={15} /></button>}
            {q.trim() && (
              <div className="ac-drop">
                {items.map((s, i) => (
                  <div key={`${s.kind}-${s.building_pk ?? s.addr}`} className={`ac-item ${i === active ? "active" : ""}`}
                    onMouseDown={() => pickFromSuggest(s)} onMouseEnter={() => setActive(i)}
                    style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Icon name={s.kind === "region" ? "map" : s.kind === "station" ? "subway" : "building"}
                      size={14} style={{ flex: "0 0 auto", opacity: .85 }} />
                    {s.is_mine && <span className="tag mine" style={{ fontSize: 10, flex: "0 0 auto" }}>내 매물</span>}
                    <span className="ac-addr" style={{ flex: 1, minWidth: 0, fontFamily: s.kind === "building" ? undefined : "inherit", fontWeight: s.kind === "building" ? undefined : 600 }}>
                      {s.addr.replace("서울특별시 ", "")}
                    </span>
                    {s.sub && <span style={{ fontSize: 11.5, color: "var(--muted)", flex: "0 0 auto" }}>{s.sub}</span>}
                    {s.price ? <span className="num" style={{ fontSize: 12, color: "var(--muted)", flex: "0 0 auto" }}>{(s.price / 1e8).toFixed(1)}억</span> : null}
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="ac-item" style={{ color: "var(--muted)", fontSize: 13 }}>일치하는 결과가 없습니다</div>
                )}
              </div>
            )}
          </div>
          <button className={`btn ${filterCount ? "primary" : ""}`} onClick={() => setShowFilter(true)}><Icon name="filter" size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />필터{filterCount ? ` ${filterCount}` : ""}</button>
          <span style={{ flex: 1 }} />
          <Segmented value={view} onChange={setView}
            options={[{ value: "list", label: "매물", icon: "building" }, { value: "map", label: "지도", icon: "map" }]} />
          <button className="tool-btn" onClick={() => setBarCollapsed(true)} title="검색바 접기"><Icon name="minus" size={15} /></button>
        </div>
        {/* 적용된 조건 칩(§3.2) — 지역 + 조건 + 그린영역 */}
        {(fRegions.length > 0 || polygons.length > 0 || filterCount > 0) && (
          <div className="chips">
            {fRegions.map((r) => (
              <span key={r.bjd_code} className="chip">{r.label}<span className="x" onClick={() => setFRegions(fRegions.filter((x) => x.bjd_code !== r.bjd_code))}>×</span></span>
            ))}
            {polygons.map((_, i) => (
              <span className="chip" key={i}><Icon name="edit" size={13} style={{verticalAlign:"-2px",marginRight:3}} />
                그린 영역{polygons.length > 1 ? ` ${i + 1}` : ""}
                <span className="x" onClick={() => { setPolygons((ps) => ps.filter((_, j) => j !== i)); resetPages(); }}>×</span></span>
            ))}
            {conditionChips(fValues).map((c) => (
              <span key={c.label} className="chip">{c.label} {c.text}<span className="x" onClick={() => setFValues((s) => { const n = { ...s }; delete n[c.label]; return n; })}>×</span></span>
            ))}
          </div>
        )}
        </>)}
      </div>

      {/* 매수자 조건 편집 중 — 지도·필터·그리기로 다듬고 여기서 되저장한다 */}
      {bc && <BuyerCondBar bc={bc} values={fValues} regions={fRegions} filters={filters}
        polygon={polygon} onDone={() => nav2("/sales")} />}

      {/* 결과바 — 건수 + 정렬 (목업 별도 바). 첫 화면(내 매물)에도 띄운다. */}
      {result.data && (
        <div className="toolbar" style={{ margin: "0 2px", flex: "0 0 auto" }}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>전체 <b className="num">{total.toLocaleString()}</b>건</span>
          <span style={{ flex: 1 }} />
          <label style={{ color: "var(--muted)", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>정렬
            <select className="input" style={{ width: "auto", minWidth: 0, padding: "7px 10px" }} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="price">매매가순</option>
              <option value="roi">수익률순</option>
            </select>
          </label>
        </div>
      )}

      {showFilter && (
        <FilterModal
          initialValues={fValues} initialRegions={fRegions} initialPolygon={polygon}
          onApply={(r) => { setFilters(r.filters); setFValues(r.values); setFRegions(r.regions); setPolygons(r.polygon ? [r.polygon] : []); resetPages(); }}
          onClose={() => setShowFilter(false)}
          onDraw={() => { setShowFilter(false); setView("map"); }}
        />
      )}

      {/* 지도 뷰 — 목업 S01 .map-split: 좌 사이드바(선택카드+미니리스트) / 우 지도 */}
      {view === "map" && (
        <div className="map-split">
          {/* 좌: 선택 매물 요약 + 미니리스트(핀 동기) */}
          <div className="map-list">
            {picked ? <SelCard picked={picked} bldg={pickedBldg.data} nearby={nearbySales.data} onDetail={() => go(picked.building_pk)} /> : null}
            <div className="ml-head">
              <span>이 지도 영역 <b className="num">{mapPinList.length}</b>건{
                mapPins.isFetching ? " · 불러오는 중…"
                : mapPinList.length < total ? ` · 전체 ${total.toLocaleString()}건 中 · 필터로 좁혀보세요`
                : " · 전체 표시"}</span>
            </div>
            {mapPinList.slice(0, 100).map((p) => (
              <div key={p.building_pk} className={`ml-row ${picked?.building_pk === p.building_pk ? "on" : ""}`} onClick={() => { setPicked(p); if (p.lng && p.lat) setCenterReq({ lng: p.lng, lat: p.lat }); }}>
                <span className="ml-a">{p.addr.replace("서울특별시 ", "").replace("번지", "")}
                  <span className={`ml-tag ${p.col}`}>{p.col === "mine" ? "내" : "일반"}</span>
                </span>
                <span className="ml-nums">{won(p.price)}{p.roi != null && <small> · {p.roi}%</small>}</span>
              </div>
            ))}
            {mapPinList.length > 100 && <div className="ml-row" style={{ justifyContent: "center", color: "var(--muted)", cursor: "default" }}>목록은 상위 100건 · 지도에서 전체 확인</div>}
            {mapPinList.length === 0 && <div className="sel-empty">이 영역에 표시할 매물이 없습니다</div>}
          </div>
          {/* 우: 지도 + 범례 */}
          <div className="map-canvas">
            {mapPins.isFetching && <LoadingOverlay label="매물 불러오는 중" />}
            {/* 핀 태그 가격 토글 — 좌상단 */}
            <Segmented value={priceMode} onChange={setPriceMode} size="sm"
              style={{ position: "absolute", top: 12, left: 12, zIndex: 5, boxShadow: "var(--shadow-lg)" }}
              options={[{ value: "fair", label: "적정가" }, { value: "real", label: "실거래가" }]} />
            <MapPanel
              pins={mapPinList}
              polygons={polygons}
              polygonActive={polygons.length > 0}
              selectedPk={picked?.building_pk ?? null}
              selectedCol={picked?.col ?? null}
              centerReq={centerReq}
              priceMode={priceMode}
              onParcelClick={(pk) => { if (pk) selectBuilding(pk); }}
              onPick={(pk) => setPicked(mapPinList.find((p) => p.building_pk === pk) ?? null)}
              // 새 영역은 더한다(null = 전부 지우기). 여러 상권을 동시에 보는 게 현장 방식이다.
              onPolygon={(g) => { setPolygons((ps) => (g ? [...ps, g] : [])); setPages({ mine: 1, normal: 1 }); }}
            />
            <div className="map-legend">
              <span><b style={{ background: "var(--blue)" }} />내 매물</span>
              <span><b style={{ background: "var(--purple)" }} />일반</span>
            </div>
          </div>
        </div>
      )}

      {/* 2열 결과(내매물/일반) — 주소/실거래/매매가/수익률 */}
      {view === "list" && (result.data ? (
        <>
        {COLS.every(({ key }) => (result.data![key]?.total ?? 0) === 0) && (
          <div className="col-empty" style={{ textAlign: "center", padding: 28 }}>
            {mineOnly ? "등록한 매물이 없습니다" : "조건에 맞는 매물이 없습니다"}
            <small>{mineOnly ? "매물 상세에서 담당자를 지정하면 여기에 모입니다 · 주소·지역으로 검색해 보세요"
              : filterCount ? "필터를 줄이거나 지역을 넓혀 보세요" : "주소·지역을 입력해 검색하세요"}</small>
            {filterCount > 0 && <button className="btn" style={{ marginTop: 10 }}
              onClick={() => { setFilters({}); setFValues({}); setFRegions([]); resetPages(); }}><Icon name="reset" size={13} style={{ verticalAlign: "-2px", marginRight: 3 }} />필터 초기화</button>}
          </div>
        )}
        {mineOnly && (result.data!.mine.total > 0) && (
          <div className="wf-note" style={{ fontSize: 12, color: "var(--blue)", padding: "2px 4px 6px" }}>
            내 매물 전체를 보고 있습니다 — 주소·지역으로 검색하면 일반 매물도 함께 나옵니다.
          </div>
        )}
        <div className="wf-note" style={{ fontSize: 12, color: "var(--muted)", padding: "2px 4px 8px" }}>
          매매가·수익률은 시스템 추정 기준 · 매매가 미입력 시 빌탐정 적정가(<b>적정</b>) 사용 · 팀 오버레이 미반영
        </div>
        <div className="result-cols wf-list s01">
          {COLS.map(({ key, label }) => {
            const col = result.data![key];
            return (
              <div key={key} className="col-card">
                <div className={`col-head ${key}`}>
                  {label} <span className="count">{col.total.toLocaleString()}</span>
                </div>
                <div className="col-body">
                  <div className="wf-head">
                    <span>주소</span>
                    <span className="num">실거래</span>
                    <span className="num">매매가</span>
                    <span className="num">수익률</span>
                  </div>
                  {col.items.map((h) => (
                    <div key={h.building_pk} className="wf-row" onClick={() => go(h.building_pk)}>
                      <span>{h.addr.replace("서울특별시 ", "").replace("번지", "")}</span>
                      <span className="num" style={{ color: "var(--muted)" }}>{won(h.last_sale_price)}</span>
                      <span className="num">{won(h.price)}{h.price_is_est && <small style={{ color: "var(--muted)", fontWeight: 400 }}> 적정</small>}</span>
                      <span className="num" style={{ color: h.roi == null ? "var(--muted)" : undefined }}>{h.roi == null ? "—" : `${h.roi}%`}</span>
                      <span className="row-actions">
                        <button className="btn primary" onClick={(e) => { e.stopPropagation(); go(h.building_pk); }}>상세보기</button>
                        <button className="btn" onClick={(e) => { e.stopPropagation(); toMap(h, key); }}>지도위치</button>
                      </span>
                    </div>
                  ))}
                  {col.items.length === 0 && (
                    <div className="col-empty">
                      {key === "mine" ? <>아직 등록한 매물이 없습니다<small>매물 상세에서 담당자를 지정하면 내 매물이 됩니다</small></> : "표시할 매물이 없습니다"}
                    </div>
                  )}
                </div>
                {col.pages > 1 && (
                  <div className="col-pager">
                    <button disabled={col.page <= 1} onClick={() => setPages((p) => ({ ...p, [key]: col.page - 1 }))}>‹</button>
                    <span className="pg">{col.page} / {col.pages}</span>
                    <button disabled={col.page >= col.pages} onClick={() => setPages((p) => ({ ...p, [key]: col.page + 1 }))}>›</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </>
      ) : (
        <div className="panel" style={{ padding: 24, color: "var(--muted)", fontSize: 13 }}>
          주소를 검색하거나 [필터]에서 지역을 선택하면 내 매물 / 일반 2열로 매물이 표시됩니다.
          지도 탭에서 영역을 직접 그려 검색할 수도 있습니다.
        </div>
      ))}
    </div>
  );
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
