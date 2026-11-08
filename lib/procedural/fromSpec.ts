import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { ModelSpec, SpecPart } from "@/lib/modelSpec";
import { emissive, makeMaterial } from "./materials";

/** Turn Claude's parts recipe into a three.js group (meters, resting on y=0). */
export function buildFromSpec(spec: ModelSpec, seed = Math.floor(Math.random() * 1e9)): THREE.Group {
  const cache = new Map<string, THREE.Material>();
  const matFor = (p: SpecPart) => {
    const key = `${p.material}|${p.color ?? ""}`;
    let m = cache.get(key);
    if (!m) {
      m = p.material === "glow" ? emissive(p.color ?? "#ffe7b0") : makeMaterial({ kind: p.material, color: p.color, seed: seed + cache.size * 31 });
      cache.set(key, m);
    }
    return m;
  };

  const inner = new THREE.Group();
  inner.name = `${safe(spec.name)}_parts`;
  const used = new Map<string, number>();

  for (const p of spec.parts) {
    const geo = geometry(p);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, matFor(p));
    const n = used.get(p.name) ?? 0;
    used.set(p.name, n + 1);
    mesh.name = n ? `${p.name}_${n + 1}` : p.name;
    mesh.position.set(...p.position);
    const [rx, ry, rz] = p.rotation ?? [0, 0, 0];
    mesh.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz));
    if (p.scale) mesh.scale.set(...p.scale);
    inner.add(mesh);
  }

  const root = new THREE.Group();
  root.name = safe(spec.name);
  root.add(inner);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    // stand on the ground, centered on X/Z
    const c = box.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, -box.min.y, -c.z);
  }
  return root;
}

function safe(s: string) {
  return s.replace(/[^\w-]+/g, "_").slice(0, 40) || "Model";
}

function geometry(p: SpecPart): THREE.BufferGeometry | null {
  const seg = p.segments ?? 32;
  switch (p.shape) {
    case "box": {
      const [w, h, d] = p.size!;
      const r = Math.min(p.bevel ?? 0, Math.min(w, h, d) / 2 - 0.0002);
      return r > 0.0004 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
    }
    case "wedge": {
      // triangular prism: ridge along X at the top, centered
      const [w, h, d] = p.size!;
      const shape = new THREE.Shape();
      shape.moveTo(-d / 2, -h / 2);
      shape.lineTo(d / 2, -h / 2);
      shape.lineTo(0, h / 2);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
      g.translate(0, 0, -w / 2);
      g.rotateY(Math.PI / 2); // extrusion axis Z -> X, triangle now in the ZY plane
      return g;
    }
    case "cylinder":
      return new THREE.CylinderGeometry(p.radiusTop!, p.radiusBottom!, p.height!, seg);
    case "cone":
      return new THREE.ConeGeometry(p.radiusBottom!, p.height!, seg);
    case "sphere":
      return new THREE.SphereGeometry(p.radius!, seg, Math.max(8, Math.round(seg * 0.6)));
    case "capsule":
      return new THREE.CapsuleGeometry(p.radius!, p.height!, 6, seg);
    case "torus":
      return new THREE.TorusGeometry(p.radius!, p.tube!, Math.max(8, Math.round(seg / 3)), seg, THREE.MathUtils.degToRad(p.arc ?? 360));
    case "lathe": {
      const pts = p.profile!.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
      return new THREE.LatheGeometry(pts, Math.max(12, seg));
    }
  }
  return null;
}
