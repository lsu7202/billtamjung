/** 사진 · 로드뷰 — 건물을 눈으로 보는 자리.
 *
 *  **건물 사진은 대개 없다.** 그래서 사진이 없거나 깨지면 그 자리에서 로드뷰로 내려앉고,
 *  로드뷰 좌표도 없으면 그 조각을 아예 안 그린다 — 「사진 없음」 회색 네모를 답 가운데 세우면
 *  자리만 먹고 아무 말도 안 한다. 조각이 하나도 안 남으면 부품째 사라진다.
 *
 *  우리 사진은 인증이 걸린 길이라 blob 으로 받는다(BuildingPhoto 와 같은 어법).
 *  바깥 주소(http…)는 그대로 <img> 에 건다. */
import { useEffect, useState } from "react";

import { RoadviewMini } from "../../../shared/map/Roadview";
import { useAuth } from "../../../shared/store/auth";
import { Frame } from "./Grids";

type Item = { kind?: "photo" | "roadview"; url?: string; lng?: number; lat?: number; caption?: string };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const hasRV = (it: Item) => num(it.lng) != null && num(it.lat) != null;
const usable = (it: Item) => (it.kind === "photo" ? !!it.url || hasRV(it) : hasRV(it));

/** 우리 길(/photos/…)은 Bearer 가 붙어야 열린다 — <img src> 로는 못 받아서 blob 으로 바꾼다 */
function useSrc(url?: string): { src: string | null; bad: boolean } {
  const access = useAuth((s) => s.access);
  const [src, setSrc] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setBad(false);
    if (!url) { setSrc(null); return; }
    if (!url.startsWith("/")) { setSrc(url); return; }
    setSrc(null);
    let obj: string | null = null, alive = true;
    fetch(`/api${url}`, { headers: access ? { Authorization: `Bearer ${access}` } : {} })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error("no"))))
      .then((blob) => {
        obj = URL.createObjectURL(blob);
        if (alive) setSrc(obj); else URL.revokeObjectURL(obj);
      })
      .catch(() => { if (alive) setBad(true); });
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [url, access]);
  return { src, bad };
}

function One({ it, onDead }: { it: Item; onDead: () => void }) {
  const [bad, setBad] = useState(false);
  const wantPhoto = it.kind !== "roadview" && !!it.url && !bad;
  const { src, bad: loadBad } = useSrc(wantPhoto ? it.url : undefined);
  const rv = hasRV(it);
  const dead = !wantPhoto && !rv;
  useEffect(() => { if (dead) onDead(); }, [dead, onDead]);
  useEffect(() => { if (loadBad) setBad(true); }, [loadBad]);
  if (dead) return null;
  return (
    <figure className="gd-mi">
      <div className="b">
        {wantPhoto
          ? (src && <img src={src} alt={it.caption ?? ""} onError={() => setBad(true)} />)
          : <RoadviewMini lng={Number(it.lng)} lat={Number(it.lat)} className="rv" />}
      </div>
      {it.caption && <figcaption>{it.caption}</figcaption>}
    </figure>
  );
}

export function Media({ p }: { p: Record<string, any> }) {
  const items: Item[] = (Array.isArray(p.items) ? p.items : []).filter(usable);
  const [dead, setDead] = useState<number[]>([]);
  const live = items.map((_, i) => i).filter((i) => !dead.includes(i));
  if (!items.length || !live.length) return null;
  return (
    <Frame title={p.title} foot={p.foot}>
      <div className="gd-md">
        {live.map((i) => (
          <One key={i} it={items[i]}
            onDead={() => setDead((d) => (d.includes(i) ? d : [...d, i]))} />
        ))}
      </div>
    </Frame>
  );
}
