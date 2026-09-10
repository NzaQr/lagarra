import * as THREE from "three";
import { spinPlan, spinProgress, WIN_MOTION } from "./WinMotion";

const smooth = (value: number) => THREE.MathUtils.smoothstep(value, 0, 1);
type ConfettiMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
interface Particle {
  mesh: ConfettiMesh;
  side: number;
  delay: number;
  speedX: number;
  speedY: number;
  drift: number;
  size: number;
  angle: number;
  tumble: number;
}

/** Starts only after the physical prize has passed through the chute. */
export class PrizeCelebration {
  private elapsed = 0;
  private yaw = 0;
  private pitch = 0;
  private disposed = false;
  private reduced = false;
  private reducedAt = 0;
  private featured = true;
  private particlesStarted = false;
  private leftChute = false;
  private particles: Particle[] = [];
  private plan;
  private storing?: {
    elapsed: number;
    position: THREE.Vector3;
    scale: number;
    target: HTMLElement;
    resolve: () => void;
    promise: Promise<void>;
  };
  private start: THREE.Vector3;
  private rotation: THREE.Quaternion;
  private scale: number;
  private radius: number;
  private effects = new THREE.Group();
  private halo: THREE.Sprite;
  private backdrop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private confetti: ConfettiMesh[] = [];
  private exit = new THREE.Vector3(-0.88, 0.57, 1.85);
  private destination = new THREE.Vector3();
  private local = new THREE.Vector3();
  private upright = new THREE.Quaternion();
  private texture: THREE.CanvasTexture;

  constructor(
    private scene: THREE.Scene,
    readonly mesh: THREE.Group,
    private light: THREE.PointLight,
    sequence = 0,
  ) {
    this.plan = spinPlan(sequence);
    this.start = mesh.position.clone();
    this.rotation = mesh.quaternion.clone();
    this.scale = mesh.scale.x;
    // Fit the actual vertices around the rotation origin. A world-axis box
    // becomes too large when the physical prize arrives tilted in the chute.
    mesh.updateWorldMatrix(true, true);
    const inverse = mesh.matrixWorld.clone().invert();
    const transform = new THREE.Matrix4();
    const point = new THREE.Vector3();
    this.radius = 0;
    mesh.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      transform.multiplyMatrices(inverse, part.matrixWorld);
      const positions = part.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(transform);
        this.radius = Math.max(this.radius, point.length() * this.scale);
      }
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d")!;
    const glow = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    glow.addColorStop(0, "rgba(237,245,255,.85)");
    glow.addColorStop(0.3, "rgba(170,209,242,.3)");
    glow.addColorStop(1, "rgba(170,209,242,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, 128, 128);
    this.texture = new THREE.CanvasTexture(canvas);
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.halo.position.z = -0.4;
    this.effects.add(this.halo);
    this.backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: "#101923",
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    scene.add(this.effects, this.backdrop);
  }

  private get stopTime() {
    return this.reduced
      ? this.reducedAt + WIN_MOTION.reducedDuration
      : WIN_MOTION.exitDuration + this.plan.duration;
  }

  get isReady() {
    return !this.disposed && this.elapsed >= this.stopTime + WIN_MOTION.pause;
  }

  get isAnimating() {
    if (this.disposed) return false;
    if (this.storing) return this.mesh.visible;
    return (
      this.elapsed <
      this.stopTime +
        WIN_MOTION.pause +
        (this.reduced
          ? 0
          : WIN_MOTION.confettiDelay +
            WIN_MOTION.secondBurstDelay +
            WIN_MOTION.confettiDuration)
    );
  }

  setFeatured(value: boolean) {
    this.featured = value;
    if (!value) this.clearConfetti();
  }

  rotate(dx: number, dy: number) {
    if (!this.isReady || this.storing) return;
    this.yaw += dx;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + dy,
      -Math.PI / 2,
      Math.PI / 2,
    );
  }

  store(target: HTMLElement): Promise<void> {
    if (this.storing) return this.storing.promise;
    if (!this.isReady || this.disposed) return Promise.resolve();
    this.clearConfetti();
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    this.storing = {
      elapsed: 0,
      position: this.mesh.position.clone(),
      scale: this.mesh.scale.x,
      target,
      resolve,
      promise,
    };
    return promise;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, reducedMotion: boolean) {
    if (this.disposed) return;
    // Latch a preference change for this reveal. Turning motion back on must
    // never restart a spin or recreate particles in the same celebration.
    if (reducedMotion && !this.reduced) {
      this.reducedAt = Math.min(
        this.elapsed,
        this.stopTime - WIN_MOTION.reducedDuration,
      );
      this.reduced = true;
      this.clearConfetti();
    }
    if (this.storing) {
      const storing = this.storing;
      storing.elapsed += dt;
      const progress = smooth(storing.elapsed / (this.reduced ? 0.18 : 0.85));
      const rect = storing.target.getBoundingClientRect();
      const halfHeight = 4 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      this.destination
        .set(
          (((rect.left + rect.width / 2) / window.innerWidth) * 2 - 1) *
            halfHeight *
            camera.aspect,
          (1 - ((rect.top + rect.height / 2) / window.innerHeight) * 2) *
            halfHeight,
          -4,
        )
        .applyQuaternion(camera.quaternion)
        .add(camera.position);
      if (!this.reduced) {
        this.mesh.position.lerpVectors(
          storing.position,
          this.destination,
          progress,
        );
        const bend = Math.sin(progress * Math.PI);
        this.mesh.position.add(
          this.local
            .set(-0.25 * bend, -0.15 * bend, 0)
            .applyQuaternion(camera.quaternion),
        );
      }
      this.mesh.scale.setScalar(storing.scale * (1 - progress * 0.98));
      this.effects.visible = false;
      this.backdrop.material.opacity = 0.72 * (1 - progress);
      this.light.intensity = 7 * (1 - progress);
      if (progress === 1) {
        this.mesh.visible = false;
        storing.resolve();
      }
      return;
    }

    this.elapsed += dt;
    const t = this.elapsed;
    const halfHeight = 4 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfWidth = halfHeight * camera.aspect;
    const centerY = halfHeight * 0.36;
    const heroScale =
      this.scale *
      Math.min(
        2.45,
        Math.min(halfWidth * 0.9, halfHeight * 0.5) / (this.radius * 1.12),
      );
    this.destination
      .set(0, centerY, -4)
      .applyQuaternion(camera.quaternion)
      .add(camera.position);

    const landing = this.local.set(-0.88, 0.57, 0.78);
    if (!this.reduced && t < 0.35) {
      this.mesh.position.lerpVectors(this.start, landing, smooth(t / 0.35));
      this.mesh.quaternion.slerpQuaternions(
        this.rotation,
        this.upright,
        smooth(t / 0.35),
      );
    } else if (!this.reduced && t < WIN_MOTION.exitDuration) {
      this.mesh.position.lerpVectors(
        landing,
        this.exit,
        smooth((t - 0.35) / 0.7),
      );
      this.mesh.quaternion.copy(this.upright);
    }

    const flight = this.reduced
      ? smooth((t - this.reducedAt) / WIN_MOTION.reducedDuration)
      : smooth((t - WIN_MOTION.exitDuration) / WIN_MOTION.flightDuration);
    // The whole trophy is in front of the dark plane before it becomes visible.
    // Fading during the flight makes the trophy appear to pass through a shadow.
    const backdropReveal = this.reduced
      ? flight
      : smooth(
          (t - WIN_MOTION.exitDuration - WIN_MOTION.flightDuration) /
            WIN_MOTION.backdropDuration,
        );
    if (this.reduced || t >= WIN_MOTION.exitDuration) {
      if (!this.leftChute) {
        this.leftChute = true;
        // The enlarged display model must not cast a moving shadow over the
        // cabinet or pass through shadows from the physical machine.
        this.mesh.traverse((part) => {
          if (part instanceof THREE.Mesh) {
            part.castShadow = false;
            part.receiveShadow = false;
          }
        });
      }
      // Reduced motion uses a small scale transition at the final location.
      this.mesh.position.lerpVectors(
        this.exit,
        this.destination,
        this.reduced ? 1 : flight,
      );
      this.mesh.quaternion.slerpQuaternions(
        this.upright,
        camera.quaternion,
        this.reduced ? 1 : flight,
      );
      if (!this.reduced && t < this.stopTime) {
        const progress = spinProgress(
          (t - WIN_MOTION.exitDuration) / this.plan.duration,
        );
        this.mesh.rotateY(progress * this.plan.turns * Math.PI * 2);
      }
      if (t >= this.stopTime) {
        // Copy the exact endpoint; accumulated rotations cannot change the result.
        this.mesh.quaternion.copy(camera.quaternion);
        this.mesh.rotateX(this.pitch);
        this.mesh.rotateY(this.yaw);
      }
      const pulseTime =
        (t - this.stopTime - WIN_MOTION.pause) / WIN_MOTION.pulseDuration;
      const pulse =
        !this.reduced && pulseTime > 0 && pulseTime < 1
          ? Math.sin(pulseTime * Math.PI) ** 2
          : 0;
      this.mesh.scale.setScalar(
        (this.reduced
          ? heroScale * (0.98 + flight * 0.02)
          : THREE.MathUtils.lerp(this.scale, heroScale, flight)) *
          (1 + pulse * 0.045),
      );
      this.halo.material.opacity = backdropReveal * (0.2 + pulse * 0.2);
    }
    this.mesh.visible =
      this.featured || (!this.reduced && t < WIN_MOTION.exitDuration);
    this.effects.visible = this.featured;
    this.backdrop.visible = this.featured;
    this.effects.position.copy(this.destination);
    this.effects.quaternion.copy(camera.quaternion);
    this.halo.scale.setScalar(Math.min(2.8, halfWidth * 1.7, halfHeight * 1.5));
    this.backdrop.position
      .set(0, 0, -6)
      .applyQuaternion(camera.quaternion)
      .add(camera.position);
    this.backdrop.quaternion.copy(camera.quaternion);
    this.backdrop.scale.set(halfHeight * 3 * camera.aspect, halfHeight * 3, 1);
    this.backdrop.material.opacity = backdropReveal * 0.72;
    if (this.featured) {
      this.light.position
        .copy(this.mesh.position)
        .add(this.local.set(-0.5, 1, 1.4).applyQuaternion(camera.quaternion));
      this.light.intensity = flight * 7;
    }
    const burst =
      t - this.stopTime - WIN_MOTION.pause - WIN_MOTION.confettiDelay;
    if (this.featured && !this.reduced && burst >= 0) {
      const end = WIN_MOTION.confettiDuration + WIN_MOTION.secondBurstDelay;
      if (burst >= end) this.clearConfetti();
      else {
        if (!this.particlesStarted) this.createConfetti(camera.aspect);
        this.updateConfetti(
          burst,
          halfWidth,
          halfHeight,
          centerY,
          (this.radius * heroScale) / this.scale,
        );
      }
    }
  }

  private createConfetti(aspect: number) {
    this.particlesStarted = true;
    const colors = ["#ecf1f7", "#b4d4ec", "#aebdcd", "#6889a5"];
    const shapes = [
      new THREE.PlaneGeometry(1, 1.6),
      new THREE.CircleGeometry(0.6, 8),
      new THREE.PlaneGeometry(0.5, 2.8),
    ];
    const count = aspect < 0.8 ? 32 : 40;
    // A local generator cannot consume randomness used by the game.
    let seed = this.plan.turns * 173;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      const shape = i % 8 === 0 ? 2 : i % 3 === 0 ? 1 : 0;
      const mesh = new THREE.Mesh(
        shapes[shape],
        new THREE.MeshBasicMaterial({
          color: colors[i % colors.length],
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      mesh.visible = false;
      this.confetti.push(mesh);
      this.effects.add(mesh);
      this.particles.push({
        mesh,
        side: i % 2 === 0 ? -1 : 1,
        delay: i < count * 0.75 ? 0 : WIN_MOTION.secondBurstDelay,
        speedX: 1.4 + random() * 0.9,
        speedY: 1.7 + random() * 2.1,
        drift: 0.08 + random() * 0.12,
        size: 0.05 + random() * 0.028,
        angle: random() * Math.PI * 2,
        tumble: 2 + random() * 3,
      });
    }
  }

  private updateConfetti(
    time: number,
    halfWidth: number,
    halfHeight: number,
    centerY: number,
    heroRadius: number,
  ) {
    for (const p of this.particles) {
      const age = time - p.delay;
      const depth = heroRadius + 0.12;
      const perspective = 1 + depth / 4;
      const spread = Math.min(
        heroRadius * (1.65 + (p.speedX - 1.4) * 0.65),
        halfWidth * perspective * (0.82 + p.drift * 0.45),
      );
      // Air drag slows the outward burst near the trophy. On a phone, pieces
      // remain in the side gaps instead of leaving the screen immediately.
      const travel = 1 - Math.exp(-(3 + p.speedX) * Math.max(0, age));
      const x =
        p.side *
        (THREE.MathUtils.lerp(heroRadius * 0.22, spread, travel) +
          p.drift * heroRadius * age * 0.05);
      const y = heroRadius * (-0.12 + p.speedY * age - 1.75 * age * age);
      // Start behind the model and let its depth buffer hide the launch points.
      // Pieces become visible as they spread past the silhouette, never over its face.
      p.mesh.position.set(x, y, -depth);
      p.mesh.scale.setScalar(p.size * heroRadius);
      const screenX = x / (halfWidth * perspective);
      const screenY = (y + centerY) / (halfHeight * perspective);
      const edgeFade =
        (1 - smooth((Math.abs(screenX) - 0.88) / 0.1)) *
        (1 - smooth((screenY - 0.76) / 0.12)) *
        smooth((screenY + 0.78) / 0.18);
      p.mesh.rotation.set(
        age * p.tumble,
        p.angle + age * 2,
        p.angle + age * p.side,
      );
      p.mesh.material.opacity =
        0.85 *
        smooth(age / 0.08) *
        (1 - smooth((age - 1.1) / (WIN_MOTION.confettiDuration - 1.1))) *
        edgeFade;
      p.mesh.visible =
        age >= 0 && age < WIN_MOTION.confettiDuration && edgeFade > 0;
    }
  }

  private clearConfetti() {
    const geometries = new Set(this.confetti.map((piece) => piece.geometry));
    for (const piece of this.confetti) {
      this.effects.remove(piece);
      piece.material.dispose();
    }
    geometries.forEach((geometry) => geometry.dispose());
    this.confetti = [];
    this.particles = [];
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.storing?.resolve();
    this.clearConfetti();
    this.scene.remove(this.mesh, this.effects, this.backdrop);
    this.mesh.traverse((part) => {
      if (part instanceof THREE.Mesh) part.geometry.dispose();
    });
    this.texture.dispose();
    this.halo.material.dispose();
    this.backdrop.geometry.dispose();
    this.backdrop.material.dispose();
    if (this.featured) this.light.intensity = 0;
  }
}
