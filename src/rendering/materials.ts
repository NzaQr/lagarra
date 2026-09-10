import * as THREE from "three";

// Small, deterministic surface maps. No image requests or runtime assets.
export function surfaceTexture(repeat = 1) {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  let seed = 731;
  for (let i = 0; i < size * size; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = i % size;
    const y = Math.floor(i / size);
    // Fine grain over broad coating variation avoids a uniform plastic finish.
    const cloud = Math.sin(x * 0.12 + Math.sin(y * 0.07)) * 3
      + Math.cos(y * 0.16 + x * 0.035) * 2;
    const value = Math.round(190 + (seed >>> 27) + cloud);
    data.set([value, value, value, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function lightPoolTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const c = canvas.getContext("2d")!;
  const gradient = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,0.65)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.32)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.08)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = gradient;
  c.fillRect(0, 0, 128, 128);
  // Break up the reflected light like a finely textured, polished floor.
  // Keep the noise deterministic and baked into the shared small map.
  c.globalCompositeOperation = "destination-out";
  let seed = 193;
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x += 2) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      c.fillStyle = `rgba(0,0,0,${0.12 + (seed >>> 24) / 440})`;
      c.fillRect(x, y, 2, 1);
    }
  }
  return new THREE.CanvasTexture(canvas);
}

export function plushTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const weave = Math.sin(x * 2.7 + Math.sin(y * 1.9)) * Math.cos(y * 2.3);
      const nap = ((x * 17 + y * 31 + x * y * 7) % 29) / 29;
      const value = Math.round(205 + weave * 7 + nap * 19);
      data.set([value, value, value, 255], (y * size + x) * 4);
    }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 3);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// Diagonal strands read as braided steel on the narrow suspension cable.
export function cableTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const strand = Math.cos((x + y * 2) * Math.PI / 8);
      const value = Math.round(175 + strand * 55);
      data.set([value, value, value, 255], (y * size + x) * 4);
    }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 12);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
// A small shared strip halo replaces bloom and extra light sources.
export function stripGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const c = canvas.getContext("2d")!;
  const glow = c.createLinearGradient(0, 0, 0, 32);
  glow.addColorStop(0, "rgba(255,255,255,0)");
  glow.addColorStop(0.3, "rgba(255,255,255,0.06)");
  glow.addColorStop(0.5, "rgba(255,255,255,0.65)");
  glow.addColorStop(0.7, "rgba(255,255,255,0.06)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = glow;
  c.fillRect(0, 0, 128, 32);
  c.globalCompositeOperation = "destination-in";
  const ends = c.createLinearGradient(0, 0, 128, 0);
  ends.addColorStop(0, "transparent");
  ends.addColorStop(0.08, "white");
  ends.addColorStop(0.92, "white");
  ends.addColorStop(1, "transparent");
  c.fillStyle = ends;
  c.fillRect(0, 0, 128, 32);
  return new THREE.CanvasTexture(canvas);
}
export function labelTexture(
  text: string,
  subtext = "",
  foreground = "#eae8d8",
  background = "#184f4b",
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const c = canvas.getContext("2d")!;
  c.fillStyle = background;
  c.fillRect(0, 0, 1024, 256);
  c.fillStyle = foreground;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = "600 96px Arial, sans-serif";
  c.fillText(text, 512, subtext ? 104 : 128);
  if (subtext) {
    c.font = "500 23px Arial, sans-serif";
    c.fillText(subtext, 512, 195);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

export function controlLabelTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = 384;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#f3efe3";
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = "#203946";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = '700 150px "Outfit Variable", "Avenir Next", Arial, sans-serif';
  c.fillText("MOVE  +  DROP", canvas.width / 2, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}
export function bedTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#eee6d3";
  c.fillRect(0, 0, 256, 256);
  c.fillStyle = "#e0d8c7";
  for (let y = 0; y < 256; y += 16)
    for (let x = 0; x < 256; x += 16) {
      c.beginPath();
      c.arc(x + 8, y + 8, 1, 0, Math.PI * 2);
      c.fill();
    }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(3, 3);
  return map;
}
