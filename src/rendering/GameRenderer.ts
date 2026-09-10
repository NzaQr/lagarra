import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  MACHINE,
  type Quality,
  type SimulationFrame,
} from "../game-core/types";
import { PrizeCelebration } from "./PrizeCelebration";
import { createPrize } from "./prizeMeshes";
import { bedTexture, cableTexture, controlLabelTexture, labelTexture, lightPoolTexture, stripGlowTexture, surfaceTexture } from "./materials";
import { RenderBudget } from "./RenderBudget";

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;
  private environment: THREE.WebGLRenderTarget;
  private quality: Quality;
  private budget = new RenderBudget();
  private renderRequested = true;
  private lastState?: SimulationFrame["state"];
  private lastCameraMatrix = new THREE.Matrix4();
  private prizeLight = new THREE.PointLight("#edf5ff", 0, 6, 2);
  private prizeMeshes = new Map<number, THREE.Group>();
  private celebrations = new Map<number, PrizeCelebration>();
  private celebrationSequence = 0;
  private featuredCelebration?: PrizeCelebration;
  private armMeshes: THREE.Mesh[] = [];
  private hub = new THREE.Group();
  private carriage = new THREE.Group();
  private crossRail = new THREE.Group();
  private joystick = new THREE.Group();
  private button!: THREE.Mesh;
  private cable!: THREE.Mesh;
  private target = new THREE.Vector3(0, 2.54, 0);
  private cameraPosition = new THREE.Vector3();
  private key!: THREE.SpotLight;
  private cabinetLight!: THREE.PointLight;
  private statusMaterial!: THREE.MeshStandardMaterial;
  private debugLines?: THREE.LineSegments;
  private elapsed = 0;
  private initialCamera = true;
  private viewportHeight = 0;
  private shadowPoses = new WeakMap<THREE.Object3D, THREE.Matrix4>();
  private shadowCasterCount = 0;
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private white = new THREE.MeshStandardMaterial({
    color: "#eeeae1",
    roughness: 0.4,
    metalness: 0.08,
  });
  private teal = new THREE.MeshStandardMaterial({
    color: "#435860",
    roughness: 0.4,
    metalness: 0.62,
  });
  private steel = new THREE.MeshStandardMaterial({
    color: "#d0dce5",
    metalness: 0.94,
    roughness: 0.23,
  });
  private black = new THREE.MeshStandardMaterial({
    color: "#19232e",
    roughness: 0.67,
    metalness: 0.1,
  });
  private glow = new THREE.MeshStandardMaterial({
    color: "#fff0d1",
    emissive: "#ffd38a",
    emissiveIntensity: 3.2,
  });
  private cyan = new THREE.MeshStandardMaterial({
    color: "#c9faff",
    emissive: "#42dfff",
    emissiveIntensity: 3.5,
    roughness: 0.3,
  });
  private boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private sphereGeometry = new THREE.SphereGeometry(1, 24, 16);
  private cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 20);
  private disposed = false;

  constructor(container: HTMLElement, quality: Quality) {
    this.container = container;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    // Include shadow passes in the diagnostics, as well as the main scene.
    this.renderer.info.autoReset = false;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Three dimensional claw machine and prize pile",
    );
    Object.assign(this.renderer.domElement.style, {
      width: "100%",
      height: "100%",
      display: "block",
    });
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color("#0c1119");
    this.scene.fog = new THREE.Fog("#0c1119", 13, 34);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    // Bake large softboxes once. Broad highlights describe the enamel and
    // machined edges without runtime area lights or reflection passes.
    const softboxMaterial = new THREE.MeshBasicMaterial({ color: "#fff0d9" });
    const softbox = new THREE.Mesh(new THREE.PlaneGeometry(5, 8), softboxMaterial);
    softbox.position.set(-4, 3, 4);
    softbox.lookAt(0, 1, 0);
    room.add(softbox);
    const coolbox = new THREE.Mesh(new THREE.PlaneGeometry(3, 7),
      new THREE.MeshBasicMaterial({ color: "#d7eaf2" }));
    coolbox.position.set(4, 2, -2);
    coolbox.lookAt(0, 1, 0);
    room.add(coolbox);
    this.environment = pmrem.fromScene(room, 0.035);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.36;
    // Fine coating variation breaks up the broad studio reflections.
    const coating = surfaceTexture(3);
    this.white.roughnessMap = coating;
    this.white.bumpMap = coating;
    this.white.bumpScale = 0.0008;
    this.teal.roughnessMap = coating;
    this.teal.bumpMap = coating;
    this.teal.bumpScale = 0.0012;
    room.dispose();
    pmrem.dispose();
    this.buildRoom();
    this.buildCabinet();
    this.buildPearlDetails();
    this.buildSurfaceDetails();
    this.buildLightHalos();
    this.batchCabinet();
    this.buildMechanism();
    this.buildLighting();
    // These local mesh transforms never change. Parent groups still move normally.
    this.scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh &&
        object !== this.cable &&
        object !== this.button
      ) {
        object.updateMatrix();
        object.matrixAutoUpdate = false;
      }
    });
    this.scene.matrixWorldAutoUpdate = false;
    this.setQuality(quality);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }
  private box(
    parent: THREE.Object3D,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    rounded = 0,
  ) {
    const geometry = rounded
      ? new RoundedBoxGeometry(w, h, d, 3, rounded)
      : this.boxGeometry;
    const mesh = new THREE.Mesh(geometry, material);
    if (!rounded) mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private batchCabinet(parent: THREE.Object3D = this.scene) {
    const batches = new Map<
      string,
      THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]
    >();
    for (const child of parent.children) {
      if (
        !(child instanceof THREE.Mesh) ||
        Array.isArray(child.material) ||
        child.material.transparent
      )
        continue;
      const key = `${child.material.uuid}:${child.castShadow}:${child.receiveShadow}`;
      const batch = batches.get(key) ?? [];
      batch.push(child);
      batches.set(key, batch);
    }
    for (const meshes of batches.values()) {
      if (meshes.length < 2) continue;
      const geometries = meshes.map((mesh) => {
        mesh.updateMatrix();
        const geometry = mesh.geometry.index
          ? mesh.geometry.toNonIndexed()
          : mesh.geometry.clone();
        return geometry.applyMatrix4(mesh.matrix);
      });
      const geometry = mergeGeometries(geometries);
      geometries.forEach((part) => part.dispose());
      if (!geometry) continue;
      const first = meshes[0];
      const batch = new THREE.Mesh(geometry, first.material);
      batch.castShadow = first.castShadow;
      batch.receiveShadow = first.receiveShadow;
      parent.add(batch);
      for (const mesh of meshes) {
        parent.remove(mesh);
        if (
          mesh.geometry !== this.boxGeometry &&
          mesh.geometry !== this.cylinderGeometry &&
          mesh.geometry !== this.sphereGeometry
        )
          mesh.geometry.dispose();
      }
    }
  }
  private cylinder(
    parent: THREE.Object3D,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
  ) {
    const mesh = new THREE.Mesh(this.cylinderGeometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(r, h, r);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private sphere(
    parent: THREE.Object3D,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    r: number,
  ) {
    const m = new THREE.Mesh(this.sphereGeometry, material);
    m.position.set(x, y, z);
    m.scale.setScalar(r);
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  private label(
    parent: THREE.Object3D,
    text: string,
    sub: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    fg?: string,
    bg?: string,
  ) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        map: labelTexture(text, sub, fg, bg),
        roughness: 0.48,
      }),
    );
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  private buildRoom() {
    const grain = surfaceTexture(85);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({
        color: "#202930",
        roughness: 0.57,
        metalness: 0.3,
        roughnessMap: grain,
        bumpMap: grain,
        bumpScale: 0.008,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.06;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // Soft light footprints approximate rough floor reflections in one pass.
    // They are fixed to the room, so both camera views see the same light pools.
    const poolMap = lightPoolTexture();
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 4.3),
      new THREE.MeshBasicMaterial({
        color: "#000000", map: poolMap, transparent: true, opacity: 0.9,
        depthWrite: false, toneMapped: false,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.set(0, -0.054, 0.12);
    this.scene.add(contact);
    const warmPool = new THREE.MeshBasicMaterial({
      color: "#e9a954", map: poolMap, transparent: true, opacity: 0.44,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const coolPool = warmPool.clone();
    coolPool.color.set("#42bfe9");
    coolPool.opacity = 0.22;
    const pool = (x: number, z: number, w: number, d: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, -0.052, z);
      this.scene.add(mesh);
    };
    pool(-4.8, -3.7, 1.8, 5, warmPool);
    pool(4.8, -3.7, 1.8, 5, warmPool);
    pool(-1.45, 1.9, 1.1, 3.3, warmPool);
    pool(1.5, 1.3, 0.9, 3.7, warmPool);
    pool(0, 1.5, 4.2, 1.5, coolPool);
    // Narrow cores inside the broad pools suggest stretched lamp reflections.
    pool(-1.45, 2.15, 0.28, 2.7, warmPool);
    pool(1.5, 1.8, 0.22, 3.1, warmPool);
    pool(0, 1.65, 3.4, 0.3, coolPool);
    // Wide wall ribs and quiet practical lamps anchor the machine in a room.
    const wall = new THREE.MeshStandardMaterial({
      color: "#20262b",
      roughness: 0.74,
      bumpMap: surfaceTexture(12),
      bumpScale: 0.013,
    });
    this.box(this.scene, wall, 0, 4, -5.8, 28, 8, 0.2);
    const wallTrim = new THREE.MeshStandardMaterial({
      color: "#202e3d",
      roughness: 0.72,
    });
    for (let i = -5; i <= 5; i++)
      this.box(this.scene, wallTrim, i * 2.4, 3.5, -5.65, 0.035, 7, 0.05);
    const warm = new THREE.MeshStandardMaterial({
      color: "#ffe4bc",
      emissive: "#ffd4a0",
      emissiveIntensity: 2.8,
    });
    for (const x of [-4.8, 4.8]) {
      this.box(this.scene, wallTrim, x, 3.65, -5.46, 0.16, 2.5, 0.12, 0.035);
      this.box(this.scene, warm, x, 3.65, -5.38, 0.04, 2.3, 0.04, 0.01);
      const wash = new THREE.PointLight("#f2c994", 12, 6.5, 2);
      wash.position.set(x, 3.6, -4.9);
      this.scene.add(wash);
    }
    // A recessed plinth gives a clean contact shadow and hides the feet.
    this.box(this.scene, this.black, 0, 0.025, 0, 3.65, 0.12, 2.95, 0.08);
  }
  private buildCabinet() {
    const s = this.scene;
    // Lower shell. The front is built around an actual retrieval aperture.
    this.box(s, this.white, 0, 0.69, -1.22, 3.46, 1.27, 0.16, 0.06);
    this.box(s, this.white, -1.65, 0.69, 0, 0.16, 1.27, 2.56, 0.055);
    this.box(s, this.white, 1.65, 0.69, 0, 0.16, 1.27, 2.56, 0.055);
    this.box(s, this.white, 0, 0.16, 0, 3.46, 0.2, 2.6, 0.055);
    this.box(s, this.white, 0.74, 0.69, 1.14, 1.83, 1.27, 0.2, 0.04);
    this.box(s, this.white, -1.57, 0.69, 1.14, 0.3, 1.27, 0.2, 0.04);
    this.box(s, this.white, -0.88, 1.09, 1.14, 1.16, 0.48, 0.2, 0.04);
    this.box(s, this.white, -0.88, 0.23, 1.14, 1.16, 0.14, 0.2, 0.03);
    this.box(s, this.teal, 0, 0.17, 0, 3.43, 0.15, 2.73, 0.035);
    this.box(s, this.white, 0, 1.3, -1.33, 3.55, 0.15, 0.12, 0.03);
    this.box(s, this.white, 0, 1.3, 1.33, 3.55, 0.15, 0.12, 0.03);
    this.box(s, this.white, -1.72, 1.3, 0, 0.12, 0.15, 2.6, 0.03);
    this.box(s, this.white, 1.72, 1.3, 0, 0.12, 0.15, 2.6, 0.03);
    this.box(s, this.black, -0.88, 0.58, 0.43, 1.25, 0.61, 0.04, 0.02);
    this.box(s, this.steel, -0.88, 0.3, 1.25, 1.24, 0.04, 0.31, 0.015);
    this.box(s, this.teal, -1.47, 0.6, 1.245, 0.06, 0.53, 0.08, 0.015);
    this.box(s, this.teal, -0.29, 0.6, 1.245, 0.06, 0.53, 0.08, 0.015);
    this.box(s, this.teal, -0.88, 0.86, 1.245, 1.24, 0.06, 0.08, 0.015);
    const flap = new THREE.MeshPhysicalMaterial({
      color: "#8195a8",
      metalness: 0.12,
      roughness: 0.26,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.box(s, flap, -0.88, 0.7, 1.29, 1.1, 0.22, 0.018);
    this.label(
      s,
      "PRIZE OUT",
      "PUSH TO COLLECT",
      -0.88,
      1.025,
      1.218,
      1.14,
      0.24,
      "#42586e",
      "#e5eaf0",
    );
    this.label(
      s,
      "01",
      "TOKYO TOY CLUB",
      0.81,
      0.69,
      1.089,
      0.56,
      0.36,
      "#607488",
      "#e5eaf0",
    );
    for (let y = 0.36; y < 0.91; y += 0.065)
      this.box(s, this.black, 1.37, y, 1.095, 0.12, 0.012, 0.006);
    // Four continuous coated metal uprights, rubber glazing seals inside.
    for (const x of [-1.69, 1.69])
      for (const z of [-1.29, 1.29]) {
        this.box(s, this.white, x, 2.95, z, 0.15, 3.32, 0.15, 0.025);
        this.box(s, this.black, x * 0.96, 2.95, z * 0.973, 0.028, 3.15, 0.028);
        for (const y of [1.5, 4.35]) {
          const screw = this.cylinder(
            s,
            this.steel,
            x,
            y,
            z + 0.08,
            0.022,
            0.008,
          );
          screw.rotation.x = Math.PI / 2;
        }
      }
    this.box(s, this.white, 0, 4.64, 0, 3.58, 0.5, 2.79, 0.075);
    // The crown is an uninterrupted enamel surface, with no lettering.
    this.box(s, this.teal, 0, 4.92, 0, 3.5, 0.07, 2.74, 0.025);
    this.box(s, this.black, 0, 4.38, 0, 3.24, 0.05, 2.43);
    // Bed is split around the physical chute in the front-left corner.
    const bed = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      map: bedTexture(),
      roughness: 0.91,
    });
    const { chuteX: cx, chuteZ: cz, chuteHalf: r, bedY } = MACHINE;
    this.box(
      s,
      bed,
      0,
      bedY - 0.055,
      (-1.25 + cz - r) / 2,
      3.3,
      0.11,
      cz - r + 1.25,
    );
    this.box(
      s,
      bed,
      (cx + r + 1.65) / 2,
      bedY - 0.055,
      (cz - r + 1.25) / 2,
      1.65 - cx - r,
      0.11,
      1.25 - cz + r,
    );
    this.box(
      s,
      bed,
      (-1.65 + cx - r) / 2,
      bedY - 0.055,
      (cz - r + 1.25) / 2,
      cx - r + 1.65,
      0.11,
      1.25 - cz + r,
    );
    this.box(
      s,
      bed,
      cx,
      bedY - 0.055,
      (cz + r + 1.25) / 2,
      2 * r,
      0.11,
      1.25 - cz - r,
    );
    const chuteMat = new THREE.MeshStandardMaterial({
      color: "#263b50",
      roughness: 0.56,
      metalness: 0.3,
    });
    this.box(s, chuteMat, cx, 0.86, cz - r, 2 * r, 0.94, 0.04);
    this.box(s, chuteMat, cx - r, 0.86, cz, 0.04, 0.94, 2 * r);
    this.box(s, chuteMat, cx + r, 0.86, cz, 0.04, 0.94, 2 * r);
    // Thin metal rim makes the hole legible against the pale floor.
    for (const dz of [-r, r])
      this.box(
        s,
        this.steel,
        cx,
        bedY + 0.018,
        cz + dz,
        2 * r + 0.075,
        0.035,
        0.048,
      );
    for (const dx of [-r, r])
      this.box(s, this.steel, cx + dx, bedY + 0.018, cz, 0.048, 0.035, 2 * r);
    const arrow = this.label(
      s,
      "↓",
      "PRIZE CHUTE",
      cx,
      bedY + 0.025,
      cz - 0.57,
      0.7,
      0.22,
      "#dceaf6",
      "#5a7289",
    );
    arrow.rotation.x = -Math.PI / 2;
    // Interior back wall below the glazing and a narrow perimeter trim.
    this.box(s, this.white, 0, 1.51, -1.26, 3.27, 0.32, 0.045);
    for (const x of [-1.65, 1.65])
      this.box(s, this.white, x, 1.48, 0, 0.06, 0.25, 2.54);
    this.box(s, this.white, 0, 1.53, 1.29, 3.25, 0.19, 0.08);
    // Glazing remains faint enough to judge real contact and depth.
    const glass = new THREE.MeshPhysicalMaterial({
      color: "#e7ece8",
      metalness: 0.08,
      roughness: 0.095,
      transparent: true,
      opacity: 0.045,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 1.1,
    });
    for (const x of [-1.68, 1.68]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(2.45, 2.85), glass);
      p.rotation.y = Math.PI / 2;
      p.position.set(x, 2.94, 0);
      s.add(p);
    }
    const rear = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.85), glass);
    rear.position.set(0, 2.94, -1.28);
    s.add(rear);
    const frontGlass = glass.clone();
    frontGlass.opacity = 0.018;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.7), frontGlass);
    front.position.set(0, 3.02, 1.285);
    s.add(front);
    // Faint reflection streaks sell glass without refraction passes.
    const shine = new THREE.MeshBasicMaterial({
      color: "#fff0d8",
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.box(s, shine, 1.13, 3.14, 1.29, 0.035, 2.3, 0.002).rotation.z = -0.2;
    this.box(s, shine, 1.29, 3.14, 1.29, 0.008, 2.3, 0.002).rotation.z = -0.2;
    // A clipped reflection stays inside the pane and leaves the claw clear.
    const reflection = new THREE.BufferGeometry();
    reflection.setAttribute("position", new THREE.Float32BufferAttribute([
      -1.55, 1.74, 1.293, -1.55, 2.32, 1.293, -0.79, 4.28, 1.293,
      -1.55, 1.74, 1.293, -0.79, 4.28, 1.293, -0.64, 4.28, 1.293,
    ], 3));
    s.add(new THREE.Mesh(reflection, shine));
    // Thin polished glass edges supply depth cues from either camera.
    const glassEdge = new THREE.MeshBasicMaterial({
      color: "#b8d5d0", transparent: true, opacity: 0.2,
      depthWrite: false,
    });
    for (const x of [-1.605, 1.605]) {
      const edge = this.box(s, glassEdge, x, 2.98, 1.291,
        0.008, 2.75, 0.004);
      edge.castShadow = edge.receiveShadow = false;
    }
    for (const x of [-1.684, 1.684]) {
      const sideShine = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 2.5), shine);
      sideShine.position.set(x, 2.98, -0.91);
      sideShine.rotation.y = Math.PI / 2;
      s.add(sideShine);
    }
    // The side pane has its own clipped reflection for the depth camera.
    // One shared-material mesh supplies both strips, without refraction.
    const sideReflection = new THREE.BufferGeometry();
    const vertices: number[] = [];
    for (const x of [-1.685, 1.685]) {
      vertices.push(
        x, 1.68, -0.84, x, 1.68, -0.73, x, 4.28, 0.41,
        x, 1.68, -0.84, x, 4.28, 0.41, x, 4.28, 0.23,
      );
    }
    sideReflection.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    s.add(new THREE.Mesh(sideReflection, shine));
    this.buildControlPanel();
    for (const x of [-1.49, 1.49])
      this.box(s, this.glow, x, 4.28, 0, 0.05, 0.035, 2.1, 0.012);
    this.box(s, this.glow, 0, 4.26, 1.1, 2.96, 0.038, 0.05, 0.01);
    for (const x of [-1.55, 1.55]) {
      this.box(s, this.teal, x, 2.98, -1.19, 0.08, 2.72, 0.055);
      this.box(s, this.glow, x, 2.98, -1.153, 0.027, 2.65, 0.02);
    }
    this.box(s, this.glow, -0.88, 0.81, 0.82, 0.97, 0.025, 0.05);
    this.statusMaterial = new THREE.MeshStandardMaterial({
      color: "#bddfff",
      emissive: "#86b8e0",
      emissiveIntensity: 0.5,
    });
    this.box(s, this.statusMaterial, 0, 1.397, 1.423, 3.13, 0.025, 0.016);
  }
  private buildPearlDetails() {
    const group = this.scene;
    this.box(group, this.teal, 0.79, 0.68, 1.247, 1.38, 0.72, 0.035, 0.07);
    this.box(group, this.white, 0.79, 0.68, 1.274, 1.27, 0.61, 0.03, 0.055);
    // Flush service lock and folded crown lip use the existing metal batches.
    const lock = this.cylinder(group, this.steel, 1.25, 0.87, 1.297, 0.034, 0.012);
    lock.rotation.x = Math.PI / 2;
    this.box(group, this.black, 1.25, 0.87, 1.306, 0.006, 0.028, 0.003);
    this.box(group, this.steel, 0, 4.885, 1.376, 3.39, 0.018, 0.018);
    for (const x of [-1.59, 1.59]) {
      this.box(group, this.steel, x, 1.64, 1.27, 0.055, 0.21, 0.028, 0.008);
      this.box(group, this.steel, x, 4.18, 1.27, 0.055, 0.21, 0.028, 0.008);
    }
    // Folded inner channels catch the warm lamp light along the cabinet depth.
    for (const x of [-1.6, 1.6]) {
      this.box(group, this.steel, x, 4.31, 0, 0.028, 0.025, 2.38);
      this.box(group, this.white, x, 1.61, 0, 0.035, 0.045, 2.38);
    }
    for (const x of [-1.69, 1.69])
      for (const y of [1.5, 4.35])
        this.box(group, this.black, x, y, 1.381, 0.022, 0.004, 0.002);
    this.box(group, this.teal, 0, 4.67, 1.405, 2.97, 0.055, 0.024, 0.01);
    this.box(group, this.cyan, 0, 4.67, 1.425, 2.9, 0.023, 0.018);
    this.box(group, this.cyan, 0, 0.185, 1.374, 3.24, 0.026, 0.018);
    for (const x of [-1.742, 1.742]) {
      this.box(group, this.cyan, x, 0.185, 0, 0.016, 0.025, 2.54);
      this.box(group, this.cyan, x, 1.285, 0, 0.016, 0.025, 2.43);
    }
    for (const x of [-1.738, 1.738])
      this.box(group, this.teal, x, 0.7, 0, 0.025, 0.68, 1.95, 0.01);
  }
  private buildSurfaceDetails() {
    const s = this.scene;
    // Folded sheet-metal seams and inset panels join the existing static
    // material batches. Their relief catches light in both camera views.
    for (const x of [-1.742, 1.742]) {
      this.box(s, this.white, x, 0.7, 0, 0.029, 0.58, 1.83, 0.014);
      for (const z of [-0.86, 0.86])
        this.box(s, this.steel, x * 1.001, 0.71, z, 0.012, 0.51, 0.013);
    }
    this.box(s, this.steel, 0, 0.26, 1.382, 3.28, 0.018, 0.016);
    this.box(s, this.black, 0, 4.875, 1.389, 3.36, 0.012, 0.011);
    this.box(s, this.white, 0, 4.405, 1.402, 3.34, 0.024, 0.016, 0.006);
    for (const x of [-1.69, 1.69]) {
      this.box(s, this.steel, x - Math.sign(x) * 0.061, 2.96, 1.369,
        0.012, 2.78, 0.008);
      for (const y of [1.72, 4.12]) {
        this.box(s, this.white, x - Math.sign(x) * 0.095, y, 1.274,
          0.072, 0.095, 0.035, 0.012);
      }
    }
    // Lamp housings keep the luminous cores thin and give them a warm lip.
    for (const x of [-1.55, 1.55]) {
      for (const offset of [-0.032, 0.032])
        this.box(s, this.steel, x + offset, 2.98, -1.146,
          0.012, 2.67, 0.014);
    }
    this.box(s, this.steel, 0, 4.29, 1.105, 3.05, 0.015, 0.09);
    // Baked corner occlusion belongs only to the cabinet; dynamic prize
    // contact continues to come from the existing shadow pass.
    const shadeMap = lightPoolTexture();
    const shade = new THREE.MeshBasicMaterial({
      color: "#514331", map: shadeMap, transparent: true,
      opacity: 0.27, depthWrite: false,
    });
    for (const x of [-1.48, 1.48]) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 2.37), shade);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, MACHINE.bedY + 0.004, -0.05);
      s.add(mesh);
    }
    const rearShade = new THREE.Mesh(new THREE.PlaneGeometry(3.12, 0.35), shade);
    rearShade.rotation.x = -Math.PI / 2;
    rearShade.position.set(0, MACHINE.bedY + 0.005, -1.08);
    s.add(rearShade);
  }
  private buildLightHalos() {
    const map = stripGlowTexture();
    const cool = new THREE.MeshBasicMaterial({
      map, color: "#58dcff", transparent: true, opacity: 0.44,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    });
    const warm = cool.clone();
    warm.color.set("#ffc779");
    warm.opacity = 0.3;
    const strip = (
      material: THREE.Material, x: number, y: number, z: number,
      width: number, height: number, rotationZ = 0, rotationY = 0,
    ) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(0, rotationY, rotationZ);
      this.scene.add(mesh);
    };
    strip(cool, 0, 4.67, 1.438, 3.08, 0.14);
    strip(cool, 0, 0.185, 1.387, 3.38, 0.15);
    for (const x of [-1.754, 1.754]) {
      strip(cool, x, 0.185, 0, 2.65, 0.13, 0, Math.PI / 2);
      strip(cool, x, 1.285, 0, 2.53, 0.11, 0, Math.PI / 2);
    }
    strip(warm, 0, 4.26, 1.134, 3.08, 0.18);
    for (const x of [-1.55, 1.55])
      strip(warm, x, 2.98, -1.135, 2.76, 0.2, Math.PI / 2);
    for (const x of [-4.8, 4.8])
      strip(warm, x, 3.65, -5.35, 2.55, 0.35, Math.PI / 2);
  }
  private buildControlPanel() {
    const p = new THREE.Group();
    p.position.set(0, 1.2, 1.61);
    p.rotation.x = 0.1;
    // Keep the physical drop button clear of the front-right upright in side view.
    // Keep a clear optical gap between the readable panel label and the
    // physical drop button. This does not change the input action itself.
    const dropButtonX = 0.70;
    const dropButtonZ = 0;
    this.scene.add(p);
    // Extend the deck toward the player and leave space around both control bases.
    this.box(p, this.white, 0, 0, 0, 3.25, 0.23, 0.8, 0.075);
    this.box(p, this.teal, 0, 0.123, 0, 2.95, 0.025, 0.64, 0.045);
    this.joystick.position.set(-0.93, 0.16, 0);
    p.add(this.joystick);
    // The mounting base belongs to the fixed panel, not the handle pivot.
    this.cylinder(p, this.black, -0.93, 0.16, 0, 0.17, 0.045);
    this.cylinder(this.joystick, this.steel, 0, 0.17, 0, 0.031, 0.29);
    this.sphere(this.joystick, this.teal, 0, 0.32, 0, 0.12);
    this.cylinder(p, this.steel, dropButtonX, 0.16, dropButtonZ, 0.2, 0.055);
    this.button = this.cylinder(
      p,
      new THREE.MeshStandardMaterial({
      color: "#d7f2fa",
        roughness: 0.34,
        metalness: 0.05,
        emissive: "#6adfff",
        emissiveIntensity: 0.85,
      }),
      dropButtonX,
      0.205,
      dropButtonZ,
      0.156,
      0.075,
    );
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.06, 0.25),
      new THREE.MeshBasicMaterial({
        map: controlLabelTexture(),
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    plate.position.set(-0.12, 0.143, 0);
    plate.rotation.x = -Math.PI / 2;
    p.add(plate);
  }
  private buildMechanism() {
    const s = this.scene;
    for (const x of [-1.46, 1.46]) {
      const rail = this.cylinder(
        s,
        this.steel,
        x,
        MACHINE.railY,
        0,
        0.033,
        2.45,
      );
      rail.rotation.x = Math.PI / 2;
    }
    s.add(this.crossRail);
    for (const z of [-0.09, 0.09]) {
      const rail = this.cylinder(
        this.crossRail,
        this.steel,
        0,
        MACHINE.railY,
        z,
        0.033,
        3.0,
      );
      rail.rotation.z = Math.PI / 2;
    }
    for (const x of [-1.46, 1.46])
      this.box(
        this.crossRail,
        this.black,
        x,
        MACHINE.railY,
        0,
        0.17,
        0.12,
        0.28,
        0.025,
      );
    s.add(this.carriage);
    this.box(this.carriage, this.white, 0, 0, 0, 0.39, 0.14, 0.39, 0.045);
    this.cylinder(this.carriage, this.black, 0, -0.1, 0, 0.14, 0.12);
    this.cylinder(this.carriage, this.steel, 0, -0.17, 0, 0.054, 0.045);
    this.cylinder(this.carriage, this.black, 0, -0.2, 0, 0.028, 0.035);
    for (const x of [-0.15, 0.15])
      for (const z of [-0.15, 0.15])
        this.cylinder(this.carriage, this.steel, x, -0.076, z, 0.023, 0.018);
    this.cable = this.cylinder(s, this.black, 0, 3.9, 0, 0.014, 1);
    const cableMaterial = new THREE.MeshStandardMaterial({
      color: "#74818b", metalness: 0.8, roughness: 0.4,
      bumpMap: cableTexture(), bumpScale: 0.0015,
    });
    this.cable.material = cableMaterial;
    s.add(this.hub);
    this.cylinder(this.hub, this.steel, 0, 0, 0, 0.155, 0.22);
    this.cylinder(this.hub, this.white, 0, 0.11, 0, 0.175, 0.08);
    this.cylinder(this.hub, this.black, 0, -0.1, 0, 0.12, 0.06);
    this.cylinder(this.hub, this.steel, 0, 0.17, 0, 0.062, 0.065);
    this.cylinder(this.hub, this.black, 0, 0.203, 0, 0.043, 0.014);
    // Stacked strain-relief rings terminate the cable without extra animation.
    for (let i = 0; i < 4; i++)
      this.cylinder(this.hub, this.black, 0, 0.22 + i * 0.015, 0,
        0.034 - i * 0.004, 0.009);
    for (const y of [-0.075, 0.07])
      this.cylinder(this.hub, this.steel, 0, y, 0, 0.163, 0.017);
    // Short vertical slots and collar rings give the compact hub a machined finish.
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const slot = this.box(this.hub, this.black,
        Math.cos(a) * 0.155, 0.012, Math.sin(a) * 0.155,
        0.012, 0.055, 0.007);
      slot.rotation.y = Math.PI / 2 - a;
    }
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      this.sphere(
        this.hub,
        this.steel,
        Math.cos(a) * 0.16,
        -0.05,
        Math.sin(a) * 0.16,
        0.065,
      );
      const pin = this.cylinder(
        this.hub, this.white, Math.cos(a) * 0.195, -0.05,
        Math.sin(a) * 0.195, 0.032, 0.018,
      );
      pin.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(Math.cos(a), 0, Math.sin(a)),
      );
    }
    this.batchCabinet(this.hub);
    this.batchCabinet(this.carriage);
    this.batchCabinet(this.crossRail);
  }
  private buildLighting() {
    this.scene.add(new THREE.HemisphereLight("#e1ecf3", "#514238", 0.5));
    // A feathered key creates a local pool of light and one cached shadow map.
    this.key = new THREE.SpotLight("#ffead0", 155, 24, 0.62, 1, 2);
    this.key.position.set(-3.5, 8, 4.5);
    this.key.target.position.set(0, 1.6, 0);
    this.key.castShadow = true;
    Object.assign(this.key.shadow.camera, {
      near: 0.5,
      far: 24,
    });
    this.key.shadow.bias = -0.00025;
    this.key.shadow.normalBias = 0.018;
    this.key.shadow.radius = 4;
    this.scene.add(this.key, this.key.target);
    // Broad reflections come from the prefiltered environment. The rim only
    // supplies the direct edge light, without two costly area-light shaders.
    const rim = new THREE.DirectionalLight("#d1e5f0", 1.25);
    rim.position.set(3.4, 4.3, -2.7);
    this.scene.add(rim, this.prizeLight);
    this.cabinetLight = new THREE.PointLight("#ffe6be", 22, 5, 2);
    this.cabinetLight.position.set(-0.25, 3.72, 0.3);
    this.scene.add(this.cabinetLight);
  }
  private resize() {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth,
      h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.viewportHeight = h;
    this.camera.fov = this.camera.aspect < 0.8 ? 39 : 36;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(
      this.budget.reset(w, h, window.devicePixelRatio || 1, this.quality),
    );
    this.renderer.setSize(w, h, false);
    this.renderRequested = true;
  }
  setQuality(quality: Quality) {
    this.quality = quality;
    const size = quality === "high" ? 1024 : 512;
    if (this.key) {
      this.key.shadow.mapSize.set(size, size);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.scene.environmentIntensity = 0.5;
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }
  update(
    frame: SimulationFrame,
    dt: number,
    cameraIndex: number,
    lastPrizeId?: string,
  ) {
    if (this.disposed) return false;
    const stateChanged = this.lastState !== frame.state;
    this.lastState = frame.state;
    this.elapsed += dt;
    const collectedIds = new Set(
      frame.prizes.filter((prize) => prize.collected).map((prize) => prize.id),
    );
    for (const [id, celebration] of this.celebrations) {
      if (
        frame.state === "resetting" ||
        frame.state === "settling" ||
        !collectedIds.has(id)
      ) {
        celebration.dispose();
        this.celebrations.delete(id);
        if (this.featuredCelebration === celebration)
          this.featuredCelebration = undefined;
        this.renderRequested = true;
      }
    }
    const active = new Set<number>();
    for (const prize of frame.prizes) {
      if (prize.collected) {
        const mesh = this.prizeMeshes.get(prize.id);
        if (mesh) {
          mesh.position.copy(prize.position);
          mesh.quaternion.copy(prize.rotation);
          // The last collected prize is the result named by the simulation.
          // Earlier prizes still leave the chute but do not stack effects.
          this.celebrations.forEach((celebration) =>
            celebration.setFeatured(false),
          );
          this.celebrations.set(
            prize.id,
            new PrizeCelebration(
              this.scene,
              mesh,
              this.prizeLight,
              this.celebrationSequence++,
            ),
          );
          this.featuredCelebration = this.celebrations.get(prize.id);
          this.prizeMeshes.delete(prize.id);
        }
        continue;
      }
      active.add(prize.id);
      let mesh = this.prizeMeshes.get(prize.id);
      if (!mesh) {
        mesh = createPrize(prize.definition);
        this.prizeMeshes.set(prize.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.copy(prize.position);
      mesh.quaternion.copy(prize.rotation);
    }
    // Several physics steps can collect prizes before one draw. Use the
    // simulation's result even when collection order differs from mesh order.
    if (lastPrizeId) {
      const result = [...frame.prizes]
        .reverse()
        .find(
          (prize) => prize.collected && prize.definition.id === lastPrizeId,
        );
      if (result) this.featuredCelebration = this.celebrations.get(result.id);
    }
    this.celebrations.forEach((celebration) =>
      celebration.setFeatured(celebration === this.featuredCelebration),
    );
    for (const [id, mesh] of this.prizeMeshes)
      if (!active.has(id)) {
        this.scene.remove(mesh);
        mesh.traverse((part) => {
          if (part instanceof THREE.Mesh) part.geometry.dispose();
        });
        this.prizeMeshes.delete(id);
      }
    this.hub.position.copy(frame.claw);
    this.hub.quaternion.copy(frame.clawRotation);
    this.carriage.position.set(
      frame.carriage.x,
      MACHINE.railY,
      frame.carriage.z,
    );
    this.crossRail.position.z = frame.carriage.z;
    const cableLength = Math.max(0.04, MACHINE.railY - frame.carriage.y - 0.12);
    this.cable.quaternion.copy(frame.clawRotation);
    this.cable.position
      .set(0, -cableLength / 2, 0)
      .applyQuaternion(this.cable.quaternion)
      .add(this.carriage.position);
    this.cable.scale.y = cableLength;
    for (let i = 0; i < frame.arms.length; i++) {
      const arm = frame.arms[i];
      let mesh = this.armMeshes[i];
      if (!mesh) {
        // Bake shallow collars into the upper links. Their transforms still
        // come directly from the physical arms, with no decorative motion.
        let geometry: THREE.BufferGeometry = new THREE.CapsuleGeometry(
          arm.radius, arm.length, 4, 10,
        );
        if (i % 2 === 0) {
          const parts = [geometry.toNonIndexed()];
          for (const sign of [-1, 1]) {
            const collar = new THREE.CylinderGeometry(
              arm.radius * 1.035, arm.radius * 1.035,
              Math.min(0.018, arm.length * 0.08), 10,
            );
            collar.translate(0, sign * arm.length * 0.39, 0);
            parts.push(collar.toNonIndexed());
            collar.dispose();
          }
          const merged = mergeGeometries(parts);
          parts.forEach((part) => part.dispose());
          if (merged) {
            geometry.dispose();
            geometry = merged;
          }
        }
        mesh = new THREE.Mesh(
          geometry,
          i % 2 === 0 ? this.steel : this.black,
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.armMeshes.push(mesh);
      }
      mesh.position.copy(arm.position);
      mesh.quaternion.copy(arm.rotation);
    }
    this.joystick.rotation.z = THREE.MathUtils.damp(
      this.joystick.rotation.z,
      -frame.moveX * 0.2,
      15,
      dt,
    );
    this.joystick.rotation.x = THREE.MathUtils.damp(
      this.joystick.rotation.x,
      frame.moveZ * 0.2,
      15,
      dt,
    );
    if (Math.abs(this.joystick.rotation.z + frame.moveX * 0.2) < 1e-6)
      this.joystick.rotation.z = -frame.moveX * 0.2;
    if (Math.abs(this.joystick.rotation.x - frame.moveZ * 0.2) < 1e-6)
      this.joystick.rotation.x = frame.moveZ * 0.2;
    const activeSequence =
      frame.state !== "positioning" &&
      frame.state !== "settling" &&
      frame.state !== "result";
    this.button.position.y = THREE.MathUtils.damp(
      this.button.position.y,
      activeSequence ? 0.177 : 0.205,
      15,
      dt,
    );
    const buttonY = activeSequence ? 0.177 : 0.205;
    if (Math.abs(this.button.position.y - buttonY) < 1e-6)
      this.button.position.y = buttonY;
    this.statusMaterial.emissiveIntensity = activeSequence
      ? 0.45 + Math.sin(this.elapsed * 3) * 0.13
      : 0.48 + (this.reducedMotion.matches ? 0 : Math.sin(this.elapsed * 1.2) * 0.035);
    // Reuse the status light's slow idle pulse on the physical button.
    // No extra render requests or shadow updates are needed for this material.
    (this.button.material as THREE.MeshStandardMaterial).emissiveIntensity =
      activeSequence ? 0.65 : 0.85 +
        (this.reducedMotion.matches ? 0 : Math.sin(this.elapsed * 1.2) * 0.055);
    // Same target and distance make each angle useful for judging one axis.
    const aspect = this.camera.aspect;
    const portrait = aspect < 0.8;
    const compactLandscape = this.viewportHeight < 500 && aspect > 1.4;
    const distance = compactLandscape
      ? 9.2
      : portrait
        ? 15.9
        : aspect < 1.2
          ? 13.5
          : 12.7;
    const angle = cameraIndex % 2 === 0 ? 0.3 : 1.36;
    this.cameraPosition.set(
      Math.sin(angle) * distance,
      2.55 + distance * 0.3,
      Math.cos(angle) * distance,
    );
    this.target.set(0, compactLandscape ? 2.4 : 1.6, 0);
    this.camera.position.lerp(
      this.cameraPosition,
      this.initialCamera || this.reducedMotion.matches
        ? 1
        : 1 - Math.exp(-dt * 8),
    );
    if (this.camera.position.distanceToSquared(this.cameraPosition) < 1e-10)
      this.camera.position.copy(this.cameraPosition);
    this.initialCamera = false;
    this.camera.lookAt(this.target);
    const effectsWereMoving = [...this.celebrations.values()].some(
      (effect) => effect.isAnimating,
    );
    this.celebrations.forEach((celebration) =>
      celebration.update(dt, this.camera, this.reducedMotion.matches),
    );
    this.updateShadows();
    this.renderer.info.reset();
    this.camera.updateMatrixWorld();
    const cameraChanged = !this.lastCameraMatrix.equals(
      this.camera.matrixWorld,
    );
    const effectsMoving = [...this.celebrations.values()].some(
      (effect) => effect.isAnimating,
    );
    if (
      !this.renderRequested &&
      !stateChanged &&
      !this.renderer.shadowMap.needsUpdate &&
      !cameraChanged &&
      !activeSequence &&
      !effectsWereMoving &&
      !effectsMoving
    )
      return false;
    const ratio = this.budget.observe(dt * 1000);
    if (ratio !== null) this.renderer.setPixelRatio(ratio);
    this.renderer.render(this.scene, this.camera);
    this.lastCameraMatrix.copy(this.camera.matrixWorld);
    this.renderRequested = false;
    return true;
  }
  private updateShadows() {
    // Update once here; the renderer uses these same world matrices.
    this.scene.updateMatrixWorld();
    let count = 0;
    this.scene.traverseVisible((object) => {
      if (!object.castShadow) return;
      count++;
      const previous = this.shadowPoses.get(object);
      if (!previous) {
        this.shadowPoses.set(object, object.matrixWorld.clone());
        this.renderer.shadowMap.needsUpdate = true;
      } else if (
        previous.elements.some(
          (value, index) =>
            Math.abs(value - object.matrixWorld.elements[index]) > 0.0001,
        )
      ) {
        // Subpixel pendulum motion must not keep a full shadow pass running
        // after an attempt. Compare against the last drawn pose, not the last tick.
        previous.copy(object.matrixWorld);
        this.renderer.shadowMap.needsUpdate = true;
      }
    });
    if (count !== this.shadowCasterCount)
      this.renderer.shadowMap.needsUpdate = true;
    this.shadowCasterCount = count;
  }
  rotatePrize(dx: number, dy: number) {
    this.celebrations.forEach((celebration) => celebration.rotate(dx, dy));
    this.renderRequested = true;
  }
  get isPrizeReady() {
    return this.featuredCelebration?.isReady ?? false;
  }
  async storePrizes(target: HTMLElement) {
    await Promise.all(
      [...this.celebrations.values()].map((celebration) =>
        celebration.store(target),
      ),
    );
  }
  setDebugLines(vertices: Float32Array, colors: Float32Array) {
    if (!import.meta.env.DEV) return;
    this.renderRequested = true;
    if (!this.debugLines) {
      this.debugLines = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
          vertexColors: true,
          depthTest: false,
          transparent: true,
          opacity: 0.75,
        }),
      );
      this.debugLines.renderOrder = 99;
      this.scene.add(this.debugLines);
    }
    this.debugLines.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(vertices, 3),
    );
    // Rapier debug colors include alpha. Three.js needs RGB.
    const rgb = new Float32Array((colors.length / 4) * 3);
    for (let i = 0; i < colors.length / 4; i++)
      rgb.set(colors.subarray(i * 4, i * 4 + 3), i * 3);
    this.debugLines.geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(rgb, 3),
    );
    this.debugLines.geometry.computeBoundingSphere();
  }
  updateDebug(vertices: Float32Array, colors: Float32Array) {
    this.setDebugLines(vertices, colors);
  }
  clearDebugLines() {
    if (this.debugLines) {
      this.renderRequested = true;
      this.scene.remove(this.debugLines);
      this.debugLines.geometry.dispose();
      (this.debugLines.material as THREE.Material).dispose();
      this.debugLines = undefined;
    }
  }
  getPerformance() {
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      quality: this.quality,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.celebrations.forEach((celebration) => celebration.dispose());
    this.celebrations.clear();
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) geometries.add(m.geometry);
      if (m.material)
        for (const mat of Array.isArray(m.material) ? m.material : [m.material])
          materials.add(mat);
    });
    for (const m of materials) {
      for (const value of Object.values(m))
        if (value instanceof THREE.Texture) textures.add(value);
      m.dispose();
    }
    geometries.forEach((g) => g.dispose());
    textures.forEach((t) => t.dispose());
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.prizeMeshes.clear();
  }
}
