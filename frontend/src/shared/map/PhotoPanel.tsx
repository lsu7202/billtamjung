import { useEffect, useRef, useState } from "react";
import { loadNaver } from "./naver";

/** S02 매물사진 패널 — 지도(단일 마커) / 로드뷰(Panorama 최근접) 탭.
 * specs S02 §3.2, 네이버지도-연동 §3.2·3.3.
 */
export function PhotoPanel({ lng, lat }: { lng: number; lat: number }) {
  const [tab, setTab] = useState<"map" | "road">("map");
  const mapDiv = useRef<HTMLDivElement>(null);
  const roadDiv = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [noPano, setNoPano] = useState(false);
  const inited = useRef<{ map?: boolean; road?: boolean }>({});

  useEffect(() => {
    let dead = false;
    loadNaver()
      .then((naver) => {
        if (dead) return;
        if (tab === "map" && mapDiv.current && !inited.current.map) {
          const pos = new naver.maps.LatLng(lat, lng);
          const map = new naver.maps.Map(mapDiv.current, { center: pos, zoom: 17 });
          new naver.maps.Marker({
            position: pos, map,
            icon: {
              content: `<div style="background:#0F1A2E;color:#fff;font:700 12px/1 monospace;padding:6px 11px;border-radius:999px 999px 999px 3px;box-shadow:0 3px 8px rgba(15,26,46,.4)">본매물</div>`,
              anchor: new naver.maps.Point(10, 30),
            },
          });
          inited.current.map = true;
        }
        if (tab === "road" && roadDiv.current && !inited.current.road) {
          try {
            new naver.maps.Panorama(roadDiv.current, {
              position: new naver.maps.LatLng(lat, lng),
              pov: { pan: 0, tilt: 0, fov: 100 },
            });
            inited.current.road = true;
          } catch {
            setNoPano(true);
          }
        }
      })
      .catch((e) => setErr((e as Error).message));
    return () => { dead = true; };
  }, [tab, lng, lat]);

  const tabBtn = (t: "map" | "road", label: string) => (
    <button className={`btn ${tab === t ? "primary" : ""}`} onClick={() => setTab(t)}>{label}</button>
  );

  return (
    <div className="panel">
      <div style={{ display: "flex", gap: 8, padding: "12px 14px 0" }}>
        {tabBtn("map", "지도")}{tabBtn("road", "로드뷰")}
      </div>
      <div style={{ position: "relative", height: 330, margin: 14, borderRadius: 8, overflow: "hidden", background: "var(--surface-2)" }}>
        {err && <div style={{ padding: 20, color: "var(--up)", fontSize: 13 }}>{err}</div>}
        <div ref={mapDiv} style={{ position: "absolute", inset: 0, display: tab === "map" ? "block" : "none" }} />
        <div ref={roadDiv} style={{ position: "absolute", inset: 0, display: tab === "road" ? "block" : "none" }} />
        {tab === "road" && noPano && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 13 }}>
            로드뷰 없음 — 이 위치 주변에 파노라마가 없습니다
          </div>
        )}
      </div>
    </div>
  );
}
