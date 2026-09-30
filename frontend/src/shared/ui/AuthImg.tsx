import { useEffect, useState } from "react";
import { useAuth } from "../store/auth";

/** 인증이 필요한 이미지 — <img src> 는 토큰을 못 실어서(401) blob 으로 받아 그린다.
 *  광고 사진(/ads/{id}/photos/{pid}) · 목록 카드 사진이 쓴다. 못 받으면 아무것도 안 그린다. */
export function AuthImg({ src, className }: { src: string | null; className?: string }) {
  const access = useAuth((s) => s.access);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!src) { setUrl(null); return; }
    let obj: string | null = null, alive = true;
    fetch(src, { headers: { Authorization: `Bearer ${access}` } })
      .then((res) => (res.ok ? res.blob() : Promise.reject()))
      .then((b) => { obj = URL.createObjectURL(b); if (alive) setUrl(obj); else URL.revokeObjectURL(obj); })
      .catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [src, access]);
  return url ? <img className={className} src={url} alt="" /> : null;
}
