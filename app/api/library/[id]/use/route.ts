import { NextResponse } from "next/server";
import { readLibFile, readLibrary, updateEntry, validId } from "@/lib/server/library";
import { insertAsset, modelKey, newId, saveBuffer } from "@/lib/server/storage";
import { nameFromPrompt } from "@/lib/presets";
import type { Asset } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Count a use. For model entries also create a vault asset from the stored file
 * (spec entries are built in the browser and saved through /api/assets/upload).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { prompt = "" } = (await req.json().catch(() => ({}))) as { prompt?: string };
  const e = (await readLibrary()).entries.find((x) => x.id === id);
  if (!e) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await updateEntry(id, { uses: (e.uses ?? 0) + 1 });
  if (e.type === "spec") return NextResponse.json({ ok: true });

  const asset: Asset = {
    id: newId(),
    name: nameFromPrompt(prompt || e.label),
    status: "ready",
    progress: 100,
    source: "library",
    settings: {
      mode: "text",
      prompt,
      engine: "demo",
      density: "balanced",
      textureQuality: "standard",
      pbr: true,
      quad: false,
      smartLowPoly: false,
      presets: [],
    },
    provider: { engine: "demo" },
    format: e.format ?? "glb",
    createdAt: Date.now(),
    completedAt: Date.now(),
  };
  const buf = await readLibFile(id, asset.format!);
  if (!buf) return NextResponse.json({ error: "File model entri ini hilang." }, { status: 404 });
  asset.fileSize = await saveBuffer(modelKey(asset)!, buf);
  await insertAsset(asset);
  return NextResponse.json(asset);
}
