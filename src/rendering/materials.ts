import * as THREE from "three";
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
  return texture;
}
export function bedTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#dde0cf";
  c.fillRect(0, 0, 256, 256);
  c.fillStyle = "#c4cabb";
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
