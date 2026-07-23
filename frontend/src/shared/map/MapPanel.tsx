import { useEffect, useRef, useState } from "react";
import { loadNaver, PIN_COLORS, priceLabel } from "./naver";
import { searchApi } from "../api/endpoints";

/** S01 지도 뷰 — 분류색 핀 · 레이어(일반/위성/지적도) · 영역 그리기(자유곡선/다각형).
 * specs S01 §3.6·3.6a·3.6c, 네이버지도-연동 §1.2·3.1.
 */
export interface MapPin {
  building_pk: string;
  addr: string;
  lng: number;
  lat: number;
  col: "ad" | "mine" | "normal";
  price: number | null;
  roi?: number | null;
  is_fav?: boolean;
  land_area?: number | null;
  floors_above?: number | null;
  floors_below?: number | null;
}

type DrawMode = "off" | "free" | "poly" | "magnet";

/** GeoJSON(Polygon/MultiPolygon) → naver paths(링 배열). 좌표 [lng,lat]→LatLng(lat,lng). */
function geoToPaths(naver: any, geo: any): any[] {
  const rings: any[] = [];
  const add = (poly: number[][][]) => poly.forEach((r) => rings.push(r.map(([lng, lat]) => new naver.maps.LatLng(lat, lng))));
  if (geo?.type === "Polygon") add(geo.coordinates);
  else if (geo?.type === "MultiPolygon") geo.coordinates.forEach(add);
  return rings;
}

/** 로드뷰 시야 부채꼴: 위치+heading(pan°, 북=0 시계방향)+fov로 반경 R(m) 섹터 LatLng 경로. */
function conePath(naver: any, lat: number, lng: number, pan: number, fov: number, R = 45): any[] {
  const pts = [new naver.maps.LatLng(lat, lng)];
  const mLat = R / 111320, mLng = R / (111320 * Math.cos((lat * Math.PI) / 180));
  const half = Math.min(fov, 120) / 2;
  for (let a = pan - half; a <= pan + half; a += 6) {
    const r = (a * Math.PI) / 180;
    pts.push(new naver.maps.LatLng(lat + Math.cos(r) * mLat, lng + Math.sin(r) * mLng));
  }
  return pts;
}

export function MapPanel({
  pins, onPick, onPolygon, polygonActive, selectedPk, selectedCol, onParcelClick, centerReq, roadviewReq,
}: {
  pins: MapPin[];
  onPick: (pk: string) => void;
  onPolygon: (geojson: object | null) => void;
  polygonActive: boolean;
  selectedPk?: string | null;                 // 선택 건물(필지 분류색 오버레이)
  selectedCol?: "ad" | "mine" | "normal" | null;
  onParcelClick?: (building_pk: string | null, pnu: string) => void;  // 필지 클릭(부동산플래닛식)
  centerReq?: { lng: number; lat: number } | null;  // 지도 중심 이동 요청(사이드바·지도위치 선택 시)
  roadviewReq?: { lng: number; lat: number } | null;  // 큰 로드뷰 열기 요청(sel-card 확대)
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const cadastralRef = useRef<any>(null);
  const overlayRef = useRef<any>(null);       // 그린 영역 폴리곤 표시
  const selParcelRef = useRef<any>(null);     // 선택 필지(분류색 오버레이)
  const drawingRef = useRef<{ mode: DrawMode; pts: any[]; temp: any | null }>({ mode: "off", pts: [], temp: null });
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mapType, setMapType] = useState<"normal" | "satellite">("normal");
  const [cadastre, setCadastre] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode>("off");
  const [snapping, setSnapping] = useState(false);       // 자석 스냅 진행 표시
  const [street, setStreet] = useState(false);           // 거리뷰 모드(StreetLayer + 클릭→로드뷰)
  const [roadview, setRoadview] = useState<{ lng: number; lat: number } | null>(null);  // 파노라마 위치
  const [panoBig, setPanoBig] = useState(false);         // 로드뷰 작은/큰 화면
  const panoDivRef = useRef<HTMLDivElement>(null);
  const panoRef = useRef<any>(null);
  const streetRef = useRef<any>(null);                   // StreetLayer(커버리지)
  const rvMarkerRef = useRef<any>(null);                 // 지도 위 로드뷰 위치 마커
  const rvConeRef = useRef<any>(null);                   // 지도 위 시야(POV) 부채꼴

  // 지도 초기화
  useEffect(() => {
    let dead = false;
    loadNaver()
      .then((naver) => {
        if (dead || !divRef.current) return;
        const center = pins.length
          ? new naver.maps.LatLng(pins[0].lat, pins[0].lng)
          : new naver.maps.LatLng(37.5006, 127.0362);
        mapRef.current = new naver.maps.Map(divRef.current, { center, zoom: 15 });
        cadastralRef.current = new naver.maps.CadastralLayer();
        setReady(true);
      })
      .catch((e) => setErr((e as Error).message));
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 핀 렌더(분류색 라벨 마커)
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = pins.map((p) => {
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(p.lat, p.lng),
        map: mapRef.current,
        icon: {
          content: `<div style="background:${PIN_COLORS[p.col]};color:#fff;font:700 12px/1 'SF Mono',monospace;
            padding:5px 10px;border-radius:999px 999px 999px 3px;white-space:nowrap;
            box-shadow:0 3px 8px rgba(15,26,46,.3)">${priceLabel(p.price)}</div>`,
          anchor: new naver.maps.Point(10, 30),
        },
      });
      naver.maps.Event.addListener(marker, "click", () => onPick(p.building_pk));
      return marker;
    });
    if (pins.length && mapRef.current) {
      const naver2 = window.naver;
      const bounds = new naver2.maps.LatLngBounds();
      pins.forEach((p) => bounds.extend(new naver2.maps.LatLng(p.lat, p.lng)));
      mapRef.current.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pins]);

  // 선택 매물 좌표로 지도 중심 이동(줌 유지). 사이드바 목록·지도위치 선택 시 요청됨
  useEffect(() => {
    if (!ready || !centerReq) return;
    const naver = window.naver;
    mapRef.current.panTo(new naver.maps.LatLng(centerReq.lat, centerReq.lng));
  }, [ready, centerReq]);

  // 레이어 토글
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    mapRef.current.setMapTypeId(mapType === "satellite" ? naver.maps.MapTypeId.SATELLITE : naver.maps.MapTypeId.NORMAL);
  }, [ready, mapType]);
  useEffect(() => {
    if (!ready || !cadastralRef.current) return;
    cadastralRef.current.setMap(cadastre ? mapRef.current : null);
  }, [ready, cadastre]);

  // 지도 클릭 → 그 지점 필지 조회(부동산플래닛식). 그리기·거리뷰 모드 아닐 때만.
  useEffect(() => {
    if (!ready || !onParcelClick || drawMode !== "off" || street) return;
    const naver = window.naver;
    const map = mapRef.current;
    const listener = naver.maps.Event.addListener(map, "click", async (e: any) => {
      try {
        const { building_pk } = await searchApi.parcelAt(e.coord.lng(), e.coord.lat());
        onParcelClick(building_pk, "");
      } catch { /* 필지 없음 무시 */ }
    });
    return () => naver.maps.Event.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, drawMode, street]);

  // 거리뷰 모드: StreetLayer(커버리지) 표시 + 지도 클릭 → 그 지점 로드뷰 열기
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    const map = mapRef.current;
    if (!streetRef.current) streetRef.current = new naver.maps.StreetLayer();
    streetRef.current.setMap(street ? map : null);
    if (!street) return;
    const listener = naver.maps.Event.addListener(map, "click", (e: any) => {
      setRoadview({ lng: e.coord.lng(), lat: e.coord.lat() });
      setPanoBig(false);
    });
    return () => naver.maps.Event.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, street]);

  // sel-card 확대 요청 → 큰 로드뷰 열기(+ 커버리지 표시)
  useEffect(() => {
    if (!ready || !roadviewReq) return;
    setStreet(true);
    setRoadview(roadviewReq);
    setPanoBig(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, roadviewReq]);

  // 파노라마 생성/이동 + 지도 위 위치 마커·시야 부채꼴 동기화
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    const map = mapRef.current;
    if (!roadview) {                                      // 닫힘 → 정리
      panoRef.current?.setVisible?.(false);
      rvMarkerRef.current?.setMap(null); rvMarkerRef.current = null;
      rvConeRef.current?.setMap(null); rvConeRef.current = null;
      return;
    }
    const pos = new naver.maps.LatLng(roadview.lat, roadview.lng);
    const drawPov = () => {
      if (!panoRef.current) return;
      const p = panoRef.current.getPosition?.(); if (!p) return;
      const pov = panoRef.current.getPov?.() ?? { pan: 0, fov: 90 };
      rvConeRef.current?.setMap(null);
      rvConeRef.current = new naver.maps.Polygon({
        map, paths: [conePath(naver, p.lat(), p.lng(), pov.pan, pov.fov)],
        fillColor: "#1E5AF0", fillOpacity: 0.22, strokeColor: "#1E5AF0", strokeWeight: 1, zIndex: 90,
      });
      if (rvMarkerRef.current) rvMarkerRef.current.setPosition(p);
    };
    if (!panoRef.current && panoDivRef.current) {
      panoRef.current = new naver.maps.Panorama(panoDivRef.current, { position: pos, pov: { pan: 0, tilt: 0, fov: 100 } });
      naver.maps.Event.addListener(panoRef.current, "pano_changed", drawPov);
      naver.maps.Event.addListener(panoRef.current, "pov_changed", drawPov);
    } else if (panoRef.current) {
      panoRef.current.setVisible?.(true);
      panoRef.current.setPosition(pos);
    }
    rvMarkerRef.current?.setMap(null);
    rvMarkerRef.current = new naver.maps.Marker({
      position: pos, map, zIndex: 91,
      icon: { content: `<div style="width:16px;height:16px;border-radius:50%;background:#1E5AF0;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`, anchor: new naver.maps.Point(8, 8) },
    });
    setTimeout(drawPov, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, roadview]);

  // 선택 건물의 필지에 분류색 오버레이(폴리곤 클릭·사이드바·핀 선택 공통 경로)
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    selParcelRef.current?.setMap(null);
    selParcelRef.current = null;
    if (!selectedPk) return;
    let dead = false;
    searchApi.parcelFor(selectedPk).then(({ polygon }) => {
      if (dead || !polygon) return;
      const c = PIN_COLORS[selectedCol ?? "normal"];
      selParcelRef.current = new naver.maps.Polygon({
        map: mapRef.current, paths: geoToPaths(naver, polygon), clickable: false,
        fillColor: c, fillOpacity: 0.35, strokeColor: c, strokeWeight: 2.2, zIndex: 60,
      });
    }).catch(() => { /* 필지 없음 무시 */ });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedPk, selectedCol]);

  // 영역 그리기(자유곡선/자석: 드래그 / 다각형: 클릭+더블클릭 닫기)
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    const map = mapRef.current;
    const d = drawingRef.current;
    d.mode = drawMode;
    map.setOptions({ draggable: drawMode === "off" });

    if (drawMode === "off") return;
    d.pts = [];

    // GeoJSON(Poly/MultiPoly) → naver paths(링 배열)
    const toPaths = (geo: any): any[] => {
      const rings: any[] = [];
      const add = (poly: number[][][]) => poly.forEach((r) => rings.push(r.map(([lng, lat]) => new naver.maps.LatLng(lat, lng))));
      if (geo.type === "Polygon") add(geo.coordinates);
      else if (geo.type === "MultiPolygon") geo.coordinates.forEach(add);
      return rings;
    };
    const drawOverlay = (paths: any[], snapped: boolean) => {
      overlayRef.current?.setMap(null);
      overlayRef.current = new naver.maps.Polygon({
        map, paths,
        fillColor: "#1E5AF0", fillOpacity: 0.12,
        strokeColor: "#1E5AF0", strokeWeight: snapped ? 2 : 1.5, strokeStyle: snapped ? "solid" : "shortdash",
      });
    };

    const finish = async () => {
      if (d.temp) { d.temp.setMap(null); d.temp = null; }
      if (d.pts.length >= 3) {
        const ring = d.pts.map((ll: any) => [ll.lng(), ll.lat()]);
        ring.push(ring[0]);
        const raw = { type: "Polygon", coordinates: [ring] };
        if (d.mode === "magnet") {
          // 자석(후처리): 그린 영역 → 걸치는 필지 합집합으로 스냅
          setSnapping(true);
          try {
            const { polygon } = await searchApi.snap(raw);
            if (polygon) { drawOverlay(toPaths(polygon), true); onPolygon(polygon); }
            else { drawOverlay([d.pts], false); onPolygon(raw); }   // 필지 미포함 → 원본 폴백
          } catch { drawOverlay([d.pts], false); onPolygon(raw); }
          finally { setSnapping(false); }
        } else {
          drawOverlay([d.pts], false);
          onPolygon(raw);
        }
      }
      d.pts = [];
      setDrawMode("off");
    };

    const listeners: any[] = [];
    if (drawMode === "free" || drawMode === "magnet") {
      let down = false;
      listeners.push(
        naver.maps.Event.addListener(map, "mousedown", (e: any) => { down = true; d.pts = [e.coord]; }),
        naver.maps.Event.addListener(map, "mousemove", (e: any) => {
          if (!down) return;
          d.pts.push(e.coord);
          if (d.pts.length % 3 === 0) {
            d.temp?.setMap(null);
            d.temp = new naver.maps.Polyline({ map, path: d.pts, strokeColor: "#1E5AF0", strokeWeight: 2 });
          }
        }),
        naver.maps.Event.addListener(map, "mouseup", () => { down = false; finish(); }),
      );
    } else {
      listeners.push(
        naver.maps.Event.addListener(map, "click", (e: any) => {
          d.pts.push(e.coord);
          d.temp?.setMap(null);
          d.temp = new naver.maps.Polyline({ map, path: d.pts, strokeColor: "#1E5AF0", strokeWeight: 2 });
        }),
        naver.maps.Event.addListener(map, "dblclick", (e: any) => { e.pointerEvent?.preventDefault?.(); finish(); }),
      );
    }
    return () => listeners.forEach((l) => naver.maps.Event.removeListener(l));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, drawMode]);

  function clearPolygon() {
    overlayRef.current?.setMap(null);
    overlayRef.current = null;
    onPolygon(null);
  }

  if (err) return <div className="panel" style={{ padding: 24, color: "var(--up)" }}>{err}</div>;

  const layerBtn = (on: boolean): React.CSSProperties => ({
    background: on ? "var(--signal-bg)" : "#fff",
    color: on ? "var(--signal)" : "var(--ink)",
    borderColor: on ? "var(--signal)" : "var(--line-2)",
  });

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div ref={divRef} style={{ position: "absolute", inset: 0 }} />
      {/* 영역 그리기 도구(S01 §3.6c) */}
      <div style={{ position: "absolute", top: 12, left: 12, zIndex: 5, display: "flex", gap: 6 }}>
        <button className="btn" style={layerBtn(drawMode === "free")} onClick={() => setDrawMode(drawMode === "free" ? "off" : "free")}>✎ 자유곡선</button>
        <button className="btn" style={layerBtn(drawMode === "poly")} onClick={() => setDrawMode(drawMode === "poly" ? "off" : "poly")}>▱ 다각형</button>
        <button className="btn" style={layerBtn(drawMode === "magnet")} onClick={() => setDrawMode(drawMode === "magnet" ? "off" : "magnet")}>🧲 자석 올가미</button>
        {polygonActive && <button className="btn" style={{ color: "var(--up)" }} onClick={clearPolygon}>✕ 영역 지우기</button>}
      </div>
      {/* 레이어 툴바(§3.6a) */}
      <div style={{ position: "absolute", top: 12, right: 12, zIndex: 5, display: "flex", gap: 6 }}>
        <button className="btn" style={layerBtn(mapType === "normal")} onClick={() => setMapType("normal")}>일반</button>
        <button className="btn" style={layerBtn(mapType === "satellite")} onClick={() => setMapType("satellite")}>위성</button>
        <button className="btn" style={layerBtn(cadastre)} onClick={() => setCadastre(!cadastre)}>지적도</button>
        <button className="btn" style={layerBtn(street)} onClick={() => { setStreet(!street); if (street) setRoadview(null); }}>🧍 거리뷰</button>
      </div>
      {street && !roadview && (
        <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: 5,
          background: "var(--ink)", color: "#fff", fontSize: 12, padding: "7px 14px", borderRadius: 999 }}>
          파란 도로를 클릭하면 그 위치 거리뷰가 열립니다
        </div>
      )}

      {/* 로드뷰 파노라마 오버레이(작은/큰 전환) */}
      <div style={{
        position: "absolute", zIndex: 20, overflow: "hidden", borderRadius: 10, border: "2px solid #fff",
        boxShadow: "0 4px 16px rgba(0,0,0,.35)", display: roadview ? "block" : "none",
        ...(panoBig
          ? { inset: 12 }
          : { left: 12, bottom: 12, width: 380, height: 260 }),
      }}>
        <div ref={panoDivRef} style={{ position: "absolute", inset: 0, background: "#2a2f36" }} />
        <div style={{ position: "absolute", top: 8, right: 8, zIndex: 2, display: "flex", gap: 6 }}>
          <button className="btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setPanoBig(!panoBig)}>{panoBig ? "⤡ 작게" : "⤢ 크게"}</button>
          <button className="btn" style={{ padding: "5px 10px", fontSize: 12, color: "var(--up)" }} onClick={() => setRoadview(null)}>✕ 닫기</button>
        </div>
      </div>
      {(drawMode !== "off" || snapping) && (
        <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: 5,
          background: "var(--ink)", color: "#fff", fontSize: 12, padding: "7px 14px", borderRadius: 999 }}>
          {snapping ? "🧲 필지 경계로 스냅 중…"
            : drawMode === "poly" ? "클릭으로 꼭짓점 · 더블클릭으로 닫기"
            : drawMode === "magnet" ? "드래그로 감싸면 필지 경계로 자동 스냅됩니다"
            : "드래그로 영역을 그리세요"}
        </div>
      )}
    </div>
  );
}
