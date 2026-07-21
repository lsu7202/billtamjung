import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { searchApi, savedApi } from "../../shared/api/endpoints";
import { MapPanel, MapPin } from "../../shared/map/MapPanel";

/** S01 매물 통합검색 — 자동완성 + 지역(구/동) + 3열 목록 + 지도 뷰(핀·영역 그리기) */

interface Hit {
  building_pk: string; addr: string; price: number | null;
  lng: number; lat: number;
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

export function SearchPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const [gu, setGu] = useState("");
  const [bjd, setBjd] = useState("");
  const [view, setView] = useState<"list" | "map">("list");
  const [polygon, setPolygon] = useState<object | null>(null);
  const [picked, setPicked] = useState<MapPin | null>(null);
  const [sort, setSort] = useState("price");
  const [favOnly, setFavOnly] = useState(false);
  const [pages, setPages] = useState({ ad: 1, mine: 1, normal: 1 });

  const suggest = useQuery({
    queryKey: ["suggest", q],
    queryFn: () => searchApi.suggest(q),
    enabled: q.trim().length > 0,
  });
  const regions = useQuery<Regions>({ queryKey: ["regions"], queryFn: searchApi.regions });
  // 영역(폴리곤)이 있으면 지역범위 대체(S01 §3.6c)
  const result = useQuery<SearchResult>({
    queryKey: ["search3", bjd, polygon, sort, favOnly, pages],
    queryFn: () =>
      searchApi.list({
        bjd_code: polygon ? undefined : bjd || undefined,
        polygon: polygon ?? undefined, sort, fav_only: favOnly,
        page_ad: pages.ad, page_mine: pages.mine, page_normal: pages.normal,
      }) as Promise<SearchResult>,
    enabled: !!bjd || !!polygon,
  });

  async function saveCondition() {
    const name = prompt("검색조건 이름", bjd ? "저장 조건" : "그린 영역");
    if (!name) return;
    await savedApi.save(name, { bjd_code: bjd || null, polygon, sort });
    alert("저장했습니다 — 마이페이지에서 확인");
  }

  const items = suggest.data ?? [];
  const go = (pk: string) => nav(`/buildings/${pk}`);

  function onKey(e: React.KeyboardEvent) {
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); go(items[active].building_pk); }
    else if (e.key === "Escape") setQ("");
  }

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
        <button className={`btn ${favOnly ? "primary" : ""}`} onClick={() => setFavOnly(!favOnly)}>★ 즐겨찾기</button>
        {(bjd || polygon) && <button className="btn" onClick={saveCondition}>조건 저장</button>}
        <span style={{ flex: 1 }} />
        <select className="input" style={{ width: 120 }} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="price">매매가순</option>
          <option value="roi">낮은가격순</option>
          <option value="addr">주소순</option>
        </select>
        <div style={{ display: "flex" }}>
          <button className={`btn ${view === "list" ? "primary" : ""}`} style={{ borderRadius: "6px 0 0 6px" }} onClick={() => setView("list")}>매물</button>
          <button className={`btn ${view === "map" ? "primary" : ""}`} style={{ borderRadius: "0 6px 6px 0", borderLeft: 0 }} onClick={() => setView("map")}>지도</button>
        </div>
      </div>

      {/* 지도 뷰 */}
      {view === "map" && (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14 }}>
          <div className="panel" style={{ padding: 14, alignSelf: "start" }}>
            {picked ? (
              <>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>{picked.addr.replace("서울특별시 ", "").replace("번지", "")}</div>
                <div className="kv"><span className="k">매매가</span><span className="v num">{won(picked.price)}</span></div>
                <div className="kv"><span className="k">대지면적</span><span className="v num">{picked.land_area ?? "—"}㎡</span></div>
                <div className="kv"><span className="k">층수</span><span className="v">지상 {picked.floors_above ?? "—"} · 지하 {picked.floors_below ?? "—"}</span></div>
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

      {/* 3열 결과 */}
      {view === "list" && (result.data ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0 }}>
          {COLS.map(({ key, label, color }, ci) => {
            const col = result.data![key];
            return (
              <div key={key} className="panel" style={{
                borderRadius: ci === 0 ? "9px 0 0 9px" : ci === 2 ? "0 9px 9px 0" : 0,
                borderLeft: ci > 0 ? 0 : undefined,
              }}>
                <div style={{ background: color, color: "#fff", fontWeight: 800, textAlign: "center",
                  padding: "9px 0", borderRadius: ci === 0 ? "8px 0 0 0" : ci === 2 ? "0 8px 0 0" : 0 }}>
                  {label} <span className="num" style={{ opacity: .85, fontWeight: 600 }}>{col.total.toLocaleString()}</span>
                </div>
                <table className="wf">
                  <thead><tr><th>주소</th><th className="num">매매가{key === "normal" && <small style={{ color: "var(--muted)" }}> 추정</small>}</th></tr></thead>
                  <tbody>
                    {col.items.map((h) => (
                      <tr key={h.building_pk} style={{ cursor: "pointer" }} onClick={() => go(h.building_pk)}>
                        <td>{h.addr.replace("서울특별시 ", "").replace("번지", "")}</td>
                        <td className="num">{won(h.price)}</td>
                      </tr>
                    ))}
                    {col.items.length === 0 && (
                      <tr><td colSpan={2} style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>
                        {key === "mine" ? "아직 등록한 매물이 없습니다" : "표시할 매물이 없습니다"}
                      </td></tr>
                    )}
                  </tbody>
                </table>
                {col.pages > 1 && (
                  <div style={{ display: "flex", justifyContent: "center", gap: 12, padding: 9, borderTop: "1px solid var(--line)", fontSize: 12 }}>
                    <button className="btn" disabled={col.page <= 1}
                      onClick={() => setPages((p) => ({ ...p, [key]: col.page - 1 }))}>‹</button>
                    <span className="num" style={{ alignSelf: "center" }}>{col.page} / {col.pages}</span>
                    <button className="btn" disabled={col.page >= col.pages}
                      onClick={() => setPages((p) => ({ ...p, [key]: col.page + 1 }))}>›</button>
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
