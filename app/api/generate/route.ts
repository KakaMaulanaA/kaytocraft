import { NextResponse } from "next/server";
import { createTask, engineList, invalidateBalance, tripoBalance, type UploadedImage } from "@/lib/server/providers";
import { getConcept, readConceptImage } from "@/lib/server/concepts";
import { estimate3D, sum } from "@/lib/estimate";
import { insertAsset, newId, saveBuffer, updateAsset } from "@/lib/server/storage";
import { nameFromPrompt, PROMPT_MAX } from "@/lib/presets";
import { takeFile } from "@/lib/server/uploads";
import type { Asset, GenerateSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_IMAGE = 20 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function POST(req: Request) {
  const form = await req.formData();
  let settings: GenerateSettings;
  try {
    settings = JSON.parse(String(form.get("settings") ?? ""));
  } catch {
    return NextResponse.json({ error: "Payload settings tidak valid." }, { status: 400 });
  }

  const engine = engineList().find((e) => e.id === settings.engine);
  if (!engine) return NextResponse.json({ error: "Engine tidak dikenal." }, { status: 400 });
  if (!engine.available)
    return NextResponse.json({ error: `${engine.label} belum aktif — isi API key di .env.local.` }, { status: 400 });

  settings.prompt = String(settings.prompt ?? "").slice(0, PROMPT_MAX);
  if (settings.mode === "text" && !settings.prompt.trim())
    return NextResponse.json({ error: "Prompt masih kosong." }, { status: 400 });

  let image: UploadedImage | undefined;
  let file: Awaited<ReturnType<typeof takeFile>> = null;
  try {
    file = await takeFile(form, "image", MAX_IMAGE);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const conceptId = String(form.get("conceptId") ?? "");
  if (conceptId) {
    // 3D from an approved 2D concept: send the concept image to the image-to-3D endpoint.
    const c = await getConcept(conceptId);
    if (!c || c.status !== "ready") return NextResponse.json({ error: "Konsep tidak ditemukan / belum siap." }, { status: 400 });
    settings.mode = "image";
    if (c.ext !== "svg") {
      const buf = await readConceptImage(c);
      if (!buf) return NextResponse.json({ error: "Gambar konsep hilang." }, { status: 400 });
      image = {
        buf,
        mime: c.ext === "jpg" ? "image/jpeg" : "image/png",
        name: `concept-${c.id}.${c.ext}`,
      };
    } else if (engine.provider !== "demo") {
      return NextResponse.json({ error: "Konsep demo hanya bisa dipakai dengan Demo Mode." }, { status: 400 });
    }
  } else if (settings.mode === "image") {
    if (!file) return NextResponse.json({ error: "Unggah gambar referensi dulu." }, { status: 400 });
    if (!IMAGE_TYPES.includes(file.type))
      return NextResponse.json({ error: "Format gambar harus PNG, JPG, atau WebP." }, { status: 400 });
    image = { buf: file.buf, mime: file.type, name: file.name || "reference.png" };
  }

  // Don't waste a request if the Tripo balance clearly can't cover it.
  if (engine.provider === "tripo") {
    const need = sum(estimate3D(settings) ?? []);
    const have = await tripoBalance();
    if (have !== null && have < need)
      return NextResponse.json(
        { error: `Saldo Tripo kurang: butuh ±${need} kredit, tersisa ${have}. Top up di developers.tripo3d.ai/en/pricing.` },
        { status: 402 },
      );
  }

  const id = newId();
  const name =
    settings.mode === "image" && !settings.prompt.trim() && file
      ? nameFromPrompt(file.name.replace(/\.[^.]+$/, ""), "Image Asset")
      : nameFromPrompt(settings.prompt);

  const asset: Asset = {
    id,
    name,
    status: "queued",
    progress: 0,
    stageLabel: "Mengirim ke engine",
    settings,
    provider: { engine: settings.engine, startedAt: Date.now() },
    conceptId: conceptId || undefined,
    createdAt: Date.now(),
  };
  await insertAsset(asset);

  if (image) {
    const ext = image.mime.split("/")[1].replace("jpeg", "jpg");
    await saveBuffer(`uploads/${id}.${ext}`, image.buf);
  }

  try {
    const r = await createTask(asset, image);
    invalidateBalance();
    const updated = await updateAsset(id, {
      status: "running",
      stageLabel: "Task dibuat",
      provider: { engine: settings.engine, taskId: r.taskId, stage: r.stage, demoModel: r.demoModel },
    });
    return NextResponse.json(updated);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const failed = await updateAsset(id, { status: "failed", error, stageLabel: undefined });
    return NextResponse.json(failed, { status: 502 });
  }
}
