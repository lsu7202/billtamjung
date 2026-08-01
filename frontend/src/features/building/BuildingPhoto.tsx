import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { photosApi } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";

/** 매물 대표 사진 — S02에서 유저가 업로드한 사진(app.photos) 첫 장.
 *  인증(Bearer) 필요 → blob 로드. 저장된 사진 없으면 중립 플레이스홀더(표지 report-cover와 무관). */
export function BuildingPhoto({ pk }: { pk: string }) {
  const access = useAuth((s) => s.access);
  const list = useQuery({ enabled: !!pk, queryKey: ["photos", pk], queryFn: () => photosApi.list(pk) });
  const first = list.data?.[0];
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!first) { setUrl(null); return; }
    let obj: string | null = null, alive = true;
    fetch(`/api${first.url}`, { headers: { Authorization: `Bearer ${access}` } })
      .then((res) => (res.ok ? res.blob() : Promise.reject()))
      .then((blob) => { obj = URL.createObjectURL(blob); if (alive) setUrl(obj); else URL.revokeObjectURL(obj); })
      .catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [first?.url, access]);

  if (url) return <img src={url} alt="매물 사진" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg,#dfe4ec,#c3cbd8)", color: "#6b7688", fontSize: "1.2em", fontWeight: 700 }}>건물 사진</div>
  );
}
