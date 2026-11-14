import type { Asset, GenerateSettings } from "./types";
import type { LibraryData, LibraryEntry } from "./library";
import { applyVariation, matchLibrary } from "./library";
import { smartPrompt } from "./smartPrompt";
import { detectProcedural } from "./procedural/detect";
import { groupToGlb } from "./useLibrary";
import { appendFile } from "./upload";
import { requestDesign } from "./designClient";
import { renderThumb } from "./thumb";

/** How each line of a batch is turned into a model. */
export type BatchEngine = "auto" | "gemini" | "claude" | "tripo";

export interface BatchResult {
  asset: Asset;
  /** Which route produced it (shown in the table). */
  via: "library" | "procedural" | "gemini" | "claude" | "tripo";
}

/** Default Tripo settings for batch (balanced, standard texture: 20 credits each). */
export const TRIPO_BATCH: Omit<GenerateSettings, "prompt"> = {
  mode: "text",
  engine: "tripo-v3.1",
  density: "balanced",
  textureQuality: "standard",
  pbr: true,
  quad: false,
  smartLowPoly: false,
  presets: [],
};

async function saveGroup(group: import("three").Group, source: "procedural" | "claude" | "gemini" | "library", prompt: string, spec?: unknown) {
  const fd = new FormData();
  await appendFile(fd, "file", await groupToGlb(group), `${source}.glb`);
  fd.append("source", source);
  fd.append("prompt", prompt);
  if (spec) fd.append("spec", JSON.stringify(spec));
  const res = await fetch("/api/assets/upload", { method: "POST", body: fd });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || "Gagal menyimpan model.");
  const asset = body as Asset;
  // Thumbnail for the vault, rendered off-screen.
  const png = await renderThumb(group);
  if (png) {
    const t = await fetch(`/api/assets/${asset.id}/thumb`, { method: "POST", body: png }).catch(() => null);
    if (t?.ok) asset.hasThumb = true;
  }
  return asset;
}

async function fromLibrary(entry: LibraryEntry, prompt: string): Promise<Asset> {
  if (entry.type === "spec") {
    const spec = await (await fetch(`/api/library/${entry.id}/spec`)).json();
    const { buildFromSpec } = await import("./procedural/fromSpec");
    const varied = applyVariation(spec, prompt, entry.keywords);
    const asset = await saveGroup(buildFromSpec(varied), "library", prompt, varied);
    fetch(`/api/library/${entry.id}/use`, { method: "POST", body: "{}" }).catch(() => {});
    return asset;
  }
  const res = await fetch(`/api/library/${entry.id}/use`, { method: "POST", body: JSON.stringify({ prompt }) });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || "Gagal memakai Library");
  if (entry.hasThumb) {
    // Reuse the library thumbnail.
    const png = await (await fetch(`/api/library/${entry.id}/thumb`)).blob().catch(() => null);
    if (png) await fetch(`/api/assets/${body.id}/thumb`, { method: "POST", body: png }).catch(() => {});
  }
  return body as Asset;
}

async function viaDesign(engine: "gemini" | "claude", prompt: string): Promise<Asset> {
  const body = await requestDesign({ engine, prompt }, engine === "gemini" ? "Gemini" : "Claude");
  const { buildFromSpec } = await import("./procedural/fromSpec");
  return saveGroup(buildFromSpec(body.spec), engine, prompt, body.spec);
}

async function viaTripo(prompt: string, signal: AbortSignal): Promise<Asset> {
  const fd = new FormData();
  fd.append("settings", JSON.stringify({ ...TRIPO_BATCH, prompt }));
  const res = await fetch("/api/generate", { method: "POST", body: fd });
  let a = (await res.json()) as Asset & { error?: string };
  if (!res.ok || a.status === "failed") throw new Error(a.error || "Tripo gagal memulai.");
  const started = Date.now();
  while (a.status !== "ready") {
    if (signal.aborted) throw new Error("Dihentikan.");
    if (Date.now() - started > 15 * 60_000) throw new Error("Tripo terlalu lama (lebih dari 15 menit).");
    await new Promise((r) => setTimeout(r, 3000));
    a = await (await fetch(`/api/tasks/${a.id}`, { cache: "no-store" })).json();
    if (a.status === "failed") throw new Error(a.error || "Tripo gagal.");
  }
  return a;
}

/**
 * Make one model for a batch line.
 *  auto:  Library -> Mode Gratis -> Gemini (if a key is set) — all free
 *  gemini / claude: always that AI (Library still wins when it matches, it is free and consistent)
 *  tripo: Tripo3D (paid credits)
 */
export async function makeOne(
  prompt: string,
  engine: BatchEngine,
  ctx: { library: LibraryData; gemini: boolean; claude: boolean; signal: AbortSignal },
): Promise<BatchResult> {
  const core = smartPrompt(prompt, ctx.library.dictionary).core;
  if (engine === "tripo") return { asset: await viaTripo(prompt, ctx.signal), via: "tripo" };

  const hit = matchLibrary(ctx.library.entries, prompt, core);
  if (hit) return { asset: await fromLibrary(hit, prompt), via: "library" };

  if (engine === "auto") {
    const params = detectProcedural(core);
    if (params) {
      const { buildProcedural } = await import("./procedural/build");
      return { asset: await saveGroup(buildProcedural(params), "procedural", prompt), via: "procedural" };
    }
    if (ctx.gemini) return { asset: await viaDesign("gemini", prompt), via: "gemini" };
    throw new Error("Belum dikenali Mode Gratis / Library, dan GEMINI_API_KEY belum diisi.");
  }
  if (engine === "gemini" && !ctx.gemini) throw new Error("GEMINI_API_KEY belum diisi.");
  if (engine === "claude" && !ctx.claude) throw new Error("ANTHROPIC_API_KEY belum diisi.");
  return { asset: await viaDesign(engine, prompt), via: engine };
}
