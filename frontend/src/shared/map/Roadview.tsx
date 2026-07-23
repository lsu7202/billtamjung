import { useEffect, useRef, useState } from "react";
import { loadNaver } from "./naver";

/** 네이버 파노라마(거리뷰) 미니 뷰어. 사이드바 sel-card용. 좌표 최근접 파노라마 로드.
 * 커버리지 없으면 안내. specs 네이버지도-연동(거리뷰). */
export function RoadviewMini({ lng, lat, className, onExpand }: {
  lng: number; lat: number; className?: string; onExpand?: () => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const panoRef = useRef<any>(null);
  const [none, setNone] = useState(false);

  useEffect(() => {
    let dead = false;
    loadNaver().then((naver) => {
      if (dead || !divRef.current) return;
      const pos = new naver.maps.LatLng(lat, lng);
      if (!panoRef.current) {
        panoRef.current = new naver.maps.Panorama(divRef.current, {
          position: pos, pov: { pan: 0, tilt: 0, fov: 100 }, aroundControl: false,
        });
        naver.maps.Event.addListener(panoRef.current, "pano_status", (s: any) => {
          setNone(String(s) !== "OK");
        });
      } else {
        panoRef.current.setPosition(pos);
      }
    }).catch(() => setNone(true));
    return () => { dead = true; };
  }, [lng, lat]);

  return (
    <div className={className} style={{ position: "relative", cursor: onExpand ? "pointer" : "default" }} onClick={onExpand}>
      <div ref={divRef} style={{ position: "absolute", inset: 0 }} />
      {none && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(150deg,#8a97a6,#5f6b7a)", color: "#e7ecf2", fontSize: 12, fontWeight: 600 }}>
        이 위치 거리뷰 없음
      </div>}
    </div>
  );
}
