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
  front: 0x322d1d,         // 전면도로(면) — 넓어서 밝게 칠하면 화면을 덩어리로 덮는다
  frontEdge: 0xffa23c,     // 주황 = 전면도로
  plate: 0x16223a,         // 대지
  plateEdge: 0x39e0c8,     // 청록 = 대지 경계
  mass: 0x3e6fd0,          // 파랑 = 현재 건물
  massLine: 0x9bc0ff,
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

/** 폴리곤 무게중심 — **면적 가중**이다(2026-08-27).
 *
 *  예전엔 정점의 산술 평균을 썼다. 정점이 고르게 흩어진 도형에선 같은 값이지만,
 *  지적도 폴리곤은 도로에 접한 변에 정점이 몰려 있는 일이 흔하다. 그러면 중심이
 *  그 변 쪽으로 끌려가고, 그 중심을 기준으로 줄인 건물 바닥이 통째로 밀려서
 *  **대지 경계 밖으로 튀어나온다**(실측: 건폐율 43.87%인데 건물이 대지를 벗어남).
 *
 *  넓이가 0(선분·중복점)이면 나눗셈이 깨지므로 그때만 산술 평균으로 물러난다.
 */
const centroid = (pts: V2[]): V2 => {
  let a2 = 0, cx = 0, cz = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const cross = p.x * q.z - q.x * p.z;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cz += (p.z + q.z) * cross;
  }
  if (Math.abs(a2) < 1e-9) {
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
             z: pts.reduce((s, p) => s + p.z, 0) / pts.length };
  }
  return { x: cx / (3 * a2), z: cz / (3 * a2) };
};

/** 중심을 향해 k배 줄인 도형 — 건폐율만큼 작은 건물 바닥을 만든다. */
const shrink = (pts: V2[], k: number, c: V2): V2[] =>
  pts.map((p) => ({ x: c.x + (p.x - c.x) * k, z: c.z + (p.z - c.z) * k }));

/** 압출용 단면 — 도형의 (u,v)가 눕힌 뒤 (x,z)가 된다.
 *  rotateX(90°)가 (u,v,d) → (u, −d, v)로 보내므로 v에는 z를 **그대로** 넣어야 한다.
 *  여기서 −z를 넣으면 매스만 Z축으로 뒤집혀 대지·도로와 어긋난다(경계선은 안 뒤집히므로 티가 난다). */
const shapeOf = (pts: V2[]) => {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i ? s.lineTo(p.x, p.z) : s.moveTo(p.x, p.z)));
  s.closePath();
  return s;
};

/** 폴리곤을 눕혀 세운다 — ExtrudeGeometry는 XY 평면에 만드니 X축으로 90° 눕힌다. */
function slab(pts: V2[], y0: number, h: number, mat: THREE.Material) {
  const g = new THREE.ExtrudeGeometry(shapeOf(pts), { depth: h, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  g.translate(0, y0 + h, 0);
  g.computeVertexNormals();          // 감김 방향이 바뀌었으니 법선을 다시 계산한다
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

/** dx/dy = 화면에서 치수선 옆으로 밀어낼 픽셀. 선 위에 얹으면 선을 가린다. */
type Label = { text: string; at: THREE.Vector3; kind: "front" | "road" | "mass" | "plate";
  dx?: number; dy?: number };

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

    /* 지형 그룹 — 지세를 각도로 펴려면 지면·도로·대지·건물이 **함께** 기울어야 한다.
       조명은 밖(scene)에 남긴다. 같이 돌면 음영이 그대로라 기울인 티가 안 난다.
       회전 중심은 필지 중심이다: pivot 을 거기 놓고 land 를 그만큼 되밀어 두면
       자식들은 지금 쓰는 절대 좌표를 그대로 쓸 수 있다. */
    const pivot = new THREE.Group();
    pivot.position.set(c.x, 0, c.z);
    const land = new THREE.Group();
    land.position.set(-c.x, 0, -c.z);
    pivot.add(land);
    scene.add(pivot);

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
    land.add(ground);
    const grid = new THREE.GridHelper(120, 24, C.grid, C.grid);   // 5m 눈금
    (grid.material as THREE.Material).transparent = true;
    (grid.material as any).opacity = 0.5;
    grid.position.set(c.x, 0, c.z);
    land.add(grid);

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
        land.add(mesh);
        edges.forEach((e) => land.add(thick(e, front ? C.frontEdge : C.roadEdge, {
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
    land.add(slab(parcel, -0.4, 0.4, new THREE.MeshStandardMaterial({
      color: C.plate, roughness: 0.95, metalness: 0,
    })));
    land.add(thick(loop(parcel, 0.03), C.plateEdge, { width: 2.6 }));

    // ── 건물 매스 ─────────────────────────────────────────
    const far = data.far ?? 0, bcr = data.bcr ?? 0;
    const floors = data.floorsAbove ?? (bcr > 0 && far > 0 ? Math.max(1, Math.round(far / bcr)) : 3);
    // 높이는 대장 실측값(표제부)이 있으면 그것만 쓴다. 없으면 층수×3.5m로 매스는 세우되
    // 치수는 그리지 않는다 — 그림은 도해지만 숫자는 사실이어야 한다.
    // (실측: 종로2가 71-6은 8층 21.6m = 층당 2.7m. 3.5m 가정이면 28m로 6.4m 빗나간다)
    const H = data.height ?? floors * STOREY;
    const storey = H / Math.max(1, floors);
    const foot = shrink(parcel, bcr > 0 ? Math.sqrt(Math.min(bcr, 100) / 100) : 0.9, c);

    // 건폐율이 있으면 바닥은 사실이다(마스터가 사실만 채운다 — 0044에서 추정 출처 제거).
    // 없으면 0.9는 그리기 위한 임의값이라 사실이 아니다 — 높이 치수와 같은 규칙: 반투명 + 점선.
    const solid = bcr > 0;
    // 건물은 **기울이지 않는다**. 땅이 비탈이어도 건물은 수직으로 선다 —
    // 매스까지 같이 기울면 그림이 거짓말이 된다(2026-08-26). 회전 중심이 필지 중심이라
    // 중심의 높이는 그대로여서, 매스를 scene 에 두면 기운 땅 위 제자리에 선다.
    scene.add(slab(foot, 0, H, new THREE.MeshStandardMaterial({
      color: C.mass, roughness: 0.45, metalness: 0.1,
      transparent: !solid, opacity: solid ? 1 : 0.5,
    })));
    for (let i = 1; i < floors; i++) scene.add(thick(loop(foot, i * storey), C.massLine, { width: 1, opacity: 0.3 }));
    scene.add(thick(loop(foot, H), 0xffffff, { width: 2, opacity: 0.9, dash: solid ? undefined : [0.8, 0.5] }));
    // 바닥선 — 건물 밑둘레를 땅 높이에 그린다(2026-08-27). 검산으로는 바닥이 대지 안인데
    // 낮은 카메라에선 뒤에 선 높은 매스가 앞쪽 경계선을 가로질러 보여 「대지를 벗어났다」로
    // 읽혔다(실사용 보고). 경계선과 같은 평면에 밑둘레가 있어야 눈이 같은 자로 잰다.
    scene.add(thick(loop(foot, 0.12), 0xffffff, { width: 1.6, opacity: 0.85, top: false }));

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
      land.add(thick([p1, p2], col, { width: 2.4, dash: DASH, top: true }));
      [p1, p2].forEach((p) => land.add(thick(
        [p.clone().setY(0), p.clone().setY(3)], col, { width: 2, dash: [0.5, 0.35], top: true },
      )));
      labs.push({
        text: `${r.w}m`, kind: r.front ? "front" : "road", dy: -12,
        at: new THREE.Vector3((p1.x + p2.x) / 2, 3.4, (p1.z + p2.z) / 2),
      });
    });

    // 건물 높이 — 앞쪽 모서리 바깥에 세로 치수선. 대장 실측이 있을 때만 긋는다.
    const corner = foot.reduce((a, p) => (p.z > a.z ? p : a), foot[0]);
    const off = { x: corner.x + (corner.x - c.x) * 0.3 + 2, z: corner.z + (corner.z - c.z) * 0.3 + 2 };
    const V = (y: number) => new THREE.Vector3(off.x, y, off.z);
    if (data.height != null) {
      scene.add(thick([V(0), V(H)], C.massLine, { width: 2.4, dash: DASH, top: true }));
      scene.add(thick([new THREE.Vector3(corner.x, 0, corner.z), V(0)], C.massLine, { width: 1.6, dash: [0.5, 0.35], top: true }));
      scene.add(thick([new THREE.Vector3(corner.x, H, corner.z), V(H)], C.massLine, { width: 1.6, dash: [0.5, 0.35], top: true }));
      labs.push({ text: `${H.toFixed(1)}m`, kind: "mass", at: V(H / 2), dx: 30 });
    }

    // 대지 변 길이 치수는 그리지 않는다(2026-08-27 제거).
    // 치수선을 변의 법선으로 밀어내도 필지 모양·카메라 각에 따라 건물과 겹쳐 보이는 각이 남았다.
    // 이 그림의 핵심은 **도로**(어느 쪽에 몇 m 도로가 붙었나)이고 그건 잘 선다 —
    // 헷갈리게 하는 보조 정보는 없는 편이 낫다. eLen 은 카메라 거리 계산에만 남긴다.
    let eLen = 0;
    parcel.forEach((p, i) => {
      const q = parcel[(i + 1) % parcel.length];
      eLen = Math.max(eLen, Math.hypot(q.x - p.x, q.z - p.z));
    });

    // ── 카메라 — 고정. 끌면 돈다 ───────────────────────────
    const widest = drawn.reduce((a, r) => Math.max(a, r.w), 0);
    // 전면도로 쪽에서 45° 비껴본 조감. 정면으로 서면 도로가 카메라 뒤로 빠져 폭이 안 보이고,
    // 도로와 나란히 서면 건물이 옆으로 눕는다. 그 사이가 조감도다.
    const fr = drawn.find((r) => r.front) ?? drawn[0];

    /* 지세 — 대장엔 낱말(평지·완경사·급경사)뿐이고 실제 고저 데이터가 없다.
       낱말마다 대표 각도를 정해 편다. **추정이고**, 그래서 화면에 「추정」이라 적는다.
       기우는 방향은 전면도로에서 필지 안쪽으로 올라가는 쪽으로 잡는다 —
       길이 낮고 안쪽이 높은 게 흔한 모양이라 그렇지, 이 필지가 그렇다는 근거는 없다.
       고지·저지는 경사가 아니라 주변 대비 높낮이라 기울이지 않는다. */
    const TILT: Record<string, number> = { 완경사: 4, 급경사: 12 };
    const tilt = ((TILT[String(data.slope ?? "")] ?? 0) * Math.PI) / 180;
    if (tilt && fr) {
      const ux = c.x - fr.near.x, uz = c.z - fr.near.z;
      const L = Math.hypot(ux, uz) || 1;
      // 회전축 = 경사 방향과 수직인 수평축. 이 축으로 돌리면 경사 방향이 들린다.
      pivot.rotateOnAxis(new THREE.Vector3(uz / L, 0, -ux / L).normalize(), tilt);
      pivot.updateMatrixWorld(true);
    }
    let az = (fr ? Math.atan2(fr.near.z - c.z, fr.near.x - c.x) : 0.68) + 0.8;
    let elev = 0.60;
    let dist = Math.max(92, H * 3.3, eLen * 4.2, widest * 2.4);

    // 치수 라벨의 좌표는 land 안(기울기 전) 값이라, 기운 뒤 화면 어디인지는 월드로 옮겨야 안다
    const project = (v: THREE.Vector3, w: number, h: number, dx = 0, dy = 0, tilted = true) => {
      const p = (tilted ? land.localToWorld(v.clone()) : v.clone()).project(cam);
      return {
        sx: Math.min(w - 40, Math.max(40, (p.x * 0.5 + 0.5) * w + dx)),
        sy: Math.min(h - 16, Math.max(16, (-p.y * 0.5 + 0.5) * h + dy)),
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
        H * 0.34 + dist * Math.sin(elev),
        c.z + Math.sin(az) * dist * Math.cos(elev),
      );
      cam.lookAt(c.x, H * 0.34, c.z);
      renderer.render(scene, cam);

      // 겹치는 치수는 아래로 밀어 떼어 놓는다 — 겹친 숫자는 둘 다 못 읽는다
      const placed = labs.map((L) => ({ ...L, ...project(L.at, w, h, L.dx, L.dy, L.kind !== "mass") }))
        .sort((a, b) => a.sy - b.sy);
      // 실제로 겹칠 때만 떼어낸다. 넉넉하게 잡으면 멀쩡한 라벨까지 한 줄로 쌓여
      // 자기 치수선에서 떨어져 나간다(실측: 9m·4m·21.6m가 한 열로 모였다).
      for (let i = 1; i < placed.length; i++)
        for (let j = 0; j < i; j++)
          if (Math.abs(placed[i].sx - placed[j].sx) < 46 && placed[i].sy - placed[j].sy < 22)
            placed[i].sy = Math.min(h - 16, placed[j].sy + 22);
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
      {/* 정보 판(용도지역·면적·건폐/용적)은 뺐다(2026-08-27) — 같은 탭의 건물정보·토지정보
          카드에 다 있는 값이라 두 번 적는 꼴이었다. 이 그림이 할 말은 도로와 덩어리뿐이다. */}
      {/* 치수 — 3D 위치를 화면 좌표로 옮겨 붙인다(글자는 또렷하게) */}
      {labels.map((L, i) => L.on && (
        <div key={i} className={`ps3-dim ${L.kind}`} style={{ left: L.sx, top: L.sy }}>{L.text}</div>
      ))}
      <div className="ps3-hint">끌어서 회전 · 휠로 확대</div>
    </div>
  );
}
