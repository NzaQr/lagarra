import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { PrizeDefinition } from "../game-core/types";
import { createPrize } from "../rendering/prizeMeshes";
import { PrizeInteraction } from "./PrizeInteraction";

export default function PrizeViewer({ prize }: { prize: PrizeDefinition }) {
  const host = useRef<HTMLDivElement>(null);
  const rotation = useRef({ yaw: 0, pitch: 0 });
  const requestDraw = useRef(() => {});
  useEffect(() => {
    const element = host.current!;
    rotation.current = { yaw: 0, pitch: 0 };
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.setAttribute("aria-label", `3D model of ${prize.name}`);
    element.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
    const mesh = createPrize(prize);
    // Centre each model and fit its full rotation inside the viewer.
    const bounds = new THREE.Box3().setFromObject(mesh);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    mesh.position.sub(sphere.center);
    const pivot = new THREE.Group();
    pivot.add(mesh);
    scene.add(pivot, new THREE.HemisphereLight("#edf5ff", "#526980", 2.3));
    const key = new THREE.DirectionalLight("#f4f7ff", 3);
    key.position.set(-2, 3, 4);
    const rim = new THREE.DirectionalLight("#c6e1ff", 2);
    rim.position.set(3, 1, -2);
    scene.add(key, rim);
    let frame = 0;
    const render = () => {
      frame = 0;
      pivot.rotation.set(
        rotation.current.pitch,
        rotation.current.yaw,
        0,
        "YXZ",
      );
      renderer.render(scene, camera);
    };
    const invalidate = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    requestDraw.current = invalidate;
    const resize = () => {
      const width = element.clientWidth,
        height = element.clientHeight;
      camera.aspect = width / Math.max(height, 1);
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const limitingAngle = Math.min(
        halfFov,
        Math.atan(Math.tan(halfFov) * camera.aspect),
      );
      camera.position.z = (sphere.radius / Math.sin(limitingAngle)) * 1.12;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      invalidate();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      requestDraw.current = () => {};
      observer.disconnect();
      mesh.traverse((part) => {
        if (part instanceof THREE.Mesh) part.geometry.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [prize]);
  return (
    <PrizeInteraction
      name={prize.name}
      className="collection-prize-viewer"
      onRotate={(dx, dy) => {
        rotation.current.yaw += dx;
        rotation.current.pitch = THREE.MathUtils.clamp(
          rotation.current.pitch + dy,
          -Math.PI / 2,
          Math.PI / 2,
        );
        requestDraw.current();
      }}
    >
      <div className="prize-viewer-canvas" ref={host} />
    </PrizeInteraction>
  );
}
