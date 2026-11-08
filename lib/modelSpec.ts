/**
 * "Recipe" format Claude returns: a list of primitive parts in meters.
 * Shared by the server (validation) and the browser (building).
 */

export const SPEC_MATERIALS = [
  "wood",
  "metal",
  "gold",
  "plastic",
  "glass",
  "ceramic",
  "fabric",
  "leather",
  "stone",
  "marble",
  "rattan",
  "rubber",
  "glow",
] as const;
export type SpecMaterial = (typeof SPEC_MATERIALS)[number];

export const SPEC_SHAPES = ["box", "cylinder", "cone", "sphere", "torus", "lathe", "capsule", "wedge"] as const;
export type SpecShape = (typeof SPEC_SHAPES)[number];

export interface SpecPart {
  name: string;
  shape: SpecShape;
  /** box / wedge: [width x, height y, depth z] */
  size?: [number, number, number];
  /** box / wedge corner rounding (m) */
  bevel?: number;
  radius?: number; // sphere, torus, capsule
  radiusTop?: number; // cylinder
  radiusBottom?: number; // cylinder, cone
  height?: number; // cylinder, cone, capsule
  tube?: number; // torus thickness
  arc?: number; // torus arc in degrees (default 360)
  /** lathe: [radius, y] points from bottom (y=0) up, revolved around Y */
  profile?: [number, number][];
  segments?: number;
  /** center of the part (lathe: center of its base) */
  position: [number, number, number];
  /** degrees, XYZ order */
  rotation?: [number, number, number];
  scale?: [number, number, number];
  material: SpecMaterial;
  color?: string;
}

export interface ModelSpec {
  name: string;
  parts: SpecPart[];
}

// ------------------------------------------------------------------ validation

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : def;
  return Math.min(max, Math.max(min, n));
};
const vec = (v: unknown, def: [number, number, number], min: number, max: number): [number, number, number] =>
  Array.isArray(v) && v.length === 3 ? [num(v[0], def[0], min, max), num(v[1], def[1], min, max), num(v[2], def[2], min, max)] : def;
const HEX = /^#[0-9a-f]{6}$/i;

/** Clamp everything to sane ranges so a bad reply can't crash the builder. */
export function sanitizeSpec(raw: unknown): ModelSpec {
  const r = (raw ?? {}) as { name?: unknown; parts?: unknown };
  const parts = (Array.isArray(r.parts) ? r.parts : []).slice(0, 250).flatMap((p0, i): SpecPart[] => {
    const p = (p0 ?? {}) as Record<string, unknown>;
    const shape = SPEC_SHAPES.includes(p.shape as SpecShape) ? (p.shape as SpecShape) : null;
    if (!shape) return [];
    const material = SPEC_MATERIALS.includes(p.material as SpecMaterial) ? (p.material as SpecMaterial) : "plastic";
    const part: SpecPart = {
      name: String(p.name ?? `Part_${i + 1}`).replace(/[^\w.-]+/g, "_").slice(0, 60) || `Part_${i + 1}`,
      shape,
      position: vec(p.position, [0, 0, 0], -50, 50),
      rotation: vec(p.rotation, [0, 0, 0], -720, 720),
      scale: vec(p.scale, [1, 1, 1], 0.01, 100),
      material,
      color: typeof p.color === "string" && HEX.test(p.color) ? p.color : undefined,
      segments: Math.round(num(p.segments, 32, 3, 96)),
    };
    const L = (v: unknown, d: number) => num(v, d, 0.0005, 50);
    switch (shape) {
      case "box":
      case "wedge":
        part.size = vec(p.size, [0.1, 0.1, 0.1], 0.0005, 50);
        part.bevel = num(p.bevel, 0, 0, 5);
        break;
      case "cylinder":
        part.radiusTop = L(p.radiusTop ?? p.radius, 0.05);
        part.radiusBottom = L(p.radiusBottom ?? p.radius, part.radiusTop);
        part.height = L(p.height, 0.1);
        break;
      case "cone":
        part.radiusBottom = L(p.radiusBottom ?? p.radius, 0.05);
        part.height = L(p.height, 0.1);
        break;
      case "sphere":
        part.radius = L(p.radius, 0.05);
        break;
      case "capsule":
        part.radius = L(p.radius, 0.03);
        part.height = L(p.height, 0.1);
        break;
      case "torus":
        part.radius = L(p.radius, 0.1);
        part.tube = L(p.tube, 0.01);
        part.arc = num(p.arc, 360, 1, 360);
        break;
      case "lathe": {
        const pts = Array.isArray(p.profile) ? p.profile : [];
        part.profile = pts
          .filter((q): q is [number, number] => Array.isArray(q) && q.length >= 2)
          .slice(0, 64)
          .map((q) => [num(q[0], 0, 0, 50), num(q[1], 0, -50, 50)]);
        if (part.profile.length < 2) return [];
        break;
      }
    }
    return [part];
  });
  return { name: String(r.name ?? "Model").slice(0, 80), parts };
}

// ------------------------------------------------------------------ JSON schema for Claude's tool

export const BUILD_MODEL_TOOL = {
  name: "build_model",
  description:
    "Output the 3D model as a list of primitive parts. Units are meters, Y is up, the object stands on the ground plane (lowest point at y=0), +Z is the front.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short English name of the object" },
      parts: {
        type: "array",
        description: "All parts of the model (typically 10-150).",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Readable part name, e.g. Table_Leg_FL" },
            shape: { type: "string", enum: [...SPEC_SHAPES] },
            size: { type: "array", items: { type: "number" }, description: "box/wedge: [width, height, depth]" },
            bevel: { type: "number", description: "box/wedge corner radius in meters (0.002-0.03 looks finished)" },
            radius: { type: "number", description: "sphere/torus/capsule radius" },
            radiusTop: { type: "number", description: "cylinder top radius" },
            radiusBottom: { type: "number", description: "cylinder/cone bottom radius" },
            height: { type: "number", description: "cylinder/cone/capsule height" },
            tube: { type: "number", description: "torus tube radius" },
            arc: { type: "number", description: "torus arc in degrees, default 360" },
            profile: {
              type: "array",
              items: { type: "array", items: { type: "number" } },
              description: "lathe: [[radius, y], ...] from bottom to top, revolved around the Y axis",
            },
            segments: { type: "integer", description: "radial segments for round shapes (default 32)" },
            position: { type: "array", items: { type: "number" }, description: "[x,y,z] center of the part (lathe: center of its base)" },
            rotation: { type: "array", items: { type: "number" }, description: "[x,y,z] degrees" },
            scale: { type: "array", items: { type: "number" }, description: "optional non-uniform scale" },
            material: { type: "string", enum: [...SPEC_MATERIALS] },
            color: { type: "string", description: "#rrggbb tint (optional; omit for natural wood)" },
          },
          required: ["name", "shape", "position", "material"],
        },
      },
    },
    required: ["name", "parts"],
  },
} as const;

export const DESIGN_SYSTEM_PROMPT = `You are a senior 3D prop modeler building game-ready base meshes from primitive shapes.
The user describes one object (often in Indonesian). Design it and return it ONLY through the build_model tool.

Rules:
- Real-world proportions in meters. Y is up. The object rests on the ground: its lowest point is at y=0. +Z is the front.
- position is the CENTER of each part (for lathe it is the center of the base, and the profile goes up from y=0).
- Every part must touch or slightly overlap the parts it connects to. No floating pieces.
- Make it look finished and recognizable: add trims, frames, handles, rims, panels, bolts, small details. Typically 15-120 parts.
- Use bevel (0.003-0.02) on boxes so edges catch light. Use lathe for anything turned/round (vases, bottles, columns, lamp bases).
- Use "wedge" (triangular prism, ridge along X at the top, width=x, height=y, depth=z) for roofs and slopes.
- Pick sensible materials and colors. Use "glow" only for lights/screens.
- Name parts clearly in English (e.g. Roof_Left, Window_Frame_2, Wheel_FL).
- One object only. No ground plane, no background, no people.`;
