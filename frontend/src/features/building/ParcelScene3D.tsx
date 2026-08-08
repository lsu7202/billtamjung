import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { ParcelScene, type SceneData } from "./ParcelScene";

/** 입체 지적도(3D) — 필지·접도·용적을 실제 모델로 세운다.
 *
 *  카메라는 가만히 있는다. 자동으로 돌면 읽는 동안 계속 움직여 눈이 따라가지 못한다.
 *  대신 끌어서 직접 돌린다(휠=확대). 움직일 때만 그린다 — 정지 화면에서 GPU를 물지 않는다.
 *
 *  담는 값은 전부 사실이다 — 필지 폴리곤·접도 폭(도로명주소 실측)·층수·용적률·법정 용적률.
 *  건물 바닥은 대지를 건폐율만큼 줄인 도형이다(건축면적 = 대지면적 × 건폐율).
 */

type LngLat = [number, number];
type Geo = { type: string; coordinates: any };

const STOREY = 3.5;          // 층고(m) — 대장에 높이가 없어 층수로 되돌린다
const R_KEEP = 130;          // 필지 중심에서 이 반경(m)까지의 도로만 그린다

/* 색 — 역할마다 다른 계열을 준다. 같은 파랑 안에서 명도만 다르면 경계가 안 읽힌다. */
const C = {
  bg: 0x070c14,
  ground: 0x121a28,
  grid: 0x1f2b3e,
  road: 0x2c3a50,          // 일반 접도(면)
  roadEdge: 0x9db0cc,
  front: 0x40371f,         // 전면도로(면)
  frontEdge: 0xffa23c,     // 주황 = 전면도로
  plate: 0x16223a,         // 대지
  plateEdge: 0x39e0c8,     // 청록 = 대지 경계
  mass: 0x3e6fd0,          // 파랑 = 현재 건물
  massLine: 0x9bc0ff,
  legal: 0xf2d072,         // 노랑 = 법정 용적 여유
};

const ringsOf = (g: Geo | null | undefined): LngLat[][] => {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates[0]];
  if (g.type === "MultiPolygon") return g.coordinates.map((p: any) => p[0]);
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
};

type V2 = { x: number; z: number };

/** 위경도 → 필지 중심 기준 미터 평면. three는 Y가 위라 위도는 -Z로 눕힌다. */
function makeToMeters(lng0: number, lat0: number) {
  const mx = 111320 * Math.cos((lat0 * Math.PI) / 180), my = 110540;
  return ([lng, lat]: LngLat): V2 => ({ x: (lng - lng0) * mx, z: -(lat - lat0) * my });
}

const centroid = (pts: V2[]): V2 => ({
  x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
  z: pts.reduce((a, p) => a + p.z, 0) / pts.length,
});

/** 중심을 향해 k배 줄인 도형 — 건폐율만큼 작은 건물 바닥을 만든다. */
const shrink = (pts: V2[], k: number, c: V2): V2[] =>
  pts.map((p) => ({ x: c.x + (p.x - c.x) * k, z: c.z + (p.z - c.z) * k }));

const shapeOf = (pts: V2[]) => {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i ? s.lineTo(p.x, -p.z) : s.moveTo(p.x, -p.z)));
  s.closePath();
  return s;
};

/** 폴리곤을 눕혀 세운다 — ExtrudeGeometry는 XY 평면에 만드니 X축으로 90° 눕힌다. */
function slab(pts: V2[], y0: number, h: number, mat: THREE.Material) {
  const g = new THREE.ExtrudeGeometry(shapeOf(pts), { depth: h, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  g.translate(0, y0 + h, 0);
  return new THREE.Mesh(g, mat);
}

/** 폴리라인을 폭 w의 띠로 — 도로를 실제 폭 그대로 눕힌다. 경계선으로 폭을 읽힌다. */
function ribbon(line: V2[], w: number, y: number, mat: THREE.Material) {
  const pos: number[] = [];
  const edgeL: THREE.Vector3[] = [], edgeR: THREE.Vector3[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const L = Math.hypot(dx, dz) || 1;
    const nx = (-dz / L) * (w / 2), nz = (dx / L) * (w / 2);
    pos.push(
      a.x - nx, y, a.z - nz, b.x - nx, y, b.z - nz, b.x + nx, y, b.z + nz,
      a.x - nx, y, a.z - nz, b.x + nx, y, b.z + nz, a.x + nx, y, a.z + nz,
    );
    if (!i) { edgeL.push(new THREE.Vector3(a.x - nx, y, a.z - nz)); edgeR.push(new THREE.Vector3(a.x + nx, y, a.z + nz)); }
    edgeL.push(new THREE.Vector3(b.x - nx, y, b.z - nz));
    edgeR.push(new THREE.Vector3(b.x + nx, y, b.z + nz));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return { mesh: new THREE.Mesh(g, mat), edges: [edgeL, edgeR] };
}

type Label = { text: string; at: THREE.Vector3; kind: "front" | "road" | "mass" | "plate" | "legal" };

export function ParcelScene3D({ data, animate = true }: { data: SceneData; animate?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<(Label & { sx: number; sy: number; on: boolean })[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    const rings = ringsOf(data.parcel);
    if (!el || !rings.length) return;

    const flat = rings[0];
    const lng0 = flat.reduce((a, p) => a + p[0], 0) / flat.length;
    const lat0 = flat.reduce((a, p) => a + p[1], 0) / flat.length;
    const toM = makeToMeters(lng0, lat0);

    // 마지막 점이 첫 점과 겹치면 압출 도형이 뒤틀린다
    const raw = flat.map(toM);
    const parcel = raw.length > 2 && Math.hypot(raw[0].x - raw[raw.length - 1].x, raw[0].z - raw[raw.length - 1].z) < 0.01
      ? raw.slice(0, -1) : raw;
    const c = centroid(parcel);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(C.bg, 1);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText =
      "width:100%;height:100%;display:block;border-radius:inherit;cursor:grab;touch-action:none";

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(C.bg, 60, 150);
    const cam = new THREE.PerspectiveCamera(34, 1, 0.5, 600);

    scene.add(new THREE.AmbientLight(0xa9c0e6, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.65);
    key.position.set(-38, 60, 34);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fa4e8, 0.7);
    rim.position.set(46, 22, -42);
    scene.add(rim);

    /* 굵은 선 — 기본 Line은 굵기를 못 준다(WebGL 제약). Line2로 픽셀 굵기를 준다. */
    const lineMats: LineMaterial[] = [];
    const thick = (pts: THREE.Vector3[], color: number, opt: {
      width?: number; dash?: [number, number]; opacity?: number; top?: boolean;
    } = {}) => {
      const g = new LineGeometry();
      g.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
      const m = new LineMaterial({
        color, linewidth: opt.width ?? 2, transparent: true, opacity: opt.opacity ?? 1,
        dashed: !!opt.dash, dashSize: opt.dash?.[0] ?? 1, gapSize: opt.dash?.[1] ?? 1,
        depthTest: !opt.top,
      });
      lineMats.push(m);
      const l = new Line2(g, m);
      l.computeLineDistances();
      if (opt.top) l.renderOrder = 6;
      return l;
    };
    const loop = (pts: V2[], y: number) => {
      const p = pts.map((q) => new THREE.Vector3(q.x, y, q.z));
      p.push(p[0].clone());
      return p;
    };

    // ── 지면 ──────────────────────────────────────────────
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(150, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: C.ground }),
    );
    ground.position.set(c.x, -0.06, c.z);
    scene.add(ground);
    const grid = new THREE.GridHelper(120, 24, C.grid, C.grid);   // 5m 눈금
    (grid.material as THREE.Material).transparent = true;
    (grid.material as any).opacity = 0.5;
    grid.position.set(c.x, 0, c.z);
    scene.add(grid);

    // ── 접한 도로 ─────────────────────────────────────────
    // DoubleSide 필수 — 띠를 위에서 내려다보는데 감김 방향에 따라 뒷면이 되면 통째로 사라진다
    const roadMat = new THREE.MeshBasicMaterial({ color: C.road, side: THREE.DoubleSide });
    const frontMat = new THREE.MeshBasicMaterial({ color: C.front, side: THREE.DoubleSide });
    type RoadDraw = { rn: string; w: number; near: V2; dir: V2; front: boolean };
    const drawn: RoadDraw[] = [];

    data.roads.forEach((r) => {
      ringsOf(r.geojson).forEach((ln) => {
        const pts = ln.map(toM).filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < R_KEEP);
        if (pts.length < 2) return;
        const front = r.rn === data.frontRn;
        const { mesh, edges } = ribbon(pts, r.road_bt, front ? 0.06 : 0.04, front ? frontMat : roadMat);
        scene.add(mesh);
        edges.forEach((e) => scene.add(thick(e, front ? C.frontEdge : C.roadEdge, {
          // 멀리 뻗는 경계선은 옅게 — 안개가 안 먹는 선이라 그대로 두면 화면을 가로지른다
          width: front ? 2.2 : 1.2, opacity: front ? 0.9 : 0.3,
        })));
        // 치수선을 걸 자리 — 필지에 가장 가까운 마디와 그 방향
        let bi = 0, bd = Infinity;
        pts.forEach((p, i) => {
          const d = Math.hypot(p.x - c.x, p.z - c.z);
          if (d < bd) { bd = d; bi = i; }
        });
        if (bd > R_KEEP) return;
        const a = pts[Math.max(0, bi - 1)], b = pts[Math.min(pts.length - 1, bi + 1)];
        const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const prev = drawn.find((d) => d.rn === r.rn);
        if (prev) { if (bd < Math.hypot(prev.near.x - c.x, prev.near.z - c.z)) Object.assign(prev, { near: pts[bi] }); return; }
        drawn.push({ rn: r.rn, w: r.road_bt, near: pts[bi], dir: { x: (b.x - a.x) / L, z: (b.z - a.z) / L }, front });
      });
    });

    // ── 대지 ──────────────────────────────────────────────
    scene.add(slab(parcel, -0.4, 0.4, new THREE.MeshStandardMaterial({
      color: C.plate, roughness: 0.95, metalness: 0,
    })));
    scene.add(thick(loop(parcel, 0.03), C.plateEdge, { width: 2.6 }));

    // ── 건물 매스 ─────────────────────────────────────────
    const far = data.far ?? 0, legal = data.legalFar ?? 0, bcr = data.bcr ?? 0;
    const floors = data.floorsAbove ?? (bcr > 0 && far > 0 ? Math.max(1, Math.round(far / bcr)) : 3);
    const H = floors * STOREY;
    const foot = shrink(parcel, bcr > 0 ? Math.sqrt(Math.min(bcr, 100) / 100) : 0.9, c);

    scene.add(slab(foot, 0, H, new THREE.MeshStandardMaterial({
      color: C.mass, roughness: 0.45, metalness: 0.1,
    })));
    for (let i = 1; i < floors; i++) scene.add(thick(loop(foot, i * STOREY), C.massLine, { width: 1, opacity: 0.3 }));
    scene.add(thick(loop(foot, H), 0xffffff, { width: 2, opacity: 0.9 }));

    // ── 법정 용적까지 남은 여유 ────────────────────────────
    const HL = far > 0 && legal > far ? H * (legal / far) : H;
    if (HL > H + 0.5) {
      scene.add(slab(foot, H, HL - H, new THREE.MeshStandardMaterial({
        color: C.legal, transparent: true, opacity: 0.12, roughness: 1,
        side: THREE.DoubleSide, depthWrite: false,
      })));
      scene.add(thick(loop(foot, HL), C.legal, { width: 2, opacity: 0.9 }));
    }

    // ── 치수선 — 값을 대상 옆에 붙인다 ──────────────────────
    const labs: Label[] = [];
    const DASH: [number, number] = [0.9, 0.55];

    drawn.sort((a, b) => b.w - a.w).slice(0, 3).forEach((r) => {
      // 도로 진행방향의 법선으로 폭을 가로지르는 치수선 + 양끝 보조선
      const nx = -r.dir.z, nz = r.dir.x;
      const y = 0.45;
      const p1 = new THREE.Vector3(r.near.x - nx * r.w / 2, y, r.near.z - nz * r.w / 2);
      const p2 = new THREE.Vector3(r.near.x + nx * r.w / 2, y, r.near.z + nz * r.w / 2);
      const col = r.front ? C.frontEdge : C.roadEdge;
      scene.add(thick([p1, p2], col, { width: 2.4, dash: DASH, top: true }));
      [p1, p2].forEach((p) => scene.add(thick(
        [p.clone().setY(0), p.clone().setY(3)], col, { width: 2, dash: [0.5, 0.35], top: true },
      )));
      labs.push({
        text: `${r.w}m`, kind: r.front ? "front" : "road",
        at: new THREE.Vector3((p1.x + p2.x) / 2, 3.4, (p1.z + p2.z) / 2),
      });
    });

    // 건물 높이 — 앞쪽 모서리 바깥에 세로 치수선
    const corner = foot.reduce((a, p) => (p.z > a.z ? p : a), foot[0]);
    const off = { x: corner.x + (corner.x - c.x) * 0.3 + 2, z: corner.z + (corner.z - c.z) * 0.3 + 2 };
    const V = (y: number) => new THREE.Vector3(off.x, y, off.z);
    scene.add(thick([V(0), V(H)], C.massLine, { width: 2.4, dash: DASH, top: true }));
    scene.add(thick([new THREE.Vector3(corner.x, 0, corner.z), V(0)], C.massLine, { width: 1.6, dash: [0.5, 0.35], top: true }));
    scene.add(thick([new THREE.Vector3(corner.x, H, corner.z), V(H)], C.massLine, { width: 1.6, dash: [0.5, 0.35], top: true }));
    labs.push({ text: `${H.toFixed(0)}m`, kind: "mass", at: V(H / 2) });

    if (HL > H + 0.5) {
      scene.add(thick([V(H), V(HL)], C.legal, { width: 2.4, dash: DASH, top: true }));
      scene.add(thick([new THREE.Vector3(corner.x, HL, corner.z), V(HL)], C.legal, { width: 1.6, dash: [0.5, 0.35], top: true }));
      labs.push({ text: `+${(HL - H).toFixed(1)}m`, kind: "legal", at: V((H + HL) / 2) });
    }

    // 대지 — 가장 긴 변에 길이 치수
    let e0 = 0, eLen = 0;
    parcel.forEach((p, i) => {
      const q = parcel[(i + 1) % parcel.length];
      const L = Math.hypot(q.x - p.x, q.z - p.z);
      if (L > eLen) { eLen = L; e0 = i; }
    });
    {
      const p = parcel[e0], q = parcel[(e0 + 1) % parcel.length];
      const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
      const L = Math.hypot(mx - c.x, mz - c.z) || 1;
      const ox = ((mx - c.x) / L) * 4.5, oz = ((mz - c.z) / L) * 4.5;   // 건물 밖으로 빼서 겹치지 않게
      scene.add(thick([
        new THREE.Vector3(p.x + ox, 0.25, p.z + oz), new THREE.Vector3(q.x + ox, 0.25, q.z + oz),
      ], C.plateEdge, { width: 2.4, dash: DASH, top: true }));
      labs.push({ text: `${eLen.toFixed(1)}m`, kind: "plate", at: new THREE.Vector3(mx + ox, 0.9, mz + oz) });
    }

    // ── 카메라 — 고정. 끌면 돈다 ───────────────────────────
    const widest = drawn.reduce((a, r) => Math.max(a, r.w), 0);
    // 전면도로 쪽에서 45° 비껴본 조감. 정면으로 서면 도로가 카메라 뒤로 빠져 폭이 안 보이고,
    // 도로와 나란히 서면 건물이 옆으로 눕는다. 그 사이가 조감도다.
    const fr = drawn.find((r) => r.front) ?? drawn[0];
    let az = (fr ? Math.atan2(fr.near.z - c.z, fr.near.x - c.x) : 0.68) + 0.8;
    let elev = 0.60;
    let dist = Math.max(92, HL * 3.3, eLen * 4.2, widest * 2.4);

    const project = (v: THREE.Vector3, w: number, h: number) => {
      const p = v.clone().project(cam);
      return {
        sx: Math.min(w - 40, Math.max(40, (p.x * 0.5 + 0.5) * w)),
        sy: Math.min(h - 16, Math.max(16, (-p.y * 0.5 + 0.5) * h)),
        on: p.z < 1,
      };
    };

    let queued = false;
    const draw = () => {
      queued = false;
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false);
        cam.aspect = w / h; cam.updateProjectionMatrix();
      }
      lineMats.forEach((m) => m.resolution.set(w, h));

      cam.position.set(
        c.x + Math.cos(az) * dist * Math.cos(elev),
        HL * 0.34 + dist * Math.sin(elev),
        c.z + Math.sin(az) * dist * Math.cos(elev),
      );
      cam.lookAt(c.x, HL * 0.34, c.z);
      renderer.render(scene, cam);

      // 겹치는 치수는 아래로 밀어 떼어 놓는다 — 겹친 숫자는 둘 다 못 읽는다
      const placed = labs.map((L) => ({ ...L, ...project(L.at, w, h) })).sort((a, b) => a.sy - b.sy);
      for (let i = 1; i < placed.length; i++)
        for (let j = 0; j < i; j++)
          if (Math.abs(placed[i].sx - placed[j].sx) < 70 && placed[i].sy - placed[j].sy < 26)
            placed[i].sy = Math.min(h - 16, placed[j].sy + 26);
      setLabels(placed);
    };
    const invalidate = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
    invalidate();

    // 끌어서 회전 · 휠로 확대
    const cv = renderer.domElement;
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY };
      cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      az -= (e.clientX - drag.x) * 0.006;
      elev = Math.min(1.35, Math.max(0.12, elev + (e.clientY - drag.y) * 0.004));
      drag = { x: e.clientX, y: e.clientY };
      invalidate();
    };
    const up = (e: PointerEvent) => {
      drag = null; cv.style.cursor = "grab";
      cv.releasePointerCapture?.(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      dist = Math.min(260, Math.max(26, dist * (1 + e.deltaY * 0.0012)));
      invalidate();
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    const ro = new ResizeObserver(invalidate);
    ro.observe(el);

    return () => {
      ro.disconnect();
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("wheel", wheel);
      scene.traverse((o: any) => {
        o.geometry?.dispose?.();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m?.dispose?.());
      });
      renderer.dispose();
      cv.remove();
    };
  }, [data, animate]);

  if (!ringsOf(data.parcel).length) return <div className="ps-empty">필지 도형이 없어 그릴 수 없습니다</div>;
  // WebGL이 막힌 환경(원격데스크톱·구형 GPU)에서도 자료는 나와야 한다 — 등각 SVG로 떨어진다
  if (failed) return <ParcelScene data={data} w={900} h={760} />;

  return (
    <div className="ps3" ref={host}>
      <div className="ps3-hud left">
        {data.useZone && <div className="ps3-zone">{data.useZone}</div>}
        <div className="ps3-k">대지면적</div>
        <div className="ps3-v">{data.landArea ? `${(data.landArea / 3.305785).toFixed(1)}평` : "—"}</div>
        <div className="ps3-k">연면적</div>
        <div className="ps3-v">{data.totalArea ? `${(data.totalArea / 3.305785).toFixed(1)}평` : "—"}</div>
      </div>
      <div className="ps3-hud right">
        <div className="ps3-k">건폐율 / 용적률</div>
        <div className="ps3-v">{data.bcr ?? "—"}% · {data.far ?? "—"}%</div>
        {data.legalFar != null && (
          <>
            <div className="ps3-k">법정 용적률</div>
            <div className="ps3-h">{data.legalFar}%</div>
          </>
        )}
      </div>

      {/* 치수 — 3D 위치를 화면 좌표로 옮겨 붙인다(글자는 또렷하게) */}
      {labels.map((L, i) => L.on && (
        <div key={i} className={`ps3-dim ${L.kind}`} style={{ left: L.sx, top: L.sy }}>{L.text}</div>
      ))}
      <div className="ps3-hint">끌어서 회전 · 휠로 확대</div>
    </div>
  );
}
