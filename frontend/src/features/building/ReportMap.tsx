import { useRef, useState, useEffect } from "react";
import { loadNaver } from "../../shared/map/naver";
import { geoToPaths } from "../../shared/map/geo";

/** 상권 존 색상 — 격자 지배 용도. 덱 07·스토리 공용. */
export const ZONE_COLOR: Record<string, string> = { 업무: "#2B5AA8", 먹자: "#E8833A", 유흥: "#D64545", 판매: "#2E9E6B" };
/** 유동인구 농도의 색 — 상권 넷 어느 것과도 겹치지 않는 앱 파랑. */
export const POP_COLOR = "#3182F6";
/** pop: 0~1 로 정규화된 유동인구. 있으면 채움이 이 값의 농도가 되고 상권은 테두리로 간다. */
export type Zone = { geojson: unknown; cat: string; count: number; pop?: number | null };

/** 보고서용 지도 — 네이버 SDK. zones(상권 존 색칠) 있으면 우선, 없으면 필지 폴리곤/마커.
 *  cadastral: 지적편집도 레이어를 얹는다(필지 경계·지번을 지도가 직접 그려준다).
 *  zoom/onZoom: 배율을 밖에서 쥔다. 지도판과 지적도판이 같은 배율이어야 나란히 비교가 된다.
 *    휠(또는 핀치)로만 바꾼다 — 확대바는 없고 이동은 막는다. 본 매물이 늘 가운데 있어야 한다. */
export function ReportMap({ lng, lat, geom, zones, h, cadastral, zoom, onZoom, fit, layer = "pop" }: {
  lng?: number | null; lat?: number | null; geom?: any; zones?: Zone[]; h?: string;
  cadastral?: boolean; zoom?: number; onZoom?: (z: number) => void;
  fit?: boolean;                               // fit=false: 존을 다 담되 확대하지 않는다
  /** 무엇을 칠할까 — 'pop' 유동인구 농도(상권은 테두리) · 'cat' 상권 지배용도(채움) */
  layer?: "pop" | "cat";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (lng == null || lat == null || !ref.current) return;
    let map: any;
    let dead = false;                      // SDK 로드 중에 언마운트되면 지도를 만들지 않는다(누수)
    loadNaver().then((naver) => {
      if (dead || !ref.current) return;
      const pos = new naver.maps.LatLng(lat, lng);
      const ctl = zoom != null;            // 배율을 밖에서 쥐는 모드
      map = new naver.maps.Map(ref.current, {
        center: pos, zoom: zoom ?? (cadastral ? 18 : 16),
        draggable: false, scrollWheel: ctl, pinchZoom: ctl,
        disableDoubleClickZoom: true, scaleControl: false, mapDataControl: false,
        zoomControl: false, keyboardShortcuts: false,
      });
      mapRef.current = map;
      // 휠로 바뀐 배율을 밖으로 알린다 → 반대쪽 판도 같은 배율로 따라온다
      if (ctl && onZoom) naver.maps.Event.addListener(map, "zoom_changed", (z: number) => onZoom(z));
      // 지적편집도 — SDK가 제공하는 레이어. 우리가 필지를 그리지 않아도 지번까지 나온다.
      if (cadastral && naver.maps.CadastralLayer) new naver.maps.CadastralLayer().setMap(map);
      if (zones && zones.length) {
        const bnds = new naver.maps.LatLngBounds();
        zones.forEach((z) => {
          const paths = geoToPaths(naver, z.geojson);
          const col = ZONE_COLOR[z.cat] || "#8891a0";
          // pop 이 있으면 **채움이 유동인구**다(파랑 한 색의 농도), 상권은 테두리로 내린다.
          // 둘 다 채움에 넣으면 색이 주인공이 되어 유동인구 지도가 상권 지도로 읽힌다
          // (강남처럼 한 용도가 압도하는 데선 온통 같은 파랑이 된다 — 2026-08-26).
          // 진하기 바닥은 0.10 — 가장 옅은 칸도 「자료 없음」과 구별돼야 한다.
          // 채움을 유동인구가 쓰면 상권은 테두리로 밀리는데, 250m 칸에서 2.5px 선은
          // 옆 칸과 구별이 안 됐다(2026-08-28). 그래서 무엇을 칠할지 밖에서 고른다:
          //   layer='pop'  유동인구 농도(파랑) + 상권 테두리
          //   layer='cat'  상권 지배용도(색) — 테두리 없이 채움만, 칸 경계는 흰 선
          const heat = z.pop != null && layer !== "cat";
          const op = heat ? 0.10 + Math.max(0, Math.min(1, z.pop!)) * 0.72 : 0.55;
          new naver.maps.Polygon({ map, paths, clickable: false,
            fillColor: heat ? POP_COLOR : col, fillOpacity: op,
            strokeColor: heat ? col : "#fff",
            strokeWeight: heat ? 2.5 : 1, strokeOpacity: heat ? 0.85 : 0.9 });
          paths.forEach((ring: any[]) => ring.forEach((p: any) => bnds.extend(p)));
        });
        // 역은 그리지 않는다 — 네이버 타일이 이미 역 아이콘과 이름을 그린다.
        // 우리가 겹쳐 찍으면 같은 정보가 두 벌이 되고, 본매물 표시와 헷갈린다(2026-08-26).
        const subPaths = geom ? geoToPaths(naver, geom) : [];   // 본매물 = 필지 폴리곤(점 아님)
        const heatMap = zones.some((z) => z.pop != null) && layer !== "cat";
        if (subPaths.length)
          new naver.maps.Polygon({ map, paths: subPaths, clickable: false, zIndex: 100,
            fillColor: "#262320", fillOpacity: 0.95, strokeColor: "#fff",
            strokeWeight: heatMap ? 4 : 2, strokeOpacity: 1 });
        // 유동인구 지도에서는 필지 폴리곤만으로 부족하다 — 250m 칸 옆에서 12m 필지는 몇 픽셀이라
        // 역 라벨에 그대로 묻힌다. 필지는 칠하되 위치를 알리는 고리를 겹쳐 둔다(2026-08-26).
        if (!subPaths.length || heatMap)
          new naver.maps.Marker({ position: pos, map, zIndex: 110,
            icon: { content: subPaths.length
              ? `<div style="width:26px;height:26px;border-radius:50%;border:3px solid #262320;box-shadow:0 0 0 2px rgba(255,255,255,.95)"></div>`
              : `<div style="width:16px;height:16px;border-radius:50%;background:#262320;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>`,
              anchor: new naver.maps.Point(subPaths.length ? 13 : 9, subPaths.length ? 13 : 9) } });
        map.fitBounds(bnds, { top: 12, right: 12, bottom: 12, left: 12 });
        // 상권 지도는 존이 잘려도 본매물 주변 밀도를 우선해 한 단계 당긴다.
        // 유동인구 지도(fit=false)는 반대다 — 반경 600m 칸이 다 보여야 「길 하나 건너 12배」가 읽힌다.
        if (fit !== false) map.setZoom(map.getZoom() + 1, false);
        map.setCenter(pos);
        return;
      }
      const paths = geom ? geoToPaths(naver, geom) : [];
      if (paths.length) {
        new naver.maps.Polygon({ map, paths, clickable: false,
          // 지적도 위에서는 필지를 덮어버리면 지번·경계가 안 보인다 — 테두리만 남긴다
          fillColor: "#262320", fillOpacity: cadastral ? 0.14 : 0.85,
          strokeColor: cadastral ? "#D64545" : "#fff", strokeWeight: cadastral ? 3 : 2, strokeOpacity: 1 });
        // 배율을 밖에서 쥘 때는 자동 맞춤을 하지 않는다 — 두 판의 배율이 갈라진다.
        if (!ctl) {
          const bnds = new naver.maps.LatLngBounds();
          paths.forEach((ring: any[]) => ring.forEach((p: any) => bnds.extend(p)));
          map.fitBounds(bnds, { top: 60, right: 60, bottom: 60, left: 60 });
          map.setZoom(map.getZoom() - 3);
          map.setCenter(new naver.maps.LatLng(lat, lng));
        }
      } else {
        new naver.maps.Marker({ position: pos, map,
          icon: { content: `<div style="width:15px;height:15px;border-radius:50%;background:#262320;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>`, anchor: new naver.maps.Point(9, 9) } });
      }
    }).catch(() => setErr(true));
    // 네이버 SDK의 destroy()는 내부 리스너 정리 중 종종 터진다(removeDOMListener → isArray of null).
    // 그대로 두면 덱에서 위치도 슬라이드를 넘기는 순간 ErrorBoundary가 화면 전체를 삼킨다.
    return () => {
      dead = true; mapRef.current = null;
      try { map?.destroy?.(); } catch { /* 정리 실패는 무시 */ }
    };
    // zoom은 의존성에서 뺀다 — 배율이 바뀔 때마다 지도를 다시 만들면 안 된다(아래 effect가 반영)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lng, lat, geom, zones, cadastral, fit, layer]);

  // 밖에서 배율이 바뀌면 살아 있는 지도에 그대로 적용한다
  useEffect(() => {
    if (zoom != null && mapRef.current && mapRef.current.getZoom() !== zoom) {
      mapRef.current.setZoom(zoom, false);
    }
  }, [zoom]);

  if (lng == null || lat == null) return <div className="rs-map rs-map-empty">위치 정보 없음</div>;
  return <div className="rs-map" ref={ref} style={h ? { height: h, minHeight: 0, flex: "none" } : undefined}>{err && <span className="rs-map-empty">지도를 불러오지 못했습니다</span>}</div>;
}
