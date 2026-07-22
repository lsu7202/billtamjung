import { useEffect, useRef, useState } from "react";
import { loadNaver, PIN_COLORS, priceLabel } from "./naver";

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

type DrawMode = "off" | "free" | "poly";

export function MapPanel({
  pins, onPick, onPolygon, polygonActive,
}: {
  pins: MapPin[];
  onPick: (pk: string) => void;
  onPolygon: (geojson: object | null) => void;
  polygonActive: boolean;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const cadastralRef = useRef<any>(null);
  const overlayRef = useRef<any>(null);       // 그린 영역 폴리곤 표시
  const drawingRef = useRef<{ mode: DrawMode; pts: any[]; temp: any | null }>({ mode: "off", pts: [], temp: null });
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mapType, setMapType] = useState<"normal" | "satellite">("normal");
  const [cadastre, setCadastre] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode>("off");

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

  // 영역 그리기(자유곡선: 드래그 / 다각형: 클릭+더블클릭 닫기)
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    const map = mapRef.current;
    const d = drawingRef.current;
    d.mode = drawMode;
    map.setOptions({ draggable: drawMode === "off" });

    if (drawMode === "off") return;
    d.pts = [];

    const finish = () => {
      if (d.temp) { d.temp.setMap(null); d.temp = null; }
      if (d.pts.length >= 3) {
        overlayRef.current?.setMap(null);
        overlayRef.current = new naver.maps.Polygon({
          map, paths: [d.pts],
          fillColor: "#1E5AF0", fillOpacity: 0.12,
          strokeColor: "#1E5AF0", strokeWeight: 1.5, strokeStyle: "shortdash",
        });
        const ring = d.pts.map((ll: any) => [ll.lng(), ll.lat()]);
        ring.push(ring[0]);
        onPolygon({ type: "Polygon", coordinates: [ring] });
      }
      d.pts = [];
      setDrawMode("off");
    };

    const listeners: any[] = [];
    if (drawMode === "free") {
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
        {polygonActive && <button className="btn" style={{ color: "var(--up)" }} onClick={clearPolygon}>✕ 영역 지우기</button>}
      </div>
      {/* 레이어 툴바(§3.6a) */}
      <div style={{ position: "absolute", top: 12, right: 12, zIndex: 5, display: "flex", gap: 6 }}>
        <button className="btn" style={layerBtn(mapType === "normal")} onClick={() => setMapType("normal")}>일반</button>
        <button className="btn" style={layerBtn(mapType === "satellite")} onClick={() => setMapType("satellite")}>위성</button>
        <button className="btn" style={layerBtn(cadastre)} onClick={() => setCadastre(!cadastre)}>지적도</button>
      </div>
      {drawMode !== "off" && (
        <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: 5,
          background: "var(--ink)", color: "#fff", fontSize: 12, padding: "7px 14px", borderRadius: 999 }}>
          {drawMode === "free" ? "드래그로 영역을 그리세요" : "클릭으로 꼭짓점 · 더블클릭으로 닫기"}
        </div>
      )}
    </div>
  );
}
