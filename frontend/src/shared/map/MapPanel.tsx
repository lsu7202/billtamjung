import { useEffect, useRef, useState } from "react";
import { loadNaver, PIN_COLORS } from "./naver";
import { makeCanvasPinLayer, type CanvasLayer, type CanvasPin } from "./mapCanvasLayer";
import { meters, areaM2, geoToPaths, circleToGeoJSON, conePath } from "./geo";
import { makeRuler, Ruler } from "./ruler";
import { Icon } from "../ui/Icon";
import { Segmented } from "../ui/Segmented";
import { SourceTag } from "../ui/Notice";
import { searchApi } from "../api/endpoints";

/** S01 지도 뷰 — 분류색 핀 · 레이어(일반/위성/지적도) · 영역 그리기(자유곡선/다각형).
 * specs S01 §3.6·3.6a·3.6c, 네이버지도-연동 §1.2·3.1.
 */
export interface MapPin {
  building_pk: string;
  addr: string;
  lng: number;
  lat: number;
  col: "mine" | "normal";
  price: number | null;
  last_sale_price?: number | null;
  sale_est?: number | null;
  roi?: number | null;
  land_area?: number | null;
  floors_above?: number | null;
  floors_below?: number | null;
}

type DrawMode = "off" | "free" | "poly" | "magnet" | "circle" | "ruler";

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`);
const fmtArea = (a: number) => `${a >= 10000 ? `${(a / 10000).toFixed(2)}ha` : `${Math.round(a).toLocaleString()}㎡`} (${Math.round(a / 3.3058).toLocaleString()}평)`;

export function MapPanel({
  pins, onPick, onPolygon, polygons, polygonActive, selectedPk, selectedCol, onParcelClick, centerReq, priceMode = "fair",
}: {
  pins: MapPin[];
  onPick: (pk: string) => void;
  onPolygon: (geojson: object | null) => void;   // 새 영역 1개(누적은 부모가) · null=전체 지우기
  polygons?: object[] | null;                 // 그려둔 영역들 — 지도에 전부 표시
  polygonActive: boolean;
  selectedPk?: string | null;                 // 선택 건물(필지 분류색 오버레이)
  selectedCol?: "mine" | "normal" | null;
  onParcelClick?: (building_pk: string | null, pnu: string) => void;  // 필지 클릭(부동산플래닛식)
  centerReq?: { lng: number; lat: number; zoom?: number } | null;  // 지도 중심 이동 요청(사이드바·지도위치 선택 시)
  priceMode?: "fair" | "real";               // 핀 태그 가격: 적정가/실거래가
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const pinLayerRef = useRef<CanvasLayer | null>(null);
  const cadastralRef = useRef<any>(null);
  const overlayRef = useRef<any[]>([]);       // 그린 영역 폴리곤들(여러 개 유지)
  const selParcelRef = useRef<any>(null);     // 선택 필지(분류색 오버레이 — 지도)
  const drawingRef = useRef<{ mode: DrawMode; pts: any[]; temp: any | null }>({ mode: "off", pts: [], temp: null });
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mapType, setMapType] = useState<"normal" | "satellite">("normal");
  const [cadastre, setCadastre] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode>("off");
  const [rulerOn, setRulerOn] = useState(false);        // 자(straightedge) 표시 — 자유곡선 스냅 가이드
  const rulerRef = useRef<Ruler | null>(null);
  const [snapping, setSnapping] = useState(false);       // 자석 스냅 진행 표시
  const [street, setStreet] = useState(false);           // 로드뷰 모드(StreetLayer + 클릭→로드뷰)
  const [roadview, setRoadview] = useState<{ lng: number; lat: number } | null>(null);  // 파노라마 위치
  const [panoBig, setPanoBig] = useState(false);         // 로드뷰 작은/큰 화면
  const panoDivRef = useRef<HTMLDivElement>(null);
  const panoRef = useRef<any>(null);
  const streetRef = useRef<any>(null);                   // StreetLayer(커버리지)
  const rvConeRef = useRef<any>(null);                   // 지도 위 시야(POV) 부채꼴
  const rvKeepRef = useRef<{ pos: any; pov: any } | null>(null);  // 전체화면 전환 시 위치·시점 보존
  const rvLastRef = useRef<{ lng: number; lat: number } | null>(null);  // 직전 roadview(위치 변경 감지)
  const [measure, setMeasure] = useState<"off" | "dist" | "area" | "radius">("off");  // 측정 도구
  const measureRef = useRef<{ pts: any[]; shapes: any[]; labels: any[] }>({ pts: [], shapes: [], labels: [] });

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

  // 핀 = 캔버스 레이어(DOM 마커 X) — 캔버스 1개에 클러스터+가격태그 그림. 수만 개도 부드러움.
  const onPickRef = useRef(onPick); onPickRef.current = onPick;
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const layer = makeCanvasPinLayer(window.naver, mapRef.current, (pk) => onPickRef.current(pk));
    pinLayerRef.current = layer;
    return () => { layer.destroy(); pinLayerRef.current = null; };
  }, [ready]);
  useEffect(() => { pinLayerRef.current?.setPins(pins as CanvasPin[]); }, [pins, ready]);
  useEffect(() => { pinLayerRef.current?.setPriceMode(priceMode); }, [priceMode, ready]);
  useEffect(() => { pinLayerRef.current?.setSelected(selectedPk ?? null); }, [selectedPk, ready]);

  // 선택 대상 좌표로 지도 이동. zoom을 주면 그 배율까지 확대한다.
  // 예전엔 줌을 그대로 뒀는데, 건물 하나를 골라도 줌 15면 선택 필지가 몇 픽셀이라
  // 지도에서 어디가 선택됐는지 보이지 않았다(800m만 움직이고 화면은 그대로인 것처럼 보임).
  useEffect(() => {
    if (!ready || !centerReq) return;
    const naver = window.naver;
    const at = new naver.maps.LatLng(centerReq.lat, centerReq.lng);
    const want = centerReq.zoom;
    if (want && mapRef.current.getZoom() < want) mapRef.current.morph(at, want);
    else mapRef.current.panTo(at);
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

  // 지도 클릭 → 그 지점 필지 조회(부동산플래닛식). 그리기·로드뷰·측정 모드 아닐 때만.
  useEffect(() => {
    if (!ready || !onParcelClick || drawMode !== "off" || street || measure !== "off") return;
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
  }, [ready, drawMode, street, measure]);

  // 측정 도구: 거리재기(폴리라인)·면적(폴리곤)·반경(원). 클릭으로 점 추가, 더블클릭 줌 억제.
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    const map = mapRef.current;
    const m = measureRef.current;
    const wipe = () => { m.shapes.forEach((s) => s.setMap(null)); m.labels.forEach((l) => l.setMap(null)); m.shapes = []; m.labels = []; };
    wipe(); m.pts = [];
    if (measure === "off") { map.setOptions({ disableDoubleClickZoom: false }); return; }
    map.setOptions({ disableDoubleClickZoom: true });

    const label = (pos: any, text: string) => new naver.maps.Marker({
      position: pos, map, zIndex: 100,
      icon: { content: `<div style="background:#262320;color:#fff;font:700 11px/1.4 sans-serif;padding:3px 7px;border-radius:5px;white-space:nowrap;transform:translate(-50%,-150%)">${text}</div>`, anchor: new naver.maps.Point(0, 0) },
    });
    const centroid = () => { let x = 0, y = 0; m.pts.forEach((p) => { x += p.lng(); y += p.lat(); }); return new naver.maps.LatLng(y / m.pts.length, x / m.pts.length); };
    const O = "#C2571C";
    const redraw = () => {
      wipe();
      if (!m.pts.length) return;
      if (measure === "dist") {
        m.shapes.push(new naver.maps.Polyline({ map, path: m.pts, strokeColor: O, strokeWeight: 3 }));
        let tot = 0; for (let i = 1; i < m.pts.length; i++) tot += meters(m.pts[i - 1], m.pts[i]);
        m.labels.push(label(m.pts[m.pts.length - 1], fmtDist(tot)));
      } else if (measure === "area") {
        if (m.pts.length >= 3) { m.shapes.push(new naver.maps.Polygon({ map, paths: [m.pts], fillColor: O, fillOpacity: 0.15, strokeColor: O, strokeWeight: 2 })); m.labels.push(label(centroid(), fmtArea(areaM2(m.pts)))); }
        else m.shapes.push(new naver.maps.Polyline({ map, path: m.pts, strokeColor: O, strokeWeight: 2 }));
      } else if (measure === "radius" && m.pts.length >= 2) {
        const r = meters(m.pts[0], m.pts[1]);
        m.shapes.push(new naver.maps.Circle({ map, center: m.pts[0], radius: r, fillColor: O, fillOpacity: 0.12, strokeColor: O, strokeWeight: 2 }));
        m.shapes.push(new naver.maps.Polyline({ map, path: [m.pts[0], m.pts[1]], strokeColor: O, strokeWeight: 2 }));
        m.labels.push(label(m.pts[1], `반경 ${fmtDist(r)} · ${fmtArea(Math.PI * r * r)}`));
      }
    };
    const onClick = naver.maps.Event.addListener(map, "click", (e: any) => {
      if (measure === "radius" && m.pts.length >= 2) m.pts = [e.coord];  // 새 반경 시작
      else m.pts.push(e.coord);
      redraw();
    });
    return () => naver.maps.Event.removeListener(onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, measure]);

  // 로드뷰 모드: StreetLayer(커버리지) 표시 + 지도 클릭 → 그 지점 로드뷰 열기
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

  // 파노라마 생성 + 지도 동기화. 위치 마크는 지도 중앙 고정 → 로드뷰 조작 시 지도가 이동(마크 아님).
  // 화살표 숨김 + 화면 더블클릭으로 그 방향 이동(네이버식).
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    const map = mapRef.current;
    rvConeRef.current?.setMap(null); rvConeRef.current = null;
    panoRef.current = null;
    if (panoDivRef.current) panoDivRef.current.innerHTML = "";
    if (!roadview || !panoDivRef.current) return;

    // roadview(위치)가 바뀌면 그 좌표로, panoBig(전체화면)만 바뀌면 직전 위치·시점 보존
    const moved = !rvLastRef.current || rvLastRef.current.lng !== roadview.lng || rvLastRef.current.lat !== roadview.lat;
    rvLastRef.current = roadview;
    const startPos = !moved && rvKeepRef.current ? rvKeepRef.current.pos : new naver.maps.LatLng(roadview.lat, roadview.lng);
    const startPov = !moved && rvKeepRef.current ? rvKeepRef.current.pov : { pan: 0, tilt: 0, fov: 100 };
    const pano = new naver.maps.Panorama(panoDivRef.current, {
      position: startPos, pov: startPov,
      flightSpot: false, aroundControl: false, zoomControl: false,  // 기본 화살표·컨트롤 숨김
    });
    panoRef.current = pano;

    // ★ 전체화면/PiP 전환 시 컨테이너 크기로 파노라마 리사이즈(재생성만으론 크기 반영 안 됨).
    // naver가 panoDiv를 생성시점 크기로 고정 → 래퍼(부모) 크기 기준으로 setSize 해야 전체화면을 채움
    const fitSize = () => {
      const wrap = panoDivRef.current?.parentElement;
      if (wrap && panoRef.current) panoRef.current.setSize?.(new naver.maps.Size(wrap.clientWidth, wrap.clientHeight));
    };
    requestAnimationFrame(fitSize);
    setTimeout(fitSize, 140);
    setTimeout(fitSize, 320);

    // 지도(중앙 마크 위치) 기준 시야 부채꼴 갱신. 지도가 위치의 소스.
    const sync = () => {
      const p = pano.getPosition?.(); const pov = pano.getPov?.() ?? { pan: 0, fov: 90 };
      if (p) rvKeepRef.current = { pos: p, pov };         // 전체화면 전환 대비 보존
      const c = map.getCenter();
      rvConeRef.current?.setMap(null);
      rvConeRef.current = new naver.maps.Polygon({
        map, paths: [conePath(naver, c.lat(), c.lng(), pov.pan, pov.fov)],
        fillColor: "#3A5DA8", fillOpacity: 0.25, strokeColor: "#3A5DA8", strokeWeight: 1, zIndex: 90,
      });
    };
    naver.maps.Event.addListener(pano, "pano_changed", sync);
    naver.maps.Event.addListener(pano, "pov_changed", sync);

    // ★ 지도 드래그/이동(마크는 항상 중앙) → 그 중앙 좌표로 로드뷰 갱신. 지도가 소스, 마크 고정
    const onIdle = () => { if (panoRef.current) { panoRef.current.setPosition(map.getCenter()); sync(); } };
    const idleL = naver.maps.Event.addListener(map, "idle", onIdle);

    // 화면 더블클릭 → 그 방향·거리로 '지도'를 전진(지도가 소스 → 로드뷰 자동 갱신). 화살표 대체
    const el = panoDivRef.current;
    const onDbl = (ev: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const fx = (ev.clientX - r.left) / r.width - 0.5;   // 좌우 → heading 보정
      const fy = (ev.clientY - r.top) / r.height;         // 상하 → 전진거리(위=멀리)
      const pov = pano.getPov?.() ?? { pan: 0, fov: 90 };
      const heading = pov.pan + fx * (pov.fov ?? 90);
      const dist = 8 + (1 - fy) * 30;                     // 8~38m
      const c = map.getCenter(); const rad = heading * Math.PI / 180;
      const dLat = (dist * Math.cos(rad)) / 111320;
      const dLng = (dist * Math.sin(rad)) / (111320 * Math.cos(c.lat() * Math.PI / 180));
      map.panTo(new naver.maps.LatLng(c.lat() + dLat, c.lng() + dLng));  // 지도 이동 → idle → 로드뷰 갱신
    };
    el.addEventListener("dblclick", onDbl);

    setTimeout(sync, 500);
    return () => { el.removeEventListener("dblclick", onDbl); naver.maps.Event.removeListener(idleL); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, roadview, panoBig]);   // panoBig 포함 → 전체화면 전환 시 파노라마 재생성(크기 반영·위치 보존)

  // 전체화면 전환 시 지도(PiP)도 컨테이너 크기에 맞게 재배치
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 90);
    return () => clearTimeout(t);
  }, [panoBig, ready]);

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
    map.setOptions({ draggable: drawMode === "off" || drawMode === "ruler" });   // 자 모드는 자 이펙트가 팬 관리

    if (drawMode === "off" || drawMode === "ruler") return;
    d.pts = [];
    const snap = (c: any) => (rulerRef.current ? rulerRef.current.snap(c) : c);   // 자에 대면 직선

    // GeoJSON(Poly/MultiPoly) → naver paths(링 배열)
    const toPaths = (geo: any): any[] => {
      const rings: any[] = [];
      const add = (poly: number[][][]) => poly.forEach((r) => rings.push(r.map(([lng, lat]) => new naver.maps.LatLng(lat, lng))));
      if (geo.type === "Polygon") add(geo.coordinates);
      else if (geo.type === "MultiPolygon") geo.coordinates.forEach(add);
      return rings;
    };
    // 그린 영역은 쌓인다 — 새로 그릴 때 기존 것을 지우지 않는다(예전엔 마지막 하나만 남았다).
    const drawOverlay = (paths: any[], snapped: boolean) => {
      overlayRef.current.push(new naver.maps.Polygon({
        map, paths,
        fillColor: "#3A5DA8", fillOpacity: 0.12,
        strokeColor: "#3A5DA8", strokeWeight: snapped ? 2 : 1.5, strokeStyle: snapped ? "solid" : "shortdash",
      }));
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
        naver.maps.Event.addListener(map, "mousedown", (e: any) => { down = true; d.pts = [snap(e.coord)]; }),
        naver.maps.Event.addListener(map, "mousemove", (e: any) => {
          if (!down) return;
          d.pts.push(snap(e.coord));
          if (d.pts.length % 3 === 0) {
            d.temp?.setMap(null);
            d.temp = new naver.maps.Polyline({ map, path: d.pts, strokeColor: "#3A5DA8", strokeWeight: 2 });
          }
        }),
        naver.maps.Event.addListener(map, "mouseup", () => { down = false; finish(); }),
      );
    } else if (drawMode === "circle") {
      let cen: any = null;
      listeners.push(
        naver.maps.Event.addListener(map, "mousedown", (e: any) => { cen = e.coord; }),
        naver.maps.Event.addListener(map, "mousemove", (e: any) => {
          if (!cen) return;
          d.temp?.setMap(null);
          d.temp = new naver.maps.Circle({ map, center: cen, radius: meters(cen, e.coord),
            fillColor: "#3A5DA8", fillOpacity: 0.12, strokeColor: "#3A5DA8", strokeWeight: 2 });
        }),
        naver.maps.Event.addListener(map, "mouseup", (e: any) => {
          if (!cen) return;
          const r = meters(cen, e.coord);
          d.temp?.setMap(null); d.temp = null;
          if (r > 20) {
            const geo = circleToGeoJSON({ lng: cen.lng(), lat: cen.lat() }, r);
            drawOverlay(toPaths(geo), true);
            onPolygon(geo);
          }
          cen = null;
          setDrawMode("off");
        }),
      );
    } else {
      listeners.push(
        naver.maps.Event.addListener(map, "click", (e: any) => {
          d.pts.push(e.coord);
          d.temp?.setMap(null);
          d.temp = new naver.maps.Polyline({ map, path: d.pts, strokeColor: "#3A5DA8", strokeWeight: 2 });
        }),
        naver.maps.Event.addListener(map, "dblclick", (e: any) => { e.pointerEvent?.preventDefault?.(); finish(); }),
      );
    }
    return () => listeners.forEach((l) => naver.maps.Event.removeListener(l));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, drawMode]);

  // 외부 주입 영역(불러오기·필터) 표시 — 직접 그리기와 동일 오버레이. 지도 진입/영역 변경 시 재그림.
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const naver = window.naver;
    overlayRef.current.forEach((o) => o.setMap(null));
    overlayRef.current = [];
    (polygons ?? []).forEach((g) => {
      const paths = geoToPaths(naver, g);
      if (!paths.length) return;
      overlayRef.current.push(new naver.maps.Polygon({
        map: mapRef.current, paths,
        fillColor: "#3A5DA8", fillOpacity: 0.12, strokeColor: "#3A5DA8", strokeWeight: 2,
      }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, polygons]);

  // 자(ruler) 생성/제거 — 자유곡선 스냅 가이드로 유지
  useEffect(() => {
    if (!ready || !rulerOn) return;
    rulerRef.current = makeRuler(window.naver, mapRef.current);
    return () => { rulerRef.current?.destroy(); rulerRef.current = null; };
  }, [ready, rulerOn]);

  // 자 조정(이동·회전) — drawMode==="ruler"일 때 지도 마우스로 조작
  useEffect(() => {
    if (!ready || drawMode !== "ruler" || !rulerRef.current) return;
    const naver = window.naver, map = mapRef.current, rl = rulerRef.current;
    rl.setInteractive(true);
    let dragging = false;
    const ls = [
      naver.maps.Event.addListener(map, "mousedown", (e: any) => { if (rl.onDown(e.coord)) { dragging = true; map.setOptions({ draggable: false }); } }),
      naver.maps.Event.addListener(map, "mousemove", (e: any) => { if (dragging) rl.onMove(e.coord); }),
      naver.maps.Event.addListener(map, "mouseup", () => { if (dragging) { dragging = false; rl.onUp(); map.setOptions({ draggable: true }); } }),
    ];
    return () => { ls.forEach((l) => naver.maps.Event.removeListener(l)); rl.setInteractive(false); map.setOptions({ draggable: true }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, drawMode]);

  // 도구별 커서 — 그리기·측정=크로스헤어(class+!important로 naver 기본 openhand 덮음), 그 외 기본(팬)
  useEffect(() => {
    if (!ready || !divRef.current) return;
    const drawing = drawMode === "free" || drawMode === "poly" || drawMode === "magnet" || drawMode === "circle" || measure !== "off";
    divRef.current.classList.toggle("map-crosshair", drawing);
  }, [ready, drawMode, measure]);

  // 스페이스 팬(피그마식) — 지도 위에서 Space 누른 채 마우스 이동 = 지도가 커서를 따라 이동.
  // 그리기 모드 중에도 동작(드로잉이 드래그를 점유해도 팬 가능). setCenter 즉시 이동(애니메이션 없음).
  useEffect(() => {
    if (!ready || !divRef.current) return;
    const el = divRef.current;
    let space = false, over = false, last: { x: number; y: number } | null = null;
    const isTyping = (t: EventTarget | null) => {
      const e = t as HTMLElement | null;
      return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.isContentEditable);
    };
    const kd = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      if (over) e.preventDefault();                      // 페이지 스크롤 방지
      if (!space) { space = true; last = null; el.classList.add("map-spacepan"); }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      space = false; last = null; el.classList.remove("map-spacepan");
    };
    const mm = (e: MouseEvent) => {
      if (!space || !over) { last = null; return; }
      const m = mapRef.current;
      if (!m) return;
      if (last) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        const proj = m.getProjection();
        const c = proj.fromCoordToOffset(m.getCenter());
        m.setCenter(proj.fromOffsetToCoord(new window.naver.maps.Point(c.x - dx, c.y - dy)));
      }
      last = { x: e.clientX, y: e.clientY };
    };
    const enter = () => { over = true; };
    const leave = () => { over = false; last = null; };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("mousemove", mm);
    el.addEventListener("mouseenter", enter);
    el.addEventListener("mouseleave", leave);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mousemove", mm);
      el.removeEventListener("mouseenter", enter);
      el.removeEventListener("mouseleave", leave);
    };
  }, [ready]);

  function clearPolygon() {
    overlayRef.current.forEach((o) => o.setMap(null));
    overlayRef.current = [];
    onPolygon(null);   // null = 전부 지우기
  }

  if (err) return <div className="panel" style={{ padding: 24, color: "var(--up)" }}>{err}</div>;

  const rvOpen = !!roadview;
  const pip: React.CSSProperties = { borderRadius: 10, overflow: "hidden", border: "2px solid #fff", boxShadow: "0 4px 16px rgba(0,0,0,.35)" };
  // 전체화면 = 지도↔로드뷰 크기 교체: 기본(지도 큼+로드뷰 PiP) / 전체화면(로드뷰 큼+지도 PiP)
  const mapStyle: React.CSSProperties = rvOpen && panoBig
    ? { position: "absolute", right: 12, bottom: 12, width: 320, height: 220, zIndex: 25, ...pip }
    : { position: "absolute", inset: 0 };

  const hintBox = (bg: string): React.CSSProperties => ({ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: 5, background: bg, color: "#fff", fontSize: 12, padding: "7px 14px", borderRadius: 999, whiteSpace: "nowrap" });

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* 지도 영역 */}
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <div ref={divRef} style={mapStyle} />

        {/* 데이터 출처 — 구석에 최소 노출, 호버로 펼침 */}
        <div style={{ position: "absolute", right: 10, bottom: 10, zIndex: 6 }}><SourceTag /></div>

        {/* 로드뷰 위치 마크 — 지도 정중앙 고정 */}
        {rvOpen && (
          <div style={{ ...mapStyle, zIndex: (typeof mapStyle.zIndex === "number" ? mapStyle.zIndex : 1) + 3, pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "center", border: 0, boxShadow: "none", background: "transparent" }}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#3A5DA8", border: "3px solid #fff", boxShadow: "0 1px 4px rgba(0,0,0,.4)" }} />
          </div>
        )}

        {/* 로드뷰 파노라마 */}
        <div style={{
          display: rvOpen ? "block" : "none", background: "#2a2f36",
          ...(panoBig
            ? { position: "absolute", inset: 0, zIndex: 15 }
            : { position: "absolute", left: 12, bottom: 12, width: 340, height: 230, zIndex: 20, ...pip }),
        }}>
          <div ref={panoDivRef} style={{ position: "absolute", inset: 0 }} />
          <div style={{ position: "absolute", top: 8, right: 8, zIndex: 2, display: "flex", gap: 6 }}>
            <button className="btn" title={panoBig ? "지도로" : "전체화면"} style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setPanoBig(!panoBig)}>{panoBig ? "⤡" : "⤢"}</button>
          </div>
          {rvOpen && <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", zIndex: 2, background: "rgba(15,26,46,.72)", color: "#fff", fontSize: 11, padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>화면을 더블클릭해 이동</div>}
        </div>

        {/* 힌트 오버레이 */}
        {measure !== "off" && (
          <div style={hintBox("#C2571C")}>
            {measure === "radius" ? "중심 클릭 → 반경 지점 클릭" : measure === "area" ? "꼭짓점을 클릭해 면적을 잽니다(3점 이상)" : "지점을 순서대로 클릭해 거리를 잽니다"}
          </div>
        )}
        {street && !roadview && <div style={hintBox("var(--ink)")}>파란 도로를 클릭하면 그 위치 로드뷰가 열립니다</div>}
        {drawMode === "ruler" && <div style={hintBox("var(--ink)")}>자를 드래그해 이동 · 양 끝(●)을 드래그해 회전 → 자유곡선으로 대고 그리세요</div>}
        {((drawMode !== "off" && drawMode !== "ruler") || snapping) && (
          <div style={hintBox("var(--ink)")}>
            {snapping ? "🧲 필지 경계로 스냅 중…"
              : drawMode === "poly" ? "클릭으로 꼭짓점 · 더블클릭으로 닫기"
              : drawMode === "magnet" ? "드래그로 감싸면 필지 경계로 자동 스냅됩니다"
              : drawMode === "circle" ? "중심을 누른 뒤 드래그해 반경을 정하세요"
              : `드래그로 영역을 그리세요${rulerOn ? " · 자에 대면 직선" : ""}`}
          </div>
        )}
      </div>

      {/* 푸터 아이콘 툴바 — 로드뷰 전체화면 시 숨김 */}
      {!panoBig && (
        <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "6px 10px", background: "#fff", borderTop: "1px solid var(--line)", flexWrap: "wrap" }}>
          <button className={`tool-btn ${drawMode === "free" ? "on" : ""}`} title="자유곡선 (드래그)" onClick={() => { const on = drawMode === "free"; setDrawMode(on ? "off" : "free"); if (!on) { setStreet(false); setMeasure("off"); } }}><Icon name="free" size={16} /></button>
          <button className={`tool-btn ${drawMode === "poly" ? "on" : ""}`} title="다각형 (클릭·더블클릭)" onClick={() => { const on = drawMode === "poly"; setDrawMode(on ? "off" : "poly"); if (!on) { setStreet(false); setMeasure("off"); } }}><Icon name="polygon" size={16} /></button>
          <button className={`tool-btn ${drawMode === "magnet" ? "on" : ""}`} title="자석 올가미 (필지 스냅)" onClick={() => { const on = drawMode === "magnet"; setDrawMode(on ? "off" : "magnet"); if (!on) { setStreet(false); setMeasure("off"); } }}><Icon name="magnet" size={16} /></button>
          <button className={`tool-btn ${drawMode === "circle" ? "on" : ""}`} title="원 반경 (중심→드래그)" onClick={() => { const on = drawMode === "circle"; setDrawMode(on ? "off" : "circle"); if (!on) { setStreet(false); setMeasure("off"); } }}><Icon name="circle" size={16} /></button>
          <button className={`tool-btn ${drawMode === "ruler" ? "on" : ""}`} title="자 (직선 가이드)" onClick={() => (rulerOn && drawMode === "ruler" ? (setRulerOn(false), setDrawMode("off")) : (setRulerOn(true), setDrawMode("ruler"), setStreet(false), setMeasure("off")))}><Icon name="ruler" size={16} /></button>
          {polygonActive && <button className="tool-btn" style={{ color: "var(--up)" }} title="영역 지우기" onClick={clearPolygon}><Icon name="delete" size={16} /></button>}

          <span className="tool-sep" />
          {([["dist", "distance", "거리재기"], ["area", "area", "면적"], ["radius", "radius", "반경"]] as const).map(([k, ico, tip]) => (
            <button key={k} className={`tool-btn ${measure === k ? "on" : ""}`} title={tip}
              onClick={() => { const on = measure === k; setMeasure(on ? "off" : k); if (!on) { setDrawMode("off"); setStreet(false); } }}><Icon name={ico} size={16} /></button>
          ))}
          {measure !== "off" && <button className="tool-btn" style={{ color: "var(--up)" }} title="측정 종료" onClick={() => setMeasure("off")}><Icon name="delete" size={16} /></button>}

          <span className="tool-sep" style={{ marginLeft: "auto" }} />
          <Segmented value={mapType} onChange={(v) => setMapType(v)} size="sm"
            options={[{ value: "normal", icon: "maptype", title: "일반지도" }, { value: "satellite", icon: "satellite", title: "위성" }]} />
          <button className={`tool-btn ${cadastre ? "on" : ""}`} title="지적도" onClick={() => setCadastre(!cadastre)}><Icon name="cadastral" size={16} /></button>
          <button className={`tool-btn ${street ? "on" : ""}`} title="로드뷰" onClick={() => {
            const on = street; setStreet(!on);
            if (on) setRoadview(null);
            else { setDrawMode("off"); setMeasure("off"); const c = mapRef.current?.getCenter(); if (c) setRoadview({ lng: c.lng(), lat: c.lat() }); }
          }}><Icon name="roadview" size={16} /></button>
        </div>
      )}
    </div>
  );
}
