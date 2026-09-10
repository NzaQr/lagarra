import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { PrizeDefinition } from "../game-core/types";
import { plushTexture } from "./materials";

// All models share unit geometries. Their decorative parts sit close to the
// compound collider envelope, so a claw can touch what the player can see.
const sphere = new THREE.SphereGeometry(1, 20, 14);
const detailSphere = new THREE.SphereGeometry(1, 12, 8);
const cone = new THREE.ConeGeometry(1, 1, 12);
const ring = new THREE.TorusGeometry(1, 0.05, 8, 32);
const capsuleTop = new THREE.SphereGeometry(
  1,
  20,
  10,
  0,
  Math.PI * 2,
  0,
  Math.PI / 2,
);
const capsuleBottom = new THREE.SphereGeometry(
  1,
  20,
  10,
  0,
  Math.PI * 2,
  Math.PI / 2,
  Math.PI / 2,
);
// One continuous padded star, with no overlapping lobes or internal seams.
const starGeometry = new THREE.SphereGeometry(1, 40, 20);
const starPositions = starGeometry.getAttribute("position");
for (let i = 0; i < starPositions.count; i++) {
  const x = starPositions.getX(i);
  const y = starPositions.getY(i);
  const radius = 0.76 + 0.24 * Math.cos(5 * Math.atan2(x, y));
  starPositions.setXYZ(i, x * radius, y * radius, starPositions.getZ(i) * 0.43);
}
starGeometry.computeVertexNormals();
const plushGrain = plushTexture();
const dark = new THREE.MeshStandardMaterial({
  color: "#222b30",
  roughness: 0.3,
});
const cream = new THREE.MeshStandardMaterial({
  color: "#fff2d8",
  roughness: 0.82,
  bumpMap: plushGrain,
  bumpScale: 0.003,
});
// Parts bake their palette into vertex colors below. Shared materials keep
// each prize at one draw call while preserving plush and molded finishes.
const renderMaterials: Record<
  PrizeDefinition["material"],
  THREE.MeshStandardMaterial
> = {
  plush: new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.92,
    bumpMap: plushGrain,
    bumpScale: 0.0024,
    vertexColors: true,
  }),
  rubber: new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.64,
    metalness: 0.035,
    vertexColors: true,
  }),
  plastic: new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.22,
    metalness: 0.035,
    vertexColors: true,
  }),
};
const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function material(color: string, plush: boolean, glossy = false) {
  const key = `${color}-${plush}-${glossy}`;
  if (!materialCache.has(key))
    materialCache.set(
      key,
      new THREE.MeshStandardMaterial({
        color,
        roughness: plush ? 0.92 : glossy ? 0.22 : 0.64,
        metalness: plush ? 0 : 0.035,
        bumpMap: plush ? plushGrain : null,
        bumpScale: plush ? 0.0024 : 0,
        vertexColors: true,
      }),
    );
  return materialCache.get(key)!;
}
export function createPrize(def: PrizeDefinition): THREE.Group {
  const g = new THREE.Group();
  // Render-only palette: physical definitions and saved prize poses stay intact.
  const palette: Partial<Record<PrizeDefinition["model"], [string, string]>> = {
    bear: ["#b98450", "#ecd0a4"],
    bunny: ["#fff8ee", "#e8b8be"],
    cat: ["#fff0d6", "#dca658"],
    frog: ["#a2c76a", "#e0e9af"],
    penguin: ["#555568", "#edbd70"],
    bird: ["#f0d17a", "#e5b755"],
    mushroom: ["#dc8fa8", "#fff5e7"],
    capsule: ["#91bfce", "#fff8ec"],
    star: ["#f5d777", "#e6a08a"],
    seal: ["#dce7e6", "#eff4ee"],
  };
  const colors = palette[def.model];
  const body = material(
    colors?.[0] ?? def.color,
    def.material === "plush",
    def.material === "plastic",
  );
  const accent = material(
    colors?.[1] ?? def.accent,
    def.material === "plush",
    def.material === "plastic",
  );
  const blush = material("#df9b9b", true);
  const part = (
    m: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy = sx,
    sz = sx,
    geometry: THREE.BufferGeometry = sphere,
  ) => {
    const mesh = new THREE.Mesh(
      geometry === sphere && Math.max(sx, sy, sz) < 0.4
        ? detailSphere
        : geometry,
      m,
    );
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const face = (y = 0.12, z = 0.78, separation = 0.25) => {
    part(dark, -separation, y, z, 0.077, 0.085, 0.045);
    part(dark, separation, y, z, 0.077, 0.085, 0.045);
    // Tiny catchlights share the cream batch used by each toy's muzzle.
    for (const x of [-separation, separation])
      part(cream, x - 0.014, y + 0.025, z + 0.03, 0.016, 0.019, 0.009);
  };
  // A colored fabric panel follows its host ellipsoid. It has no raised rim
  // or separate cushion silhouette, and is baked into the same material batch.
  const panel = (
    m: THREE.Material,
    center: [number, number, number],
    radii: [number, number, number],
    u: number,
    v: number,
    width: number,
    height: number,
  ) => {
    const geometry = new THREE.CircleGeometry(1, 24);
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const x = u + positions.getX(i) * width;
      const y = v + positions.getY(i) * height;
      const z = Math.sqrt(Math.max(0.001, 1 - x * x - y * y));
      positions.setXYZ(
        i,
        center[0] + x * radii[0] * 1.008,
        center[1] + y * radii[1] * 1.008,
        center[2] + z * radii[2] * 1.008,
      );
    }
    geometry.computeVertexNormals();
    part(m, 0, 0, 0, 1, 1, 1, geometry);
  };
  const smile = (y: number, z: number, width = 0.12, depth = 0) => {
    for (let i = 0; i < 5; i++) {
      const x = ((i - 2) * width) / 2;
      part(
        dark,
        x,
        y + (x / width) ** 2 * 0.05,
        z - (x / width) ** 2 * depth,
        width * 0.34,
        0.014,
        0.016,
      ).rotation.z = (x / width) * 0.55;
    }
  };
  switch (def.model) {
    case "bear":
      part(body, 0, -0.4, 0, 0.57, 0.53, 0.48);
      panel(accent, [0, -0.4, 0], [0.57, 0.53, 0.48], 0, -0.04, 0.57, 0.65);
      part(body, 0, 0.27, 0, 0.72, 0.64, 0.62);
      part(body, -0.53, 0.74, 0, 0.25, 0.27, 0.2);
      part(body, 0.53, 0.74, 0, 0.25, 0.27, 0.2);
      part(accent, -0.53, 0.76, 0.17, 0.145, 0.16, 0.055);
      part(accent, 0.53, 0.76, 0.17, 0.145, 0.16, 0.055);
      part(cream, 0, 0.05, 0.58, 0.28, 0.21, 0.12);
      part(dark, 0, 0.13, 0.71, 0.075, 0.055, 0.04);
      part(body, -0.59, -0.3, 0.05, 0.22, 0.32, 0.23).rotation.z = -0.4;
      part(body, 0.59, -0.3, 0.05, 0.22, 0.32, 0.23).rotation.z = 0.4;
      part(body, -0.38, -0.71, 0.25, 0.27, 0.24, 0.29);
      part(body, 0.38, -0.71, 0.25, 0.27, 0.24, 0.29);
      part(accent, -0.38, -0.71, 0.51, 0.16, 0.15, 0.05);
      part(accent, 0.38, -0.71, 0.51, 0.16, 0.15, 0.05);
      part(dark, 0, 0.045, 0.703, 0.016, 0.06, 0.016);
      smile(-0.025, 0.694, 0.09);
      face(0.31, 0.592, 0.25);
      // The bow uses the existing accent batch.
      part(blush, -0.12, -0.24, 0.47, 0.13, 0.09, 0.06).rotation.z = -0.3;
      part(blush, 0.12, -0.24, 0.47, 0.13, 0.09, 0.06).rotation.z = 0.3;
      part(blush, 0, -0.24, 0.51, 0.065);
      break;
    case "bunny":
      part(body, 0, -0.46, 0, 0.49, 0.45, 0.45);
      panel(cream, [0, -0.46, 0], [0.49, 0.45, 0.45], 0, 0, 0.61, 0.67);
      part(body, 0, 0.12, 0, 0.68, 0.59, 0.61);
      part(body, -0.3, 0.85, 0, 0.19, 0.56, 0.2).rotation.z = 0.12;
      part(body, 0.3, 0.85, 0, 0.19, 0.56, 0.2).rotation.z = -0.12;
      part(accent, -0.31, 0.9, 0.17, 0.1, 0.39, 0.04).rotation.z = 0.12;
      part(accent, 0.31, 0.9, 0.17, 0.1, 0.39, 0.04).rotation.z = -0.12;
      face(0.15, 0.578, 0.24);
      part(accent, 0, 0.01, 0.619, 0.06, 0.045, 0.035);
      smile(-0.08, 0.59, 0.07);
      for (const x of [-1, 1]) {
        part(accent, x * 0.39, -0.01, 0.49, 0.1, 0.06, 0.03);
        part(body, x * 0.47, -0.41, 0.1, 0.18, 0.27, 0.2);
        part(body, x * 0.32, -0.77, 0.25, 0.24, 0.17, 0.28);
      }
      break;
    case "cat":
      part(body, 0, -0.43, 0, 0.56, 0.46, 0.48);
      part(body, 0, 0.23, 0, 0.75, 0.6, 0.63);
      part(accent, -0.49, 0.7, 0, 0.31, 0.48, 0.28, cone);
      part(accent, 0.49, 0.7, 0, 0.31, 0.48, 0.28, cone);
      part(cream, -0.49, 0.73, 0.19, 0.17, 0.28, 0.065, cone);
      part(cream, 0.49, 0.73, 0.19, 0.17, 0.28, 0.065, cone);
      panel(accent, [0, 0.23, 0], [0.75, 0.6, 0.63], 0.43, 0.48, 0.34, 0.37);
      // The tail sits behind the body and makes a sideways cat recognizable.
      part(accent, 0.49, -0.42, -0.3, 0.19, 0.38, 0.18).rotation.z = -0.55;
      for (const x of [-0.32, 0.32])
        part(body, x, -0.75, 0.24, 0.25, 0.18, 0.27);
      part(cream, 0, 0.015, 0.57, 0.29, 0.17, 0.085);
      face(0.23, 0.606);
      part(dark, 0, 0.08, 0.66, 0.055, 0.04, 0.03);
      smile(-0.035, 0.646, 0.1);
      for (const x of [-0.48, 0.48])
        for (const y of [0.015, -0.065])
          part(dark, x, y, 0.455, 0.1, 0.012, 0.018).rotation.y =
            Math.sign(x) * 0.65;
      break;
    case "frog":
      part(body, 0, -0.44, 0, 0.6, 0.42, 0.48);
      part(body, 0, 0.13, 0, 0.75, 0.46, 0.61);
      part(body, -0.45, 0.5, 0.12, 0.28);
      part(body, 0.45, 0.5, 0.12, 0.28);
      part(cream, -0.45, 0.53, 0.355, 0.18, 0.19, 0.07);
      part(cream, 0.45, 0.53, 0.355, 0.18, 0.19, 0.07);
      face(0.53, 0.423, 0.45);
      panel(accent, [0, -0.44, 0], [0.6, 0.42, 0.48], 0, 0, 0.67, 0.69);
      smile(0.015, 0.597, 0.25, 0.022);
      part(body, -0.61, -0.35, 0.12, 0.19, 0.27, 0.23);
      part(body, 0.61, -0.35, 0.12, 0.19, 0.27, 0.23);
      for (const x of [-0.58, 0.58])
        part(blush, x * 0.78, -0.04, 0.448, 0.1, 0.055, 0.025);
      part(body, -0.43, -0.72, 0.27, 0.24, 0.15, 0.25);
      part(body, 0.43, -0.72, 0.27, 0.24, 0.15, 0.25);
      break;
    case "penguin":
      part(body, 0, 0, 0, 0.72, 1, 0.72);
      panel(cream, [0, 0, 0], [0.72, 1, 0.72], 0, -0.23, 0.65, 0.62);
      for (const x of [-0.25, 0.25])
        panel(cream, [0, 0, 0], [0.72, 1, 0.72], x / 0.72, 0.33, 0.3, 0.27);
      face(0.38, 0.619);
      part(accent, 0, 0.2, 0.705, 0.12, 0.08, 0.12);
      part(accent, -0.34, -0.86, 0.32, 0.26, 0.11, 0.3);
      part(accent, 0.34, -0.86, 0.32, 0.26, 0.11, 0.3);
      part(body, -0.71, -0.12, 0, 0.16, 0.49, 0.3).rotation.z = -0.25;
      part(body, 0.71, -0.12, 0, 0.16, 0.49, 0.3).rotation.z = 0.25;
      break;
    case "bird":
      part(body, 0, 0, 0, 0.85, 0.85, 0.81);
      part(body, -0.76, -0.13, 0.05, 0.18, 0.29, 0.28).rotation.z = -0.3;
      part(body, 0.76, -0.13, 0.05, 0.18, 0.29, 0.28).rotation.z = 0.3;
      face(0.2, 0.755);
      part(accent, 0, 0.045, 0.805, 0.12, 0.075, 0.105);
      for (const side of [-1, 1])
        panel(
          blush,
          [0, 0, 0],
          [0.85, 0.85, 0.81],
          side * 0.48,
          0.01,
          0.13,
          0.075,
        );
      for (const side of [-1, 1]) {
        part(body, side * 0.075, 0.85, 0, 0.07, 0.19, 0.08).rotation.z =
          side * -0.4;
        part(accent, side * 0.3, -0.77, 0.24, 0.2, 0.1, 0.24);
      }
      break;
    case "mushroom":
      part(cream, 0, -0.35, 0, 0.59, 0.58, 0.52);
      part(body, 0, 0.1, 0, 1, 0.8, 0.9, capsuleTop);
      part(accent, 0, 0.1, 0, 0.99, 0.065, 0.89);
      face(-0.25, 0.494, 0.19);
      smile(-0.4, 0.521, 0.075, 0.006);
      // Place each spot on the dome and align it with the surface normal.
      for (const [x, z, size] of [
        [-0.43, 0.46, 0.18],
        [0.3, 0.15, 0.17],
        [0.4, 0.73, 0.16],
        [-0.2, 0.8, 0.16],
        [-0.72, -0.2, 0.14],
      ]) {
        const y = Math.sqrt(1 - x * x - (z / 0.9) ** 2);
        const spot = part(accent, x, 0.1 + 0.8 * y, z, size, size, 0.018);
        spot.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(x, y / 0.8, z / 0.81).normalize(),
        );
      }
      break;
    case "capsule": {
      // Two flush shells retain the original physical envelope. The narrow
      // equator reads as a molded joint instead of an oversized raised band.
      part(body, 0, 0, 0, 0.88, 1, 0.88, capsuleTop);
      part(accent, 0, 0, 0, 0.88, 1, 0.88, capsuleBottom);
      const seam = part(accent, 0, 0, 0, 0.843, 0.843, 0.18, ring);
      seam.rotation.x = Math.PI / 2;
      break;
    }
    case "star":
      part(body, 0, 0, 0, 1.08, 1.08, 1, starGeometry);
      face(0.04, 0.423, 0.19);
      smile(-0.11, 0.429, 0.07, 0.003);
      part(accent, -0.35, -0.11, 0.38, 0.085, 0.045, 0.025);
      part(accent, 0.35, -0.11, 0.38, 0.085, 0.045, 0.025);
      break;
    case "seal":
      part(body, 0, -0.05, 0, 0.76, 0.84, 0.69);
      panel(cream, [0, -0.05, 0], [0.76, 0.84, 0.69], 0, -0.07, 0.39, 0.21);
      face(0.13, 0.635, 0.29);
      part(dark, 0, -0.03, 0.701, 0.09, 0.06, 0.04);
      smile(-0.21, 0.665, 0.09);
      for (const x of [-0.39, 0.39])
        for (const offset of [-0.055, 0.055])
          part(dark, x, -0.14 + offset, 0.594, 0.09, 0.012, 0.016).rotation.y =
            Math.sign(x) * 0.48;
      part(body, -0.72, -0.45, 0.13, 0.29, 0.14, 0.26).rotation.z = -0.3;
      part(body, 0.72, -0.45, 0.13, 0.29, 0.14, 0.26).rotation.z = 0.3;
      for (const x of [-0.19, 0.19])
        part(body, x, -0.64, -0.4, 0.27, 0.12, 0.35).rotation.y =
          Math.sign(x) * 0.4;
      break;
  }
  // Bake decorative parts into one draw per material, rather than one draw
  // per ear, eye and foot. Keep rigid-body transforms on the parent group.
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const renderMaterial = renderMaterials[def.material];
  const sharedGeometries = new Set<THREE.BufferGeometry>([
    sphere,
    detailSphere,
    cone,
    ring,
    capsuleTop,
    capsuleBottom,
    starGeometry,
  ]);
  for (const child of g.children) {
    const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    mesh.updateMatrix();
    const sourceGeometry = mesh.geometry;
    const geometry = sourceGeometry.clone().applyMatrix4(mesh.matrix);
    // Baked, subtle underside shading gives each sewn form depth at no extra
    // draw cost. It moves with the toy and does not simulate floor contact.
    const positions = sourceGeometry.getAttribute("position");
    const sourceColor =
      mesh.material instanceof THREE.MeshStandardMaterial
        ? mesh.material.color
        : new THREE.Color("#ffffff");
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const lower = Math.max(0, -positions.getY(i));
      const shade = 1 - lower * 0.2;
      colors[i * 3] = sourceColor.r * shade;
      colors[i * 3 + 1] = sourceColor.g * shade * (1 - lower * 0.018);
      colors[i * 3 + 2] = sourceColor.b * shade * (1 - lower * 0.035);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const batch = batches.get(renderMaterial) ?? [];
    batch.push(geometry);
    batches.set(renderMaterial, batch);
    if (!sharedGeometries.has(sourceGeometry)) sourceGeometry.dispose();
  }
  g.clear();
  for (const [mat, geometries] of batches) {
    const merged = mergeGeometries(geometries);
    geometries.forEach((geometry) => geometry.dispose());
    if (merged) {
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
  }
  g.scale.setScalar(def.radius);
  return g;
}
