import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { PrizeCelebration } from "../src/rendering/PrizeCelebration";
import { spinPlan, spinProgress, WIN_MOTION } from "../src/rendering/WinMotion";

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
      }),
    }),
  });
  vi.stubGlobal("window", { innerWidth: 1440, innerHeight: 1000 });
});
afterEach(() => vi.unstubAllGlobals());

function fixture(sequence = 0, aspect = 1.44) {
  const scene = new THREE.Scene();
  const mesh = new THREE.Group();
  mesh.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.22),
      new THREE.MeshBasicMaterial(),
    ),
  );
  mesh.position.set(-0.88, 0.42, 0.78);
  scene.add(mesh);
  const camera = new THREE.PerspectiveCamera(36, aspect, 0.1, 80);
  camera.position.set(4, 5, 10);
  camera.lookAt(0, 2, 0);
  const celebration = new PrizeCelebration(
    scene,
    mesh,
    new THREE.PointLight(),
    sequence,
  );
  let elapsed = 0;
  return {
    scene,
    mesh,
    camera,
    celebration,
    advance(time: number, reduced = false) {
      celebration.update(time - elapsed, camera, reduced);
      elapsed = time;
    },
  };
}

const particles = (
  celebration: PrizeCelebration,
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] =>
  Reflect.get(celebration, "confetti");

describe("prize reveal", () => {
  it("keeps physical shadows in the chute and removes them for the flying trophy", () => {
    const { celebration, mesh, advance } = fixture();
    const part = mesh.children[0];
    part.castShadow = part.receiveShadow = true;
    advance(WIN_MOTION.exitDuration - 0.01);
    expect(part.castShadow).toBe(true);
    advance(WIN_MOTION.exitDuration + 0.01);
    expect(part.castShadow).toBe(false);
    expect(part.receiveShadow).toBe(false);
    celebration.dispose();
  });
  it("accelerates, holds speed, then brakes without reversing or overshooting", () => {
    const velocity = (t: number) =>
      (spinProgress(t + 0.00001) - spinProgress(t)) / 0.00001;
    expect(spinProgress(-1)).toBe(0);
    expect(spinProgress(2)).toBeCloseTo(1, 12);
    expect(velocity(0)).toBeLessThan(0.001);
    expect(velocity(0.05)).toBeLessThan(velocity(0.1));
    expect(velocity(0.15)).toBeCloseTo(velocity(0.3), 6);
    expect(velocity(0.4)).toBeGreaterThan(velocity(0.6));
    expect(velocity(0.6)).toBeGreaterThan(velocity(0.8));
    expect(velocity(0.999)).toBeLessThan(0.001);
    for (let i = 1; i <= 1000; i++) {
      expect(spinProgress(i / 1000)).toBeGreaterThanOrEqual(
        spinProgress((i - 1) / 1000),
      );
      expect(spinProgress(i / 1000)).toBeLessThanOrEqual(1);
    }
  });

  it.each([0, 1, 2, 3, 4, 5])(
    "stops at the exact camera-facing result on spin %i",
    (sequence) => {
      const { celebration, mesh, camera, advance } = fixture(sequence);
      const plan = spinPlan(sequence);
      expect(plan.duration).toBeGreaterThanOrEqual(1.4);
      expect(plan.duration + WIN_MOTION.exitDuration).toBeLessThan(3);
      expect(plan.turns).not.toBe(spinPlan(sequence + 1).turns);
      const stop = WIN_MOTION.exitDuration + plan.duration;
      advance(stop - 0.1);
      expect(celebration.isReady).toBe(false);
      const before = mesh.quaternion.clone();
      celebration.rotate(1, 1);
      advance(stop);
      expect(mesh.quaternion.angleTo(camera.quaternion)).toBeLessThan(1e-7);
      expect(before.angleTo(mesh.quaternion)).toBeLessThan(0.025);
      expect(particles(celebration)).toHaveLength(0);
      advance(stop + WIN_MOTION.pause - 0.001);
      expect(celebration.isReady).toBe(false);
      advance(stop + WIN_MOTION.pause + 0.001);
      expect(celebration.isReady).toBe(true);
      celebration.rotate(0.2, 0);
      advance(stop + WIN_MOTION.pause + 0.01);
      expect(mesh.quaternion.angleTo(camera.quaternion)).toBeCloseTo(0.2, 5);
      celebration.dispose();
    },
  );

  it("pulses softly before two bounded bursts and disposes all particles", () => {
    const { celebration, mesh, advance } = fixture();
    const stop = WIN_MOTION.exitDuration + spinPlan(0).duration;
    advance(stop);
    const baseScale = mesh.scale.x;
    const emphasis = stop + WIN_MOTION.pause;
    const burst = emphasis + WIN_MOTION.confettiDelay;
    advance(emphasis);
    expect(particles(celebration)).toHaveLength(0);
    advance(burst + 0.03);
    const pieces = [...particles(celebration)];
    expect(pieces).toHaveLength(40);
    expect(pieces.filter((piece) => piece.visible)).toHaveLength(30);
    expect(mesh.scale.x).toBeGreaterThan(baseScale);
    const dispose = vi.fn();
    pieces.forEach((piece) =>
      piece.material.addEventListener("dispose", dispose),
    );
    advance(emphasis + WIN_MOTION.pulseDuration / 2);
    expect(pieces.filter((piece) => piece.visible)).toHaveLength(40);
    expect(mesh.scale.x / baseScale).toBeCloseTo(1.045, 5);
    advance(emphasis + WIN_MOTION.pulseDuration + 0.01);
    expect(mesh.scale.x).toBeCloseTo(baseScale, 8);
    advance(
      burst + WIN_MOTION.secondBurstDelay + WIN_MOTION.confettiDuration + 0.01,
    );
    expect(particles(celebration)).toHaveLength(0);
    expect(pieces.every((piece) => piece.parent === null)).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(40);
    expect(celebration.isAnimating).toBe(false);
    advance(stop + 10);
    expect(particles(celebration)).toHaveLength(0);
    celebration.dispose();
    expect(dispose).toHaveBeenCalledTimes(40);
  });

  it("shows a short reduced-motion reveal and never creates confetti", () => {
    const { celebration, mesh, camera, advance } = fixture();
    advance(0.18, true);
    expect(mesh.quaternion.angleTo(camera.quaternion)).toBeLessThan(1e-7);
    expect(celebration.isReady).toBe(false);
    advance(0.39, true);
    expect(celebration.isReady).toBe(true);
    expect(celebration.isAnimating).toBe(false);
    const scale = mesh.scale.x;
    advance(6, false);
    expect(mesh.scale.x).toBe(scale);
    expect(particles(celebration)).toHaveLength(0);
    celebration.dispose();
  });

  it("clears active confetti when reduced motion is enabled or storage starts", async () => {
    const burst =
      WIN_MOTION.exitDuration +
      spinPlan(0).duration +
      WIN_MOTION.pause +
      WIN_MOTION.confettiDelay;
    const a = fixture();
    a.advance(burst + 0.3);
    expect(particles(a.celebration).length).toBeGreaterThan(0);
    a.advance(burst + 0.4, true);
    expect(particles(a.celebration)).toHaveLength(0);
    a.advance(6, false);
    expect(particles(a.celebration)).toHaveLength(0);
    a.celebration.dispose();
    const b = fixture();
    b.advance(burst + 0.3);
    const target = {
      getBoundingClientRect: () => ({
        left: 1200,
        top: 20,
        width: 100,
        height: 40,
      }),
    };
    vi.stubGlobal("HTMLElement", Object);
    const promise = b.celebration.store(target as HTMLElement);
    expect(b.celebration.store(target as HTMLElement)).toBe(promise);
    expect(particles(b.celebration)).toHaveLength(0);
    b.celebration.dispose();
    await promise;
    b.advance(10);
    expect(b.scene.children).toHaveLength(0);
  });

  it("fits portrait views and keeps the larger particles behind the trophy after resize", () => {
    const { celebration, mesh, camera, advance } = fixture(0, 390 / 844);
    const burst =
      WIN_MOTION.exitDuration +
      spinPlan(0).duration +
      WIN_MOTION.pause +
      WIN_MOTION.confettiDelay;
    advance(burst + 0.1);
    expect(particles(celebration)).toHaveLength(32);
    const heroRadius = Reflect.get(celebration, "radius") * mesh.scale.x;
    for (const piece of particles(celebration)) {
      expect(piece.position.z).toBeLessThan(-heroRadius);
      expect(Math.abs(piece.position.x)).toBeLessThan(heroRadius);
      expect(piece.scale.x).toBeGreaterThan(heroRadius * 0.045);
    }
    const portraitScale = mesh.scale.x;
    camera.aspect = 844 / 390;
    camera.updateProjectionMatrix();
    advance(burst + 0.11);
    expect(mesh.scale.x).toBeGreaterThan(portraitScale);
    camera.updateMatrixWorld();
    mesh.updateMatrixWorld();
    for (const piece of particles(celebration).filter(
      (piece) => piece.visible,
    )) {
      piece.updateWorldMatrix(true, false);
      const point = piece.getWorldPosition(new THREE.Vector3()).project(camera);
      expect(Math.abs(point.x)).toBeLessThan(0.96);
      expect(point.y).toBeGreaterThan(-0.78);
      expect(point.y).toBeLessThan(0.88);
    }
    celebration.dispose();
  });

  it.each([390 / 844, 1.44, 844 / 390])(
    "keeps the backdrop and halo hidden until arrival at aspect %f",
    (aspect) => {
      const { celebration, mesh, camera, advance } = fixture(0, aspect);
      const arrival = WIN_MOTION.exitDuration + WIN_MOTION.flightDuration;
      const backdrop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> =
        Reflect.get(celebration, "backdrop");
      const halo: THREE.Sprite = Reflect.get(celebration, "halo");
      for (let t = 0; t < arrival; t += 1 / 60) {
        advance(t);
        expect(backdrop.material.opacity).toBe(0);
        expect(halo.material.opacity).toBe(0);
      }
      advance(arrival + WIN_MOTION.backdropDuration / 2);
      expect(backdrop.material.opacity).toBeGreaterThan(0);
      const inverse = camera.quaternion.clone().invert();
      const modelDepth = mesh.position
        .clone()
        .sub(camera.position)
        .applyQuaternion(inverse).z;
      const backdropDepth = backdrop.position
        .clone()
        .sub(camera.position)
        .applyQuaternion(inverse).z;
      expect(modelDepth).toBeCloseTo(-4);
      expect(backdropDepth).toBeCloseTo(-6);
      const radius = Reflect.get(celebration, "radius") * mesh.scale.x;
      expect(modelDepth - radius).toBeGreaterThan(backdropDepth);
      celebration.dispose();
    },
  );
});
