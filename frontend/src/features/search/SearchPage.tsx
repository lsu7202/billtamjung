import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { searchApi, savedApi, buildingsApi, extrasApi, type AttrFilters } from "../../shared/api/endpoints";
import { MapPanel, MapPin } from "../../shared/map/MapPanel";
import { FilterModal, countActive } from "./FilterModal";
import { PriceTrendChart, buildTrendSeries } from "../../shared/ui/PriceTrendChart";
import "./search.css";

/** S01 매물 통합검색 — 자동완성 + 지역(구/동) + 3열 목록 + 지도 뷰(핀·영역 그리기) */

interface Hit {
  building_pk: string; addr: string; price: number | null; roi: number | null;
  lng: number; lat: number; is_fav?: boolean;
  land_area: number | null; floors_above: number | null; floors_below: number | null;
}
interface Col { items: Hit[]; total: number; page: number; pages: number }
interface SearchResult { ad: Col; mine: Col; normal: Col }
type Regions = Record<string, { sgg_code: string; dongs: { bjd_code: string; dong: string; count: number }[] }>;

const COLS = [
  { key: "ad" as const, label: "광고", color: "var(--green)" },
  { key: "mine" as const, label: "내 매물", color: "var(--blue)" },
  { key: "normal" as const, label: "일반", color: "var(--purple)" },
];

const won = (n: number | null) =>
  n == null ? "—" : n >= 1e8 ? `${Math.round(n / 1e8)}억` : `${Math.round(n / 1e4).toLocaleString()}만`;

// 조건 칩(§3.2) — 저장단위 ㎡ 기준 표기. clear = 해당 조건을 비우는 부분 패치.
const unitM2 = (lo?: number | null, hi?: number | null, u = "") =>
  lo != null && hi != null ? `${lo}~${hi}${u}` : lo != null ? `${lo}${u} 이상` : hi != null ? `${hi}${u} 이하` : "";

function filterChips(f: AttrFilters, fmt: typeof unitM2) {
  const chips: { key: string; label: string; clear: Partial<AttrFilters> }[] = [];
  if (f.use_zones?.length)
    chips.push({ key: "uz", label: `용도지역 ${f.use_zones.length === 1 ? f.use_zones[0] : `${f.use_zones[0]} 외 ${f.use_zones.length - 1}`}`, clear: { use_zones: null } });
  if (f.main_use) chips.push({ key: "mu", label: `주용도 "${f.main_use}"`, clear: { main_use: null } });
  if (f.land_area_min != null || f.land_area_max != null)
    chips.push({ key: "la", label: `대지 ${fmt(f.land_area_min, f.land_area_max, "㎡")}`, clear: { land_area_min: null, land_area_max: null } });
  if (f.total_area_min != null || f.total_area_max != null)
    chips.push({ key: "ta", label: `연면적 ${fmt(f.total_area_min, f.total_area_max, "㎡")}`, clear: { total_area_min: null, total_area_max: null } });
  if (f.floors_above_min != null || f.floors_above_max != null)
    chips.push({ key: "fl", label: `지상 ${fmt(f.floors_above_min, f.floors_above_max, "층")}`, clear: { floors_above_min: null, floors_above_max: null } });
  if (f.station_dist_max != null)
    chips.push({ key: "sd", label: `역 ${f.station_dist_max}m 이내`, clear: { station_dist_max: null } });
  return chips;
}

export function SearchPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const [gu, setGu] = useState("");
  const [bjd, setBjd] = useState("");
  const [view, setView] = useState<"list" | "map">("list");
  const [polygon, setPolygon] = useState<object | null>(null);
  const [picked, setPicked] = useState<MapPin | null>(null);
  const [sort, setSort] = useState("price");
  const [favOnly, setFavOnly] = useState(false);
  const [filters, setFilters] = useState<AttrFilters>({});
  const [showFilter, setShowFilter] = useState(false);
  const [pages, setPages] = useState({ ad: 1, mine: 1, normal: 1 });
  const filterCount = countActive(filters);

  const suggest = useQuery({
    queryKey: ["suggest", q],
    queryFn: () => searchApi.suggest(q),
    enabled: q.trim().length > 0,
  });
  const regions = useQuery<Regions>({ queryKey: ["regions"], queryFn: searchApi.regions });
  // 영역(폴리곤)이 있으면 지역범위 대체(S01 §3.6c)
  const result = useQuery<SearchResult>({
    queryKey: ["search3", bjd, polygon, sort, favOnly, filters, pages],
    queryFn: () =>
      searchApi.list({
        bjd_code: polygon ? undefined : bjd || undefined,
        polygon: polygon ?? undefined, filters, sort, fav_only: favOnly,
        page_ad: pages.ad, page_mine: pages.mine, page_normal: pages.normal,
      }) as Promise<SearchResult>,
    enabled: !!bjd || !!polygon,
  });

  async function saveCondition() {
    const name = prompt("검색조건 이름", bjd ? "저장 조건" : "그린 영역");
    if (!name) return;
    await savedApi.save(name, { bjd_code: bjd || null, polygon, sort, filters });
    alert("저장했습니다 — 마이페이지에서 확인");
  }

  const items = suggest.data ?? [];
  const go = (pk: string) => nav(`/buildings/${pk}`);
  async function toggleFav(pk: string) {
    await extrasApi.favToggle(pk);
    qc.invalidateQueries({ queryKey: ["search3"] });
  }
  function toMap(h: Hit, key: "ad" | "mine" | "normal") {
    setPicked({ ...h, col: key });
    setView("map");
  }

  function onKey(e: React.KeyboardEvent) {
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); go(items[active].building_pk); }
    else if (e.key === "Escape") setQ("");
  }

  // 지도 요약카드 가격추이(§3.6) — 선택 매물만 상세 데이터 로드
  const pickedBldg = useQuery({
    queryKey: ["pickBldg", picked?.building_pk],
    queryFn: () => buildingsApi.get(picked!.building_pk), enabled: !!picked,
  });
  const pickedAds = useQuery({
    queryKey: ["pickAds", picked?.building_pk],
    queryFn: () => extrasApi.adPrices(picked!.building_pk), enabled: !!picked,
  });
  const trend = useMemo(() => buildTrendSeries(pickedBldg.data, pickedAds.data), [pickedBldg.data, pickedAds.data]);

  const dongs = gu && regions.data ? regions.data[gu]?.dongs ?? [] : [];
  const total = result.data ? result.data.ad.total + result.data.mine.total + result.data.normal.total : 0;

  const pins: MapPin[] = useMemo(() => {
    if (!result.data) return [];
    return COLS.flatMap(({ key }) =>
      result.data![key].items
        .filter((h) => h.lng && h.lat)
        .map((h) => ({ ...h, col: key })),
    );
  }, [result.data]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* 검색바 */}
      <div className="panel" style={{ padding: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div className="ac-wrap" style={{ flex: "1 1 300px", maxWidth: 420 }}>
          <input className="input" placeholder="주소 입력 (예: 강남구 역삼동 735-29)"
            value={q} onChange={(e) => { setQ(e.target.value); setActive(-1); }} onKeyDown={onKey} autoComplete="off" />
          {items.length > 0 && (
            <div className="ac-drop">
              {items.map((s, i) => (
                <div key={s.building_pk} className={`ac-item ${i === active ? "active" : ""}`}
                  onMouseDown={() => go(s.building_pk)} onMouseEnter={() => setActive(i)}>
                  {s.addr}
                </div>
              ))}
            </div>
          )}
        </div>
        {polygon ? (
          <span className="tag mine" style={{ padding: "6px 12px", fontSize: 13 }}>
            ✏️ 그린 영역
            <button className="btn" style={{ marginLeft: 8, padding: "0 6px", fontSize: 11 }} onClick={() => setPolygon(null)}>×</button>
          </span>
        ) : (
          <>
            <select className="input" style={{ width: 140 }} value={gu}
              onChange={(e) => { setGu(e.target.value); setBjd(""); }}>
              <option value="">구 선택</option>
              {Object.keys(regions.data ?? {}).map((g) => <option key={g}>{g}</option>)}
            </select>
            <select className="input" style={{ width: 160 }} value={bjd} disabled={!gu}
              onChange={(e) => { setBjd(e.target.value); setPages({ ad: 1, mine: 1, normal: 1 }); }}>
              <option value="">법정동 선택</option>
              {dongs.map((d) => (
                <option key={d.bjd_code} value={d.bjd_code}>{d.dong} ({d.count.toLocaleString()})</option>
              ))}
            </select>
          </>
        )}
        {(bjd || polygon) && <span style={{ fontSize: 13, color: "var(--muted)" }}>전체 <b className="num">{total.toLocaleString()}</b>건</span>}
        <button className={`btn ${filterCount ? "primary" : ""}`} onClick={() => setShowFilter(true)}>
          필터{filterCount ? ` ${filterCount}` : ""}
        </button>
        <button className={`btn ${favOnly ? "primary" : ""}`} onClick={() => setFavOnly(!favOnly)}>★ 즐겨찾기</button>
        {(bjd || polygon) && <button className="btn" onClick={saveCondition}>조건 저장</button>}
        <span style={{ flex: 1 }} />
        <select className="input" style={{ width: 120 }} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="price">매매가순</option>
          <option value="roi">수익률순</option>
        </select>
        <div style={{ display: "flex" }}>
          <button className={`btn ${view === "list" ? "primary" : ""}`} style={{ borderRadius: "6px 0 0 6px" }} onClick={() => setView("list")}>매물</button>
          <button className={`btn ${view === "map" ? "primary" : ""}`} style={{ borderRadius: "0 6px 6px 0", borderLeft: 0 }} onClick={() => setView("map")}>지도</button>
        </div>
      </div>

      {/* 적용된 조건 칩바(§3.2) — 각 × 개별 제거 */}
      {filterCount > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {filterChips(filters, unitM2).map((c) => (
            <span key={c.key} className="tag mine" style={{ padding: "4px 10px", fontSize: 12 }}>
              {c.label}
              <button className="btn" style={{ marginLeft: 6, padding: "0 5px", fontSize: 11 }}
                onClick={() => { setFilters((f) => ({ ...f, ...c.clear })); setPages({ ad: 1, mine: 1, normal: 1 }); }}>×</button>
            </span>
          ))}
          <button className="btn" style={{ padding: "3px 10px", fontSize: 12 }}
            onClick={() => { setFilters({}); setPages({ ad: 1, mine: 1, normal: 1 }); }}>조건 초기화</button>
        </div>
      )}

      {showFilter && (
        <FilterModal
          initial={filters}
          onApply={(f) => { setFilters(f); setPages({ ad: 1, mine: 1, normal: 1 }); }}
          onClose={() => setShowFilter(false)}
        />
      )}

      {/* 지도 뷰 */}
      {view === "map" && (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14 }}>
          <div className="panel" style={{ padding: 14, alignSelf: "start" }}>
            {picked ? (
              <>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>{picked.addr.replace("서울특별시 ", "").replace("번지", "")}</div>
                <div className="kv"><span className="k">매매가</span><span className="v num">{won(picked.price)}</span></div>
                <div className="kv"><span className="k">수익률</span><span className="v num" style={{ color: picked.roi == null ? "var(--muted)" : undefined }}>{picked.roi == null ? "—" : `${picked.roi}%`}</span></div>
                <div className="kv"><span className="k">평단가</span><span className="v num">{picked.price && picked.land_area ? `${Math.round(picked.price / (picked.land_area / 3.3058) / 1e4).toLocaleString()}만/평` : "—"}</span></div>
                <div className="kv"><span className="k">대지면적</span><span className="v num">{picked.land_area ?? "—"}㎡</span></div>
                <div className="kv"><span className="k">층수</span><span className="v">지상 {picked.floors_above ?? "—"} · 지하 {picked.floors_below ?? "—"}</span></div>
                <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)", marginBottom: 4 }}>가격 추이</div>
                  <PriceTrendChart series={trend} />
                </div>
                <button className="btn primary" style={{ width: "100%", marginTop: 12 }} onClick={() => go(picked.building_pk)}>상세보기 →</button>
              </>
            ) : (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>핀을 클릭하면 요약이 표시됩니다</p>
            )}
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              이 화면 {pins.length}핀 · ✎ 도구로 영역을 그리면 그 안의 매물만 검색됩니다
            </p>
          </div>
          <MapPanel
            pins={pins}
            polygonActive={!!polygon}
            onPick={(pk) => setPicked(pins.find((p) => p.building_pk === pk) ?? null)}
            onPolygon={(g) => { setPolygon(g); setPages({ ad: 1, mine: 1, normal: 1 }); }}
          />
        </div>
      )}

      {/* 3열 결과 — 목업 S01.html 정본(이음새 병합·주소/매매가/수익률) */}
      {view === "list" && (result.data ? (
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
                    <span></span><span>주소</span>
                    <span className="num">매매가{key === "normal" && <span className="est">추정</span>}</span>
                    <span className="num">수익률</span>
                  </div>
                  {col.items.map((h) => (
                    <div key={h.building_pk} className="wf-row" onClick={() => go(h.building_pk)}>
                      <span className="star" style={{ fontSize: 15, color: h.is_fav ? "#f5b81f" : "var(--line-2)" }}
                        onClick={(e) => { e.stopPropagation(); toggleFav(h.building_pk); }}>★</span>
                      <span>{h.addr.replace("서울특별시 ", "").replace("번지", "")}</span>
                      <span className="num">{won(h.price)}</span>
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
      ) : (
        <div className="panel" style={{ padding: 24, color: "var(--muted)", fontSize: 13 }}>
          주소를 검색하거나 구·법정동을 선택하면 광고 / 내 매물 / 일반 3열로 매물이 표시됩니다.
          지도 탭에서 영역을 직접 그려 검색할 수도 있습니다.
        </div>
      ))}
    </div>
  );
}
