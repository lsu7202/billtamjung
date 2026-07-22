import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { searchApi, buildingsApi, extrasApi, type AttrFilters } from "../../shared/api/endpoints";
import { MapPanel, MapPin } from "../../shared/map/MapPanel";
import { FilterModal, activeCount, conditionChips, type Values, type RegionPick } from "./FilterModal";
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

const COLS = [
  { key: "ad" as const, label: "광고", color: "var(--green)" },
  { key: "mine" as const, label: "내 매물", color: "var(--blue)" },
  { key: "normal" as const, label: "일반", color: "var(--purple)" },
];

const won = (n: number | null) =>
  n == null ? "—" : n >= 1e8 ? `${Math.round(n / 1e8)}억` : `${Math.round(n / 1e4).toLocaleString()}만`;

export function SearchPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const [view, setView] = useState<"list" | "map">("list");
  const [polygon, setPolygon] = useState<object | null>(null);
  const [picked, setPicked] = useState<MapPin | null>(null);
  const [sort, setSort] = useState("price");
  const [favOnly, setFavOnly] = useState(false);
  const [filters, setFilters] = useState<AttrFilters>({});      // 백엔드 쿼리용(모달 산출)
  const [fValues, setFValues] = useState<Values>({});           // 필터 모달 원본값(칩·재편집용)
  const [fRegions, setFRegions] = useState<RegionPick[]>([]);   // 지역 앵커(필터에서 선택)
  const [showFilter, setShowFilter] = useState(false);
  const [pages, setPages] = useState({ ad: 1, mine: 1, normal: 1 });
  const bjd = fRegions[0]?.bjd_code ?? "";                       // 단일지역(멀티는 백엔드 확장 예정)
  const filterCount = activeCount(fValues, fRegions);
  const resetPages = () => setPages({ ad: 1, mine: 1, normal: 1 });

  const suggest = useQuery({
    queryKey: ["suggest", q],
    queryFn: () => searchApi.suggest(q),
    enabled: q.trim().length > 0,
  });
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
      {/* 검색바 — 목업 S01: 주소 + 필터 + 검색 + 즐겨찾기 + 매물/지도. 지역은 필터에서 선택→칩 */}
      <div className="panel" style={{ padding: 16 }}>
        <div className="toolbar">
          <div className="ac-wrap" style={{ flex: "1 1 300px", maxWidth: 420 }}>
            <input className="input" style={{ width: "100%", minWidth: 0 }}
              value={q} onChange={(e) => { setQ(e.target.value); setActive(-1); }} onKeyDown={onKey} autoComplete="off" />
            {items.length > 0 && (
              <div className="ac-drop">
                {items.map((s, i) => (
                  <div key={s.building_pk} className={`ac-item ${i === active ? "active" : ""}`}
                    onMouseDown={() => go(s.building_pk)} onMouseEnter={() => setActive(i)}>
                    <span className="ac-addr">{s.addr.replace("서울특별시 ", "")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className={`btn ${filterCount ? "primary" : ""}`} onClick={() => setShowFilter(true)}>필터{filterCount ? ` ${filterCount}` : ""}</button>
          <button className="btn primary" onClick={resetPages}>검색</button>
          <button className={`btn ${favOnly ? "primary" : ""}`} onClick={() => setFavOnly(!favOnly)}>★ 즐겨찾기</button>
          <span style={{ flex: 1 }} />
          <div className="segmented">
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>매물</button>
            <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>지도</button>
          </div>
        </div>
        {/* 적용된 조건 칩(§3.2) — 지역 + 조건 + 그린영역 */}
        {(fRegions.length > 0 || polygon || filterCount > 0) && (
          <div className="chips">
            {fRegions.map((r) => (
              <span key={r.bjd_code} className="chip">{r.label}<span className="x" onClick={() => setFRegions(fRegions.filter((x) => x.bjd_code !== r.bjd_code))}>×</span></span>
            ))}
            {polygon && <span className="chip">✏️ 그린 영역<span className="x" onClick={() => setPolygon(null)}>×</span></span>}
            {conditionChips(fValues).map((c) => (
              <span key={c.label} className="chip">{c.label} {c.text}<span className="x" onClick={() => setFValues((s) => { const n = { ...s }; delete n[c.label]; return n; })}>×</span></span>
            ))}
          </div>
        )}
      </div>

      {/* 결과바 — 건수 + 정렬 (목업 별도 바) */}
      {(bjd || polygon) && (
        <div className="toolbar" style={{ margin: "-6px 2px 0" }}>
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
          initialValues={fValues} initialRegions={fRegions}
          onApply={(r) => { setFilters(r.filters); setFValues(r.values); setFRegions(r.regions); resetPages(); }}
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
          주소를 검색하거나 [필터]에서 지역을 선택하면 광고 / 내 매물 / 일반 3열로 매물이 표시됩니다.
          지도 탭에서 영역을 직접 그려 검색할 수도 있습니다.
        </div>
      ))}
    </div>
  );
}
