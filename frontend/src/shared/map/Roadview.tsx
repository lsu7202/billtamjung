import { useEffect, useRef, useState } from "react";
import { loadNaver } from "./naver";

/** 네이버 파노라마(로드뷰) 미니 뷰어. 사이드바 sel-card용. 좌표 최근접 파노라마 로드.
 * 커버리지 없으면 안내. specs 네이버지도-연동(로드뷰). */
export function RoadviewMini({ lng, lat, className, onExpand }: {
  lng: number; lat: number; className?: string; onExpand?: () => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const panoRef = useRef<any>(null);
  const tgtRef = useRef({ lng, lat });        // 현재 본매물 좌표(리스너가 최신값 참조)
  const orientedFor = useRef("");             // 이미 시야 보정한 좌표키
  const [none, setNone] = useState(false);
  tgtRef.current = { lng, lat };

  useEffect(() => {
    let dead = false;
    // 최초/매물변경 시 1회: 파노라마(도로) 위치 → 본매물 방위각으로 시야 보정(매물을 바라보게). 부채꼴 없음.
    const orient = () => {
      const { lng, lat } = tgtRef.current;
      const key = `${lng},${lat}`;
      if (orientedFor.current === key) return;   // 리스너는 최초1회 등록 → ref만 참조(stale 클로저 방지)
      const p = panoRef.current?.getPosition?.(); if (!p) return;
      orientedFor.current = key;
      const dLat = lat - p.lat(), dLng = (lng - p.lng()) * Math.cos((p.lat() * Math.PI) / 180);
      if (Math.abs(dLat) < 1e-9 && Math.abs(dLng) < 1e-9) return;   // 파노라마=매물이면 유지
      panoRef.current.setPov({ pan: (Math.atan2(dLng, dLat) * 180) / Math.PI, tilt: 0, fov: 100 });
    };
    loadNaver().then((naver) => {
      if (dead || !divRef.current) return;
      const pos = new naver.maps.LatLng(lat, lng);
      if (!panoRef.current) {
        panoRef.current = new naver.maps.Panorama(divRef.current, {
          position: pos, pov: { pan: 0, tilt: 0, fov: 100 },
          flightSpot: false, aroundControl: false, zoomControl: false,
        });
        naver.maps.Event.addListener(panoRef.current, "pano_status", (s: any) => setNone(String(s) !== "OK"));
        naver.maps.Event.addListener(panoRef.current, "pano_changed", orient);   // 로딩·위치변경 → 방위 보정
      } else {
        panoRef.current.setPosition(pos);   // 위치 변경 → pano_changed → orient(새 좌표키라 재보정)
      }
    }).catch(() => setNone(true));
    return () => { dead = true; };
  }, [lng, lat]);

  return (
    <div className={className} style={{ position: "relative", cursor: onExpand ? "pointer" : "default" }} onClick={onExpand}>
      <div ref={divRef} style={{ position: "absolute", inset: 0 }} />
      {none && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(150deg,#8a97a6,#5f6b7a)", color: "#e7ecf2", fontSize: 12, fontWeight: 600 }}>
        이 위치 로드뷰 없음
      </div>}
    </div>
  );
}
