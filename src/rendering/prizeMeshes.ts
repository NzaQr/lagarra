import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { PrizeDefinition } from "../game-core/types";

// All models share unit geometries. Their decorative parts sit close to the
// compound collider envelope, so a claw can touch what the player can see.
const sphere = new THREE.SphereGeometry(1, 20, 14);
const cone = new THREE.ConeGeometry(1, 1, 24);
const ring = new THREE.TorusGeometry(1, 0.05, 8, 32);
const dark = new THREE.MeshStandardMaterial({
  color: "#273936",
  roughness: 0.65,
});
const cream = new THREE.MeshStandardMaterial({
  color: "#fff2d8",
  roughness: 0.82,
});
const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function material(color: string, plush: boolean) {
  const key = `${color}-${plush}`;
  if (!materialCache.has(key))
    materialCache.set(
      key,
      new THREE.MeshStandardMaterial({
        color,
        roughness: plush ? 0.92 : 0.31,
        metalness: plush ? 0 : 0.035,
      }),
    );
  return materialCache.get(key)!;
}
export function createPrize(def: PrizeDefinition): THREE.Group {
  const g = new THREE.Group();
  const body = material(def.color, def.material === "plush");
  const accent = material(def.accent, def.material === "plush");
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
    const mesh = new THREE.Mesh(geometry, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const face = (y = 0.12, z = 0.78, separation = 0.25) => {
    part(dark, -separation, y, z, 0.055, 0.07, 0.035);
    part(dark, separation, y, z, 0.055, 0.07, 0.035);
  };
  switch (def.model) {
    case "bear":
      part(body, 0, 0, 0, 0.83, 0.9, 0.72);
      part(body, -0.58, 0.69, 0, 0.3);
      part(body, 0.58, 0.69, 0, 0.3);
      part(accent, -0.58, 0.72, 0.22, 0.15, 0.16, 0.07);
      part(accent, 0.58, 0.72, 0.22, 0.15, 0.16, 0.07);
      part(cream, 0, -0.19, 0.65, 0.36, 0.29, 0.1);
      part(dark, 0, -0.08, 0.76, 0.075, 0.055, 0.04);
      part(body, -0.55, -0.64, 0.28, 0.32, 0.25, 0.34);
      part(body, 0.55, -0.64, 0.28, 0.32, 0.25, 0.34);
      face(0.14, 0.7);
      break;
    case "bunny":
      part(body, 0, -0.09, 0, 0.76, 0.81, 0.69);
      part(body, -0.34, 0.79, 0, 0.22, 0.62, 0.23);
      part(body, 0.34, 0.79, 0, 0.22, 0.62, 0.23);
      part(accent, -0.34, 0.85, 0.21, 0.1, 0.39, 0.035);
      part(accent, 0.34, 0.85, 0.21, 0.1, 0.39, 0.035);
      face(0.03, 0.68);
      part(accent, 0, -0.14, 0.72, 0.065, 0.05, 0.04);
      part(cream, 0, -0.53, 0.55, 0.3, 0.2, 0.09);
      break;
    case "cat":
      part(body, 0, 0, 0, 0.85, 0.79, 0.72);
      part(body, -0.54, 0.65, 0, 0.42, 0.52, 0.4, cone);
      part(body, 0.54, 0.65, 0, 0.42, 0.52, 0.4, cone);
      part(accent, -0.54, 0.7, 0.19, 0.19, 0.29, 0.1, cone);
      part(accent, 0.54, 0.7, 0.19, 0.19, 0.29, 0.1, cone);
      part(cream, 0, -0.25, 0.67, 0.39, 0.22, 0.09);
      face(0.12, 0.72);
      part(dark, 0, -0.12, 0.78, 0.065, 0.045, 0.04);
      break;
    case "frog":
      part(body, 0, -0.08, 0, 0.9, 0.7, 0.74);
      part(body, -0.52, 0.5, 0.12, 0.35);
      part(body, 0.52, 0.5, 0.12, 0.35);
      part(cream, -0.52, 0.53, 0.4, 0.2, 0.22, 0.07);
      part(cream, 0.52, 0.53, 0.4, 0.2, 0.22, 0.07);
      face(0.53, 0.48, 0.52);
      part(accent, 0, -0.39, 0.64, 0.53, 0.25, 0.13);
      part(body, -0.61, -0.59, 0.35, 0.34, 0.16, 0.33);
      part(body, 0.61, -0.59, 0.35, 0.34, 0.16, 0.33);
      break;
    case "penguin":
      part(body, 0, 0, 0, 0.72, 1, 0.72);
      part(cream, 0, -0.12, 0.53, 0.53, 0.7, 0.23);
      face(0.38, 0.68);
      part(accent, 0, 0.2, 0.8, 0.14, 0.09, 0.15);
      part(accent, -0.34, -0.86, 0.32, 0.26, 0.11, 0.3);
      part(accent, 0.34, -0.86, 0.32, 0.26, 0.11, 0.3);
      part(body, -0.71, -0.12, 0, 0.16, 0.49, 0.3).rotation.z = -0.25;
      part(body, 0.71, -0.12, 0, 0.16, 0.49, 0.3).rotation.z = 0.25;
      break;
    case "bird":
      part(body, 0, 0, 0, 0.85, 0.85, 0.81);
      part(accent, -0.7, -0.13, 0.16, 0.23, 0.4, 0.4);
      part(accent, 0.7, -0.13, 0.16, 0.23, 0.4, 0.4);
      part(cream, 0, -0.17, 0.65, 0.46, 0.47, 0.16);
      face(0.25, 0.79);
      part(accent, 0, 0.09, 0.91, 0.12, 0.09, 0.15);
      part(body, 0.02, 0.84, 0, 0.16, 0.3, 0.12).rotation.z = -0.4;
      break;
    case "mushroom":
      part(cream, 0, -0.35, 0, 0.52, 0.65, 0.48);
      part(body, 0, 0.33, 0, 1, 0.59, 0.9);
      face(-0.25, 0.48, 0.19);
      part(accent, -0.43, 0.62, 0.46, 0.19, 0.045, 0.18).rotation.x = 0.5;
      part(accent, 0.35, 0.7, 0.19, 0.17, 0.035, 0.15);
      part(accent, 0.4, 0.29, 0.8, 0.14, 0.14, 0.035);
      break;
    case "capsule": {
      part(body, 0, 0, 0, 0.88, 1, 0.88);
      part(accent, 0, -0.28, 0.08, 0.81, 0.67, 0.82);
      const seam = part(cream, 0, 0, 0, 0.89, 0.89, 0.89, ring);
      seam.rotation.x = Math.PI / 2;
      part(cream, 0, 0.22, 0.83, 0.4, 0.4, 0.05);
      part(body, 0, 0.22, 0.88, 0.23, 0.23, 0.045);
      break;
    }
    case "star":
      part(body, 0, 0, 0, 0.7, 0.7, 0.47);
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        const p = part(
          body,
          Math.sin(a) * 0.56,
          Math.cos(a) * 0.56,
          0,
          0.34,
          0.61,
          0.4,
        );
        p.rotation.z = -a;
      }
      face(0.04, 0.46, 0.19);
      part(accent, -0.35, -0.11, 0.44, 0.12, 0.045, 0.025);
      part(accent, 0.35, -0.11, 0.44, 0.12, 0.045, 0.025);
      break;
    case "seal":
      part(body, 0, -0.1, 0, 1, 0.68, 0.69);
      part(cream, 0, -0.3, 0.52, 0.57, 0.29, 0.16);
      face(0.13, 0.66, 0.29);
      part(dark, 0, -0.03, 0.73, 0.09, 0.06, 0.04);
      part(accent, -0.83, -0.48, 0.28, 0.38, 0.14, 0.28).rotation.z = -0.3;
      part(accent, 0.83, -0.48, 0.28, 0.38, 0.14, 0.28).rotation.z = 0.3;
      break;
  }
  // Bake decorative parts into one draw per material, rather than one draw
  // per ear, eye and foot. Keep rigid-body transforms on the parent group.
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of g.children) {
    const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    mesh.updateMatrix();
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    const batch = batches.get(mesh.material) ?? [];
    batch.push(geometry);
    batches.set(mesh.material, batch);
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
