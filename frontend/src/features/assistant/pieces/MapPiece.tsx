/** 지도 한 판 — 좌표에 핀. 정본 §12-1-1 의 그릇을 잇는다.
 *
 *  로더는 새로 짜지 않는다. `shared/map/naver` 의 loadNaver 하나가 전 화면의 지도를 띄우고,
 *  핀 아이콘은 소식 지도가 쓰는 eventIcon 을 그대로 쓴다 — 같은 갈래가 화면마다 다른 그림이면
 *  아이콘이 뜻을 잃는다.
 *
 *  **지도가 못 뜨면 핀 목록으로 떨어진다.** 키가 없거나 SDK가 막힌 자리에서 회색 네모를 남기면
 *  답이 통째로 빈칸이 된다 — 좌표는 못 보여도 「무엇이 몇 개 있다」는 글자로 남는다.
 *  휠 확대는 끈다. 대화 가운데 있는 판이라 스크롤을 가로채면 답을 지나칠 수 없다. */
import { useEffect, useRef, useState } from "react";

import { eventIcon } from "../../../shared/map/eventIcon";
import { loadNaver } from "../../../shared/map/naver";
import { Frame } from "./Grids";

type Pin = { lng: number; lat: number; tag?: string; title: string; sub?: string };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 갈래 → 아이콘. 아는 갈래만 제 그림을 갖고 나머지는 그냥 점이다(깃발은 소식 지도의 「기타」라 안 쓴다) */
function pinIcon(tag?: string): string | null {
  if (!tag) return null;
  const { icon } = eventIcon({ kind: tag, name: tag, source: "" });
  return icon === "flag" ? null : icon;
}

const marker = (tag: string | undefined, on: boolean) => {
  const ic = pinIcon(tag);
  const body = ic
    ? `<svg width="15" height="15" viewBox="0 0 24 24"><use href="#bt-${ic}"/></svg>`
    : "";
  return `<div class="gd-pin${on ? " on" : ""}${ic ? "" : " dot"}">${body}</div>`;
};

export function MapPiece({ p }: { p: Record<string, any> }) {
  const pins: Pin[] = (Array.isArray(p.pins) ? p.pins : [])
    .filter((v: any) => v && num(v.lng) != null && num(v.lat) != null);
  const c: any[] = Array.isArray(p.center) ? p.center : [];
  const center: [number, number] | null =
    num(c[0]) != null && num(c[1]) != null ? [Number(c[0]), Number(c[1])]
      : pins.length ? [pins[0].lng, pins[0].lat] : null;
  const radius = num(p.radius);

  const ref = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!center || err || !ref.current) return;
    let map: any;
    let dead = false;                       // SDK 로드 중 언마운트 — 지도를 만들지 않는다
    loadNaver().then((naver) => {
      if (dead || !ref.current) return;
      const pos = new naver.maps.LatLng(center[1], center[0]);
      map = new naver.maps.Map(ref.current, {
        center: pos, zoom: 16, scrollWheel: false, pinchZoom: true,
        zoomControl: false, scaleControl: false, mapDataControl: false, logoControl: true,
      });
      const bnds = new naver.maps.LatLngBounds(pos, pos);
      if (radius && radius > 0) {
        new naver.maps.Circle({ map, center: pos, radius, clickable: false,
          fillColor: "#3182F6", fillOpacity: 0.07, strokeColor: "#3182F6",
          strokeWeight: 1.4, strokeOpacity: 0.65 });
        // 원의 사방 끝을 담아 배율을 맞춘다(도 단위 환산 — SDK 판마다 getBounds 가 없다)
        const dLat = radius / 111320;
        const dLng = radius / (111320 * Math.cos((center[1] * Math.PI) / 180) || 1);
        bnds.extend(new naver.maps.LatLng(center[1] + dLat, center[0] + dLng));
        bnds.extend(new naver.maps.LatLng(center[1] - dLat, center[0] - dLng));
      }
      const ms: any[] = pins.map((pin, i) => {
        const m = new naver.maps.Marker({ position: new naver.maps.LatLng(pin.lat, pin.lng), map,
          zIndex: 20, icon: { content: marker(pin.tag, false), anchor: new naver.maps.Point(13, 13) } });
        naver.maps.Event.addListener(m, "click", () => {
          setSel((cur) => (cur === i ? null : i));
          ms.forEach((o, j) => o.setIcon({ content: marker(pins[j].tag, j === i), anchor: new naver.maps.Point(13, 13) }));
        });
        bnds.extend(m.getPosition());
        return m;
      });
      if (pins.length > 1 || (radius && radius > 0)) {
        map.fitBounds(bnds, { top: 24, right: 24, bottom: 24, left: 24 });
        map.setCenter(pos);
      }
    }).catch(() => setErr(true));
    return () => {
      dead = true;
      try { map?.destroy?.(); } catch { /* SDK 정리 실패는 무시(ReportMap 과 같은 함정) */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.[0], center?.[1], radius, pins.length, err]);

  if (!center && !pins.length) return null;
  if (err || !center) return <PinList p={p} pins={pins} />;

  const on = sel != null ? pins[sel] : null;
  return (
    <Frame title={p.title} foot={p.foot}>
      <div className="gd-map" ref={ref} />
      {on && (
        <div className="gd-li gd-map-sel">
          <div className="gd-l">
            {on.tag && <span className="g">{on.tag}</span>}
            <span className="t">{on.title}</span>
            {on.sub && <span className="s">{on.sub}</span>}
          </div>
        </div>
      )}
    </Frame>
  );
}

/** 지도가 없을 때의 같은 자료 — 목록 그릇과 같은 줄 문법 */
function PinList({ p, pins }: { p: Record<string, any>; pins: Pin[] }) {
  if (!pins.length) return null;
  return (
    <Frame title={p.title} foot={p.foot}>
      <div className="gd-li">
        {pins.map((pin, i) => (
          <div className="gd-l" key={i}>
            {pin.tag && <span className="g">{pin.tag}</span>}
            <span className="t">{pin.title}</span>
            {pin.sub && <span className="s">{pin.sub}</span>}
          </div>
        ))}
      </div>
    </Frame>
  );
}
