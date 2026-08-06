import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/ui/Icon";
import { useQuery } from "@tanstack/react-query";
import { loadNaver } from "./naver";
import { photosApi, searchApi } from "../api/endpoints";
import { useAuth } from "../store/auth";
import { MarketArea, CompPoint, meters, areaM2, geoToPaths, fmtArea, fmtDist, openDetail, conePath } from "./geo";
import { makeRuler, Ruler } from "./ruler";

const COMP_COLOR = { sale: "var(--c-real)", rent: "var(--c-rent)" };   // 실거래=주황(시세추이와 통일) · 임대=초록 · 본매물=네이비(별도)

/** S02 매물사진 패널 — 지도 / 로드뷰(Panorama) / 업로드 사진 탭.
 * 지도 탭: 본매물 필지 색칠 + '주변상권 정의하기'(정의 중 지도 전체화면).
 *  · 원: 중심·가장자리 핸들을 드래그해 자유롭게 이동/크기조절(중심 고정 아님).
 *  · 자유곡선: 그릴 때마다 폴리곤 자동 확장(자에 대면 직선), 중심 드래그로 이동, 초기화로 삭제.
 * specs S02 §3.2, 네이버지도-연동 §3.2·3.3.
 */
type Draw = "off" | "circle" | "free" | "ruler";

function centroid(naver: any, pts: any[]) {
  let x = 0, y = 0; pts.forEach((p) => { x += p.lng(); y += p.lat(); });
  return new naver.maps.LatLng(y / pts.length, x / pts.length);
}
const dotIcon = (naver: any, bg: string, cursor: string, border = "#fff") => ({
  content: `<div style="width:15px;height:15px;border-radius:50%;background:${bg};border:3px solid ${border};box-shadow:0 1px 4px rgba(0,0,0,.45);cursor:${cursor}"></div>`,
  anchor: new naver.maps.Point(7, 7),
});
/** 중심에서 정동(正東)으로 radius_m 떨어진 점(가장자리 핸들 위치). */
function eastPoint(naver: any, c: any, radius_m: number) {
  const lngR = radius_m / (111320 * Math.cos((c.lat() * Math.PI) / 180));
  return new naver.maps.LatLng(c.lat(), c.lng() + lngR);
}

export function PhotoPanel({ lng, lat, pk, area, onArea, comps }: {
  lng: number; lat: number; pk?: string; area?: MarketArea; onArea?: (a: MarketArea) => void; comps?: CompPoint[];
}) {
  const [tab, setTab] = useState<"map" | "upload">("map");
  const mapDiv = useRef<HTMLDivElement>(null);
  const roadDiv = useRef<HTMLDivElement>(null);
  const mapObj = useRef<any>(null);
  const panoRef = useRef<any>(null);
  const coneRef = useRef<any>(null);   // 지도 위 시야 부채꼴(영속)
  const [roadBig, setRoadBig] = useState(false);   // 로드뷰 확대(지도↔로드뷰 크기 스왑)
  const [mapReady, setMapReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [noPano, setNoPano] = useState(false);
  const [defining, setDefining] = useState(false);
  const [areaInfo, setAreaInfo] = useState<string | null>(null);   // 반경/면적 표시(지도 하단 중앙)
  const [draw, setDraw] = useState<Draw>("circle");
  const [rulerOn, setRulerOn] = useState(false);
  const rulerRef = useRef<Ruler | null>(null);
  const areaRef = useRef(area); areaRef.current = area;   // 프레시 area — 자유곡선 확장·이동에서 참조
  const inited = useRef<{ map?: boolean; road?: boolean }>({});

  useEffect(() => {
    let dead = false;
    loadNaver()
      .then((naver) => {
        if (dead) return;
        if (tab === "map" && mapDiv.current && !inited.current.map) {
          const pos = new naver.maps.LatLng(lat, lng);
          const map = new naver.maps.Map(mapDiv.current, { center: pos, zoom: 16, minZoom: 15, maxZoom: 17 });   // S02=매물 중심 뷰, 과도한 확대/축소 제한
          mapObj.current = map;
          // 본매물 위치는 필지 색칠(네이비 폴리곤)로 표시 — 별도 태그 마커 없음
          inited.current.map = true;
          setMapReady(true);
        }
      })
      .catch((e) => setErr((e as Error).message));
    return () => { dead = true; };
  }, [tab, lng, lat]);

  // 로드뷰 인셋 + 지도 위 시야 부채꼴(S01 MapPanel의 conePath·pov_changed 재사용).
  // 로드뷰를 돌리면 부채꼴이 회전 → 로드뷰가 본매물을 향하는지 확인용(이동 없음).
  useEffect(() => {
    if (!mapReady || !roadDiv.current) return;
    const naver = window.naver;
    const map = mapObj.current;
    let cancelled = false;
    const ls: any[] = [];
    const timers: any[] = [];

    const build = () => {
      if (cancelled || !roadDiv.current) return;
      // 파노라마 서브모듈이 늦게 로드될 수 있음(map은 됐어도 Panorama 미준비) → 준비될 때까지 재시도
      if (typeof naver.maps.Panorama !== "function") { timers.push(setTimeout(build, 200)); return; }
      if (roadDiv.current.childElementCount > 0) roadDiv.current.innerHTML = "";
      let pano: any;
      try {
        pano = new naver.maps.Panorama(roadDiv.current, {
          position: new naver.maps.LatLng(lat, lng), pov: { pan: 0, tilt: 0, fov: 100 },   // fov 클수록 넓게(축소)
          flightSpot: false, aroundControl: false, zoomControl: false,
        });
      } catch { setNoPano(true); return; }
      panoRef.current = pano;
      let oriented = false;
      const orient = () => {   // 최초 1회: 파노라마(도로)→본매물 방위각으로 시야 보정
        if (oriented) return;
        const p = pano.getPosition?.(); if (!p) return;
        oriented = true;
        const dLat = lat - p.lat(), dLng = (lng - p.lng()) * Math.cos((p.lat() * Math.PI) / 180);
        if (Math.abs(dLat) < 1e-9 && Math.abs(dLng) < 1e-9) return;
        pano.setPov({ pan: (Math.atan2(dLng, dLat) * 180) / Math.PI, tilt: 0, fov: 100 });
      };
      const sync = () => {
        const p = pano.getPosition?.(); const pov = pano.getPov?.() ?? { pan: 0, fov: 90 };
        if (!p) return;
        coneRef.current?.setMap(null);
        coneRef.current = new naver.maps.Polygon({
          map, paths: [conePath(naver, p.lat(), p.lng(), pov.pan, pov.fov)], clickable: false,
          fillColor: "#3A5DA8", fillOpacity: 0.25, strokeColor: "#3A5DA8", strokeWeight: 1, zIndex: 90,
        });
      };
      ls.push(
        naver.maps.Event.addListener(pano, "pano_status", (s: any) => setNoPano(String(s) !== "OK")),
        naver.maps.Event.addListener(pano, "pano_changed", orient),
        naver.maps.Event.addListener(pano, "pano_changed", sync),
        naver.maps.Event.addListener(pano, "pov_changed", sync),
      );
      timers.push(setTimeout(sync, 500));
    };
    build();

    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
      ls.forEach((l) => naver.maps.Event.removeListener(l));
      coneRef.current?.setMap(null); coneRef.current = null;
      panoRef.current = null;
      if (roadDiv.current) roadDiv.current.innerHTML = "";
    };
  }, [mapReady, lat, lng]);

  // 로드뷰 확대/축소 전환 → 컨테이너 크기 바뀌면 파노라마·지도 리사이즈(naver는 생성시 크기 고정)
  useEffect(() => {
    if (!mapReady) return;
    const fit = () => {
      const wrap = roadDiv.current?.parentElement;
      if (wrap && panoRef.current) panoRef.current.setSize?.(new window.naver.maps.Size(wrap.clientWidth, wrap.clientHeight));
      window.dispatchEvent(new Event("resize"));   // 지도 리레이아웃
    };
    const a = requestAnimationFrame(fit); const b = setTimeout(fit, 160); const d = setTimeout(fit, 340);
    return () => { cancelAnimationFrame(a); clearTimeout(b); clearTimeout(d); };
  }, [roadBig, tab, mapReady]);

  // 본매물 필지 색칠(네이비 오버레이)
  useEffect(() => {
    if (!mapReady || !pk) return;
    const naver = window.naver;
    let dead = false, parcel: any = null;
    searchApi.parcelFor(pk).then(({ polygon }) => {
      if (dead || !polygon) return;
      parcel = new naver.maps.Polygon({
        map: mapObj.current, paths: geoToPaths(naver, polygon), clickable: false,
        fillColor: "#262320", fillOpacity: 0.28, strokeColor: "#262320", strokeWeight: 2, zIndex: 60,
      });
    }).catch(() => {});
    return () => { dead = true; parcel?.setMap(null); };
  }, [mapReady, pk]);

  // 발견된 주변 매물 마커 — 실거래/임대 색 구분. 클릭=새 탭 상세.
  useEffect(() => {
    if (!mapReady) return;
    const naver = window.naver;
    const markers = (comps ?? []).map((c) => {
      const color = COMP_COLOR[c.kind];
      const m = new naver.maps.Marker({
        position: new naver.maps.LatLng(c.lat, c.lng), map: mapObj.current, zIndex: 80,
        icon: { content: `<div style="width:11px;height:11px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:pointer"></div>`, anchor: new naver.maps.Point(5, 5) },
      });
      naver.maps.Event.addListener(m, "click", () => openDetail(c.building_pk));
      return m;
    });
    return () => markers.forEach((m) => m.setMap(null));
  }, [mapReady, comps]);

  // 정의 모드(전체화면) 전환 → 컨테이너 크기 변경 후 지도 리레이아웃
  useEffect(() => {
    if (!mapReady) return;
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    return () => clearTimeout(t);
  }, [defining, mapReady]);

  // 자(ruler) 생성/제거 — 정의 중 rulerOn일 때. 자유곡선 스냅 가이드로 유지됨.
  useEffect(() => {
    if (!mapReady || !defining || !rulerOn) return;
    rulerRef.current = makeRuler(window.naver, mapObj.current);
    return () => { rulerRef.current?.destroy(); rulerRef.current = null; };
  }, [mapReady, defining, rulerOn]);

  // 자 조정(이동·회전) — draw==="ruler"일 때 지도 마우스로 조작(끝=회전·몸통=이동)
  useEffect(() => {
    if (!mapReady || !defining || draw !== "ruler" || !rulerRef.current) return;
    const naver = window.naver, map = mapObj.current, rl = rulerRef.current;
    rl.setInteractive(true);
    let dragging = false;
    const rulerUp = () => { if (dragging) { dragging = false; rl.onUp(); map.setOptions({ draggable: true }); } };
    const ls = [
      naver.maps.Event.addListener(map, "mousedown", (e: any) => { if (rl.onDown(e.coord)) { dragging = true; map.setOptions({ draggable: false }); } }),
      naver.maps.Event.addListener(map, "mousemove", (e: any) => { if (dragging) rl.onMove(e.coord); }),
      naver.maps.Event.addListener(map, "mouseup", rulerUp),
    ];
    window.addEventListener("mouseup", rulerUp);   // 지도 밖 release에도 팬 잠금 해제
    return () => { window.removeEventListener("mouseup", rulerUp); ls.forEach((l) => naver.maps.Event.removeListener(l)); rl.setInteractive(false); map.setOptions({ draggable: true }); };
  }, [mapReady, defining, draw]);

  // 주변상권 표시 + (정의 중 원이면) 중심·가장자리 핸들로 이동/크기조절
  useEffect(() => {
    if (!mapReady || !area) return;
    const naver = window.naver;
    const map = mapObj.current;
    const disp: any[] = [];
    const clear = () => disp.forEach((o) => o.setMap(null));

    if (area.kind === "polygon") {
      const paths = geoToPaths(naver, area.geojson);
      disp.push(new naver.maps.Polygon({ map, paths, clickable: false, fillColor: "#3A5DA8", fillOpacity: 0.09, strokeColor: "#3A5DA8", strokeWeight: 2 }));
      setAreaInfo(fmtArea(area.area_m2));
      if (defining && draw === "free") disp.push(new naver.maps.Marker({ position: centroid(naver, paths[0]), map, zIndex: 110, clickable: false, icon: dotIcon(naver, "#3A5DA8", "move") }));
      return () => { clear(); setAreaInfo(null); };
    }

    // 원 — 중심 자유(area.center 없으면 본매물)
    const cc = area.center ?? { lng, lat };
    let c = new naver.maps.LatLng(cc.lat, cc.lng);
    let r = area.radius_m;
    const circle = new naver.maps.Circle({ map, center: c, radius: r, clickable: false, fillColor: "#3A5DA8", fillOpacity: 0.09, strokeColor: "#3A5DA8", strokeWeight: 2 });
    disp.push(circle);
    const setLabel = () => setAreaInfo(`반경 ${fmtDist(r)} · ${fmtArea(Math.PI * r ** 2)}`);
    setLabel();

    const listeners: any[] = [];
    const cleanup = () => { listeners.forEach((l) => naver.maps.Event.removeListener(l)); map.setOptions({ draggable: true }); clear(); setAreaInfo(null); };
    if (defining && draw === "circle" && onArea) {
      // 시각 핸들(비드래그) — 실제 드래그는 지도 마우스 이벤트 히트테스트로 처리(팬 유지)
      const centerH = new naver.maps.Marker({ position: c, map, zIndex: 110, clickable: false, icon: dotIcon(naver, "#3A5DA8", "move") });
      const edgeH = new naver.maps.Marker({ position: eastPoint(naver, c, r), map, zIndex: 110, clickable: false, icon: dotIcon(naver, "#fff", "ew-resize", "#3A5DA8") });
      disp.push(centerH, edgeH);
      let mode: "" | "center" | "radius" = "", gdLng = 0, gdLat = 0;
      const tol = () => Math.max(40, r * 0.18);   // 잡기 허용 반경(m)
      const redraw = () => { circle.setCenter(c); circle.setRadius(r); centerH.setPosition(c); edgeH.setPosition(eastPoint(naver, c, r)); setLabel(); };
      // 커밋 — 지도 안팎 어디서 놓아도 실행(naver mouseup은 지도 밖 release를 못 봄 → 확대 드래그가 저장 누락되던 버그)
      const commitUp = () => {
        if (!mode) return; mode = ""; map.setOptions({ draggable: true });
        onArea({ kind: "circle", radius_m: Math.round(r), center: { lng: c.lng(), lat: c.lat() } });
      };
      window.addEventListener("mouseup", commitUp);
      listeners.push(
        naver.maps.Event.addListener(map, "mousedown", (e: any) => {
          const dC = meters(c, e.coord);
          if (dC <= tol()) { mode = "center"; gdLng = e.coord.lng() - c.lng(); gdLat = e.coord.lat() - c.lat(); }
          else if (Math.abs(dC - r) <= tol()) mode = "radius";
          else return;
          map.setOptions({ draggable: false });   // 핸들 잡은 동안만 팬 정지
        }),
        naver.maps.Event.addListener(map, "mousemove", (e: any) => {
          if (!mode) return;
          if (mode === "center") c = new naver.maps.LatLng(e.coord.lat() - gdLat, e.coord.lng() - gdLng);
          else r = Math.max(30, Math.round(meters(c, e.coord)));
          redraw();
        }),
        naver.maps.Event.addListener(map, "mouseup", commitUp),
      );
      const cleanupWithDom = () => { window.removeEventListener("mouseup", commitUp); cleanup(); };
      return cleanupWithDom;
    }
    return cleanup;
  }, [mapReady, area, lat, lng, defining, draw, onArea]);

  // 자유곡선 — 그릴 때마다 폴리곤 자동 확장·커밋(닫기 버튼 없음). 중심(●) 잡으면 영역 이동.
  useEffect(() => {
    if (!mapReady || !defining || draw !== "free" || !onArea) return;
    const naver = window.naver;
    const map = mapObj.current;
    map.setOptions({ draggable: false });
    const snap = (c: any) => (rulerRef.current ? rulerRef.current.snap(c) : c);   // 자 가장자리에 대면 직선
    const polyRing = () => {   // 현재 폴리곤 열린 링(없으면 null)
      const a = areaRef.current;
      return a?.kind === "polygon" ? ((a.geojson as any).coordinates[0] as number[][]).slice(0, -1).map(([lng, lat]) => new naver.maps.LatLng(lat, lng)) : null;
    };
    const commit = (ring: any[]) => { if (ring.length >= 3) { const r = ring.map((p: any) => [p.lng(), p.lat()]); r.push(r[0]); onArea({ kind: "polygon", geojson: { type: "Polygon", coordinates: [r] }, area_m2: areaM2(ring) }); } };
    const tolM = () => 26 * (156543.03 * Math.cos(lat * Math.PI / 180) / Math.pow(2, map.getZoom()));
    let mode: "" | "draw" | "move" = "", stroke: any[] = [], base: any[] = [], temp: any = null, ring: any[] = [], gdLng = 0, gdLat = 0, ctr: any = null;
    const freeUp = () => {
      if (!mode) return;
      temp?.setMap(null); temp = null;
      if (mode === "draw") commit([...base, ...stroke]);
      else if (mode === "move") commit(ring);
      mode = "";
    };
    const ls = [
      naver.maps.Event.addListener(map, "mousedown", (e: any) => {
        const pr = polyRing();
        if (pr) ctr = centroid(naver, pr);
        if (pr && meters(ctr, e.coord) <= tolM()) { mode = "move"; ring = pr; gdLng = e.coord.lng() - ctr.lng(); gdLat = e.coord.lat() - ctr.lat(); }
        else { mode = "draw"; base = pr ?? []; stroke = [snap(e.coord)]; }
      }),
      naver.maps.Event.addListener(map, "mousemove", (e: any) => {
        if (mode === "draw") { stroke.push(snap(e.coord)); temp?.setMap(null); temp = new naver.maps.Polyline({ map, path: [...base, ...stroke], strokeColor: "#3A5DA8", strokeWeight: 2.5 }); }
        else if (mode === "move") {
          const dLng = (e.coord.lng() - gdLng) - ctr.lng(), dLat = (e.coord.lat() - gdLat) - ctr.lat();
          ring = ring.map((p: any) => new naver.maps.LatLng(p.lat() + dLat, p.lng() + dLng));
          ctr = new naver.maps.LatLng(ctr.lat() + dLat, ctr.lng() + dLng);
          temp?.setMap(null); temp = new naver.maps.Polygon({ map, paths: [ring], fillColor: "#3A5DA8", fillOpacity: 0.09, strokeColor: "#3A5DA8", strokeWeight: 2 });
        }
      }),
      naver.maps.Event.addListener(map, "mouseup", freeUp),
    ];
    // 지도 밖 release도 커밋(원 편집과 동일한 mouseup 누락 버그 방지)
    window.addEventListener("mouseup", freeUp);
    return () => { window.removeEventListener("mouseup", freeUp); ls.forEach((l) => naver.maps.Event.removeListener(l)); temp?.setMap(null); map.setOptions({ draggable: true }); };
  }, [mapReady, defining, draw, onArea, lat]);

  const resetArea = () => onArea?.({ kind: "circle", radius_m: 500 });   // 원·폴리곤 모두 기본 원으로 초기화(삭제)

  const tabBtn = (t: "map" | "upload", label: string) => (
    <button className={`btn ${tab === t ? "primary" : ""}`} onClick={() => setTab(t)}>{label}</button>
  );
  const drawBtn = (on: boolean): React.CSSProperties => ({
    background: on ? "var(--signal-bg)" : "#fff", color: on ? "var(--signal)" : "var(--ink)", borderColor: on ? "var(--signal)" : "var(--line-2)",
  });
  const pickCircle = () => { setDraw("circle"); if (area && area.kind !== "circle") onArea?.({ kind: "circle", radius_m: 500 }); };

  const mapBox: React.CSSProperties = defining
    ? { position: "fixed", inset: 0, zIndex: 1000, margin: 0, borderRadius: 0, background: "var(--surface-2)" }
    : { position: "relative", height: 400, margin: 14, borderRadius: 8, background: "var(--surface-2)" };

  // 지도↔로드뷰 크기 스왑: 확대된 쪽=전체, 다른 쪽=우상단 PiP
  const bigStyle: React.CSSProperties = { position: "absolute", inset: 0, overflow: "hidden" };
  const pipStyle: React.CSSProperties = { position: "absolute", top: 12, right: 12, width: 264, height: 168, zIndex: 7, borderRadius: 10, overflow: "hidden", boxShadow: "0 3px 12px rgba(15,26,46,.35)", border: "2px solid #fff" };
  const showRoad = tab === "map" && !defining;   // 로드뷰 인셋 표시(업로드·상권정의 중 숨김)

  return (
    <div className="panel">
      {!defining && (
        <div style={{ display: "flex", gap: 8, padding: "12px 14px 0" }}>
          {tabBtn("map", "지도·로드뷰")}{pk && tabBtn("upload", "업로드 사진")}
          {tab === "map" && onArea && (
            <button className="btn" style={{ marginLeft: "auto", ...drawBtn(false) }} onClick={() => { setTab("map"); setDraw("circle"); setRoadBig(false); setDefining(true); }}><Icon name="circle" size={14} style={{ marginRight: 4, verticalAlign: "-2px" }} /> 주변상권 정의하기</button>
          )}
        </div>
      )}
      <div style={{ ...mapBox, overflow: "hidden" }}>
        {err && <div style={{ padding: 20, color: "var(--up)", fontSize: 13 }}>{err}</div>}
        {/* 지도 (로드뷰 확대 시 우상단 PiP로 축소) */}
        <div style={{ ...(!roadBig || defining ? bigStyle : pipStyle), display: tab === "map" ? "block" : "none", background: "var(--surface-2)" }}>
          <div ref={mapDiv} style={{ position: "absolute", inset: 0 }} />
        </div>
        {/* 로드뷰 (기본 PiP, 확대 시 전체) — 돌리면 지도의 시야 부채꼴이 회전 = 로드뷰가 본매물을 향하는지 확인 */}
        <div style={{ ...(roadBig ? bigStyle : pipStyle), background: "#5f6b7a", display: showRoad ? "block" : "none" }}>
          <div ref={roadDiv} style={{ position: "absolute", inset: 0 }} />
          {noPano && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#e7ecf2", fontSize: 12, fontWeight: 600 }}>이 위치 로드뷰 없음</div>}
          <button className="btn" title={roadBig ? "지도 크게" : "로드뷰 크게"} style={{ position: "absolute", top: 8, left: 8, zIndex: 3, padding: "4px 10px", fontSize: 12, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,.25)" }}
            onClick={() => setRoadBig((v) => !v)}>{roadBig ? "⤡" : "⤢"}</button>
          <div style={{ position: "absolute", left: 8, bottom: 6, fontSize: 10, fontWeight: 700, color: "#fff", background: "rgba(15,26,46,.6)", padding: "2px 7px", borderRadius: 5, pointerEvents: "none" }}>로드뷰 · 돌려서 매물 방향 확인</div>
        </div>
        {defining && (
          <>
            <div style={{ position: "absolute", top: 12, left: 12, zIndex: 5, display: "flex", gap: 2, background: "#fff", borderRadius: 10, padding: 4, boxShadow: "var(--shadow)" }}>
              <button className={`tool-btn ${draw === "circle" ? "on" : ""}`} title="원 (반경)" onClick={pickCircle}><Icon name="circle" size={15} /></button>
              <button className={`tool-btn ${draw === "free" ? "on" : ""}`} title="자유곡선" onClick={() => setDraw("free")}><Icon name="free" size={15} /></button>
              <button className={`tool-btn ${draw === "ruler" ? "on" : ""}`} title="자 (직선 가이드)"
                onClick={() => (rulerOn && draw === "ruler" ? (setRulerOn(false), setDraw("off")) : (setRulerOn(true), setDraw("ruler")))}>📏</button>
              <span className="tool-sep" />
              <button className="tool-btn" style={{ color: "var(--up)" }} title="초기화" onClick={resetArea}><Icon name="reset" size={13} /></button>
            </div>
            <button className="btn primary" style={{ position: "absolute", top: 12, right: 12, zIndex: 5, padding: "6px 16px" }} onClick={() => setDefining(false)}>완료</button>
            <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 5, background: "var(--ink)", color: "#fff", fontSize: 12, padding: "8px 16px", borderRadius: 999, whiteSpace: "nowrap" }}>
              {draw === "ruler" ? "자를 드래그해 이동 · 양 끝(●)을 드래그해 회전"
                : draw === "free" ? `${rulerOn ? "자에 대고 " : ""}그리면 자동 반영 · 자 옮겨 이어 그리기 · 중심(●) 드래그 = 이동`
                : "● 중심 = 이동 · ○ 가장자리 = 크기조절 · 지도는 자유롭게 이동"}
            </div>
          </>
        )}
        {/* 반경/면적 — 지도 하단 중앙(겹침 방지) */}
        {tab === "map" && !roadBig && areaInfo && (
          <div style={{ position: "absolute", bottom: defining ? 58 : 12, left: "50%", transform: "translateX(-50%)", zIndex: 6, background: "rgba(30,90,240,.92)", color: "#fff", fontSize: 12, fontWeight: 600, padding: "5px 13px", borderRadius: 8, whiteSpace: "nowrap", pointerEvents: "none", boxShadow: "0 2px 8px rgba(0,0,0,.25)" }}>{areaInfo}</div>
        )}
        {tab === "map" && !roadBig && (comps?.length ?? 0) > 0 && (
          <div style={{ position: "absolute", bottom: 12, left: 12, zIndex: 6, background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,.15)", padding: "6px 10px", fontSize: 11, display: "flex", gap: 12 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: COMP_COLOR.sale }} />실거래</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: COMP_COLOR.rent }} />임대</span>
          </div>
        )}
        {tab === "map" && !roadBig && mapReady && (
          <button className="btn" title="본매물 위치로 이동" style={{ position: "absolute", bottom: 12, right: 12, zIndex: 6, padding: "6px 12px", fontSize: 12, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,.15)" }}
            onClick={() => mapObj.current?.morph(new window.naver.maps.LatLng(lat, lng), 16)}>⌖ 본매물</button>
        )}
        {tab === "upload" && pk && <UploadTab pk={pk} />}
      </div>
    </div>
  );
}

/** 업로드 사진 — 파일 업로드(멀티) + 썸네일. 인증 헤더 필요 → blob 로드. */
function UploadTab({ pk }: { pk: string }) {
  const access = useAuth((s) => s.access);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [sel, setSel] = useState<number | null>(null);
  const list = useQuery({ queryKey: ["photos", pk], queryFn: () => photosApi.list(pk) });
  const photos = list.data ?? [];

  useEffect(() => {
    photos.forEach((p) => {
      if (urls[p.id]) return;
      fetch(`/api${p.url}`, { headers: { Authorization: `Bearer ${access}` } })
        .then((res) => (res.ok ? res.blob() : Promise.reject()))
        .then((blob) => setUrls((u) => ({ ...u, [p.id]: URL.createObjectURL(blob) })))
        .catch(() => {});
    });
    if (sel == null && photos.length) setSel(photos[0].id);   // 첫 사진 자동 선택
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", f);
      await fetch(`/api/buildings/${pk}/photos`, { method: "POST", headers: { Authorization: `Bearer ${access}` }, body: fd });
    }
    list.refetch();
  }
  async function del(id: number) { await photosApi.del(pk, id); if (sel === id) setSel(null); list.refetch(); }

  const selUrl = sel != null ? urls[sel] : null;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", gap: 8, padding: 10 }}>
      {/* 좌: 썸네일 목록(스크롤) + 업로드 박스 */}
      <div style={{ width: 100, flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
        {photos.map((p) => (
          <div key={p.id} onClick={() => setSel(p.id)} title="클릭 = 크게 보기"
            style={{ position: "relative", aspectRatio: "4/3", flex: "0 0 auto", borderRadius: 6, overflow: "hidden", cursor: "pointer", background: "#fff", border: `2px solid ${sel === p.id ? "var(--signal)" : "var(--line)"}` }}>
            {urls[p.id]
              ? <img src={urls[p.id]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--muted)", fontSize: 11 }}>로딩…</div>}
            <button className="tool-btn" style={{ position: "absolute", top: 2, right: 2, minWidth: 20, height: 20, fontSize: 11, background: "rgba(255,255,255,.92)", color: "var(--up)" }}
              onClick={(e) => { e.stopPropagation(); del(p.id); }} title="삭제">✕</button>
          </div>
        ))}
        <label style={{ aspectRatio: "4/3", flex: "0 0 auto", border: "1px dashed var(--line-2)", borderRadius: 6, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--muted)", fontSize: 22 }} title="사진 추가">
          ＋<input type="file" accept="image/*" multiple hidden onChange={onUpload} />
        </label>
      </div>
      {/* 우: 큰 미리보기 */}
      <div style={{ flex: 1, minWidth: 0, borderRadius: 8, background: "var(--surface-2)", display: "grid", placeItems: "center", overflow: "hidden" }}>
        {selUrl
          ? <img src={selUrl} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          : <span style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: 16 }}>{photos.length ? "사진을 선택하세요" : "＋로 사진을 추가하세요\n사적 · 팀 공유(매도자·현장 사진)"}</span>}
      </div>
    </div>
  );
}
