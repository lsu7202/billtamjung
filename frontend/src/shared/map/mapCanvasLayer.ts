/** 캔버스 핀 레이어 — 매물 핀을 DOM 마커 대신 canvas 1개에 그림(수만 개도 부드러움).
 * 줌아웃 시 격자 클러스터(개수 버블), 줌인 시 개별 가격 태그. 호버/클릭은 지도 이벤트로 히트테스트.
 * naver OverlayView 서브클래스. draw는 rAF로 코얼레싱(팬 중 재투영 폭주 방지). */
import { PIN_COLORS, priceLabel } from "./naver";

export interface CanvasPin {
  building_pk: string; addr?: string; lng: number; lat: number;
  col: "mine" | "normal"; price: number | null; last_sale_price?: number | null; sale_est?: number | null;
  /** 실거래를 총액·단가로 견주는 재료. 단가 분모는 대지면적이 기본이다 */
  last_sale_ym?: string | null; land_area?: number | null; total_area?: number | null;
}
export type PriceMode = "fair" | "real";   // 핀 태그 가격: 추정가 / 실거래가
/** 실거래를 어떻게 볼 것인가 — 총액이냐 단가냐, 단가면 무엇으로 나누고 어느 단위로 낼 것이냐.
 *  기본은 **대지면적 · 평**이다(연면적이 아니다). */
export type RealView = { basis: "total" | "land" | "bldg"; unit: "py" | "m2" };
type Member = { p: CanvasPin; cx: number; cy: number };
type Item =
  | { t: "pin"; cx: number; cy: number; p: CanvasPin; box?: [number, number, number, number] }
  | { t: "cluster"; cx: number; cy: number; n: number; lat: number; lng: number; members: Member[] };

const PY = 3.305785;      // 1평 = 3.305785㎡

/** 단가 한 줄 — 억은 소수 둘째까지(평당 1.4억과 1.45억은 다른 물건이다), 그 아래는 만원. */
function unitPrice(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}억`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`;
  return `${Math.round(v).toLocaleString()}원`;
}

/** 202403 → 24.03. 없으면 빈 줄(지어내지 않는다) */
function ymLabel(ym?: string | null): string {
  const t = String(ym ?? "");
  return /^\d{6}$/.test(t) ? `${t.slice(2, 4)}.${t.slice(4)}` : "";
}

/** 핀에 세울 글자. 값이 없으면 null — 핀 대신 회색 점이 선다. */
function realLabel(p: CanvasPin, v: RealView): { main: string; sub: string } | null {
  const price = p.last_sale_price;
  if (price == null) return null;
  const sub = ymLabel(p.last_sale_ym);
  if (v.basis === "total") return { main: priceLabel(price), sub };
  const area = v.basis === "land" ? p.land_area : p.total_area;   // ㎡
  if (!area || area <= 0) return null;                            // 분모가 없으면 단가를 못 낸다
  return { main: unitPrice(v.unit === "py" ? (price * PY) / area : price / area), sub };
}

const CELL = 58;        // 클러스터 격자(px)
const MARGIN = 160;     // 뷰포트 밖 여유(팬 시 가장자리 공백 완화). 캔버스 px = 컨테이너 px + MARGIN
const DPR = Math.min(window.devicePixelRatio || 1, 2);

export interface CanvasLayer {
  setPins(pins: CanvasPin[]): void;
  setSelected(pk: string | null): void;
  setPriceMode(mode: PriceMode): void;
  setRealView(v: RealView): void;
  destroy(): void;
}

export function makeCanvasPinLayer(naver: any, map: any, onPick: (pk: string) => void): CanvasLayer {
  let pins: CanvasPin[] = [];
  let fitKey = "";   // 마지막으로 맞춘 핀 집합
  let selected: string | null = null;
  let mode: PriceMode = "fair";
  let view: RealView = { basis: "land", unit: "py" };   // 밸류맵식 기본 — 대지면적 · 평
  let items: Item[] = [];
  let hoverIdx = -1;
  let raf = 0;

  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.pointerEvents = "none";   // 지도 팬/줌 방해 안 함 — 상호작용은 map 이벤트로
  const ctx = canvas.getContext("2d")!;

  // 클러스터 클릭 목록 팝오버(컨테이너 좌표 = 지도 이벤트 offset과 동일 기준)
  const container: HTMLElement | null = typeof map.getElement === "function" ? map.getElement() : null;
  const pop = document.createElement("div");
  pop.style.cssText = "position:absolute;z-index:6;display:none;background:#fff;border-radius:10px;box-shadow:0 8px 28px rgba(20,30,55,.2);padding:5px;min-width:150px;max-width:250px;font:500 12.5px -apple-system,BlinkMacSystemFont,sans-serif;color:#1a2233;pointer-events:auto;";
  if (container) container.appendChild(pop);
  const hidePop = () => { pop.style.display = "none"; };

  function showClusterPop(offX: number, offY: number, it: Extract<Item, { t: "cluster" }>) {
    if (!container) { map.morph(new naver.maps.LatLng(it.lat, it.lng), Math.min(21, map.getZoom() + 2)); return; }
    const near = it.members.slice()
      .sort((a, b) => ((a.cx - it.cx) ** 2 + (a.cy - it.cy) ** 2) - ((b.cx - it.cx) ** 2 + (b.cy - it.cy) ** 2))
      .slice(0, 8);
    pop.innerHTML = "";
    const head = document.createElement("div");
    head.style.cssText = "padding:4px 8px 6px;font-weight:700;color:#69748a;font-size:11px;";
    head.textContent = `이 지점 ${it.n}건 · 가까운 순`;
    pop.appendChild(head);
    for (const m of near) {
      const lb = mode === "real" ? realLabel(m.p, view) : null;
      const pv = mode === "real" ? null : (m.p.sale_est ?? m.p.price ?? null);
      const row = document.createElement("div");
      row.style.cssText = "padding:5px 8px;border-radius:6px;cursor:pointer;display:flex;gap:8px;align-items:center;justify-content:space-between;";
      row.onmouseenter = () => { row.style.background = "#f3f4f6"; };
      row.onmouseleave = () => { row.style.background = ""; };
      const a = document.createElement("span");
      a.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;";
      a.textContent = (m.p.addr || m.p.building_pk).replace("서울특별시 ", "");
      const b = document.createElement("span");
      b.style.cssText = "flex:0 0 auto;color:#69748a;font-variant-numeric:tabular-nums;";
      b.textContent = lb ? (lb.sub ? `${lb.main} · ${lb.sub}` : lb.main) : pv != null ? priceLabel(pv) : "—";
      row.appendChild(a); row.appendChild(b);
      row.onclick = () => { hidePop(); onPick(m.p.building_pk); };
      pop.appendChild(row);
    }
    if (it.n > near.length) {
      const more = document.createElement("div");
      more.style.cssText = "padding:6px 8px;color:#2b5aa8;cursor:pointer;font-size:12px;border-top:1px solid #eee;margin-top:3px;";
      more.textContent = `+${it.n - near.length}건 더 · 확대해서 보기`;
      more.onclick = () => { hidePop(); map.morph(new naver.maps.LatLng(it.lat, it.lng), Math.min(21, map.getZoom() + 2)); };
      pop.appendChild(more);
    }
    pop.style.display = "block";
    const lx = Math.max(6, offX - pop.offsetWidth / 2);
    const ly = Math.max(6, offY - pop.offsetHeight - 14);
    pop.style.left = lx + "px"; pop.style.top = ly + "px";
  }

  const Layer: any = function () {};
  Layer.prototype = new naver.maps.OverlayView();
  Layer.prototype.onAdd = function () { this.getPanes().overlayLayer.appendChild(canvas); };
  Layer.prototype.onRemove = function () { canvas.parentNode?.removeChild(canvas); };
  Layer.prototype.draw = function () {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; const proj = overlay.getProjection(); if (proj) { compute(proj); render(); } });
  };
  const overlay = new Layer();
  overlay.setMap(map);

  function compute(proj: any) {
    const sz = map.getSize();
    const b = map.getBounds();
    const tl = proj.fromCoordToOffset(new naver.maps.LatLng(b.getNE().lat(), b.getSW().lng())); // 뷰포트 좌상단
    const cssW = sz.width + MARGIN * 2, cssH = sz.height + MARGIN * 2;
    canvas.style.left = (tl.x - MARGIN) + "px";
    canvas.style.top = (tl.y - MARGIN) + "px";
    canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
    canvas.width = cssW * DPR; canvas.height = cssH * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // 캔버스(뷰포트+여유) 안 핀만 투영 → 격자 클러스터. 캔버스 px = paneOffset - tl + MARGIN
    const buckets = new Map<string, { xs: number; ys: number; lats: number; lngs: number; members: Member[] }>();
    for (const p of pins) {
      const off = proj.fromCoordToOffset(new naver.maps.LatLng(p.lat, p.lng));
      const cx = off.x - tl.x + MARGIN, cy = off.y - tl.y + MARGIN;
      if (cx < 0 || cy < 0 || cx > cssW || cy > cssH) continue;
      const key = `${Math.floor(cx / CELL)},${Math.floor(cy / CELL)}`;
      const bk = buckets.get(key);
      if (bk) { bk.xs += cx; bk.ys += cy; bk.lats += p.lat; bk.lngs += p.lng; bk.members.push({ p, cx, cy }); }
      else buckets.set(key, { xs: cx, ys: cy, lats: p.lat, lngs: p.lng, members: [{ p, cx, cy }] });
    }
    items = [];
    for (const bk of buckets.values()) {
      const n = bk.members.length;
      if (n === 1) items.push({ t: "pin", cx: bk.xs, cy: bk.ys, p: bk.members[0].p });
      else items.push({ t: "cluster", cx: bk.xs / n, cy: bk.ys / n, n, lat: bk.lats / n, lng: bk.lngs / n, members: bk.members });
    }
    if (hoverIdx >= items.length) hoverIdx = -1;
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    items.forEach((it, i) => { if (i !== hoverIdx) drawItem(it, false); });
    if (hoverIdx >= 0 && items[hoverIdx]) drawItem(items[hoverIdx], true);   // 호버는 맨 위
  }

  function drawItem(it: Item, hover: boolean) {
    if (it.t === "cluster") { drawCluster(it.cx, it.cy, it.n, hover); return; }
    const sel = it.p.building_pk === selected;
    // fair(추정가)=배치 sale_est(상업만 적재됨) 또는 팀 매매가 · 실거래=실제 거래가. 값 없으면 회색 점(주거·비대상).
    if (mode === "real") {
      const lb = realLabel(it.p, view);
      if (!lb) { it.box = undefined; drawDot(it.cx, it.cy, hover, sel); return; }
      it.box = drawPin(it.cx, it.cy, lb.main, PIN_COLORS[it.p.col], hover, sel, lb.sub);
      return;
    }
    const pv = it.p.sale_est ?? it.p.price ?? null;
    if (pv == null) { it.box = undefined; drawDot(it.cx, it.cy, hover, sel); }
    else it.box = drawPin(it.cx, it.cy, priceLabel(pv), PIN_COLORS[it.p.col], hover, sel);
  }

  // 추정가 산정 대상 아님(주거) · 값 없음 → 작은 회색 점(지도 정리 + 상업 매물 부각)
  function drawDot(x: number, y: number, hover: boolean, sel: boolean) {
    const r = (hover || sel ? 6 : 4.5);
    ctx.save();
    ctx.shadowColor = "rgba(15,26,46,.25)"; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = sel ? "#6b6560" : "#a8a29a"; ctx.fill();
    ctx.restore();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#fff"; ctx.stroke();
  }

  function drawCluster(x: number, y: number, n: number, hover: boolean) {
    const r = (12 + Math.min(18, Math.log2(n + 1) * 5)) * (hover ? 1.12 : 1);
    ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(38,35,32,.16)"; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#262320"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = `700 ${n >= 1000 ? 11 : 12}px 'SF Mono',monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n), x, y);
  }

  /** 알약 태그 — 꼬리(좌하단)가 (x,y). 기존 DOM 마커 anchor(10,30)와 유사.
   *  `sub` 를 주면 두 줄이 된다(값 위, 거래년월 아래). 그린 상자를 돌려줘 히트테스트가 그걸 쓴다. */
  function drawPin(x: number, y: number, text: string, color: string, hover: boolean, sel: boolean,
                   sub?: string): [number, number, number, number] {
    const big = hover || sel, s = big ? 1.16 : 1, two = !!sub;
    ctx.font = `700 ${12 * s}px 'SF Mono',monospace`;
    const tw = ctx.measureText(text).width;
    ctx.font = `600 ${10 * s}px 'SF Mono',monospace`;
    const sw = two ? ctx.measureText(sub!).width : 0;
    const padX = 10 * s, h = (two ? 33 : 22) * s, w = Math.max(tw, sw) + padX * 2, r = 10 * s;
    const left = x, top = y - h;
    ctx.save();
    ctx.shadowColor = "rgba(15,26,46,.35)"; ctx.shadowBlur = big ? 10 : 5; ctx.shadowOffsetY = big ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(left + r, top);
    ctx.arcTo(left + w, top, left + w, top + h, r);
    ctx.arcTo(left + w, top + h, left, top + h, r);
    ctx.lineTo(left, top + h);          // 좌하단 각(꼬리)
    ctx.arcTo(left, top, left + r, top, r);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    if (sel) { ctx.shadowColor = "transparent"; ctx.lineWidth = 2.5; ctx.strokeStyle = "#fff"; ctx.stroke(); }
    ctx.restore();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${12 * s}px 'SF Mono',monospace`;
    ctx.fillText(text, left + w / 2, top + (two ? 12 * s : h / 2));
    if (two) {
      ctx.font = `600 ${10 * s}px 'SF Mono',monospace`;
      ctx.fillStyle = "rgba(255,255,255,.82)";
      ctx.fillText(sub!, left + w / 2, top + 24 * s);
    }
    return [left, top, w, h];
  }

  // 히트테스트 — e.offset(컨테이너 px) → 캔버스 px(+MARGIN)로 아이템과 비교
  function hitIndex(offX: number, offY: number): number {
    const mx = offX + MARGIN, my = offY + MARGIN;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.t === "cluster") {
        const r = 12 + Math.min(18, Math.log2(it.n + 1) * 5) + 5;
        const dx = mx - it.cx, dy = my - it.cy;
        if (dx * dx + dy * dy <= r * r) return i;
      } else if (it.box) {
        const [bx, by, bw, bh] = it.box;   // 실제로 그린 알약 상자(두 줄이면 더 높다)
        if (mx >= bx - 4 && mx <= bx + bw + 4 && my >= by - 4 && my <= by + bh + 4) return i;
      } else if (mx >= it.cx - 7 && mx <= it.cx + 7 && my >= it.cy - 7 && my <= it.cy + 7) {
        return i;   // 값이 없어 회색 점으로 선 핀
      }
    }
    return -1;
  }

  let cursorOn = false;
  const onMove = (e: any) => {
    if (!e.offset) return;
    const i = hitIndex(e.offset.x, e.offset.y);
    if (i !== hoverIdx) { hoverIdx = i; render(); }
    const on = i >= 0;
    if (on !== cursorOn) { cursorOn = on; map.setOptions({ cursor: on ? "pointer" : "" }); }
  };
  const onClick = (e: any) => {
    if (!e.offset) return;
    const i = hitIndex(e.offset.x, e.offset.y);
    if (i < 0) { hidePop(); return; }
    const it = items[i];
    if (it.t === "pin") { hidePop(); onPick(it.p.building_pk); }
    else showClusterPop(e.offset.x, e.offset.y, it);   // 클러스터 클릭 → 목록 팝오버(가까운 순 상위 8 + 더보기=확대)
  };
  const mv = naver.maps.Event.addListener(map, "mousemove", onMove);
  const ck = naver.maps.Event.addListener(map, "click", onClick);
  const dz = naver.maps.Event.addListener(map, "dragstart", hidePop);   // 이동/줌 시 팝오버 위치 무효 → 닫기
  const zm = naver.maps.Event.addListener(map, "zoom_changed", hidePop);

  return {
    setPins(next) {
      pins = next;
      // **핀 구성이 바뀔 때만** 지도를 맞춘다(2026-09-06). 검색 페이지는 상태가 하나만 바뀌어도 핀 배열을 새로 만들어
      // 여기로 보내는데, 그때마다 맞추면 역·주소로 옮긴 지도가 곧바로 핀 상자(강남 내 매물)로 되돌아간다 —
      // 「종로5가역 엔터 → 움직이다 다시 돌아옴」이 그것이다. 같은 건물 집합이면 순서·가격이 바뀌어도 안 움직인다.
      const key = pins.map((p) => p.building_pk).sort().join(",");
      if (pins.length && key !== fitKey) {
        const bnd = new naver.maps.LatLngBounds();
        pins.forEach((p) => bnd.extend(new naver.maps.LatLng(p.lat, p.lng)));
        map.fitBounds(bnd, { top: 60, right: 60, bottom: 60, left: 60 });
      }
      fitKey = key;
      const proj = overlay.getProjection();
      if (proj) { compute(proj); render(); }
    },
    setSelected(pk) { selected = pk; render(); },
    setPriceMode(m) { mode = m; render(); },
    setRealView(v) { view = v; render(); },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      naver.maps.Event.removeListener(mv);
      naver.maps.Event.removeListener(ck);
      naver.maps.Event.removeListener(dz);
      naver.maps.Event.removeListener(zm);
      pop.parentNode?.removeChild(pop);
      overlay.setMap(null);
    },
  };
}
