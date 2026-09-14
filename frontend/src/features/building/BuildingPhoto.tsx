import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { photosApi, type Photo, type PhotoKind } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";

/** 매물 대표 사진 — 외관 → 내부 → 그 외 순으로 고른다.
 *  인증(Bearer) 필요 → blob 로드. 저장된 사진 없으면 중립 플레이스홀더(표지 report-cover와 무관).
 *
 *  「첫 장」을 쓰면 안 된다. 서류(건축물대장·토지이용계획·지적도)도 같은 표에 들어 있어서,
 *  정렬이 조금만 어긋나면 대표 자리에 서류가 박힌다 — 실제로 베타 사용자에게 그랬다.
 *  서류는 아예 후보에서 뺀다. 건물 사진이 하나도 없으면 서류를 세우느니 플레이스홀더가 낫다. */
const COVER_ORDER: PhotoKind[] = ["exterior", "interior", "etc"];

export function BuildingPhoto({ pk }: { pk: string }) {
  const access = useAuth((s) => s.access);
  const list = useQuery({ enabled: !!pk, queryKey: ["photos", pk], queryFn: () => photosApi.list(pk) });
  const first = COVER_ORDER.reduce<Photo | undefined>(
    (found, kind) => found ?? list.data?.find((p) => p.kind === kind), undefined);
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
