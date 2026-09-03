import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../shared/ui/Icon";
import { useQuery } from "@tanstack/react-query";
import { loadNaver } from "./naver";
import { photosApi, searchApi, PHOTO_KINDS, type Photo, type PhotoKind } from "../api/endpoints";
import { PhotoFitEditor, fitStyle, DEFAULT_FIT, type Fit } from "../ui/PhotoFit";
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
  // 지도/업로드 탭은 폐지했다(2026-08-27) — 지도는 늘 지도다. 우측 400px 칸에서
  // 사진·서류 여섯 슬롯을 관리하는 건 무리라, 보는 건 지도 아래 스트립·관리는 모달로 갈랐다.
  const [photoOpen, setPhotoOpen] = useState(false);
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
        if (mapDiv.current && !inited.current.map) {
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
  }, [lng, lat]);

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
  }, [roadBig, mapReady]);

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

  // 상권 정의 = 전체화면(2026-08-26). 모달과 같은 어법으로 다룬다:
  //   ESC 로 나가고, 그동안 뒤 화면은 스크롤을 잠근다.
  // 잠그지 않으면 지도 위에서 휠을 굴릴 때 뒤 페이지가 같이 움직여, 나왔을 때 엉뚱한 자리에 서 있다.
  useEffect(() => {
    if (!defining) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDefining(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 앱바(z 50)와 머리줄·하단 바(sticky)는 지도(z 1000)보다 낮은데도 위에 남는다 —
    // 서로 다른 stacking context 라 z 를 올려도 안 덮인다. 그리는 동안만 걷어낸다.
    document.body.classList.add("map-full");
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      document.body.classList.remove("map-full");
    };
  }, [defining]);

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

  const pickCircle = () => { setDraw("circle"); if (area && area.kind !== "circle") onArea?.({ kind: "circle", radius_m: 500 }); };

  const mapBox: React.CSSProperties = defining
    ? { position: "fixed", inset: 0, zIndex: 1000, margin: 0, borderRadius: 0, background: "var(--surface-2)" }
    // 우측 칸(400px)에 선다. 본문 폭을 쓰던 때는 1,400×400 = 3.5:1 로 강남구 절반이 들어왔다.
    // 240 이면 5:3 — 이 매물과 옆 블록이 보이는 크기고, 아래 사이드바가 첫 화면에 같이 선다.
    : { position: "relative", height: 240, margin: 12, borderRadius: 10, background: "var(--surface-2)" };

  // 지도↔로드뷰 크기 스왑: 확대된 쪽=전체, 다른 쪽=우상단 PiP
  const bigStyle: React.CSSProperties = { position: "absolute", inset: 0, overflow: "hidden" };
  // 지도가 좁아졌으니 PiP 도 줄인다 — 264 는 400 폭의 3분의 2라 지도를 통째로 가린다
  const pipStyle: React.CSSProperties = { position: "absolute", top: 10, right: 10, width: 148, height: 96, zIndex: 7, borderRadius: 10, overflow: "hidden", boxShadow: "0 2px 9px rgba(15,26,46,.3)", border: "2px solid #fff" };
  const showRoad = !defining;   // 로드뷰 인셋 표시(상권 정의 중 숨김)

  return (
    <div className="panel">
      {/* 툴바는 없다(2026-08-27) — 글자 버튼 셋이 400px 한 줄을 다 먹었다.
          상권 정의는 지도 위 아이콘, 사진은 지도 아래 스트립이 문이다. */}
      <div style={{ ...mapBox, overflow: "hidden" }}>
        {err && <div style={{ padding: 20, color: "var(--up)", fontSize: 13 }}>{err}</div>}
        {/* 지도 (로드뷰 확대 시 우상단 PiP로 축소) */}
        <div style={{ ...(!roadBig || defining ? bigStyle : pipStyle), background: "var(--surface-2)" }}>
          <div ref={mapDiv} style={{ position: "absolute", inset: 0 }} />
        </div>
        {/* 로드뷰 (기본 PiP, 확대 시 전체) — 돌리면 지도의 시야 부채꼴이 회전 = 로드뷰가 본매물을 향하는지 확인 */}
        <div style={{ ...(roadBig ? bigStyle : pipStyle), background: "#5f6b7a", display: showRoad ? "block" : "none" }}>
          <div ref={roadDiv} style={{ position: "absolute", inset: 0 }} />
          {noPano && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#e7ecf2", fontSize: 12, fontWeight: 600 }}>이 위치 로드뷰 없음</div>}
          <button className="btn" title={roadBig ? "지도 크게" : "로드뷰 크게"} style={{ position: "absolute", top: 8, left: 8, zIndex: 3, padding: "4px 10px", fontSize: 12, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,.25)" }}
            onClick={() => setRoadBig((v) => !v)}>{roadBig ? "⤡" : "⤢"}</button>
          {/* 라벨은 로드뷰를 크게 볼 때만 — PiP(148×96)에 넣으면 화면의 절반을 글자가 먹는다(2026-08-26) */}
          {roadBig && (
            <div style={{ position: "absolute", left: 8, bottom: 6, fontSize: 10, fontWeight: 700, color: "#fff", background: "rgba(15,26,46,.6)", padding: "2px 7px", borderRadius: 5, pointerEvents: "none" }}>로드뷰 · 돌려서 매물 방향 확인</div>
          )}
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
            {/* 나가는 길을 두 개로 — 버튼과 ESC. 그린 것은 그리는 즉시 저장되므로(onArea)
                「완료」는 저장이 아니라 나가기다. 그래서 곁말에 ESC 를 같이 적는다. */}
            <div style={{ position: "absolute", top: 12, right: 12, zIndex: 5, display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", background: "rgba(255,255,255,.9)", padding: "4px 9px", borderRadius: 7 }}>ESC 로도 나갑니다</span>
              <button className="btn primary" style={{ padding: "6px 16px" }} onClick={() => setDefining(false)}>완료</button>
            </div>
            <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 5, background: "var(--ink)", color: "#fff", fontSize: 12, padding: "8px 16px", borderRadius: 999, whiteSpace: "nowrap" }}>
              {draw === "ruler" ? "자를 드래그해 이동 · 양 끝(●)을 드래그해 회전"
                : draw === "free" ? `${rulerOn ? "자에 대고 " : ""}그리면 자동 반영 · 자 옮겨 이어 그리기 · 중심(●) 드래그 = 이동`
                : "● 중심 = 이동 · ○ 가장자리 = 크기조절 · 지도는 자유롭게 이동"}
            </div>
          </>
        )}
        {/* 반경/면적 — 좌상단. 하단 가운데에 두면 좁은 지도(400px)에서 범례·본매물 버튼과 겹친다.
            상권을 그리는 중(defining)엔 전체화면이라 예전처럼 하단 가운데가 넓고 잘 보인다. */}
        {!roadBig && areaInfo && (
          <div style={{ position: "absolute", zIndex: 6,
            ...(defining
              ? { bottom: 58, left: "50%", transform: "translateX(-50%)", fontSize: 12, padding: "5px 13px" }
              : { top: 8, left: 8, fontSize: 11, padding: "4px 10px" }),
            background: "rgba(30,90,240,.92)", color: "#fff", fontWeight: 600,
            borderRadius: 8, whiteSpace: "nowrap", pointerEvents: "none", boxShadow: "0 2px 8px rgba(0,0,0,.25)" }}>{areaInfo}</div>
        )}
        {!roadBig && (comps?.length ?? 0) > 0 && (
          <div style={{ position: "absolute", bottom: 12, left: 12, zIndex: 6, background: "#fff", borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,.15)", padding: "6px 10px", fontSize: 11, display: "flex", gap: 12 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: COMP_COLOR.sale }} />실거래</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: COMP_COLOR.rent }} />임대</span>
          </div>
        )}
        {!roadBig && mapReady && (
          <button className="btn" title="본매물 위치로 이동" style={{ position: "absolute", bottom: 12, right: 12, zIndex: 6, padding: "6px 12px", fontSize: 12, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,.15)" }}
            onClick={() => mapObj.current?.morph(new window.naver.maps.LatLng(lat, lng), 16)}>⌖ 본매물</button>
        )}
        {/* 상권 정의 — 좌상단 반경 배지 아래 아이콘. 우상단은 로드뷰 PiP 자리다 */}
        {!roadBig && !defining && onArea && (
          <button className="btn" title="주변상권 정의하기"
            style={{ position: "absolute", top: areaInfo ? 42 : 8, left: 8, zIndex: 6, width: 34, height: 34,
              padding: 0, display: "grid", placeItems: "center", background: "#fff",
              boxShadow: "0 2px 8px rgba(0,0,0,.18)" }}
            onClick={() => { setDraw("circle"); setRoadBig(false); setDefining(true); }}>
            <Icon name="circle" size={15} /></button>
        )}
      </div>

      {/* 사진 스트립 — 보는 건 여기, 관리는 모달. 좁은 칸에는 보는 것만 둔다(2026-08-27) */}
      {pk && !defining && <PhotoStrip pk={pk} onOpen={() => setPhotoOpen(true)} />}
      {/* 포털로 body 에 그린다(2026-08-27) — 이 판이 사는 .bt-side 가 sticky 라 stacking
          context 를 만들어, 안에서 z 를 아무리 올려도 밖의 머리줄(z 20)을 못 넘었다.
          모달은 문서 맨 끝에서 떠야 화면의 모든 상주 요소 위에 선다. */}
      {pk && photoOpen && createPortal(
        <div className="modal-bg" style={{ display: "flex", zIndex: 300 }} onClick={() => setPhotoOpen(false)}>
          {/* 뷰포트의 3/4 안쪽으로 — 88vh 는 머리줄·하단 바(sticky)와 시각적으로 부딪혔다 */}
          <div className="panel" style={{ width: "min(680px, 92vw)", maxHeight: "74vh", overflow: "auto",
            borderRadius: 18, background: "var(--surface-2)", padding: "4px 16px 14px", margin: "auto" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 2px 2px" }}>
              <b style={{ fontSize: 16, fontWeight: 800 }}>사진 · 서류</b>
              <span style={{ flex: 1 }} />
              <button className="lnk dim2" onClick={() => setPhotoOpen(false)}>닫기 ✕</button>
            </div>
            <UploadTab pk={pk} />
            {/* 확인 = 닫기다 — 올리는 즉시 저장되므로 따로 저장할 것이 없다.
                그래도 이 버튼이 있어야 「다 됐다」를 누를 자리가 생긴다(✕ 만으론 끝맺음이 없다). */}
            <button className="btn primary" style={{ width: "100%", marginTop: 14, padding: "11px 0", fontSize: 14 }}
              onClick={() => setPhotoOpen(false)}>확인</button>
          </div>
        </div>, document.body)}
    </div>
  );
}

/** 지도 아래 사진 스트립 — 대표 셋 + 나머지 개수. 서류는 안 섞는다:
 *  스캔본 썸네일은 작게 보면 다 똑같이 생겨서, 세는 것 말고는 할 말이 없다. */
function PhotoStrip({ pk, onOpen }: { pk: string; onOpen: () => void }) {
  const q = useQuery({ queryKey: ["photos", pk], queryFn: () => photosApi.list(pk) });
  const all = q.data ?? [];
  const pics = all.filter((p) => p.kind === "exterior" || p.kind === "interior");
  const docs = all.length - pics.length;
  const head = pics.slice(0, 3);
  const rest = pics.length - head.length;
  return (
    <div style={{ display: "flex", gap: 6, margin: "0 12px 12px" }}>
      {head.map((p) => (
        <button key={p.id} onClick={onOpen} style={{ flex: 1, aspectRatio: "4/3", borderRadius: 9,
          border: 0, padding: 0, cursor: "pointer", overflow: "hidden", background: "var(--surface-2)" }}>
          <img src={p.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </button>
      ))}
      <button onClick={onOpen} style={{ flex: head.length ? "0 0 64px" : 1, minHeight: 48,
        aspectRatio: head.length ? "4/3" : undefined, borderRadius: 9, border: 0, cursor: "pointer",
        background: "var(--surface-2)", color: "var(--muted)", font: "inherit",
        fontSize: 11.5, fontWeight: 800, lineHeight: 1.4 }}>
        {head.length ? <>사진{rest > 0 ? <><br />+ {rest}</> : ""}{docs > 0 && <><br />서류 {docs}</>}</>
          : "사진 · 서류 올리기"}
      </button>
    </div>
  );
}

/** 업로드 사진·서류 — 브리핑 자료가 종류로 슬롯을 찾는다(0032).
 *  건물 사진(외관·내부)은 여러 장, 서류 3종은 한 장씩. 올릴 때 슬롯 비율에 맞춰 배치를 맞춘다. */
function UploadTab({ pk }: { pk: string }) {
  const access = useAuth((s) => s.access);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [edit, setEdit] = useState<{ photo: Photo; fit: Fit } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["photos", pk], queryFn: () => photosApi.list(pk) });
  const photos: Photo[] = useMemo(() => list.data ?? [], [list.data]);

  useEffect(() => {
    photos.forEach((p) => {
      if (urls[p.id]) return;
      fetch(`/api${p.url}`, { headers: { Authorization: `Bearer ${access}` } })
        .then((res) => (res.ok ? res.blob() : Promise.reject()))
        .then((blob) => setUrls((u) => ({ ...u, [p.id]: URL.createObjectURL(blob) })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);

  async function upload(files: FileList | null, kind: PhotoKind) {
    // 재현이 안 되는 업로드 실패를 추적하려고 남긴다(2026-08-11). 콘솔에서 어디서 멈췄는지 보인다.
    console.log("[사진] 선택됨", files?.length ?? 0,
      Array.from(files ?? []).map((f) => `${f.name} ${f.type || "(타입없음)"} ${(f.size / 1024).toFixed(0)}KB`));
    if (!files?.length) { setErr("파일이 선택되지 않았습니다"); return; }
    setBusy(true); setErr(null);
    try {
      for (const f of Array.from(files)) {
        // 아이폰 기본 포맷(HEIC)은 서버엔 올라가지만 브라우저가 못 그린다 —
        // 올린 사람 눈엔 "아무 일도 안 일어남"으로 보인다. 미리 막고 이유를 말한다.
        if (/\.(heic|heif)$/i.test(f.name) || /heic|heif/i.test(f.type)) {
          throw new Error(`${f.name} — 아이폰 HEIC 형식은 지원하지 않습니다. JPG·PNG로 바꿔 올려주세요`);
        }
        if (f.size > 20 * 1024 * 1024) {
          throw new Error(`${f.name} — 20MB가 넘습니다 (${(f.size / 1048576).toFixed(1)}MB)`);
        }
        console.log("[사진] 업로드 시작", f.name);
        const r = await photosApi.upload(pk, f, kind);
        console.log("[사진] 업로드 성공", r);
      }
      await list.refetch();
      console.log("[사진] 목록 갱신 완료");
    } catch (e) {
      // 지금까지 실패가 통째로 삼켜져 "버튼 무반응"으로 보였다(2026-08-11).
      console.error("[사진] 실패", e);
      setErr(String((e as Error)?.message ?? "업로드하지 못했습니다"));
    } finally { setBusy(false); }
  }
  async function del(id: number) {
    try {
      await photosApi.del(pk, id);
      setUrls((u) => { const n = { ...u }; delete n[id]; return n; });
      list.refetch();
    } catch (e) { setErr(String((e as Error)?.message ?? "삭제하지 못했습니다")); }
  }
  async function move(p: Photo, dir: -1 | 1) {
    const same = photos.filter((x) => x.kind === p.kind);
    const i = same.findIndex((x) => x.id === p.id);
    const j = i + dir;
    if (j < 0 || j >= same.length) return;
    await Promise.all([
      photosApi.patch(pk, p.id, { sort_order: same[j].sort_order }),
      photosApi.patch(pk, same[j].id, { sort_order: p.sort_order }),
    ]);
    list.refetch();
  }
  async function saveFit() {
    if (!edit) return;
    setBusy(true);
    try { await photosApi.patch(pk, edit.photo.id, { transform: edit.fit }); setEdit(null); list.refetch(); }
    finally { setBusy(false); }
  }

  const card = (p: Photo, ratio: number) => (
    <div key={p.id} style={{ position: "relative", borderRadius: 8, overflow: "hidden",
      border: "1px solid var(--line)", background: "#fff", aspectRatio: String(ratio) }}>
      {urls[p.id]
        ? <img src={urls[p.id]} alt="" style={fitStyle(p.transform)} />
        : <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--muted)", fontSize: 11 }}>로딩…</div>}
      <div style={{ position: "absolute", right: 4, top: 4, display: "flex", gap: 3 }}>
        {urls[p.id] && (
          <button className="tool-btn" style={PB} title="배치 맞추기"
            onClick={() => setEdit({ photo: p, fit: { ...DEFAULT_FIT, ...(p.transform ?? {}) } })}>⤢</button>
        )}
        <button className="tool-btn" style={{ ...PB, color: "var(--up)" }} title="삭제"
          onClick={() => del(p.id)}>✕</button>
      </div>
      <div style={{ position: "absolute", left: 4, bottom: 4, display: "flex", gap: 3 }}>
        <button className="tool-btn" style={PB} title="앞으로" onClick={() => move(p, -1)}>‹</button>
        <button className="tool-btn" style={PB} title="뒤로" onClick={() => move(p, 1)}>›</button>
      </div>
    </div>
  );

  const adder = (kind: PhotoKind, multi: boolean, ratio: number, label: string) => (
    <label style={{ aspectRatio: String(ratio), border: "1px dashed var(--line-2)", borderRadius: 8,
      display: "grid", placeItems: "center", cursor: busy ? "wait" : "pointer", color: "var(--muted)",
      fontSize: 12, textAlign: "center", padding: 8, lineHeight: 1.5 }}>
      <span>＋<br />{label}</span>
      <input type="file" accept="image/*" multiple={multi} hidden disabled={busy}
        onChange={(e) => { upload(e.target.files, kind); e.target.value = ""; }} />
    </label>
  );

  const of = (k: PhotoKind) => photos.filter((p) => p.kind === k);

  return (
    /* 옛집(지도 칸)에선 absolute 로 칸을 채웠는데, 모달로 이사 오니 그 몸이 높이를 0 으로
       무너뜨렸다(2026-08-27) — 흐름 배치로 바꾼다. 스크롤은 모달 껍데기가 쥔다. */
    <div style={{ padding: "4px 2px 2px" }}>
      {err && (
        <div style={{ margin: "0 0 10px", padding: "8px 11px", borderRadius: 7, fontSize: 12.5,
          background: "#FDECEC", color: "var(--up)", display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ flex: 1 }}>{err}</span>
          <button className="lnk" style={{ color: "var(--up)" }} onClick={() => setErr(null)}>닫기</button>
        </div>
      )}
      {/* 건물 사진 — 여러 장. 브리핑 사진 장(4.20x6.49) 비율에 맞춘다 */}
      {(["exterior", "interior"] as PhotoKind[]).map((k) => (
        <div key={k} style={{ marginBottom: 14 }}>
          <div style={SEC}>{PHOTO_KINDS.find((x) => x.k === k)!.label}
            <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>여러 장 · 순서 조정</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(112px,1fr))", gap: 8 }}>
            {of(k).map((p) => card(p, PHOTO_RATIO))}
            {adder(k, true, PHOTO_RATIO, "사진 추가")}
          </div>
        </div>
      ))}

      {/* 서류 — 종류별 1장이면 충분(세로가 긴 스캔본) */}
      <div style={SEC}>서류<span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>브리핑에 그대로 실립니다</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(132px,1fr))", gap: 8 }}>
        {PHOTO_KINDS.filter((x) => x.doc).map(({ k, label }) => {
          const got = of(k)[0];
          return (
            <div key={k}>
              <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginBottom: 4 }}>{label}</div>
              {got ? card(got, DOC_RATIO) : adder(k, false, DOC_RATIO, "올리기")}
            </div>
          );
        })}
      </div>

      {edit && urls[edit.photo.id] && (
        <div className="bt-lightbox" style={{ display: "grid", placeItems: "center", background: "rgba(12,14,20,.62)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setEdit(null); }}>
          <div className="panel" style={{ width: "min(560px,92vw)", padding: 16 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>브리핑 칸에 맞추기</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
              보이는 만큼만 브리핑에 실립니다. 원본은 그대로 보관됩니다.
            </div>
            <PhotoFitEditor src={urls[edit.photo.id]}
              ratio={PHOTO_KINDS.find((x) => x.k === edit.photo.kind)?.doc ? DOC_RATIO : PHOTO_RATIO}
              value={edit.fit} onChange={(fit) => setEdit({ ...edit, fit })} />
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn" onClick={() => setEdit(null)}>취소</button>
              <button className="btn primary" disabled={busy} onClick={saveFit}>맞춤 저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PB: React.CSSProperties = { minWidth: 20, height: 20, fontSize: 11, background: "rgba(255,255,255,.92)" };
const SEC: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "var(--ink)", margin: "0 0 7px" };
// 브리핑 슬롯 비율(원본 pptx 실측) — 사진 4.20x6.49 · 서류 4.76x5.91
const PHOTO_RATIO = 4.20 / 6.49;
const DOC_RATIO = 4.76 / 5.91;
