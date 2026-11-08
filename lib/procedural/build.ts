import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MatKind, ProcParams } from "./detect";
import { emissive, makeMaterial, rng } from "./materials";

/**
 * Free procedural generator. Builds clean, real-world-scaled (meters) base meshes
 * from parsed prompt parameters. Every part gets a readable name for Blender.
 */

type V3 = [number, number, number];
type Rand = () => number;

interface Ctx {
  p: ProcParams;
  r: Rand;
  seed: number;
  mat: (kind: MatKind, opts?: { color?: string; dark?: boolean; tone?: string }) => THREE.Material;
  bevel: number; // corner radius multiplier (cartoon = rounder)
}

const pick = <T,>(r: Rand, list: T[]) => list[Math.floor(r() * list.length) % list.length];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, name: string, pos: V3 = [0, 0, 0], rot?: V3) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  parent.add(m);
  return m;
}

function rbox(w: number, h: number, d: number, radius: number, segments = 3) {
  const r = Math.max(0.0005, Math.min(radius, Math.min(w, h, d) / 2 - 0.0005));
  return new RoundedBoxGeometry(w, h, d, segments, r);
}

/** Cylinder whose base sits at y=0. */
function cyl(rTop: number, rBottom: number, h: number, seg = 24) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
  g.translate(0, h / 2, 0);
  return g;
}

/** Lathe from [radius, height] pairs, base at y=0. */
function lathe(points: [number, number][], seg = 40) {
  const g = new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y)), seg);
  return mergeVertices(g, 1e-5);
}

// ------------------------------------------------------------------ shared parts

type LegStyle = "tapered" | "turned" | "square" | "metalRod" | "chunky";

function legStyle(c: Ctx, legMat: MatKind): LegStyle {
  const s = c.p.style;
  if (s.cartoon) return "chunky";
  if (legMat === "metal" || legMat === "gold" || s.industrial || s.scifi) return c.r() > 0.5 ? "metalRod" : "square";
  if (s.classic) return "turned";
  if (s.modern) return "tapered";
  return pick(c.r, ["tapered", "square", "tapered", "turned"] as LegStyle[]);
}

function leg(style: LegStyle, h: number, r: number): THREE.BufferGeometry {
  switch (style) {
    case "tapered":
      return cyl(r * 0.95, r * 0.6, h, 20);
    case "metalRod":
      return cyl(r * 0.45, r * 0.45, h, 16);
    case "square":
      return rbox(r * 1.7, h, r * 1.7, r * 0.25).translate(0, h / 2, 0);
    case "chunky":
      return rbox(r * 2.6, h, r * 2.6, r * 0.9).translate(0, h / 2, 0);
    case "turned":
      return lathe(
        [
          [r * 0.7, 0],
          [r * 0.75, h * 0.04],
          [r * 0.62, h * 0.1],
          [r * 0.7, h * 0.45],
          [r * 1.25, h * 0.55],
          [r * 0.85, h * 0.6],
          [r * 1.1, h * 0.66],
          [r * 0.95, h * 0.72],
          [r * 1.15, h * 0.76],
          [r * 1.15, h],
          [0, h],
        ],
        20,
      );
  }
}

/** Which material the legs/frame use, honoring "metal legs" / "wooden legs". */
function frameMaterial(c: Ctx, fallback: MatKind): MatKind {
  const t = c.p.text;
  if (/\b(metal|steel|iron|chrome)\s+(legs|frame|base)\b/.test(t)) return "metal";
  if (/\b(gold|golden|brass)\s+(legs|frame|base)\b/.test(t)) return "gold";
  if (/\b(wood|wooden|oak|teak|walnut|pine)\s+(legs|frame|base)\b/.test(t)) return "wood";
  return fallback;
}

function mainMat(c: Ctx, fallback: MatKind) {
  return c.p.material ?? fallback;
}

// ------------------------------------------------------------------ generators

function table(c: Ctx, root: THREE.Group) {
  const { p, r } = c;
  const coffee = p.has(/\bcoffee table\b/) || p.has(/\bside table\b/);
  const desk = p.has(/\b(desk|study desk|office desk)\b/);
  const round = p.round || p.oval;
  let H = (coffee ? 0.45 : 0.75) * p.tall;
  let W = (coffee ? 1.1 : desk ? 1.3 : p.square ? 0.9 : 1.5) * p.long;
  let D = coffee ? 0.6 : desk ? 0.65 : p.square ? 0.9 : 0.85;
  if (round && !p.oval) W = D = coffee ? 0.8 : 1.1;
  if (p.oval) D = W * 0.6;
  W *= p.scale;
  D *= p.scale;
  H *= p.scale > 1 ? 1 : p.scale < 1 ? 0.92 : 1;

  const topKind = mainMat(c, "wood");
  const legKind = frameMaterial(c, topKind === "glass" || topKind === "marble" || topKind === "stone" ? "metal" : topKind);
  const topMat = c.mat(topKind, { color: p.color });
  const legMat = c.mat(legKind, { color: legKind === topKind ? p.color : undefined });
  const style = legStyle(c, legKind);
  const T = (p.style.cartoon ? 0.07 : topKind === "glass" ? 0.015 : p.style.rustic ? 0.06 : 0.04) * Math.max(1, p.scale);

  if (round) {
    const top = new THREE.CylinderGeometry(W / 2, W / 2, T, 64);
    top.scale(1, 1, D / W);
    mesh(root, top, topMat, "Table_Top", [0, H - T / 2, 0]);
    // edge bevel ring for a finished look
    const ring = new THREE.TorusGeometry(W / 2 - 0.002, T * 0.35, 8, 64);
    ring.rotateX(Math.PI / 2);
    ring.scale(1, 1, D / W);
    mesh(root, ring, topMat, "Table_Top_Edge", [0, H - T / 2, 0]);
  } else {
    mesh(root, rbox(W, T, D, T * 0.35 * c.bevel), topMat, "Table_Top", [0, H - T / 2, 0]);
  }

  const legH = H - T;
  const legR = (style === "chunky" ? 0.03 : 0.028) * Math.max(1, p.scale);
  const pedestal = round && !p.legs && (p.legs === 1 || r() < 0.45);
  if (p.legs === 1 || pedestal) {
    const prof: [number, number][] = [
      [W * 0.28, 0],
      [W * 0.28, 0.02],
      [W * 0.1, 0.06],
      [0.05, 0.14],
      [0.045, legH * 0.85],
      [0.09, legH * 0.95],
      [0.12, legH],
      [0, legH],
    ];
    mesh(root, lathe(prof, 48), legMat, "Table_Pedestal");
  } else {
    const n = p.legs ?? 4;
    const inset = style === "turned" ? 0.08 : 0.06;
    const pts: [number, number][] = [];
    if (round) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.PI / 4;
        pts.push([Math.cos(a) * (W / 2 - inset * 1.4), Math.sin(a) * (D / 2 - inset * 1.4)]);
      }
    } else if (n === 4) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx * (W / 2 - inset), sz * (D / 2 - inset)]);
    } else {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push([Math.cos(a) * (W / 2 - inset), Math.sin(a) * (D / 2 - inset)]);
      }
    }
    pts.forEach(([x, z], i) => mesh(root, leg(style, legH, legR), legMat, `Table_Leg_${i + 1}`, [x, 0, z]));
    // apron under the top for rectangular / classic tables
    if (!round && n === 4 && style !== "metalRod" && legKind === topKind) {
      const aH = 0.08;
      const y = legH - aH / 2;
      mesh(root, rbox(W - inset * 2, aH, 0.02, 0.004), topMat, "Table_Apron_Front", [0, y, D / 2 - inset]);
      mesh(root, rbox(W - inset * 2, aH, 0.02, 0.004), topMat, "Table_Apron_Back", [0, y, -(D / 2 - inset)]);
      mesh(root, rbox(0.02, aH, D - inset * 2, 0.004), topMat, "Table_Apron_Left", [-(W / 2 - inset), y, 0]);
      mesh(root, rbox(0.02, aH, D - inset * 2, 0.004), topMat, "Table_Apron_Right", [W / 2 - inset, y, 0]);
    }
    if (style === "metalRod" && !round && n === 4) {
      // stretchers for industrial look
      mesh(root, cyl(0.012, 0.012, W - inset * 2, 12).rotateZ(Math.PI / 2).translate((W - inset * 2) / 2, 0, 0), legMat, "Table_Stretcher_F", [0, 0.15, D / 2 - inset]);
      mesh(root, cyl(0.012, 0.012, W - inset * 2, 12).rotateZ(Math.PI / 2).translate((W - inset * 2) / 2, 0, 0), legMat, "Table_Stretcher_B", [0, 0.15, -(D / 2 - inset)]);
    }
  }
  if (desk && !round) {
    // drawer unit on the right
    const dw = 0.4;
    const dh = 0.45;
    const x = W / 2 - inset(dw);
    mesh(root, rbox(dw, dh, D - 0.08, 0.008), topMat, "Desk_DrawerBox", [x, H - T - dh / 2, 0]);
    for (let i = 0; i < 3; i++) {
      const y = H - T - 0.08 - i * 0.14;
      mesh(root, rbox(dw - 0.04, 0.12, 0.015, 0.004), topMat, `Desk_Drawer_${i + 1}`, [x, y, D / 2 - 0.035]);
      mesh(root, rbox(0.1, 0.012, 0.02, 0.005), c.mat("metal"), `Desk_Handle_${i + 1}`, [x, y, D / 2 - 0.02]);
    }
  }
  function inset(dw: number) {
    return dw / 2 + 0.04;
  }
}

function chair(c: Ctx, root: THREE.Group) {
  const { p, r } = c;
  const seatH = 0.45 * p.tall;
  const W = 0.46 * p.scale;
  const D = 0.46 * p.scale;
  const backH = (p.style.classic ? 0.55 : 0.45) * p.tall;
  const kind = mainMat(c, "wood");
  const upholstered = kind === "fabric" || kind === "leather";
  const molded = kind === "plastic";
  const frameKind = frameMaterial(c, molded ? (r() > 0.5 ? "wood" : "metal") : upholstered ? "wood" : kind);
  const seatMat = c.mat(kind, { color: p.color });
  const frameMat = c.mat(frameKind, { color: frameKind === kind ? p.color : undefined, dark: upholstered && !p.style.modern });
  const style = legStyle(c, frameKind);
  const legR = 0.022;
  const seatT = upholstered ? 0.09 : molded ? 0.025 : 0.035;
  const inset = 0.035;
  const legH = seatH - seatT;

  // seat
  mesh(root, rbox(W, seatT, D, (upholstered ? 0.03 : molded ? 0.012 : 0.008) * c.bevel), seatMat, "Chair_Seat", [0, legH + seatT / 2, 0]);

  // legs (back legs continue up as posts unless molded)
  const xs = [-(W / 2 - inset), W / 2 - inset];
  const splay = molded ? 0.06 : 0;
  xs.forEach((x, i) => {
    mesh(root, leg(style, legH, legR), frameMat, `Chair_Leg_Front_${i + 1}`, [x * (1 + splay), 0, D / 2 - inset], [splay * 0.6, 0, -Math.sign(x) * splay]);
    mesh(root, leg(style, legH, legR), frameMat, `Chair_Leg_Back_${i + 1}`, [x * (1 + splay), 0, -(D / 2 - inset)], [-splay * 0.6, 0, -Math.sign(x) * splay]);
  });

  const top = seatH + backH;
  const tilt = -0.12;
  if (molded) {
    // one-piece shell back
    const back = rbox(W * 0.95, backH * 0.75, 0.025, 0.012);
    const m = mesh(root, back, seatMat, "Chair_Back_Shell", [0, seatH + backH * 0.5, -D / 2 + 0.02], [tilt, 0, 0]);
    m.scale.set(1, 1, 1);
    // back supports
    xs.forEach((x, i) =>
      mesh(root, cyl(0.01, 0.01, backH * 0.4, 10), frameMat, `Chair_Back_Support_${i + 1}`, [x * 0.7, seatH, -D / 2 + 0.03], [tilt, 0, 0]),
    );
  } else {
    // posts
    xs.forEach((x, i) =>
      mesh(root, rbox(0.035, backH, 0.035, 0.008), frameMat, `Chair_Back_Post_${i + 1}`, [x, seatH + backH / 2, -(D / 2 - inset)], [tilt, 0, 0]),
    );
    const zTop = -(D / 2 - inset) + Math.sin(-tilt) * -backH * 0.5;
    if (upholstered) {
      mesh(root, rbox(W - 0.02, backH * 0.8, 0.07, 0.025 * c.bevel), seatMat, "Chair_Back_Cushion", [0, seatH + backH * 0.5, zTop * 0.95], [tilt, 0, 0]);
    } else if (p.style.classic || p.style.rustic || r() < 0.35) {
      // top rail + vertical slats
      mesh(root, rbox(W - 0.04, 0.07, 0.03, 0.008), frameMat, "Chair_Back_TopRail", [0, top - 0.06, zTop], [tilt, 0, 0]);
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const x = lerp(-(W / 2 - inset) + 0.06, W / 2 - inset - 0.06, n === 1 ? 0.5 : i / (n - 1));
        mesh(root, rbox(0.03, backH * 0.65, 0.015, 0.004), frameMat, `Chair_Back_Slat_${i + 1}`, [x, seatH + backH * 0.42, zTop * 0.98], [tilt, 0, 0]);
      }
    } else {
      // modern curved backrest panel
      const panel = rbox(W - 0.03, backH * 0.38, 0.022, 0.01);
      mesh(root, panel, kind === "rattan" ? seatMat : frameMat, "Chair_Back_Panel", [0, top - backH * 0.25, zTop], [tilt, 0, 0]);
    }
    if (kind === "rattan") {
      mesh(root, rbox(W - 0.08, backH * 0.75, 0.014, 0.004), seatMat, "Chair_Back_Weave", [0, seatH + backH * 0.48, zTop * 0.97], [tilt, 0, 0]);
    }
  }

  // stretchers for wooden chairs
  if (!molded && frameKind === "wood" && style !== "chunky") {
    const y = 0.14;
    xs.forEach((x, i) => mesh(root, rbox(0.02, 0.02, D - inset * 2, 0.004), frameMat, `Chair_Stretcher_Side_${i + 1}`, [x, y, 0]));
    mesh(root, rbox(W - inset * 2, 0.02, 0.02, 0.004), frameMat, "Chair_Stretcher_Front", [0, y + 0.04, D / 2 - inset]);
  }

  // armrests
  if (p.has(/\b(armchair|armrests?|arms)\b/)) {
    xs.forEach((x, i) => {
      const side = Math.sign(x);
      mesh(root, rbox(0.05, 0.03, D * 0.85, 0.012), upholstered ? seatMat : frameMat, `Chair_Armrest_${i + 1}`, [x + side * 0.02, seatH + 0.22, 0.01]);
      mesh(root, rbox(0.03, 0.22, 0.03, 0.006), frameMat, `Chair_Arm_Post_${i + 1}`, [x + side * 0.02, seatH + 0.11, D / 2 - inset - 0.02]);
    });
  }
}

function officeChair(c: Ctx, root: THREE.Group) {
  const { p } = c;
  const kind = p.material === "fabric" || p.material === "leather" ? p.material : "leather";
  const cushion = c.mat(kind, { color: p.color ?? "#26272b" });
  const metal = c.mat("metal", { color: p.style.modern ? undefined : "#2a2b2e" });
  const plastic = c.mat("plastic", { color: "#1f2023" });
  const seatH = 0.5;
  // 5-star base + casters
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const arm = rbox(0.3, 0.035, 0.05, 0.012);
    arm.translate(0.15, 0, 0);
    mesh(root, arm, plastic, `Base_Arm_${i + 1}`, [0, 0.085, 0], [0, -a, -0.08]);
    const wx = Math.cos(a) * 0.3;
    const wz = Math.sin(a) * 0.3;
    const wheel = new THREE.TorusGeometry(0.025, 0.014, 10, 20);
    mesh(root, wheel, c.mat("rubber"), `Caster_${i + 1}`, [wx, 0.039, wz], [0, -a + Math.PI / 2, 0]);
    mesh(root, cyl(0.012, 0.012, 0.03, 10), metal, `Caster_Stem_${i + 1}`, [wx, 0.055, wz]);
  }
  mesh(root, cyl(0.045, 0.06, 0.06, 24), plastic, "Base_Hub", [0, 0.07, 0]);
  mesh(root, cyl(0.025, 0.025, seatH - 0.13, 20), metal, "Gas_Lift", [0, 0.12, 0]);
  mesh(root, rbox(0.2, 0.05, 0.22, 0.01), plastic, "Seat_Mechanism", [0, seatH - 0.04, 0]);
  // seat + back
  mesh(root, rbox(0.52, 0.09, 0.5, 0.04), cushion, "Seat_Cushion", [0, seatH + 0.02, 0.02]);
  mesh(root, rbox(0.06, 0.38, 0.04, 0.015), plastic, "Back_Spine", [0, seatH + 0.15, -0.26], [-0.12, 0, 0]);
  const tall = p.has(/\bgaming\b/) || p.style.classic ? 0.75 : 0.58;
  mesh(root, rbox(0.5, tall, 0.09, 0.045), cushion, "Back_Cushion", [0, seatH + 0.12 + tall / 2, -0.3], [-0.12, 0, 0]);
  if (p.has(/\bgaming\b/)) mesh(root, rbox(0.28, 0.1, 0.07, 0.03), cushion, "Headrest_Pillow", [0, seatH + 0.12 + tall - 0.08, -0.34], [-0.12, 0, 0]);
  // armrests
  for (const s of [-1, 1]) {
    mesh(root, rbox(0.04, 0.2, 0.05, 0.01), plastic, `Armrest_Post_${s > 0 ? "R" : "L"}`, [s * 0.28, seatH + 0.12, -0.02]);
    mesh(root, rbox(0.08, 0.035, 0.26, 0.015), plastic, `Armrest_Pad_${s > 0 ? "R" : "L"}`, [s * 0.28, seatH + 0.23, 0.0]);
  }
}

function stool(c: Ctx, root: THREE.Group) {
  const { p, r } = c;
  const bar = p.has(/\bbar stool\b/) || p.tall > 1;
  const H = (bar ? 0.75 : 0.46) * p.scale;
  const R = 0.17 * p.scale;
  const kind = mainMat(c, "wood");
  const frameKind = frameMaterial(c, kind === "fabric" || kind === "leather" ? "wood" : kind);
  const seatMat = c.mat(kind, { color: p.color });
  const frameMat = c.mat(frameKind, { color: frameKind === kind ? p.color : undefined });
  const T = 0.04;
  mesh(root, cyl(R, R * 0.98, T, 40), seatMat, "Stool_Seat", [0, H - T, 0]);
  const n = p.legs ?? (r() > 0.5 ? 3 : 4);
  const spread = R * 1.25;
  const legLen = H - T;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const topX = Math.cos(a) * R * 0.6;
    const topZ = Math.sin(a) * R * 0.6;
    const botX = Math.cos(a) * spread;
    const botZ = Math.sin(a) * spread;
    const dir = new THREE.Vector3(topX - botX, legLen, topZ - botZ);
    const len = dir.length();
    const g = cyl(0.016, 0.02, len, 14);
    const m = mesh(root, g, frameMat, `Stool_Leg_${i + 1}`, [botX, 0, botZ]);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }
  const ringY = H * 0.35;
  const ringR = lerp(spread, R * 0.6, ringY / legLen);
  const ring = new THREE.TorusGeometry(ringR, 0.011, 8, 48);
  ring.rotateX(Math.PI / 2);
  mesh(root, ring, frameMat, "Stool_Footrest", [0, ringY, 0]);
}

function bench(c: Ctx, root: THREE.Group) {
  const { p } = c;
  const W = 1.3 * p.long * p.scale;
  const D = 0.38;
  const H = 0.45;
  const kind = mainMat(c, "wood");
  const frameKind = frameMaterial(c, p.has(/\bpark\b/) ? "metal" : kind);
  const seatMat = c.mat(kind, { color: p.color });
  const frameMat = c.mat(frameKind, { color: frameKind === kind ? p.color : undefined, dark: frameKind === "metal" });
  const park = p.has(/\b(park|garden|backrest)\b/);
  if (park || p.has(/\bslat/)) {
    for (let i = 0; i < 4; i++) mesh(root, rbox(W, 0.03, 0.08, 0.008), seatMat, `Bench_Slat_${i + 1}`, [0, H - 0.015, -D / 2 + 0.05 + i * 0.095]);
  } else {
    mesh(root, rbox(W, 0.05, D, 0.012 * c.bevel), seatMat, "Bench_Seat", [0, H - 0.025, 0]);
  }
  for (const s of [-1, 1]) {
    if (frameKind === "metal") {
      mesh(root, rbox(0.04, H - 0.03, D * 0.95, 0.01), frameMat, `Bench_Side_${s > 0 ? "R" : "L"}`, [s * (W / 2 - 0.12), (H - 0.03) / 2, 0]);
    } else {
      mesh(root, rbox(0.06, H - 0.05, D * 0.9, 0.01), frameMat, `Bench_Leg_${s > 0 ? "R" : "L"}`, [s * (W / 2 - 0.12), (H - 0.05) / 2, 0]);
    }
  }
  if (park) {
    for (let i = 0; i < 3; i++) mesh(root, rbox(W, 0.07, 0.025, 0.008), seatMat, `Bench_Back_Slat_${i + 1}`, [0, H + 0.12 + i * 0.1, -D / 2 - 0.02 - i * 0.012], [-0.15, 0, 0]);
    for (const s of [-1, 1]) mesh(root, rbox(0.04, 0.4, 0.035, 0.008), frameMat, `Bench_Back_Post_${s > 0 ? "R" : "L"}`, [s * (W / 2 - 0.12), H + 0.18, -D / 2 - 0.01], [-0.15, 0, 0]);
  }
}

function carcass(c: Ctx, root: THREE.Group, W: number, H: number, D: number, mat: THREE.Material, prefix: string, plinth = 0.06) {
  const t = 0.02;
  mesh(root, rbox(t, H - plinth, D, 0.004), mat, `${prefix}_Side_L`, [-W / 2 + t / 2, plinth + (H - plinth) / 2, 0]);
  mesh(root, rbox(t, H - plinth, D, 0.004), mat, `${prefix}_Side_R`, [W / 2 - t / 2, plinth + (H - plinth) / 2, 0]);
  mesh(root, rbox(W + 0.02, t * 1.4, D + 0.02, 0.006), mat, `${prefix}_Top`, [0, H - t * 0.7, 0]);
  mesh(root, rbox(W - t * 2, t, D, 0.003), mat, `${prefix}_Bottom`, [0, plinth + t / 2, 0]);
  mesh(root, rbox(W - t * 2, H - plinth, 0.008, 0.002), mat, `${prefix}_Back`, [0, plinth + (H - plinth) / 2, -D / 2 + 0.004]);
  if (plinth > 0) mesh(root, rbox(W - 0.03, plinth, D - 0.04, 0.004), mat, `${prefix}_Plinth`, [0, plinth / 2, -0.01]);
}

function handle(c: Ctx, parent: THREE.Group, name: string, pos: V3, vertical = false, len = 0.12) {
  const gold = c.p.style.classic || c.p.material === "gold";
  const mat = c.mat(gold ? "gold" : "metal");
  if (c.p.style.classic) {
    mesh(parent, new THREE.SphereGeometry(0.014, 16, 12), mat, name, pos);
    return;
  }
  const g = rbox(vertical ? 0.012 : len, vertical ? len : 0.012, 0.02, 0.005);
  mesh(parent, g, mat, name, pos);
}

function bookshelf(c: Ctx, root: THREE.Group) {
  const { p, r } = c;
  const W = 0.8 * p.long * p.scale;
  const H = 1.8 * p.tall * (p.scale < 1 ? 0.6 : 1);
  const D = 0.3;
  const mat = c.mat(mainMat(c, "wood"), { color: p.color });
  carcass(c, root, W, H, D, mat, "Shelf", 0.05);
  const n = Math.max(2, Math.round(H / 0.36));
  const books = p.has(/\b(book|books|bookshelf|bookcase|library)\b/) || r() > 0.4;
  const bookColors = ["#7a2e2e", "#2e4a7a", "#3d6b45", "#c9a24a", "#5b3b6b", "#8a8072", "#1f2a33", "#b5532f"];
  for (let i = 1; i < n; i++) {
    const y = 0.05 + (i * (H - 0.05)) / n;
    mesh(root, rbox(W - 0.04, 0.02, D - 0.02, 0.003), mat, `Shelf_Board_${i}`, [0, y, 0]);
  }
  if (books) {
    for (let i = 0; i < n; i++) {
      const y0 = 0.05 + 0.02 + (i * (H - 0.05)) / n + (i === 0 ? 0 : 0.01);
      const gap = (H - 0.05) / n - 0.04;
      let x = -W / 2 + 0.035;
      let k = 0;
      const fill = 0.55 + r() * 0.4;
      while (x < -W / 2 + (W - 0.06) * fill) {
        const bw = 0.02 + r() * 0.03;
        const bh = Math.min(gap, 0.18 + r() * 0.1);
        const leanBook = r() > 0.92;
        const m = mesh(
          root,
          rbox(bw, bh, 0.17 + r() * 0.05, 0.003, 1),
          c.mat("plastic", { color: pick(r, bookColors) }),
          `Book_${i + 1}_${++k}`,
          [x + bw / 2, y0 + bh / 2, 0.01],
        );
        if (leanBook) m.rotation.z = -0.25;
        x += bw + 0.002;
      }
    }
  }
}

function cabinetLike(c: Ctx, root: THREE.Group, kind: "wardrobe" | "dresser" | "cabinet") {
  const { p } = c;
  const dims = { wardrobe: [1.0, 1.95, 0.58], dresser: [0.9, 0.85, 0.45], cabinet: [0.9, 1.0, 0.45] }[kind];
  const night = p.has(/\b(nightstand|bedside)\b/);
  const W = (night ? 0.45 : dims[0]) * p.long * p.scale;
  const H = (night ? 0.55 : dims[1]) * p.tall * p.scale;
  const D = (night ? 0.4 : dims[2]) * p.scale;
  const material = mainMat(c, p.has(/\brefrigerator\b/) ? "metal" : "wood");
  const mat = c.mat(material, { color: p.color ?? (p.has(/\brefrigerator\b/) ? "#e8e8e6" : undefined) });
  const prefix = kind[0].toUpperCase() + kind.slice(1);
  carcass(c, root, W, H, D, mat, prefix, kind === "wardrobe" ? 0.08 : 0.06);
  const front = D / 2 + 0.008;
  const inner = W - 0.04;
  const base = kind === "wardrobe" ? 0.08 : 0.06;
  const h = H - base - 0.03;
  if (kind === "dresser") {
    const n = night ? 2 : 3 + (p.tall > 1 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const dh = h / n - 0.006;
      const y = base + 0.005 + dh / 2 + i * (dh + 0.006);
      mesh(root, rbox(inner, dh, 0.02, 0.004), mat, `Drawer_${i + 1}`, [0, y, front]);
      handle(c, root, `Drawer_Handle_${i + 1}`, [0, y, front + 0.016]);
    }
  } else {
    const doors = kind === "wardrobe" || W > 0.6 ? 2 : 1;
    for (let i = 0; i < doors; i++) {
      const dw = inner / doors - 0.004;
      const x = -inner / 2 + dw / 2 + i * (dw + 0.004);
      mesh(root, rbox(dw, h, 0.02, 0.004), mat, `Door_${i + 1}`, [x, base + h / 2 + 0.005, front]);
      if (p.style.classic) mesh(root, rbox(dw * 0.7, h * 0.8, 0.008, 0.003), mat, `Door_Panel_${i + 1}`, [x, base + h / 2 + 0.005, front + 0.012]);
      const hx = doors === 2 ? (i === 0 ? dw / 2 - 0.04 : -dw / 2 + 0.04) : dw / 2 - 0.05;
      handle(c, root, `Door_Handle_${i + 1}`, [x + hx, base + h * (kind === "wardrobe" ? 0.55 : 0.75), front + 0.016], true, kind === "wardrobe" ? 0.25 : 0.12);
    }
  }
  if (p.style.modern || p.style.industrial) {
    // raised on legs instead of plinth look
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(root, cyl(0.015, 0.01, 0.06, 12), c.mat("metal"), `Foot_${sx}${sz}`, [sx * (W / 2 - 0.05), 0, sz * (D / 2 - 0.05)]);
  }
}

function crate(c: Ctx, root: THREE.Group) {
  const { p, r } = c;
  const S = 0.6 * p.scale;
  if (p.style.scifi || p.material === "metal") {
    const base = c.mat("metal", { color: p.color ?? "#3b4048", dark: p.style.rustic });
    const trim = c.mat("metal", { color: "#7c838c" });
    const glow = emissive(p.color && p.style.scifi ? p.color : "#38e8c6");
    const W = S * 1.3;
    mesh(root, rbox(W, S, S, 0.03), base, "Crate_Body", [0, S / 2, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(root, rbox(0.07, S + 0.01, 0.07, 0.015), trim, `Crate_Corner_${sx}${sz}`, [sx * (W / 2 - 0.02), S / 2, sz * (S / 2 - 0.02)]);
    mesh(root, rbox(W * 0.6, S * 0.5, 0.02, 0.008), trim, "Crate_Panel_Front", [0, S / 2, S / 2 + 0.005]);
    mesh(root, rbox(W * 0.5, 0.015, 0.01, 0.004), glow, "Crate_Light_Strip", [0, S * 0.82, S / 2 + 0.01]);
    mesh(root, rbox(0.12, 0.05, 0.02, 0.01), trim, "Crate_Handle_L", [-W / 2 - 0.005, S * 0.7, 0], [0, Math.PI / 2, 0]);
    mesh(root, rbox(0.12, 0.05, 0.02, 0.01), trim, "Crate_Handle_R", [W / 2 + 0.005, S * 0.7, 0], [0, Math.PI / 2, 0]);
    return;
  }
  if (p.has(/\bcardboard\b/)) {
    const card = c.mat("plastic", { color: "#b88e5c" });
    mesh(root, rbox(S, S * 0.8, S * 0.8, 0.004), card, "Box_Body", [0, S * 0.4, 0]);
    mesh(root, rbox(0.06, 0.002, S * 0.82, 0.0005), c.mat("plastic", { color: "#c9b48a" }), "Box_Tape", [0, S * 0.8 + 0.001, 0]);
    return;
  }
  const wood = c.mat("wood", { color: p.color, dark: p.style.rustic, tone: p.woodTone });
  const plankH = S / 4;
  const t = 0.02;
  // planks on 4 sides with tiny gaps
  for (let i = 0; i < 4; i++) {
    const y = plankH / 2 + i * plankH;
    const h = plankH - 0.008;
    const j = (r() - 0.5) * 0.004;
    mesh(root, rbox(S, h, t, 0.003), wood, `Crate_Plank_F${i + 1}`, [0, y, S / 2 - t / 2 + j]);
    mesh(root, rbox(S, h, t, 0.003), wood, `Crate_Plank_B${i + 1}`, [0, y, -S / 2 + t / 2 + j]);
    mesh(root, rbox(t, h, S - t * 2, 0.003), wood, `Crate_Plank_L${i + 1}`, [-S / 2 + t / 2 + j, y, 0]);
    mesh(root, rbox(t, h, S - t * 2, 0.003), wood, `Crate_Plank_R${i + 1}`, [S / 2 - t / 2 + j, y, 0]);
  }
  // lid + corner posts + diagonal brace
  mesh(root, rbox(S + 0.01, 0.025, S + 0.01, 0.004), wood, "Crate_Lid", [0, S + 0.0125, 0]);
  const post = c.mat("wood", { dark: true, tone: p.woodTone });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(root, rbox(0.05, S, 0.05, 0.006), post, `Crate_Post_${sx}${sz}`, [sx * (S / 2 - 0.005), S / 2, sz * (S / 2 - 0.005)]);
  for (const sz of [-1, 1]) {
    const len = Math.hypot(S - 0.08, S - 0.08) * 0.92;
    mesh(root, rbox(len, 0.06, 0.018, 0.004), post, `Crate_Brace_${sz > 0 ? "F" : "B"}`, [0, S / 2, sz * (S / 2 + 0.006)], [0, 0, Math.PI / 4 * (sz > 0 ? 1 : -1)]);
  }
}

function treasureChest(c: Ctx, root: THREE.Group) {
  const { p } = c;
  const W = 0.8 * p.scale;
  const D = 0.5 * p.scale;
  const H = 0.38 * p.scale;
  const wood = c.mat("wood", { color: p.color, dark: true, tone: p.woodTone ?? "#7a4a28" });
  const band = c.mat(p.material === "metal" ? "metal" : "gold");
  const iron = c.mat("metal", { color: "#3a3a3d", dark: true });
  mesh(root, rbox(W, H, D, 0.015), wood, "Chest_Base", [0, H / 2, 0]);
  // curved lid (half cylinder)
  const lid = new THREE.CylinderGeometry(D / 2, D / 2, W, 40, 1, false, 0, Math.PI);
  lid.rotateZ(Math.PI / 2);
  mesh(root, lid, wood, "Chest_Lid", [0, H, 0]);
  // bands
  for (const x of [-W / 2 + 0.06, 0, W / 2 - 0.06]) {
    mesh(root, rbox(0.04, H + 0.005, D + 0.012, 0.004), band, `Chest_Band_${x.toFixed(2)}`, [x, H / 2, 0]);
    const arc = new THREE.TorusGeometry(D / 2 + 0.006, 0.012, 8, 32, Math.PI);
    arc.rotateY(Math.PI / 2);
    mesh(root, arc, band, `Chest_Lid_Band_${x.toFixed(2)}`, [x, H, 0]);
  }
  mesh(root, rbox(W + 0.01, 0.03, D + 0.012, 0.004), iron, "Chest_Rim", [0, H, 0]);
  mesh(root, rbox(0.09, 0.11, 0.025, 0.01), band, "Chest_Lock", [0, H - 0.02, D / 2 + 0.012]);
  mesh(root, new THREE.TorusGeometry(0.02, 0.006, 8, 20), iron, "Chest_Lock_Ring", [0, H - 0.06, D / 2 + 0.03]);
  for (const s of [-1, 1]) {
    const h = new THREE.TorusGeometry(0.05, 0.008, 8, 24, Math.PI);
    mesh(root, h, iron, `Chest_Handle_${s > 0 ? "R" : "L"}`, [s * (W / 2 + 0.012), H * 0.65, 0], [0, Math.PI / 2, Math.PI]);
  }
}

function barrel(c: Ctx, root: THREE.Group) {
  const { p } = c;
  const H = 0.9 * p.scale * p.tall;
  const R = 0.3 * p.scale;
  const kind = mainMat(c, "wood");
  const body = c.mat(kind, { color: kind === "metal" ? p.color ?? "#3d5a80" : p.color, dark: p.style.rustic, tone: p.woodTone });
  const hoop = c.mat("metal", { color: "#2f3033", dark: true });
  const prof: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    prof.push([R * (0.82 + 0.18 * Math.sin(Math.PI * t)), H * t]);
  }
  prof.push([0, H]);
  prof.unshift([0, 0]);
  mesh(root, lathe(prof, 48), body, "Barrel_Body");
  const lidTone = c.mat(kind, { dark: true, tone: p.woodTone });
  mesh(root, cyl(R * 0.8, R * 0.8, 0.01, 40), lidTone, "Barrel_Lid", [0, H - 0.012, 0]);
  for (const t of [0.1, 0.3, 0.7, 0.9]) {
    const rr = R * (0.82 + 0.18 * Math.sin(Math.PI * t)) + 0.004;
    const ring = new THREE.TorusGeometry(rr, 0.01, 8, 48);
    ring.rotateX(Math.PI / 2);
    ring.scale(1, 2.4, 1);
    mesh(root, ring, hoop, `Barrel_Hoop_${t}`, [0, H * t, 0]);
  }
}

function vase(c: Ctx, root: THREE.Group) {
  const { p, r } = c;
  const pot = p.has(/\b(flower pot|pot|planter)\b/);
  const jar = p.has(/\b(jar|urn|amphora)\b/);
  const s = p.scale;
  const kind = mainMat(c, pot ? "ceramic" : "ceramic");
  const mat = c.mat(kind === "wood" ? "wood" : kind, {
    color: p.color ?? (pot ? "#b5653e" : kind === "ceramic" ? pick(r, ["#e9e4d8", "#2f5f7a", "#3d5a4a", "#c2683f", "#efe9df"]) : undefined),
  });
  let prof: [number, number][];
  if (pot) {
    const H = 0.3 * s * p.tall;
    prof = [[0, 0], [0.11 * s, 0], [0.12 * s, 0.01], [0.15 * s, H * 0.85], [0.17 * s, H * 0.86], [0.17 * s, H], [0.15 * s, H], [0.145 * s, H * 0.9], [0.13 * s, H * 0.92]];
    mesh(root, lathe(prof, 48), mat, "Pot_Body");
    mesh(root, cyl(0.135 * s, 0.135 * s, 0.01, 40), c.mat("stone", { color: "#4a3426" }), "Pot_Soil", [0, H * 0.82, 0]);
    return;
  }
  const H = (jar ? 0.32 : 0.45) * s * p.tall;
  const belly = (jar ? 0.17 : 0.13 + r() * 0.04) * s;
  const neck = (jar ? 0.09 : 0.045 + r() * 0.02) * s;
  const lip = neck * (1.25 + r() * 0.3);
  const bellyY = jar ? 0.45 : 0.32 + r() * 0.1;
  prof = [
    [0, 0],
    [belly * 0.55, 0],
    [belly * 0.6, H * 0.03],
    [belly * 0.92, H * (bellyY - 0.15)],
    [belly, H * bellyY],
    [belly * 0.9, H * (bellyY + 0.15)],
    [neck * 1.4, H * 0.72],
    [neck, H * 0.84],
    [neck * 1.02, H * 0.94],
    [lip, H],
    [lip * 0.92, H],
    [neck * 0.85, H * 0.95],
  ];
  if (p.style.classic && !jar) {
    // add a foot ring
    prof.splice(1, 1, [belly * 0.45, 0], [belly * 0.42, H * 0.04]);
  }
  mesh(root, lathe(prof, 64), mat, jar ? "Jar_Body" : "Vase_Body");
  if (jar) mesh(root, lathe([[0, H + 0.04 * s], [neck * 0.3, H + 0.035 * s], [lip * 1.05, H + 0.005], [lip * 1.05, H - 0.005], [0, H]], 48), mat, "Jar_Lid");
  if (p.has(/\b(handle|handles|amphora)\b/)) {
    for (const sx of [-1, 1]) {
      const hnd = new THREE.TorusGeometry(0.05 * s, 0.01 * s, 8, 24, Math.PI);
      mesh(root, hnd, mat, `Vase_Handle_${sx}`, [sx * (neck * 1.4 + 0.02), H * 0.72, 0], [0, 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2]);
    }
  }
}

function mug(c: Ctx, root: THREE.Group) {
  const { p } = c;
  const s = p.scale;
  const tea = p.has(/\bteacup\b/);
  const H = (tea ? 0.065 : 0.1) * s;
  const R = (tea ? 0.045 : 0.042) * s;
  const mat = c.mat(mainMat(c, "ceramic"), { color: p.color });
  const t = 0.004 * s;
  const prof: [number, number][] = tea
    ? [[0, 0], [R * 0.55, 0], [R * 0.6, H * 0.08], [R, H], [R - t, H], [R * 0.58 - t, H * 0.12], [0, H * 0.12]]
    : [[0, 0], [R * 0.95, 0], [R, H * 0.05], [R, H], [R - t, H], [R - t, H * 0.08], [0, H * 0.08]];
  mesh(root, lathe(prof, 48), mat, tea ? "Teacup_Body" : "Mug_Body");
  const h = new THREE.TorusGeometry(H * 0.28, 0.006 * s, 10, 28, Math.PI * 1.25);
  mesh(root, h, mat, "Handle", [R + H * 0.12, H * 0.55, 0], [0, 0, -Math.PI * 0.62]);
  if (tea) mesh(root, lathe([[0, 0], [R * 1.6, 0.003], [R * 1.7, 0.008], [R * 1.5, 0.006], [0, 0.004]], 48), mat, "Saucer", [0, -0.006, 0]);
  else mesh(root, cyl(R - t * 1.5, R - t * 1.5, 0.002, 40), c.mat("plastic", { color: "#3b2316" }), "Coffee", [0, H * 0.82, 0]);
}

function bottle(c: Ctx, root: THREE.Group) {
  const { p, r } = c;
  const s = p.scale;
  const potion = p.has(/\b(potion|flask)\b/);
  const glass = c.mat(p.material ?? "glass", { color: p.color ?? (potion ? "#7d4ec9" : pick(r, ["#3f7a4a", "#8a5a2b", "#9fd3c7"])) });
  if (potion) {
    const R = 0.06 * s;
    mesh(root, lathe([[0, 0], [R * 0.6, 0], [R, R * 0.6], [R * 1.05, R], [R, R * 1.4], [R * 0.35, R * 2], [R * 0.3, R * 2.6], [R * 0.36, R * 2.7], [0, R * 2.7]], 48), glass, "Potion_Flask");
    mesh(root, cyl(R * 0.28, R * 0.24, R * 0.5, 16), c.mat("wood", { tone: "#a77b4f" }), "Cork", [0, R * 2.55, 0]);
    return;
  }
  const H = 0.3 * s * p.tall;
  const R = 0.037 * s;
  mesh(
    root,
    lathe([[0, 0], [R * 0.95, 0], [R, H * 0.02], [R, H * 0.6], [R * 0.85, H * 0.7], [R * 0.35, H * 0.82], [R * 0.33, H * 0.95], [R * 0.4, H * 0.96], [R * 0.4, H * 0.98], [0, H * 0.98]], 48),
    glass,
    "Bottle_Body",
  );
  mesh(root, cyl(R * 0.42, R * 0.42, H * 0.06, 20), c.mat("metal", { color: "#c9b37a" }), "Bottle_Cap", [0, H * 0.96, 0]);
  mesh(root, cyl(R * 1.005, R * 1.005, H * 0.22, 40), c.mat("plastic", { color: "#efe6d2" }), "Bottle_Label", [0, H * 0.25, 0]);
}

function lamp(c: Ctx, root: THREE.Group) {
  const { p, r } = c;
  const desk = p.has(/\bdesk lamp\b/);
  const floor = p.has(/\b(floor lamp|standing lamp)\b/) || p.tall > 1;
  const lantern = p.has(/\blantern\b/);
  const base = c.mat(p.material ?? (desk ? "metal" : "ceramic"), { color: p.color ?? (desk ? "#2b2d31" : undefined) });
  const shade = c.mat("fabric", { color: p.color && !desk ? "#efe8da" : "#efe8da" });
  const bulb = emissive("#ffe7b0");
  if (lantern) {
    const metal = c.mat("metal", { color: "#2f3033", dark: p.style.rustic });
    mesh(root, cyl(0.09, 0.1, 0.03, 6), metal, "Lantern_Base");
    mesh(root, cyl(0.075, 0.075, 0.18, 6), c.mat("glass", { color: "#f5d38a" }), "Lantern_Glass", [0, 0.03, 0]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      mesh(root, cyl(0.006, 0.006, 0.18, 6), metal, `Lantern_Bar_${i + 1}`, [Math.cos(a) * 0.08, 0.03, Math.sin(a) * 0.08]);
    }
    mesh(root, lathe([[0.1, 0], [0.04, 0.07], [0.02, 0.08], [0, 0.08]], 6), metal, "Lantern_Roof", [0, 0.21, 0]);
    mesh(root, new THREE.TorusGeometry(0.03, 0.006, 8, 20), metal, "Lantern_Ring", [0, 0.31, 0]);
    mesh(root, new THREE.SphereGeometry(0.025, 16, 12), bulb, "Lantern_Flame", [0, 0.1, 0]);
    return;
  }
  if (desk) {
    mesh(root, cyl(0.09, 0.1, 0.025, 40), base, "Lamp_Base");
    const a1 = mesh(root, cyl(0.01, 0.01, 0.32, 12), base, "Lamp_Arm_Lower", [0, 0.025, 0], [0, 0, -0.35]);
    const elbow = new THREE.Vector3(0, 0.32, 0).applyEuler(a1.rotation).add(a1.position);
    mesh(root, new THREE.SphereGeometry(0.018, 16, 12), base, "Lamp_Joint", elbow.toArray() as V3);
    const a2 = mesh(root, cyl(0.01, 0.01, 0.28, 12), base, "Lamp_Arm_Upper", elbow.toArray() as V3, [0, 0, 0.9]);
    const head = new THREE.Vector3(0, 0.28, 0).applyEuler(a2.rotation).add(a2.position);
    const cone = lathe([[0.03, 0], [0.035, 0.03], [0.09, 0.12], [0.086, 0.12], [0.03, 0.03]], 40);
    mesh(root, cone, base, "Lamp_Shade", head.toArray() as V3, [0, 0, 2.3]);
    mesh(root, new THREE.SphereGeometry(0.028, 16, 12), bulb, "Lamp_Bulb", head.clone().add(new THREE.Vector3(-0.05, -0.05, 0)).toArray() as V3);
    return;
  }
  const H = floor ? 1.6 : 0.45 * p.scale;
  if (floor) {
    mesh(root, cyl(0.16, 0.17, 0.03, 48), base, "Lamp_Base");
    mesh(root, cyl(0.012, 0.012, H - 0.3, 16), c.mat("metal", { color: p.color }), "Lamp_Pole", [0, 0.03, 0]);
  } else {
    const bR = 0.07 + r() * 0.03;
    mesh(root, lathe([[0, 0], [bR * 0.8, 0], [bR, H * 0.15], [bR * 1.05, H * 0.35], [bR * 0.6, H * 0.5], [0.02, H * 0.56], [0.012, H * 0.62], [0, H * 0.62]], 48), base, "Lamp_Base");
    mesh(root, cyl(0.008, 0.008, H * 0.15, 12), c.mat("metal", { color: "#b59a5a" }), "Lamp_Stem", [0, H * 0.6, 0]);
  }
  const sh = floor ? 0.4 : H * 0.42;
  const top = floor ? 0.16 : 0.1;
  const bottom = floor ? 0.24 : 0.16;
  const shadeY = floor ? H - sh : H * 0.66;
  const g = new THREE.CylinderGeometry(top, bottom, sh, 48, 1, true);
  g.translate(0, sh / 2, 0);
  const m = mesh(root, g, shade, "Lamp_Shade", [0, shadeY, 0]);
  (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  mesh(root, new THREE.SphereGeometry(0.035, 16, 12), bulb, "Lamp_Bulb", [0, shadeY + sh * 0.35, 0]);
}

function sword(c: Ctx, root: THREE.Group) {
  const { p } = c;
  const katana = p.has(/\b(katana)\b/) || p.style.japanese;
  const dagger = p.has(/\b(dagger|kris)\b/);
  const s = p.scale * (dagger ? 0.45 : 1);
  const L = (katana ? 0.72 : 0.8) * s * p.long;
  const Wb = (katana ? 0.032 : 0.05) * s;
  const steel = c.mat(p.has(/\b(golden|gold)\s+(blade)\b/) ? "gold" : "metal", { color: "#d4d8de" });
  const guardKind: MatKind = p.material === "gold" || p.style.classic ? "gold" : p.material === "wood" ? "wood" : "metal";
  const guard = c.mat(guardKind, { color: guardKind === "metal" ? "#4a4c52" : undefined });
  const grip = c.mat("leather", { color: p.color ?? (katana ? "#1d1d22" : "#4a2c1d") });

  // blade outline (curved for katana), extruded with bevel for an edge
  const shape = new THREE.Shape();
  const curve = katana ? 0.05 * s : 0;
  const N = 24;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = t * L;
    const bend = curve * t * t;
    const w = katana ? Wb * (1 - 0.25 * t) : Wb * (t < 0.85 ? 1 - 0.15 * t : (1 - t) / 0.15 * 0.87);
    left.push([-w / 2 + bend, y]);
    right.push([w / 2 + bend, y]);
  }
  const tip: [number, number] = katana ? [Wb * 0.4 + curve, L + 0.06 * s] : [0, L + 0.08 * s];
  shape.moveTo(left[0][0], left[0][1]);
  left.forEach(([x, y]) => shape.lineTo(x, y));
  shape.lineTo(tip[0], tip[1]);
  for (let i = right.length - 1; i >= 0; i--) shape.lineTo(right[i][0], right[i][1]);
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0035 * s, bevelSize: Wb * 0.18, bevelSegments: 2 });
  blade.translate(0, 0, -0.001);
  const hiltLen = (katana ? 0.26 : 0.17) * s;
  const gy = hiltLen + 0.02 * s;
  mesh(root, blade, steel, "Sword_Blade", [0, gy, 0]);
  // fuller groove
  if (!katana && !dagger) mesh(root, rbox(Wb * 0.18, L * 0.6, 0.008, 0.002), c.mat("metal", { color: "#9ea4ac" }), "Sword_Fuller", [0, gy + L * 0.35, 0]);
  // guard
  if (katana) {
    mesh(root, cyl(0.045 * s, 0.045 * s, 0.01 * s, 32).rotateX(0), guard, "Sword_Tsuba", [0, hiltLen + 0.005 * s, 0]);
  } else {
    const gw = (dagger ? 0.12 : 0.22) * s;
    mesh(root, rbox(gw, 0.025 * s, 0.035 * s, 0.01 * s), guard, "Sword_Crossguard", [0, hiltLen + 0.01 * s, 0]);
    for (const sx of [-1, 1]) mesh(root, new THREE.SphereGeometry(0.018 * s, 16, 12), guard, `Sword_Guard_Tip_${sx > 0 ? "R" : "L"}`, [sx * gw / 2, hiltLen + 0.01 * s, 0]);
  }
  // grip with wrap ridges
  const gp: [number, number][] = [[0.0, 0]];
  const gr = 0.016 * s;
  for (let i = 0; i <= 12; i++) gp.push([gr * (i % 2 ? 1.08 : 0.96), (i / 12) * (hiltLen - 0.02 * s)]);
  gp.push([0, hiltLen - 0.02 * s]);
  mesh(root, lathe(gp, 16), grip, "Sword_Grip", [0, 0.02 * s, 0]);
  mesh(root, new THREE.SphereGeometry(0.026 * s, 20, 14), guard, "Sword_Pommel", [0, 0.012 * s, 0]);
  // lay it down so it reads well in the viewport and in Blender
  root.rotation.z = Math.PI / 2;
  root.position.y = 0.04;
}

const BUILDERS: Record<ProcParams["kind"], (c: Ctx, root: THREE.Group) => void> = {
  table,
  chair,
  officeChair,
  stool,
  bench,
  bookshelf,
  wardrobe: (c, r) => cabinetLike(c, r, "wardrobe"),
  dresser: (c, r) => cabinetLike(c, r, "dresser"),
  cabinet: (c, r) => cabinetLike(c, r, "cabinet"),
  treasureChest,
  crate,
  barrel,
  vase,
  mug,
  bottle,
  lamp,
  sword,
};

/** Build the model. Returns a group in meters, resting on y=0. */
export function buildProcedural(p: ProcParams, seed = Math.floor(Math.random() * 1e9)): THREE.Group {
  const r = rng(seed);
  const cache = new Map<string, THREE.Material>();
  const ctx: Ctx = {
    p,
    r,
    seed,
    bevel: p.style.cartoon ? 3 : 1,
    mat: (kind, o = {}) => {
      const dark = o.dark ?? (p.style.rustic && kind === "wood");
      const key = `${kind}|${o.color ?? ""}|${dark}|${o.tone ?? ""}`;
      let m = cache.get(key);
      if (!m) {
        m = makeMaterial({
          kind,
          color: o.color,
          dark,
          woodTone: o.tone ?? p.woodTone,
          metalTone: p.metalTone,
          seed: seed + cache.size * 17,
        });
        cache.set(key, m);
      }
      return m;
    },
  };
  const inner = new THREE.Group();
  BUILDERS[p.kind](ctx, inner);
  const root = new THREE.Group();
  root.name = p.kind;
  root.add(inner);
  inner.name = `${p.kind}_parts`;
  // rest on the ground
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  inner.position.y -= box.min.y;
  return root;
}
