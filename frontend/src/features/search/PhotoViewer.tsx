import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RoadviewMini, type RoadView } from "../../shared/map/Roadview";
import { AuthImg } from "../../shared/ui/AuthImg";
import { Icon } from "../../shared/ui/Icon";

/** 사진 전체화면(대표 09-28) — 거리뷰와 올린 사진을 한 자리에서.
 *
 *  첫 장은 거리뷰(끌어서 둘러보기 · 길 위 화살표로 옮기기 · 확대), 그다음은 광고 사진(올린 비율 그대로).
 *  아래 썸네일 줄로 바로 넘어간다. 키보드 ← → 는 사진일 때만(거리뷰에선 거리뷰 이동에 쓰인다). Esc 로 닫는다.
 *  거리뷰는 판에서 보던 자리 · 방향에서 시작하고, 닫으면 판이 여기서 옮긴 자리를 이어받는다. */
export function PhotoViewer({ lng, lat, adId, photos, start, view, onView, onClose }: {
  lng: number; lat: number; adId: number | null; photos: number[];
  start: number; view: RoadView | null; onView: (v: RoadView) => void; onClose: () => void;
}) {
  const n = 1 + photos.length;
  const [i, setI] = useState(start);
  const src = (pid: number) => `/api/ads/${adId}/photos/${pid}`;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (i === 0) return;                         // 거리뷰에선 화살표를 거리뷰에 넘긴다
      if (e.key === "ArrowRight") setI((v) => (v + 1) % n);
      if (e.key === "ArrowLeft") setI((v) => (v - 1 + n) % n);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [i, n, onClose]);

  return createPortal((
    <div className="pv">
      <div className="pv-top">
        <span className="pv-cnt num">{i === 0 ? "거리뷰" : `사진 ${i}`} · {i + 1} / {n}</span>
        <button className="pv-x" title="닫기" onClick={onClose}><Icon name="close" size={22} /></button>
      </div>
      <div className="pv-stage">
        {i === 0
          ? <RoadviewMini lng={lng} lat={lat} view={view} onView={onView} controls className="pv-rv" />
          : <AuthImg className="pv-img" src={src(photos[i - 1])} />}
        {n > 1 && <>
          <button className="pv-nav l" onClick={() => setI((i - 1 + n) % n)}>‹</button>
          <button className="pv-nav r" onClick={() => setI((i + 1) % n)}>›</button>
        </>}
      </div>
      {n > 1 && (
        <div className="pv-thumbs">
          <button className={`pv-th rv ${i === 0 ? "on" : ""}`} onClick={() => setI(0)}>
            <Icon name="roadview" size={20} /><span>거리뷰</span></button>
          {photos.map((pid, k) => (
            <button key={pid} className={`pv-th ${i === k + 1 ? "on" : ""}`} onClick={() => setI(k + 1)}>
              <AuthImg src={src(pid)} /></button>
          ))}
        </div>
      )}
    </div>
  ), document.body);
}
