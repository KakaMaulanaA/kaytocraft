import { NextResponse } from "next/server";
import { insertAsset, modelKey, newId, saveBuffer } from "@/lib/server/storage";
import { nameFromPrompt } from "@/lib/presets";
import { takeFile } from "@/lib/server/uploads";
import { looksLikeModel } from "@/lib/server/http";
import type { Asset } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX = 150 * 1024 * 1024;

/**
 * Store a model made outside the AI engines:
 *  - source=procedural: built in the browser by the free generator
 *  - source=import: a .glb/.fbx the user picked (e.g. from Tripo/Meshy websites)
 */
export async function POST(req: Request) {
  const form = await req.formData();
  let file: Awaited<ReturnType<typeof takeFile>>;
  try {
    file = await takeFile(form, "file", MAX);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "File model tidak ada." }, { status: 400 });
  const ext = file.name.toLowerCase().endsWith(".fbx") ? "fbx" : file.name.toLowerCase().endsWith(".glb") ? "glb" : null;
  if (!ext) return NextResponse.json({ error: "Format harus .glb atau .fbx." }, { status: 400 });
  if (!looksLikeModel(file.buf, ext))
    return NextResponse.json({ error: `Isi file bukan model .${ext} yang valid (mungkin rusak atau hanya ganti nama).` }, { status: 400 });

  const src = form.get("source");
  const source =
    src === "procedural" || src === "claude" || src === "gemini" || src === "library" ? src : ("import" as const);
  const prompt = String(form.get("prompt") ?? "").slice(0, 1000);
  const id = newId();
  const fallbackName = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  const asset: Asset = {
    id,
    name: nameFromPrompt(prompt || fallbackName, "Imported Model"),
    status: "ready",
    progress: 100,
    source,
    settings: {
      mode: "text",
      prompt,
      engine: source === "claude" || source === "gemini" ? source : "demo",
      density: "balanced",
      textureQuality: "standard",
      pbr: true,
      quad: false,
      smartLowPoly: false,
      presets: [],
    },
    provider: { engine: source === "claude" || source === "gemini" ? source : "demo" },
    format: ext,
    createdAt: Date.now(),
    completedAt: Date.now(),
  };
  asset.fileSize = await saveBuffer(modelKey(asset)!, file.buf);
  // Keep the recipe (Claude / library specs) so the model can be saved to the Library and re-skinned later.
  const spec = form.get("spec");
  if (typeof spec === "string" && spec.length < 2_000_000) await saveBuffer(`specs/${id}.json`, spec);
  await insertAsset(asset);
  return NextResponse.json(asset);
}
