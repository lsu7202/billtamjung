import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ParcelScene, type SceneData } from "./ParcelScene";

/** 입체 지적도(3D) — 필지·접도·용적을 실제 모델로 세운다.
 *
 *  등각 SVG로 그리던 것을 three.js로 옮겼다. 이유는 두 가지다.
 *  하나, 도로 폭·건물 높이·대지 크기가 **하나의 축척(m)** 안에서 자동으로 맞는다.
 *  둘, 치수를 화면 구석 목록으로 빼지 않고 대상 옆에 점선 치수선으로 붙일 수 있다.
 *
 *  담는 값은 전부 사실이다 — 필지 폴리곤·접도 폭(도로명주소 실측)·층수·용적률·법정 용적률.
 *  건물 바닥은 대지를 건폐율만큼 줄인 도형이다(건축면적 = 대지면적 × 건폐율).
 */

type LngLat = [number, number];
type Geo = { type: string; coordinates: any };

const STOREY = 3.5;          // 층고(m) — 대장에 높이가 없어 층수로 되돌린다
const R_KEEP = 120;           // 필지 중심에서 이 반경(m)까지의 도로만 그린다

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

/** 폴리곤/폴리라인을 눕혀 세운다 — ExtrudeGeometry는 XY 평면에 만드니 X축으로 90° 눕힌다. */
function slab(pts: V2[], y0: number, h: number, mat: THREE.Material) {
  const g = new THREE.ExtrudeGeometry(shapeOf(pts), { depth: h, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  g.translate(0, y0 + h, 0);
  return new THREE.Mesh(g, mat);
}

/** 폴리라인을 폭 w의 띠로 — 도로를 실제 폭 그대로 눕힌다.
 *  면은 어둡게 깔고 **양쪽 경계선**으로 폭을 읽게 한다. 넓은 도로를 밝은 면으로 칠하면
 *  35m 대로가 화면을 덩어리로 덮어버려 주인공인 건물이 죽는다(실측). */
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

function dashed(points: THREE.Vector3[], color: number, dash = 0.9, gap = 0.6) {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  const l = new THREE.Line(g, new THREE.LineDashedMaterial({
    color, dashSize: dash, gapSize: gap, transparent: true, opacity: 0.9, depthTest: false,
  }));
  l.computeLineDistances();
  l.renderOrder = 5;
  return l;
}

function outline(pts: V2[], y: number, color: number, opacity = 1) {
  const p = pts.map((q) => new THREE.Vector3(q.x, y, q.z));
  p.push(p[0].clone());
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(p),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

type Label = { text: string; sub?: string; at: THREE.Vector3; kind: "road" | "size" | "far" };

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
    renderer.setClearColor(0x0b1220, 1);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block;border-radius:inherit";

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b1220, 55, 135);
    const cam = new THREE.PerspectiveCamera(34, 1, 0.5, 600);

    scene.add(new THREE.AmbientLight(0xa9c0e6, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(-38, 60, 34);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fa4e8, 0.75);
    rim.position.set(46, 22, -42);
    scene.add(rim);

    // ── 지면 ──────────────────────────────────────────────
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(140, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x0e1727 }),
    );
    ground.position.set(c.x, -0.05, c.z);
    scene.add(ground);
    const grid = new THREE.GridHelper(120, 24, 0x1a2740, 0x141f34);   // 5m 눈금
    grid.position.set(c.x, 0, c.z);
    scene.add(grid);

    // ── 접한 도로 ─────────────────────────────────────────
    // DoubleSide 필수 — 띠를 위에서 내려다보는데 감김 방향에 따라 뒷면이 되면 통째로 사라진다
    const roadMat = new THREE.MeshBasicMaterial({ color: 0x22314c, side: THREE.DoubleSide });
    const frontMat = new THREE.MeshBasicMaterial({ color: 0x3d3722, side: THREE.DoubleSide });
    type RoadDraw = { rn: string; w: number; near: V2; dir: V2; front: boolean };
    const drawn: RoadDraw[] = [];

    data.roads.forEach((r) => {
      ringsOf(r.geojson).forEach((ln) => {
        const pts = ln.map(toM).filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < R_KEEP);
        if (pts.length < 2) return;
        const front = r.rn === data.frontRn;
        const { mesh, edges } = ribbon(pts, r.road_bt, front ? 0.06 : 0.04, front ? frontMat : roadMat);
        scene.add(mesh);
        edges.forEach((e) => scene.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(e),
          new THREE.LineBasicMaterial({
            color: front ? 0xe7c876 : 0x5b7099,
            transparent: true, opacity: front ? 0.8 : 0.45,
          }),
        )));
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
    const plate = slab(parcel, -0.35, 0.35, new THREE.MeshStandardMaterial({
      color: 0x1b2941, roughness: 0.95, metalness: 0,
    }));
    scene.add(plate);
    scene.add(outline(parcel, 0.02, 0x9fc0f0, 0.95));

    // ── 건물 매스 ─────────────────────────────────────────
    const far = data.far ?? 0, legal = data.legalFar ?? 0, bcr = data.bcr ?? 0;
    const floors = data.floorsAbove ?? (bcr > 0 && far > 0 ? Math.max(1, Math.round(far / bcr)) : 3);
    const H = floors * STOREY;
    const foot = shrink(parcel, bcr > 0 ? Math.sqrt(Math.min(bcr, 100) / 100) : 0.9, c);

    const mass = slab(foot, 0, H, new THREE.MeshStandardMaterial({
      color: 0x3f6bb8, roughness: 0.42, metalness: 0.12,
    }));
    scene.add(mass);
    // 층선 — 층수가 눈으로 세어진다
    for (let i = 1; i < floors; i++) scene.add(outline(foot, i * STOREY, 0x8fb6ee, 0.28));
    scene.add(outline(foot, H, 0xffffff, 0.9));

    // ── 법정 용적까지 남은 여유 ────────────────────────────
    const HL = far > 0 && legal > far ? H * (legal / far) : H;
    if (HL > H + 0.5) {
      scene.add(slab(foot, H, HL - H, new THREE.MeshStandardMaterial({
        color: 0x8fb6ee, transparent: true, opacity: 0.13, roughness: 1,
        side: THREE.DoubleSide, depthWrite: false,
      })));
      scene.add(outline(foot, HL, 0x8fb6ee, 0.75));
    }

    // ── 치수선 — 값을 대상 옆에 붙인다 ──────────────────────
    const labs: Label[] = [];
    const GOLD = 0xe7c876, BLUE = 0x9fc0f0;

    drawn.sort((a, b) => b.w - a.w).slice(0, 3).forEach((r) => {
      // 도로 진행방향의 법선으로 폭을 가로지르는 점선 + 양끝 눈금
      const nx = -r.dir.z, nz = r.dir.x;
      const y = 0.5;
      const p1 = new THREE.Vector3(r.near.x - nx * r.w / 2, y, r.near.z - nz * r.w / 2);
      const p2 = new THREE.Vector3(r.near.x + nx * r.w / 2, y, r.near.z + nz * r.w / 2);
      const col = r.front ? GOLD : BLUE;
      scene.add(dashed([p1, p2], col, 1.1, 0.7));
      [p1, p2].forEach((p) => scene.add(dashed([
        p.clone().setY(0), p.clone().setY(2.6),
      ], col, 0.5, 0.35)));
      labs.push({
        text: `${r.w}m`, sub: r.rn, kind: "road",
        at: new THREE.Vector3((p1.x + p2.x) / 2, 2.9, (p1.z + p2.z) / 2),
      });
    });

    // 건물 높이 — 앞쪽 모서리에 세로 치수선
    const corner = foot.reduce((a, p) => (p.z > a.z ? p : a), foot[0]);
    const off = { x: corner.x + (corner.x - c.x) * 0.22 + 1.5, z: corner.z + (corner.z - c.z) * 0.22 + 1.5 };
    scene.add(dashed([new THREE.Vector3(off.x, 0, off.z), new THREE.Vector3(off.x, H, off.z)], BLUE));
    scene.add(dashed([new THREE.Vector3(corner.x, 0, corner.z), new THREE.Vector3(off.x, 0, off.z)], BLUE, 0.5, 0.35));
    scene.add(dashed([new THREE.Vector3(corner.x, H, corner.z), new THREE.Vector3(off.x, H, off.z)], BLUE, 0.5, 0.35));
    labs.push({
      text: `${H.toFixed(0)}m`, sub: `지상 ${floors}층`, kind: "size",
      at: new THREE.Vector3(off.x, H / 2, off.z),
    });

    if (HL > H + 0.5) {
      scene.add(dashed([new THREE.Vector3(off.x, H, off.z), new THREE.Vector3(off.x, HL, off.z)], GOLD));
      scene.add(dashed([new THREE.Vector3(corner.x, HL, corner.z), new THREE.Vector3(off.x, HL, off.z)], GOLD, 0.5, 0.35));
      labs.push({
        text: `+${(HL - H).toFixed(0)}m`, sub: `법정 여유 ${(legal - far).toFixed(0)}%p`, kind: "far",
        at: new THREE.Vector3(off.x, (H + HL) / 2, off.z),
      });
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
      scene.add(dashed([
        new THREE.Vector3(p.x + ox, 0.2, p.z + oz), new THREE.Vector3(q.x + ox, 0.2, q.z + oz),
      ], BLUE, 0.8, 0.5));
      labs.push({
        text: `${eLen.toFixed(1)}m`, sub: "대지", kind: "size",
        at: new THREE.Vector3(mx + ox, 0.6, mz + oz),
      });
    }

    // ── 카메라 · 렌더 루프 ─────────────────────────────────
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches || !animate;
    // 매스 전체 + 접한 도로가 여백을 두고 들어오는 거리
    const widest = drawn.reduce((a, r) => Math.max(a, r.w), 0);
    const dist = Math.max(74, HL * 2.7, eLen * 3.4, widest * 2.1);
    let t = reduce ? 1 : 0;
    // 안착 시점 — 전면도로 쪽에서 45° 비껴본다. 정면으로 서면 도로가 카메라 뒤로 빠져
    // 폭이 안 보이고, 도로와 나란히 서면 건물이 옆으로 눕는다. 그 사이가 조감도다.
    const fr = drawn.find((r) => r.front) ?? drawn[0];
    const A1 = (fr ? Math.atan2(fr.near.z - c.z, fr.near.x - c.x) : 0.68) + 0.8;
    const A0 = A1 - 1.15;                 // 한 바퀴 돌지 않고 옆에서 돌아 들어온다
    const start = performance.now();
    let raf = 0, alive = true;

    // 라벨은 화면 밖으로 새지 않게 가둔다 — 잘린 치수는 없느니만 못하다
    const project = (v: THREE.Vector3, w: number, h: number) => {
      const p = v.clone().project(cam);
      return {
        sx: Math.min(w - 56, Math.max(56, (p.x * 0.5 + 0.5) * w)),
        sy: Math.min(h - 20, Math.max(20, (-p.y * 0.5 + 0.5) * h)),
        on: p.z < 1,
      };
    };

    const frame = () => {
      if (!alive) return;
      const w = el.clientWidth, h = el.clientHeight;
      if (w && h && (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()))) {
        renderer.setSize(w, h, false);
        cam.aspect = w / h; cam.updateProjectionMatrix();
      }
      if (!reduce) {
        const e = Math.min(1, (performance.now() - start) / 2600);
        t = 1 - Math.pow(1 - e, 3);                       // 진입 — 한 바퀴 돌며 안착
      }
      const az = A0 + (A1 - A0) * t + (reduce ? 0 : (performance.now() - start) / 1000 * 0.012);
      const el0 = 0.46 + 0.32 * t;                        // 낮은 눈높이에서 부감으로
      cam.position.set(
        c.x + Math.cos(az) * dist * Math.cos(el0),
        (HL || H) * 0.62 + dist * Math.sin(el0),
        c.z + Math.sin(az) * dist * Math.cos(el0),
      );
      cam.lookAt(c.x, HL * 0.42, c.z);
      renderer.render(scene, cam);

      // 겹치는 치수는 아래로 밀어 떼어 놓는다 — 겹친 숫자는 둘 다 못 읽는다
      const placed = labs.map((L) => ({ ...L, ...project(L.at, w, h) }))
        .sort((a, b) => a.sy - b.sy);
      for (let i = 1; i < placed.length; i++) {
        for (let j = 0; j < i; j++) {
          if (Math.abs(placed[i].sx - placed[j].sx) < 150 && placed[i].sy - placed[j].sy < 30) {
            placed[i].sy = Math.min(h - 20, placed[j].sy + 30);
          }
        }
      }
      setLabels(placed);
      raf = requestAnimationFrame(frame);
    };
    frame();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      scene.traverse((o: any) => {
        o.geometry?.dispose?.();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m?.dispose?.());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [data, animate]);

  if (!ringsOf(data.parcel).length) return <div className="ps-empty">필지 도형이 없어 그릴 수 없습니다</div>;
  // WebGL이 막힌 환경(원격데스크톱·구형 GPU)에서도 자료는 나와야 한다 — 등각 SVG로 떨어진다
  if (failed) return <ParcelScene data={data} w={900} h={760} />;

  return (
    <div className="ps3" ref={host}>
      {/* 좌상단 — 무엇을 보고 있는지 */}
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
        <div key={i} className={`ps3-dim ${L.kind}`} style={{ left: L.sx, top: L.sy }}>
          {L.sub && <span className="s">{L.sub}</span>}
          <b>{L.text}</b>
        </div>
      ))}
    </div>
  );
}
