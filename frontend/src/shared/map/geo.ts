/** 주변상권 영역 — 원(중심 자유·반경) 또는 자유곡선 폴리곤. MarketBlock·PhotoPanel 공유.
 * circle.center 없으면 본매물 기준(기본값). */
export type MarketArea =
  | { kind: "circle"; radius_m: number; center?: { lng: number; lat: number } }
  | { kind: "polygon"; geojson: object; area_m2: number };

/** 실거래 사례 조건 — 기간(년)·가격 하한/상한(원). 리포트와 매물상세가 같은 값을 쓴다.
 *  기본은 현행 그대로(5년·무제한)라 조건을 안 건드리면 값이 안 변한다. */
export type CompFilter = { years: number; price_min: number | null; price_max: number | null };
export const COMP_FILTER_DEFAULT: CompFilter = { years: 5, price_min: null, price_max: null };

/** 여러 영역을 한 GeoJSON으로 합친다 — 백엔드는 폴리곤 하나만 받으므로 MultiPolygon으로 넘긴다.
 *  ST_Within(b.geom, MultiPolygon)이 그대로 성립해서 서버는 손댈 것이 없다. */
export function mergeGeo(list: object[]): object | null {
  const polys: unknown[] = [];
  for (const g of list) {
    const o = g as { type?: string; coordinates?: unknown[] };
    if (o.type === "Polygon") polys.push(o.coordinates);
    else if (o.type === "MultiPolygon") polys.push(...(o.coordinates ?? []));
  }
  return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
}

/** 지도에 찍을 주변 매물 포인트 — 실거래(sale)/임대(rent) 색 구분. */
export type CompPoint = { building_pk: string; lng: number; lat: number; kind: "sale" | "rent" };

/** 매물 상세를 새 탭으로 (redirect=항상 새 탭). */
// 나대지 매물은 building_pk 자리에 'P'+pnu 가 산다(2026-08-27) — 상세도 필지 화면으로 간다.
// 진짜 건물 PK 는 숫자로 시작하므로(대장 PK) 접두 'P' 와 부딪히지 않는다.
export const openDetail = (pk: string) =>
  window.open(pk.startsWith("P") ? `/parcels/${pk.slice(1)}` : `/buildings/${pk}`, "_blank", "noopener");

/** 원(중심+반경) → GeoJSON 폴리곤(n각형 근사). 백엔드 ST_Within 필터용. */
export function circleToGeoJSON(center: { lng: number; lat: number }, radius_m: number, n = 64): object {
  const latR = radius_m / 111320, lngR = radius_m / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const ring: number[][] = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; ring.push([center.lng + lngR * Math.cos(a), center.lat + latR * Math.sin(a)]); }
  return { type: "Polygon", coordinates: [ring] };
}

/** 두 LatLng 사이 거리(m) — 하버사인. */
export function meters(a: any, b: any): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat() - a.lat()) * toR, dLng = (b.lng() - a.lng()) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat() * toR) * Math.cos(b.lat() * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 폴리곤 면적(㎡) — 국소 등거리 투영 후 shoelace. */
export function areaM2(pts: any[]): number {
  if (pts.length < 3) return 0;
  const R = 6371000, toR = Math.PI / 180, lat0 = pts[0].lat() * toR;
  const xy = pts.map((p) => [p.lng() * toR * Math.cos(lat0) * R, p.lat() * toR * R]);
  let s = 0;
  for (let i = 0; i < xy.length; i++) { const j = (i + 1) % xy.length; s += xy[i][0] * xy[j][1] - xy[j][0] * xy[i][1]; }
  return Math.abs(s / 2);
}

/** GeoJSON Polygon/MultiPolygon → naver 링 경로. [lng,lat]→LatLng. MapPanel·PhotoPanel 공유. */
export function geoToPaths(naver: any, geo: any): any[] {
  const rings: any[] = [];
  const add = (poly: number[][][]) => poly.forEach((r) => rings.push(r.map(([lng, lat]) => new naver.maps.LatLng(lat, lng))));
  if (geo?.type === "Polygon") add(geo.coordinates);
  else if (geo?.type === "MultiPolygon") geo.coordinates.forEach(add);
  return rings;
}

export const fmtArea = (a: number) =>
  `${a >= 10000 ? `${(a / 10000).toFixed(2)}ha` : `${Math.round(a).toLocaleString()}㎡`} · ${Math.round(a / 3.3058).toLocaleString()}평`;
export const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`);

/** 로드뷰 시야 부채꼴: 위치+heading(pan°, 북=0 시계방향)+fov로 반경 R(m) 섹터 LatLng 경로. */
export function conePath(naver: any, lat: number, lng: number, pan: number, fov: number, R = 45): any[] {
  const pts = [new naver.maps.LatLng(lat, lng)];
  const mLat = R / 111320, mLng = R / (111320 * Math.cos((lat * Math.PI) / 180));
  const half = Math.min(fov, 120) / 2;
  for (let a = pan - half; a <= pan + half; a += 6) {
    const r = (a * Math.PI) / 180;
    pts.push(new naver.maps.LatLng(lat + Math.cos(r) * mLat, lng + Math.sin(r) * mLng));
  }
  return pts;
}
