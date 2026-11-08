/**
 * Knowledge Library: user-taught objects that the generator reuses for free.
 * Shared types + matching (client and server).
 */
import type { ModelSpec, SpecMaterial } from "./modelSpec";

export interface LibraryEntry {
  id: string;
  label: string;
  /** lower-case words/phrases that trigger this entry (Indonesian or English) */
  keywords: string[];
  /** spec = parts recipe (recolorable); model = a fixed .glb/.fbx file */
  type: "spec" | "model";
  format?: "glb" | "fbx";
  /** where it came from: text / file / image / vault / chat */
  origin: string;
  description?: string;
  hasThumb?: boolean;
  createdAt: number;
  uses?: number;
}

export interface LibraryData {
  entries: LibraryEntry[];
  dictionary: Record<string, string>;
}

export function parseKeywords(s: string): string[] {
  return [...new Set(s.split(/[,;\n]+/).map((k) => k.trim().toLowerCase()).filter(Boolean))].slice(0, 30);
}

/** Best library entry for a prompt: the longest keyword found as a whole word/phrase. */
export function matchLibrary(entries: LibraryEntry[], ...texts: string[]): LibraryEntry | null {
  const hay = texts.map((t) => ` ${t.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ")} `).join(" | ");
  let best: { e: LibraryEntry; len: number } | null = null;
  for (const e of entries) {
    for (const k of e.keywords) {
      if (k.length < 2) continue;
      if (hay.includes(` ${k} `) && (!best || k.length > best.len)) best = { e, len: k.length };
    }
  }
  return best?.e ?? null;
}

// ------------------------------------------------------------------ variation for spec entries

const COLORS: Record<string, string> = {
  red: "#b3352c", merah: "#b3352c", blue: "#2f5fa8", biru: "#2f5fa8", green: "#2f7a4f", hijau: "#2f7a4f",
  yellow: "#e0b52e", kuning: "#e0b52e", black: "#202024", hitam: "#202024", white: "#ecebe6", putih: "#ecebe6",
  grey: "#8a8d91", gray: "#8a8d91", brown: "#6b4a2e", coklat: "#6b4a2e", cokelat: "#6b4a2e", purple: "#6b3fa0",
  ungu: "#6b3fa0", orange: "#d96a2b", oranye: "#d96a2b", pink: "#e48aa8", cream: "#e8dcc0", krem: "#e8dcc0",
};
const MATERIALS: [RegExp, SpecMaterial][] = [
  [/\b(wood|wooden|kayu|jati|oak|teak)\b/, "wood"],
  [/\b(metal|steel|iron|besi|baja|logam)\b/, "metal"],
  [/\b(gold|golden|emas)\b/, "gold"],
  [/\b(plastic|plastik)\b/, "plastic"],
  [/\b(glass|kaca)\b/, "glass"],
  [/\b(ceramic|keramik)\b/, "ceramic"],
  [/\b(leather|kulit)\b/, "leather"],
  [/\b(fabric|kain)\b/, "fabric"],
  [/\b(marble|marmer)\b/, "marble"],
  [/\b(stone|batu)\b/, "stone"],
  [/\b(rattan|rotan)\b/, "rattan"],
];

/**
 * Re-skin a saved recipe from words in the new prompt, e.g. "sofa merah" turns the
 * dominant material red; "sofa kulit" switches it to leather.
 */
export function applyVariation(spec: ModelSpec, text: string, keywords: string[]): ModelSpec {
  // Ignore words that are part of the keyword itself ("kursi kayu" shouldn't recolor).
  let t = ` ${text.toLowerCase()} `;
  for (const k of keywords) t = t.replaceAll(` ${k} `, " ");
  const color = Object.entries(COLORS).find(([w]) => new RegExp(`\\b${w}\\b`).test(t))?.[1];
  const material = MATERIALS.find(([re]) => re.test(t))?.[1];
  if (!color && !material) return spec;

  const counts = new Map<SpecMaterial, number>();
  for (const p of spec.parts) if (p.material !== "glow") counts.set(p.material, (counts.get(p.material) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!dominant) return spec;
  // Only re-skin the "body": dominant-material parts without their own accent color
  // (doors, trims, roofs keep their colors). Fall back to all dominant parts.
  const plain = spec.parts.filter((p) => p.material === dominant && !p.color);
  const target = new Set(plain.length ? plain : spec.parts.filter((p) => p.material === dominant));
  return {
    ...spec,
    parts: spec.parts.map((p) =>
      target.has(p) ? { ...p, material: material ?? p.material, color: color ?? (material ? undefined : p.color) } : p,
    ),
  };
}
