import type { EngineId, MeshDensity, PresetId, TextureQuality } from "./types";
import { smartPrompt } from "./smartPrompt";

export const PRESETS: { id: PresetId; label: string; tags: string }[] = [
  {
    id: "hard-surface",
    label: "Hard Surface",
    tags: "hard surface model, crisp bevelled edges, clean planar surfaces, mechanical panel lines",
  },
  {
    id: "low-poly",
    label: "Low-Poly",
    tags: "low poly game asset, simple stylized shapes, flat shading, minimal geometry",
  },
  {
    id: "furniture",
    label: "Furniture",
    tags: "furniture design, real-world proportions, standing on the floor, product render",
  },
];

export const ENHANCE_TAGS =
  "single centered object, full 360 view, clean watertight mesh, neutral lighting, high detail";

export const DENSITY: Record<MeshDensity, { label: string; faces: number }> = {
  low: { label: "Low (5k faces - Blocking)", faces: 5_000 },
  balanced: { label: "Balanced (24k faces - Production)", faces: 24_000 },
  high: { label: "High (100k faces - Hero Asset)", faces: 100_000 },
};

export const TEXTURE_QUALITY: Record<TextureQuality, string> = {
  standard: "Standard",
  detailed: "Detailed",
  extreme: "Extreme 8K",
};

export const ENGINE_LABELS: Record<EngineId, string> = {
  "tripo-v3.1": "Tripo3D v3.1 (Recommended)",
  "tripo-v3.0": "Tripo3D v3.0",
  "tripo-p2": "Tripo3D P2 (Low-Poly Game)",
  meshy: "Meshy AI",
  claude: "Claude AI (rakit dari bentuk dasar)",
  gemini: "Gemini AI — gratis (rakit dari bentuk dasar)",
  demo: "Gratis — Procedural (objek sederhana)",
};

export const PROMPT_MAX = 1000;

/** Build the final prompt sent to the engine (auto-translated + quality tags + presets). */
export function composePrompt(prompt: string, presets: PresetId[], dict: Record<string, string> = {}): string {
  const tags = PRESETS.filter((p) => presets.includes(p.id)).map((p) => p.tags);
  return [smartPrompt(prompt, dict).final, ...tags].filter(Boolean).join(", ");
}

/** A short asset name from a prompt: "Modern minimalist chair..." -> "Modern Minimalist Chair". */
export function nameFromPrompt(prompt: string, fallback = "Untitled Asset"): string {
  // Name = the part before connectors like "dengan"/"with", max 4 words.
  const head = prompt.split(/\s+(?:dengan|yang|untuk|pakai|with|and|for|dan)\s+|,/i)[0];
  const words = head
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  if (!words.length) return fallback;
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
