import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadNaver } from "./naver";
import { photosApi } from "../api/endpoints";
import { useAuth } from "../store/auth";

/** S02 매물사진 패널 — 지도 / 로드뷰(Panorama) / 업로드 사진 탭.
 * specs S02 §3.2, 네이버지도-연동 §3.2·3.3.
 */
export function PhotoPanel({ lng, lat, pk }: { lng: number; lat: number; pk?: string }) {
  const [tab, setTab] = useState<"map" | "road" | "upload">("map");
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

  const tabBtn = (t: "map" | "road" | "upload", label: string) => (
    <button className={`btn ${tab === t ? "primary" : ""}`} onClick={() => setTab(t)}>{label}</button>
  );

  return (
    <div className="panel">
      <div style={{ display: "flex", gap: 8, padding: "12px 14px 0" }}>
        {tabBtn("map", "지도")}{tabBtn("road", "로드뷰")}{pk && tabBtn("upload", "업로드 사진")}
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
        {tab === "upload" && pk && <UploadTab pk={pk} />}
      </div>
    </div>
  );
}

/** 업로드 사진 — 파일 업로드(멀티) + 썸네일. 인증 헤더 필요 → blob 로드. */
function UploadTab({ pk }: { pk: string }) {
  const access = useAuth((s) => s.access);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const list = useQuery({ queryKey: ["photos", pk], queryFn: () => photosApi.list(pk) });

  useEffect(() => {
    (list.data ?? []).forEach((p) => {
      if (urls[p.id]) return;
      fetch(`/api${p.url}`, { headers: { Authorization: `Bearer ${access}` } })
        .then((res) => (res.ok ? res.blob() : Promise.reject()))
        .then((blob) => setUrls((u) => ({ ...u, [p.id]: URL.createObjectURL(blob) })))
        .catch(() => {});
    });
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

  return (
    <div style={{ position: "absolute", inset: 0, padding: 12, overflow: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 8 }}>
        {(list.data ?? []).map((p) => (
          <div key={p.id} style={{ position: "relative", aspectRatio: "4/3", background: "#fff", borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
            {urls[p.id]
              ? <img src={urls[p.id]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--muted)", fontSize: 12 }}>로딩…</div>}
            <button className="btn" style={{ position: "absolute", top: 4, right: 4, padding: "0 6px", fontSize: 11 }}
              onClick={async () => { await photosApi.del(pk, p.id); list.refetch(); }}>×</button>
          </div>
        ))}
        <label style={{ aspectRatio: "4/3", border: "1px dashed var(--line-2)", borderRadius: 6, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--muted)", fontSize: 13 }}>
          ＋ 사진 추가
          <input type="file" accept="image/*" multiple hidden onChange={onUpload} />
        </label>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>사적 · 팀 공유. 매도자 사진·현장 사진 등.</p>
    </div>
  );
}
