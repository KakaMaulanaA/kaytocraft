import type { EngineId, GenerateSettings } from "./types";
import { smartPrompt } from "./smartPrompt";

/**
 * Credit estimates from developers.tripo3d.ai/en/pricing (H Series, 1 credit = $0.01).
 * Texture is always on in this app, so base = "standard texture" price.
 */
export const TRIPO_COST = {
  text: 20,
  image: 30,
  detailed: 10,
  extreme: 20,
  quad: 5,
  smartLowPoly: 10,
  concept: 5.5, // seedream_v4 text-to-image
};

export interface CostLine {
  label: string;
  credits: number;
}

export function estimate3D(s: GenerateSettings, fromImage = s.mode === "image"): CostLine[] | null {
  if (!s.engine.startsWith("tripo")) return null;
  const lines: CostLine[] = [{ label: fromImage ? "Image to 3D" : "Text to 3D", credits: fromImage ? TRIPO_COST.image : TRIPO_COST.text }];
  if (s.textureQuality === "detailed") lines.push({ label: "HD texture", credits: TRIPO_COST.detailed });
  if (s.textureQuality === "extreme") lines.push({ label: "8K texture", credits: TRIPO_COST.extreme });
  if (s.quad) lines.push({ label: "Quad mesh", credits: TRIPO_COST.quad });
  if (s.smartLowPoly) lines.push({ label: "Smart low-poly", credits: TRIPO_COST.smartLowPoly });
  return lines;
}

export const sum = (lines: CostLine[]) => Math.round(lines.reduce((n, l) => n + l.credits, 0) * 10) / 10;
export const usd = (credits: number) => `$${(credits / 100).toFixed(2)}`;

export function isFree(engine: EngineId) {
  return engine === "demo";
}

// ------------------------------------------------------------------ prompt lint

export interface Hint {
  level: "warn" | "info";
  text: string;
}

const ORGANIC = /\b(wood|wooden|oak|walnut|pine|bamboo|rattan|wicker|fabric|cloth|leather|velvet|linen|plant|tree|flower|food|animal|organic)\b/i;

export function lintSettings(s: GenerateSettings): Hint[] {
  const hints: Hint[] = [];
  // Short / Indonesian prompts are fine now: smartPrompt translates and enriches them.
  const core = smartPrompt(s.prompt).core;
  if (s.mode === "text") {
    if (s.presets.includes("hard-surface") && ORGANIC.test(core))
      hints.push({ level: "warn", text: "Preset Hard Surface membuat objek bergaya mesin/logam — tidak cocok untuk kayu/kain. Matikan preset itu." });
    if (s.presets.length > 1)
      hints.push({ level: "info", text: "Lebih dari satu preset bisa saling bertabrakan. Pilih satu saja." });
  }
  if (s.smartLowPoly && s.density !== "low")
    hints.push({ level: "warn", text: "Smart Low-Poly sering merusak objek yang kompleks (+10 kredit). Matikan kecuali objeknya sangat sederhana." });
  if (s.textureQuality !== "standard")
    hints.push({ level: "info", text: "Texture di atas Standard menambah biaya. Pakai Standard dulu sampai bentuknya pas." });
  return hints;
}

// ------------------------------------------------------------------ prompt builder

export interface PromptParts {
  object: string;
  shape: string;
  material: string;
  style: string;
}

export function buildPrompt(p: PromptParts): string {
  return [p.object, p.shape, p.material && `made of ${p.material}`, p.style && `${p.style} style`]
    .map((x) => x.trim())
    .filter(Boolean)
    .join(", ");
}

export const MATERIAL_CHIPS = ["oak wood", "painted metal", "brushed steel", "matte plastic", "ceramic", "leather", "fabric", "stone", "glass"];
export const STYLE_CHIPS = ["realistic", "modern minimalist", "scandinavian", "industrial", "vintage", "sci-fi", "stylized cartoon", "low poly game asset"];
