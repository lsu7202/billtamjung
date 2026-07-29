/** 주변상권 영역 — 원(중심 자유·반경) 또는 자유곡선 폴리곤. MarketBlock·PhotoPanel 공유.
 * circle.center 없으면 본매물 기준(기본값). */
export type MarketArea =
  | { kind: "circle"; radius_m: number; center?: { lng: number; lat: number } }
  | { kind: "polygon"; geojson: object; area_m2: number };

/** 지도에 찍을 주변 매물 포인트 — 실거래(sale)/임대(rent) 색 구분. */
export type CompPoint = { building_pk: string; lng: number; lat: number; kind: "sale" | "rent" };

/** 매물 상세를 새 탭으로 (redirect=항상 새 탭). */
export const openDetail = (pk: string) => window.open(`/buildings/${pk}`, "_blank", "noopener");

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
