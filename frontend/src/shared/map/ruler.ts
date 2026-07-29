/** 지도 위 "자"(straightedge) — 자유자재로 이동·회전, 자유곡선을 이 가장자리에 대고 그리면 직선으로 스냅.
 * MapPanel(S01)·PhotoPanel(S02) 공유. 지오메트릭(지도 좌표) 오버레이 — 지도와 함께 이동/확대.
 */
const R = 6371000, D2R = Math.PI / 180;
const toXY = (ll: any, lat0: number) => ({ x: ll.lng() * D2R * Math.cos(lat0 * D2R) * R, y: ll.lat() * D2R * R });
const toLL = (naver: any, x: number, y: number, lat0: number) =>
  new naver.maps.LatLng(y / (D2R * R), x / (D2R * Math.cos(lat0 * D2R) * R));
const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);

export interface Ruler {
  snap: (ll: any) => any;                 // 점을 자 가장자리에 가까우면 직선으로 스냅
  onDown: (coord: any) => boolean;        // 자 몸통/끝 잡으면 true(이동/회전 시작)
  onMove: (coord: any) => void;
  onUp: () => void;
  setInteractive: (on: boolean) => void;  // 조정 모드 표시(끝 핸들)
  destroy: () => void;
}

export function makeRuler(naver: any, map: any): Ruler {
  const lat0 = map.getCenter().lat();
  // 초기: 지도 중심 가로선, 뷰 폭의 45% 길이
  const bnds = map.getBounds();
  const cLat = map.getCenter().lat();
  const viewW = dist(toXY(new naver.maps.LatLng(cLat, bnds.getMin().x), lat0), toXY(new naver.maps.LatLng(cLat, bnds.getMax().x), lat0));
  let half = (viewW * 0.45) / 2;          // 반길이(m)
  const width = Math.max(18, half * 0.10); // 자 폭(m)
  const c0 = map.getCenter();
  let cx = c0.lng(), cy = c0.lat();        // 중심(경위도)
  let ang = 0;                             // 각(rad), 0=동쪽

  const ends = () => {
    const m = toXY(new naver.maps.LatLng(cy, cx), lat0);
    const dx = Math.cos(ang) * half, dy = Math.sin(ang) * half;
    return [toLL(naver, m.x - dx, m.y - dy, lat0), toLL(naver, m.x + dx, m.y + dy, lat0)];
  };
  // 자 몸통(직사각형) 4모서리 = 양 끝을 수직으로 width/2 이동
  const corners = () => {
    const m = toXY(new naver.maps.LatLng(cy, cx), lat0);
    const dx = Math.cos(ang) * half, dy = Math.sin(ang) * half;      // 길이축
    const px = Math.cos(ang + Math.PI / 2) * width / 2, py = Math.sin(ang + Math.PI / 2) * width / 2;  // 폭축
    const P = (sx: number, sy: number) => toLL(naver, m.x + sx, m.y + sy, lat0);
    return [P(-dx + px, -dy + py), P(dx + px, dy + py), P(dx - px, dy - py), P(-dx - px, -dy - py)];
  };

  const bar = new naver.maps.Polygon({
    map, paths: [corners()], clickable: false,
    fillColor: "#262320", fillOpacity: 0.14, strokeColor: "#262320", strokeWeight: 1.5,
  });
  // 가장자리(그리는 쪽) 강조선
  const edge = new naver.maps.Polyline({ map, path: ends(), clickable: false, strokeColor: "#C2571C", strokeWeight: 3 });
  const dotIcon = (bg: string) => ({ content: `<div style="width:14px;height:14px;border-radius:50%;background:${bg};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);cursor:grab"></div>`, anchor: new naver.maps.Point(7, 7) });
  const [e1, e2] = ends();
  const h1 = new naver.maps.Marker({ position: e1, map, zIndex: 130, clickable: false, icon: dotIcon("#262320") });
  const h2 = new naver.maps.Marker({ position: e2, map, zIndex: 130, clickable: false, icon: dotIcon("#262320") });

  const redraw = () => { const [a, b] = ends(); bar.setPaths([corners()]); edge.setPath([a, b]); h1.setPosition(a); h2.setPosition(b); };

  // 상호작용: 끝 잡으면 회전(중심 고정), 몸통 잡으면 이동
  let mode: "" | "rotate" | "move" = "", grabDLng = 0, grabDLat = 0, rotSign = 1;
  const mpp = () => 156543.03 * Math.cos(cy * D2R) / Math.pow(2, map.getZoom());

  const onDown = (coord: any) => {
    const [a, b] = ends();
    const tol = 16 * mpp();   // 끝 핸들 잡기 허용(≈16px)
    const P = toXY(coord, lat0), A = toXY(a, lat0), B = toXY(b, lat0);
    if (dist(P, A) < tol) { mode = "rotate"; rotSign = -1; }
    else if (dist(P, B) < tol) { mode = "rotate"; rotSign = 1; }
    else {
      // 몸통(선분)과의 수직거리 < 폭 + 여유 → 이동
      const abx = B.x - A.x, aby = B.y - A.y, t = ((P.x - A.x) * abx + (P.y - A.y) * aby) / (abx * abx + aby * aby);
      const proj = { x: A.x + t * abx, y: A.y + t * aby };
      if (t >= -0.05 && t <= 1.05 && dist(P, proj) < width / 2 + 10 * mpp()) { mode = "move"; grabDLng = coord.lng() - cx; grabDLat = coord.lat() - cy; }
      else return false;
    }
    return true;
  };
  const onMove = (coord: any) => {
    if (!mode) return;
    if (mode === "move") { cx = coord.lng() - grabDLng; cy = coord.lat() - grabDLat; }
    else { const C = toXY(new naver.maps.LatLng(cy, cx), lat0), P = toXY(coord, lat0); ang = Math.atan2((P.y - C.y) * rotSign, (P.x - C.x) * rotSign); }
    redraw();
  };
  const onUp = () => { mode = ""; };

  const snap = (ll: any) => {
    const [a, b] = ends();
    const A = toXY(a, lat0), B = toXY(b, lat0), P = toXY(ll, lat0);
    const abx = B.x - A.x, aby = B.y - A.y, len2 = abx * abx + aby * aby;
    const t = ((P.x - A.x) * abx + (P.y - A.y) * aby) / len2;
    const proj = { x: A.x + t * abx, y: A.y + t * aby };
    const tol = 22 * mpp();   // ≈22px 이내면 자 가장자리로 스냅
    if (t >= -0.15 && t <= 1.15 && dist(P, proj) < tol) return toLL(naver, proj.x, proj.y, lat0);
    return ll;
  };

  const setInteractive = (on: boolean) => { h1.setMap(on ? map : null); h2.setMap(on ? map : null); };
  const destroy = () => { bar.setMap(null); edge.setMap(null); h1.setMap(null); h2.setMap(null); };

  return { snap, onDown, onMove, onUp, setInteractive, destroy };
}
