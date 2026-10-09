/** 캔버스 핀 레이어 — 매물 핀을 DOM 마커 대신 canvas 1개에 그림(수만 개도 부드러움).
 * 줌아웃 시 격자 클러스터(개수 버블), 줌인 시 개별 가격 태그. 호버/클릭은 지도 이벤트로 히트테스트.
 * naver OverlayView 서브클래스. draw는 rAF로 코얼레싱(팬 중 재투영 폭주 방지). */
import { PIN_COLORS, priceLabel } from "./naver";

export interface CanvasPin {
  /** 열쇠 = 지번(10-08). 고르기 · 겹침 · 묶음이 이것으로 갈린다. building_pk 는 대표 동(목록 카드용) */
  pnu: string; building_pk?: string; addr?: string; lng: number; lat: number;
  col: "mine" | "normal"; price: number | null; last_sale_price?: number | null; sale_est?: number | null;
  /** 핀 종류(S05) — 색은 이걸로. 없으면 col */
  kind?: "mine" | "ad" | "sold" | "normal" | "seek" | "deal" | "est" | "msale" | "mrent" | "market";
  /** 이 핀만의 값 보기 — 보기(매매 · 실거래 · 전체 건물)를 겹쳐 켜면 핀마다 값이 다르다. 없으면 레이어 전체 mode */
  lens?: "fair" | "real";
  /** 값 대신 세울 글자(값이 없을 때) — 매매가가 없는 내 매물은 「미정」. 추정가로 대신 채우지 않는다 */
  text?: string;
  /** 실거래를 총액·단가로 견주는 재료. 단가 분모는 대지면적이 기본이다 */
  last_sale_ym?: string | null; land_area?: number | null; total_area?: number | null;
  /** 가격표 없이 색 점으로만(구해요 추정가, 대표 09-30). 마우스를 올리거나 고르면 그때만 가격표. 묶지 않는다 */
  dot?: boolean;
  /** 건축물대장 주용도 — 가격표 첫 칸(근린 · 단독 …) */
  main_use_name?: string | null;
  /** 매물유형(팀 대분류, 없으면 네이버 유형) — 매물 전단 가운데 줄 */
  major?: string | null;
  /** 실거래 보기 — 원천 건축물주용도, 없으면 실거래 유형(0246). 있으면 가격표 첫 칸이 대장 주용도 대신 이것 */
  trade_use?: string | null;
  /** 매매시세 · 임대시세 대표값 — 매매는 호가(원), 임대는 ㎡당 월세(원). askN = 그 건물 광고 수 */
  ask?: number | null; askN?: number;
  /** 시세 가격표 머리 · 아랫줄 글자 — 임대는 고른 층(「1층」) · 공간 수, 매매는 수집일 */
  askHead?: string; askFoot?: string;
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

/** 단가 한 줄(밸류맵식, 09-30) — 1억 이상 「1.8억」, 천만 원대 「3.1천」(=3,100만), 그 아래 「950만」. */
function unitPrice(v: number): string {
  const one = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, "");
  if (v >= 1e8) return `${one(v / 1e8)}억`;
  if (v >= 1e7) return `${one(v / 1e7)}천`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`;
  return `${Math.round(v).toLocaleString()}원`;
}

/** 202403 → 24.03. 없으면 빈 줄(지어내지 않는다) */
function ymLabel(ym?: string | null): string {
  const t = String(ym ?? "");
  return /^\d{6}$/.test(t) ? `${t.slice(2, 4)}.${t.slice(4)}` : "";
}

/** 값 하나를 총액 · 단가로(2026-09-28 탐색 2) — 매매가 · 추정가 · 실거래가 모두 같은 눈금으로 선다.
 *  밸류맵이 편한 이유가 이것이다: 매물 값과 실거래를 같은 단위로 눈으로 견준다. */
export function valueLabel(price: number | null | undefined, v: RealView,
                           land?: number | null, total?: number | null): string | null {
  if (price == null) return null;
  if (v.basis === "total") return priceLabel(price);
  const area = v.basis === "land" ? land : total;   // ㎡
  if (!area || area <= 0) return null;               // 분모가 없으면 단가를 못 낸다
  return unitPrice(v.unit === "py" ? (price * PY) / area : price / area);
}

/** 임대시세 한 줄 — ㎡당 월세(원)를 앱 면적 단위로. 「8.9만/평」 */
function rentLabel(perM2: number, unit: "py" | "m2"): string {
  const v = unit === "py" ? perM2 * PY : perM2;
  const man = v / 1e4;
  const t = man >= 100 ? `${Math.round(man).toLocaleString()}만` : man >= 1 ? `${String(Math.round(man * 10) / 10).replace(/\.0$/, "")}만`
    : `${Math.round(v / 100) * 100}원`;
  return `${t}/${unit === "py" ? "평" : "㎡"}`;
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
// 클러스터는 멀리서만(2026-09-22 대표: 「3단계 더 멀리 가야 묶이게」). 전엔 줌과 무관하게 늘 58px
// 격자로 묶어 기본 줌 15에서도 같은 골목 핀이 다 숫자 버블이었다. 이제 줌 12 이하에서만 묶고,
// 그 위에선 전부 낱개 가격 태그다(겹치면 겹친 대로 — 격자를 잘게 하면 작은 버블이 산처럼 쌓인다).
const CLUSTER_ZOOM = 12;
/** 가격표 단계(밸류맵식, 09-30) — 이 줌부터 세 칸(종류 / 값 / 날짜), 그 아래는 두 칸(종류 | 값) */
const TAG3_ZOOM = 17;
/** 실거래는 이 줌 아래면 가격표 없이 점 — 매물은 멀어져도 두 칸 그대로 선다 */
const REAL_TAG_ZOOM = 15;

/** 주용도 → 가격표 첫 칸 두세 글자. 「제2종근린생활시설」→「근린」 */
export function useShort(n?: string | null): string {
  const t = (n ?? "").trim();
  if (!t) return "건물";
  if (t.includes("근린")) return "근린";
  // 실거래 유형(0246) 이름이 먼저 — 「단독/다가구」가 「다가구」로 잘리지 않게
  const map: [string, string][] = [["상가/사무실", "상가"], ["단독/다가구", "단독"], ["연립/다세대", "연립"], ["오피스텔", "오피스텔"],
    ["기타건물", "기타"], ["숙박시설", "숙박"], ["공장/창고", "공장"], ["단독주택", "단독"], ["다가구", "다가구"], ["공동주택", "공동"], ["업무", "업무"],
    ["교육", "교육"], ["노유자", "노유자"], ["종교", "종교"], ["공장", "공장"], ["숙박", "숙박"], ["자동차", "자동차"],
    ["창고", "창고"], ["문화", "문화"], ["판매", "판매"], ["의료", "의료"], ["위험물", "위험물"], ["운동", "운동"],
    ["교정", "교정"], ["운수", "운수"], ["관광", "관광"], ["위락", "위락"]];
  const hit = map.find(([k]) => t.includes(k));
  return hit ? hit[1] : t.replace(/시설$/, "").slice(0, 3);
}
const SALE_KINDS = new Set(["mine", "ad", "sold"]);
/** 핀 색을 흰 바탕에 옅게 섞은 색(머리 칸 바탕) */
function tintOf(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return `rgb(${c.map((v) => Math.round(255 - (255 - v) * a)).join(",")})`;
}
const MARGIN = 160;     // 뷰포트 밖 여유(팬 시 가장자리 공백 완화). 캔버스 px = 컨테이너 px + MARGIN
const DPR = Math.min(window.devicePixelRatio || 1, 2);

export interface CanvasLayer {
  setPins(pins: CanvasPin[], fit?: boolean): void;
  setSelected(pk: string | null): void;
  setPriceMode(mode: PriceMode): void;
  setRealView(v: RealView): void;
  /** 그 자리(컨테이너 px)에 가격표 · 클러스터가 있나 — 지도의 필지 클릭이 가격표 클릭을 덮어쓰지 않게(10-04) */
  hits(x: number, y: number): boolean;
  destroy(): void;
}

export function makeCanvasPinLayer(naver: any, map: any, onPick: (pnu: string) => void): CanvasLayer {
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
      a.textContent = (m.p.addr || m.p.pnu).replace("서울특별시 ", "");
      const b = document.createElement("span");
      b.style.cssText = "flex:0 0 auto;color:#69748a;font-variant-numeric:tabular-nums;";
      b.textContent = lb ? (lb.sub ? `${lb.main} · ${lb.sub}` : lb.main) : pv != null ? priceLabel(pv) : "—";
      row.appendChild(a); row.appendChild(b);
      row.onclick = () => { hidePop(); onPick(m.p.pnu); };
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
    const clusterOn = map.getZoom() <= CLUSTER_ZOOM;
    for (const p of pins) {
      const off = proj.fromCoordToOffset(new naver.maps.LatLng(p.lat, p.lng));
      const cx = off.x - tl.x + MARGIN, cy = off.y - tl.y + MARGIN;
      if (cx < 0 || cy < 0 || cx > cssW || cy > cssH) continue;
      // 점 핀 · 매물 핀은 묶지 않는다(매물은 멀어져도 가격표가 그대로 — 밸류맵식, 09-30)
      const key = clusterOn && !p.dot && !SALE_KINDS.has(p.kind ?? "") ? `${Math.floor(cx / CELL)},${Math.floor(cy / CELL)}` : p.pnu;
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
    // 큰 버블이 위에 오게. 멀리서 여러 격자가 겹치면 작은 것(41)이 큰 것(1.5k)을 덮어
    // 숫자가 거짓말을 했다(2026-09-22 화면 확인). 낱개 핀 → 작은 버블 → 큰 버블 순으로 그린다.
    items.sort((a, b) => (a.t === "cluster" ? a.n : 0) - (b.t === "cluster" ? b.n : 0));
    if (hoverIdx >= items.length) hoverIdx = -1;
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    items.forEach((it, i) => { if (i !== hoverIdx) drawItem(it, false); });
    if (hoverIdx >= 0 && items[hoverIdx]) drawItem(items[hoverIdx], true);   // 호버는 맨 위
  }

  function drawItem(it: Item, hover: boolean) {
    if (it.t === "cluster") { drawCluster(it.cx, it.cy, it.n, hover); return; }
    const sel = it.p.pnu === selected;
    const color = PIN_COLORS[it.p.kind ?? it.p.col];
    const z = map.getZoom();
    const three = z >= TAG3_ZOOM;
    const head = useShort(it.p.trade_use ?? it.p.main_use_name);
    if (it.p.dot && !hover && !sel) { it.box = undefined; drawDot(it.cx, it.cy, false, false, color); return; }
    // 매매시세 · 임대시세(10-04) — 실거래와 같은 가로 가격표, 색만 다르다. 멀면 점
    if (it.p.kind === "msale" || it.p.kind === "mrent") {
      const rent = it.p.kind === "mrent";
      const lb = it.p.ask == null ? null : rent ? rentLabel(it.p.ask, view.unit)
        : valueLabel(it.p.ask, view, it.p.land_area, it.p.total_area);
      if (!lb || (z < REAL_TAG_ZOOM && !hover && !sel)) { it.box = undefined; drawDot(it.cx, it.cy, false, false, color); return; }
      it.box = drawTag(it.cx, it.cy, it.p.askHead ?? head, lb, three ? it.p.askFoot ?? null : null, color, hover, sel);
      return;
    }
    // 실거래 — 세 칸(종류 / 거래가 / 년월) · 두 칸(종류 | 거래가) · 멀면 점
    if ((it.p.lens ?? mode) === "real") {
      const lb = realLabel(it.p, view);
      if (!lb) { it.box = undefined; drawDot(it.cx, it.cy, hover, sel); return; }
      if (z < REAL_TAG_ZOOM && !hover && !sel) { it.box = undefined; drawDot(it.cx, it.cy, false, false, color); return; }
      it.box = drawTag(it.cx, it.cy, head, lb.main, three ? lb.sub : null, color, hover, sel);
      return;
    }
    const pv = it.p.sale_est ?? it.p.price ?? null;
    const lb = valueLabel(pv, view, it.p.land_area, it.p.total_area) ?? it.p.text ?? null;
    if (lb == null) { it.box = undefined; drawDot(it.cx, it.cy, hover, sel); return; }
    // 매물 — 세 칸(매매 / 값 / 종류) · 그 밖은 두 칸(매매 | 값), 멀어져도 안 사라진다
    if (SALE_KINDS.has(it.p.kind ?? "")) {
      it.box = drawFlyer(it.cx, it.cy, it.p.kind === "sold", lb, three ? it.p.major ?? null : null, hover, sel);
      return;
    }
    // 그 밖(구해요 · 추정가 점을 올리거나 고름) — 두 칸(종류 | 값)
    it.box = drawTag(it.cx, it.cy, head, lb, null, color, hover, sel);
  }

  /** 빌탐정 가격표(09-30) — 세 칸 · 두 칸 구조는 밸류맵에서 빌리고 생김새는 우리 결로.
   *  둥근 모서리 · 머리 칸은 핀 색을 옅게 깐 바탕에 핀 색 글자 · 값 칸은 핀 색 바탕 흰 글자 ·
   *  꼬리는 아래 가운데 작은 삼각형(건물을 가운데서 가리킨다). 꼬리 끝이 (x,y). 그린 상자를 돌려준다 */
  function drawTag(x: number, y: number, head: string, val: string, foot: string | null, color: string,
                   hover: boolean, sel: boolean): [number, number, number, number] {
    const big = hover || sel, s = big ? 1.1 : 1;
    const light = color.toUpperCase() === "#FFFFFF";
    const ink = light ? "#191F28" : "#FFFFFF";
    const main = light ? "#191F28" : color;                // 테두리 · 머리 글자
    const tint = light ? "#F2F4F6" : tintOf(color, 0.13);   // 머리 바탕
    const fHead = `700 ${11.5 * s}px -apple-system,BlinkMacSystemFont,'Pretendard',sans-serif`;
    const fVal = `800 ${(foot ? 15 : 13) * s}px 'SF Mono',monospace`;
    const fFoot = `600 ${10.5 * s}px 'SF Mono',monospace`;
    const tw = (f: string, t: string) => { ctx.font = f; return ctx.measureText(t).width; };
    const r = 8 * s, tail = 6 * s;
    const rr = (l: number, t: number, w: number, h: number, rad: number) => {
      ctx.beginPath(); ctx.moveTo(l + rad, t); ctx.arcTo(l + w, t, l + w, t + h, rad); ctx.arcTo(l + w, t + h, l, t + h, rad);
      ctx.arcTo(l, t + h, l, t, rad); ctx.arcTo(l, t, l + w, t, rad); ctx.closePath();
    };
    let w: number, h: number;
    if (foot) { w = Math.max(tw(fHead, head), tw(fVal, val), tw(fFoot, foot)) + 22 * s; h = 20 * s + 21 * s + 15 * s + 2 * s; }
    else { w = tw(fHead, head) + tw(fVal, val) + 34 * s; h = 25 * s; }
    const left = x - w / 2, top = y - tail - h;
    ctx.save();
    // 몸통(핀 색) + 꼬리
    ctx.shadowColor = "rgba(15,26,46,.26)"; ctx.shadowBlur = big ? 10 : 5; ctx.shadowOffsetY = big ? 3 : 1.5;
    rr(left, top, w, h, r); ctx.fillStyle = light ? "#FFFFFF" : color; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - tail, top + h - 0.5); ctx.lineTo(x + tail, top + h - 0.5); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.save(); rr(left, top, w, h, r); ctx.clip();
    ctx.fillStyle = tint;
    if (foot) ctx.fillRect(left, top, w, 20 * s);                        // 세 칸: 위 줄이 머리
    else ctx.fillRect(left, top, tw(fHead, head) + 16 * s, h);          // 두 칸: 왼쪽이 머리
    ctx.restore();
    if (light || sel) { rr(left, top, w, h, r); ctx.lineWidth = sel ? 2.4 : 1.4; ctx.strokeStyle = sel ? "#191F28" : main; ctx.stroke(); }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (foot) {
      ctx.font = fHead; ctx.fillStyle = main; ctx.fillText(head, x, top + 10 * s + 0.5);
      ctx.font = fVal; ctx.fillStyle = ink; ctx.fillText(val, x, top + 20 * s + 11 * s);
      ctx.font = fFoot; ctx.fillStyle = light ? "rgba(25,31,40,.6)" : "rgba(255,255,255,.85)";
      ctx.fillText(foot, x, top + 20 * s + 21 * s + 7 * s);
    } else {
      const hw = tw(fHead, head) + 16 * s;
      ctx.font = fHead; ctx.fillStyle = main; ctx.fillText(head, left + hw / 2, top + h / 2 + 0.5);
      ctx.font = fVal; ctx.fillStyle = ink; ctx.fillText(val, left + hw + (w - hw) / 2, top + h / 2 + 0.5);
    }
    ctx.restore();
    return [left, top, w, h + tail];
  }

  /** 매물 전단(10-03) — 부동산 유리창에 붙은 종이 광고 결. 다른 가격표(가로 상자)와 모양으로 갈린다.
   *  흰 종이 · 얇은 회색 테두리 · 각진 모서리 · 맨 위 「매 매」 빨강 자간 넓게 · 가운데 매물유형(가까울 때만) · 값 크게.
   *  멀어져도 두 줄(매매 / 값)로 남는다. 꼬리 끝이 (x,y). 그린 상자를 돌려준다 */
  function drawFlyer(x: number, y: number, sold: boolean, val: string, major: string | null,
                     hover: boolean, sel: boolean): [number, number, number, number] {
    const big = hover || sel, s = big ? 1.1 : 1;
    const ff = "-apple-system,BlinkMacSystemFont,'Pretendard',sans-serif";
    const fHead = `800 ${12 * s}px ${ff}`, fMid = `600 ${10.5 * s}px ${ff}`, fVal = `800 ${15 * s}px ${ff}`;
    const headTxt = sold ? "완  료" : "매  매";
    const tw = (f: string, t: string) => { ctx.font = f; return ctx.measureText(t).width; };
    const padX = 10 * s, tail = 6 * s, r = 2 * s;
    const rowH = 15 * s, valH = 19 * s, padY = 5 * s;
    const w = Math.max(tw(fHead, headTxt), major ? tw(fMid, major) : 0, tw(fVal, val)) + padX * 2;
    const h = padY * 2 + rowH + (major ? rowH - 2 * s : 0) + valH;
    const left = x - w / 2, top = y - tail - h, bot = top + h;
    const edge = sel ? "#191F28" : "#C9CED6";
    const path = () => {
      ctx.beginPath(); ctx.moveTo(left + r, top);
      ctx.arcTo(left + w, top, left + w, bot, r); ctx.arcTo(left + w, bot, left, bot, r);
      ctx.lineTo(x + tail, bot); ctx.lineTo(x, y); ctx.lineTo(x - tail, bot);      // 꼬리
      ctx.arcTo(left, bot, left, top, r); ctx.arcTo(left, top, left + w, top, r); ctx.closePath();
    };
    ctx.save();
    ctx.shadowColor = "rgba(15,26,46,.28)"; ctx.shadowBlur = big ? 10 : 6; ctx.shadowOffsetY = big ? 3 : 2;
    path(); ctx.fillStyle = "#FFFFFF"; ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = sel ? 2.2 : 1; ctx.strokeStyle = edge; ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let cy = top + padY + rowH / 2;
    ctx.font = fHead; ctx.fillStyle = sold ? PIN_COLORS.sold : PIN_COLORS.ad; ctx.fillText(headTxt, x, cy + 0.5);
    cy += rowH / 2;
    if (major) { ctx.font = fMid; ctx.fillStyle = "#6B7684"; ctx.fillText(major, x, cy + (rowH - 2 * s) / 2); cy += rowH - 2 * s; }
    ctx.font = fVal; ctx.fillStyle = sold ? "#8B95A1" : "#191F28"; ctx.fillText(val, x, cy + valH / 2 + 0.5);
    ctx.restore();
    return [left, top, w, h + tail];
  }

  // 추정가 산정 대상 아님(주거) · 값 없음 → 작은 회색 점(지도 정리 + 상업 매물 부각)
  function drawDot(x: number, y: number, hover: boolean, sel: boolean, color?: string) {
    const r = color ? 5.5 : (hover || sel ? 6 : 4.5);
    ctx.save();
    ctx.shadowColor = "rgba(15,26,46,.25)"; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color ?? (sel ? "#6b6560" : "#a8a29a"); ctx.fill();
    ctx.restore();
    // 흰 점(추정가)은 검정 테두리, 나머지는 흰 테두리
    const light = color?.toUpperCase() === "#FFFFFF";
    ctx.lineWidth = light ? 1.6 : 1.5; ctx.strokeStyle = light ? "#191F28" : "#fff"; ctx.stroke();
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
    if (it.t === "pin") { hidePop(); onPick(it.p.pnu); }
    else showClusterPop(e.offset.x, e.offset.y, it);   // 클러스터 클릭 → 목록 팝오버(가까운 순 상위 8 + 더보기=확대)
  };
  const mv = naver.maps.Event.addListener(map, "mousemove", onMove);
  const ck = naver.maps.Event.addListener(map, "click", onClick);
  const dz = naver.maps.Event.addListener(map, "dragstart", hidePop);   // 이동/줌 시 팝오버 위치 무효 → 닫기
  const zm = naver.maps.Event.addListener(map, "zoom_changed", hidePop);

  return {
    hits(x, y) { return hitIndex(x, y) >= 0; },
    setPins(next, fit = true) {
      pins = next;
      if (!fit) {                         // 지도가 움직이는 대로 불러오는 화면(탐색)은 지도를 핀에 맞추지 않는다
        fitKey = pins.map((p) => p.pnu).sort().join(",");
        const pj = overlay.getProjection();
        if (pj) { compute(pj); render(); }
        return;
      }
      // **핀 구성이 바뀔 때만** 지도를 맞춘다(2026-09-06). 검색 페이지는 상태가 하나만 바뀌어도 핀 배열을 새로 만들어
      // 여기로 보내는데, 그때마다 맞추면 역·주소로 옮긴 지도가 곧바로 핀 상자(강남 내 매물)로 되돌아간다 —
      // 「종로5가역 엔터 → 움직이다 다시 돌아옴」이 그것이다. 같은 건물 집합이면 순서·가격이 바뀌어도 안 움직인다.
      const key = pins.map((p) => p.pnu).sort().join(",");
      if (pins.length && key !== fitKey) {
        const bnd = new naver.maps.LatLngBounds();
        pins.forEach((p) => bnd.extend(new naver.maps.LatLng(p.lat, p.lng)));
        map.fitBounds(bnd, { top: 60, right: 60, bottom: 60, left: 60 });
      }
      fitKey = key;
      const proj = overlay.getProjection();
      if (proj) { compute(proj); render(); }
    },
    setSelected(pnu) { selected = pnu; render(); },
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
