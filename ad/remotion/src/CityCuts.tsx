import React, { useLayoutEffect, useMemo } from "react";
import { ThreeCanvas } from "@remotion/three";
import { useCurrentFrame, interpolate, Easing } from "remotion";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { C, rng } from "./brand";
import { BEAT } from "./timing";

/* ══ B버전: 하드 컷 6샷 — 속도감 우선(샷마다 다른 앵글·큰 이동·즉각 텍스트) ══ */

const HERO = { x: 2.3, z: -5.2, w: 2.6, d: 2.3, h: 7.8 };

type Bld = { x: number; z: number; w: number; d: number; h: number };
const CITY: Bld[] = (() => {
  const r = rng(11680);
  const out: Bld[] = [];
  for (let z = -26; z < 34; z += 2.5) {
    for (const side of [-1, 1]) {
      let x = (z > 6 ? 6.4 : 4.2) + r() * 1.6;
      while (x < 26) {
        const w = 1.2 + r() * 2.0, d = 1.2 + r() * 1.7;
        const near = Math.abs(z - HERO.z) < 4.4 && Math.abs(side * x - HERO.x) < 4.6;
        if (!near && r() > 0.14) {
          const h = z > 14 ? 1.4 + r() * 2.6 : 1.8 + Math.pow(r(), 1.55) * 10.5;
          out.push({ x: side * x, z: z + (r() - 0.5) * 1.1, w, d, h });
        }
        x += w + 0.8 + r() * 1.6;
      }
    }
  }
  return out;
})();

const buildGeo = () => {
  const r = rng(4040);
  const pos: number[] = [], base: number[] = [], seed: number[] = [], bx: number[] = [], hero: number[] = [], yn: number[] = [];
  const addBuilding = (b: Bld, isHero: boolean) => {
    const rows = Math.max(3, Math.floor(b.h / (isHero ? 0.42 : 0.62)));
    for (let row = 0; row < rows; row++) {
      const y = 0.5 + (row / rows) * (b.h - 0.7);
      const faces: [number, (t: number, off: number) => [number, number]][] = [
        [Math.max(2, Math.floor(b.w / (isHero ? 0.38 : 0.55))), (t, off) => [b.x - b.w / 2 + t * b.w, b.z + off * b.d / 2]],
        [Math.max(2, Math.floor(b.d / (isHero ? 0.38 : 0.55))), (t, off) => [b.x + off * b.w / 2, b.z - b.d / 2 + t * b.d]],
      ];
      for (const [n, fpos] of faces) for (const off of [-1, 1]) for (let c = 0; c < n; c++) {
        const [px, pz] = fpos((c + 0.5) / n, off);
        pos.push(px, y, pz);
        const lit = isHero || r() < 0.3;
        base.push(isHero ? 1 : lit ? 0.55 + r() * 0.65 : 0.1 + r() * 0.1);
        seed.push(r() * 100);
        bx.push(b.x);
        hero.push(isHero ? 1 : 0);
        yn.push(y / b.h);
      }
    }
  };
  CITY.forEach((b) => addBuilding(b, false));
  addBuilding(HERO as Bld, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aBase", new THREE.Float32BufferAttribute(base, 1));
  g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
  g.setAttribute("aBx", new THREE.Float32BufferAttribute(bx, 1));
  g.setAttribute("aHero", new THREE.Float32BufferAttribute(hero, 1));
  g.setAttribute("aYn", new THREE.Float32BufferAttribute(yn, 1));
  return g;
};

const VERT = `
uniform float uF, uBeamX, uDimT, uLitT, uPulse, uAlphaMul;
attribute float aBase, aSeed, aBx, aHero, aYn;
varying float vB; varying float vHero;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float flick = 0.78 + 0.22 * sin(uF * 0.055 + aSeed * 7.0);
  float b = aBase * flick;
  float beam = exp(-pow((aBx - uBeamX) * 0.7, 2.0)) * 1.8;
  float passed = step(aBx, uBeamX);
  float dim = mix(1.0, 0.06, uDimT * passed);
  float ign = smoothstep(aYn - 0.10, aYn + 0.02, uLitT);
  float heroB = mix(0.12, 1.45 + 0.4 * uPulse, ign);
  b = mix((b + beam * 0.9) * dim, heroB, aHero);
  float fog = exp(0.028 * mv.z);
  vB = b * fog * uAlphaMul;
  vHero = aHero;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(mix(230.0, 330.0, aHero) / -mv.z, 27.0);
}`;

const FRAG = `
precision mediump float;
varying float vB; varying float vHero;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float a = smoothstep(0.5, 0.16, d) * vB;
  vec3 warm = vec3(0.86, 0.80, 0.66);
  vec3 gold = vec3(0.94, 0.80, 0.45);
  vec3 col = mix(warm, gold, clamp(vHero * 0.9 + vB * 0.25, 0.0, 1.0));
  gl_FragColor = vec4(col * (0.3 + min(vB, 1.4)), a);
}`;

/* 새틴 질감 텍스트 텍스처(A버전과 동일 질감) */
const textTexCache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();
const makeTextTex = (text: string) => {
  if (textTexCache.has(text)) return textTexCache.get(text)!;
  const cv = document.createElement("canvas");
  const g = cv.getContext("2d")!;
  const font = "750 150px Pretendard, 'Apple SD Gothic Neo', sans-serif";
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 240;
  cv.width = w; cv.height = 340;
  const g2 = cv.getContext("2d")!;
  g2.font = font; g2.textAlign = "center"; g2.textBaseline = "middle";
  g2.shadowColor = "rgba(0,0,0,0.55)"; g2.shadowBlur = 2; g2.shadowOffsetY = 3;
  g2.fillStyle = "#1A1714";
  g2.fillText(text, w / 2, 172);
  g2.shadowColor = "transparent"; g2.shadowBlur = 0; g2.shadowOffsetY = 0;
  const grad = g2.createLinearGradient(0, 60, 0, 280);
  grad.addColorStop(0, "#FFFDF4");
  grad.addColorStop(0.42, "#F1EADA");
  grad.addColorStop(0.78, "#CFC4AC");
  grad.addColorStop(1, "#B7A88B");
  g2.fillStyle = grad;
  g2.fillText(text, w / 2, 170);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const out = { tex, aspect: w / 340 };
  textTexCache.set(text, out);
  return out;
};

/* ── 씬(각 카피 구간의 카메라) — 전환 에너지는 바깥 푸시 스와이프가 담당, 내부는 완만한 무브 ── */
type V3 = [number, number, number];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const SCENES: { range: readonly [number, number]; from: V3; to: V3; look: V3; fov?: [number, number] }[] = [
  { range: [0, 104], from: [-11, 2.6, 7], to: [-7.8, 3.2, 2.6], look: [4, 4.2, -3] },              // 측면 트래킹
  { range: [104, 206], from: [3.8, 15.5, 20.5], to: [2.8, 12.2, 15.5], look: [1.5, 2, -4] },       // 에어리얼 하강
  { range: [206, BEAT.lightOn[0]], from: [2.3, 3.2, 16.5], to: [2.3, 4.5, 10.5], look: [2.0, 3.4, -5.2], fov: [33, 38] },  // 정면 푸시+스캔
  { range: [BEAT.lightOn[0], 450], from: [2.6, 6.4, 15.5], to: [2.4, 6.1, 14.2], look: [1.9, 2.9, -5.2] },                  // 히어로 점등
];

const Scene: React.FC<{ frame: number; camFrame?: number }> = ({ frame: f, camFrame }) => {
  const cf = camFrame ?? f;
  const { camera } = useThree();
  const geo = useMemo(buildGeo, []);

  const sh = SCENES.find((x) => cf >= x.range[0] && cf < x.range[1]) ?? SCENES[SCENES.length - 1];
  const st = interpolate(cf, [sh.range[0], sh.range[1]], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.25, 0.1, 0.45, 1) });
  const cp = lerp3(sh.from, sh.to, st);
  const fov = sh.fov ? interpolate(st, [0, 1], sh.fov) : 33;
  useLayoutEffect(() => {
    camera.position.set(cp[0], cp[1], cp[2]);
    camera.lookAt(sh.look[0], sh.look[1], sh.look[2]);
    (camera as THREE.PerspectiveCamera).fov = fov;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  });

  const beamX = interpolate(f, BEAT.scan, [-21, 21], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.45, 0, 0.25, 1) });
  const dimT = interpolate(f, [BEAT.scan[0] + 10, BEAT.scan[1] + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const litT = interpolate(f, BEAT.lightOn, [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
  const pulse = f > BEAT.lightOn[1] ? 0.5 + 0.5 * Math.sin((f - BEAT.lightOn[1]) / 12) : 0;

  const mk = () => ({
    uF: { value: f }, uBeamX: { value: beamX }, uDimT: { value: dimT },
    uLitT: { value: litT }, uPulse: { value: pulse }, uAlphaMul: { value: 1 },
  });
  const u1 = useMemo(mk, []);
  const u2 = useMemo(mk, []);
  [u1, u2].forEach((u, i) => {
    u.uF.value = f; u.uBeamX.value = beamX; u.uDimT.value = dimT;
    u.uLitT.value = litT; u.uPulse.value = pulse; u.uAlphaMul.value = i === 0 ? 1 : 0.15;
  });

  return (
    <>
      <points geometry={geo} frustumCulled={false}>
        <shaderMaterial vertexShader={VERT} fragmentShader={FRAG} uniforms={u1}
          transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <points geometry={geo} scale={[1, -1, 1]} frustumCulled={false}>
        <shaderMaterial vertexShader={VERT} fragmentShader={FRAG} uniforms={u2}
          transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </>
  );
};

export const CityCuts: React.FC<{ camFrame?: number }> = ({ camFrame }) => {
  const f = useCurrentFrame();
  const riseO = interpolate(f, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const outO = interpolate(f, BEAT.cityOut, [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", inset: 0, opacity: riseO * outO }}>
      <ThreeCanvas width={1920} height={1080} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
        camera={{ fov: 33, near: 0.1, far: 160, position: [0, 2.2, 30] }} style={{ width: 1920, height: 1080 }}>
        <Scene frame={f} camFrame={camFrame} />
      </ThreeCanvas>
    </div>
  );
};
