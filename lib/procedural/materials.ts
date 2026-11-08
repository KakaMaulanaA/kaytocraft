import * as THREE from "three";
import type { MatKind } from "./detect";

/** Small seeded RNG so a given seed always gives the same model. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!] as const;
}

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * k)));
  return `#${c.getHexString()}`;
}

function texture(c: HTMLCanvasElement, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

/** Wood grain: long wavy lines plus a few knots. */
export function woodTexture(base: string, seed: number) {
  const r = rng(seed);
  const [c, g] = canvas(512);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 140; i++) {
    const y0 = r() * 512;
    const amp = 2 + r() * 6;
    const freq = 0.004 + r() * 0.01;
    const phase = r() * 10;
    g.strokeStyle = r() > 0.5 ? shade(base, 0.72 + r() * 0.15) : shade(base, 1.08 + r() * 0.1);
    g.globalAlpha = 0.12 + r() * 0.3;
    g.lineWidth = 0.6 + r() * 2.2;
    g.beginPath();
    for (let x = 0; x <= 512; x += 8) {
      const y = y0 + Math.sin(x * freq + phase) * amp;
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let k = 0; k < 2; k++) {
    const x = r() * 512;
    const y = r() * 512;
    for (let ring = 1; ring < 7; ring++) {
      g.globalAlpha = 0.18;
      g.strokeStyle = shade(base, 0.6);
      g.beginPath();
      g.ellipse(x, y, ring * 5, ring * 2.2, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  return texture(c);
}

function marbleTexture(base: string, seed: number) {
  const r = rng(seed);
  const [c, g] = canvas(512);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 18; i++) {
    g.strokeStyle = shade(base, 0.62);
    g.globalAlpha = 0.15 + r() * 0.35;
    g.lineWidth = 0.5 + r() * 2;
    g.beginPath();
    let x = r() * 512;
    let y = 0;
    g.moveTo(x, y);
    while (y < 512) {
      x += (r() - 0.5) * 40;
      y += 10 + r() * 25;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  return texture(c);
}

function weaveTexture(base: string) {
  const [c, g] = canvas(256);
  g.fillStyle = shade(base, 0.7);
  g.fillRect(0, 0, 256, 256);
  const s = 16;
  for (let y = 0; y < 256; y += s) {
    for (let x = 0; x < 256; x += s) {
      const hor = ((x + y) / s) % 2 === 0;
      const grd = hor ? g.createLinearGradient(x, y, x, y + s) : g.createLinearGradient(x, y, x + s, y);
      grd.addColorStop(0, shade(base, 0.85));
      grd.addColorStop(0.5, shade(base, 1.15));
      grd.addColorStop(1, shade(base, 0.85));
      g.fillStyle = grd;
      g.fillRect(x + 1, y + 1, s - 2, s - 2);
    }
  }
  return texture(c, 3);
}

function noiseTexture(base: string, seed: number, amount = 0.12) {
  const r = rng(seed);
  const [c, g] = canvas(256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = r() > 0.5 ? shade(base, 1 + amount) : shade(base, 1 - amount);
    g.globalAlpha = 0.5;
    g.fillRect(r() * 256, r() * 256, 1.5, 1.5);
  }
  g.globalAlpha = 1;
  return texture(c, 2);
}

export interface MatOpts {
  kind: MatKind;
  color?: string; // paint / tint
  woodTone?: string;
  metalTone?: string;
  seed: number;
  dark?: boolean; // aged look
}

export function makeMaterial(o: MatOpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial();
  switch (o.kind) {
    case "wood": {
      if (o.color) {
        // painted wood
        m.color.set(o.color);
        m.roughness = 0.55;
        break;
      }
      const tone = o.dark ? shade(o.woodTone ?? "#8a5a34", 0.65) : (o.woodTone ?? "#b98552");
      m.map = woodTexture(tone, o.seed);
      m.roughness = 0.62;
      break;
    }
    case "metal":
      m.color.set(o.color ?? o.metalTone ?? "#9aa0a6");
      m.metalness = 1;
      m.roughness = o.dark ? 0.6 : 0.32;
      break;
    case "gold":
      m.color.set("#d4a437");
      m.metalness = 1;
      m.roughness = 0.28;
      break;
    case "plastic":
      m.color.set(o.color ?? "#e9e7e2");
      m.roughness = 0.42;
      break;
    case "glass":
      m.color.set(o.color ?? "#9fd3c7");
      m.roughness = 0.05;
      m.metalness = 0;
      m.transparent = true;
      m.opacity = 0.45;
      break;
    case "ceramic":
      m.color.set(o.color ?? "#e6e1d6");
      m.roughness = 0.22;
      break;
    case "fabric":
      m.map = noiseTexture(o.color ?? "#5d6b7a", o.seed, 0.08);
      m.roughness = 0.95;
      break;
    case "leather":
      m.map = noiseTexture(o.color ?? "#5a3826", o.seed, 0.05);
      m.roughness = 0.5;
      break;
    case "stone":
      m.map = noiseTexture(o.color ?? "#9a9690", o.seed, 0.15);
      m.roughness = 0.9;
      break;
    case "marble":
      m.map = marbleTexture(o.color ?? "#ecebe8", o.seed);
      m.roughness = 0.18;
      break;
    case "rattan":
      m.map = weaveTexture(o.color ?? "#b4864c");
      m.roughness = 0.7;
      break;
    case "rubber":
      m.color.set(o.color ?? "#1d1d1f");
      m.roughness = 0.85;
      break;
  }
  m.name = `${o.kind}${o.color ? `_${o.color.slice(1)}` : ""}`;
  return m;
}

export function emissive(color: string) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, name: "glow" });
}
