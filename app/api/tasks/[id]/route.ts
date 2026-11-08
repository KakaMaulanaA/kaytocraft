import { NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { pollTask } from "@/lib/server/providers";
import { download, getAsset, modelKey, saveBuffer, updateAsset } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

// Guard so overlapping polls don't download the same model twice.
const finalizing = new Set<string>();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) return NextResponse.json({ error: "Asset tidak ditemukan." }, { status: 404 });
  if (asset.status === "ready" || asset.status === "failed" || finalizing.has(id)) return NextResponse.json(asset);

  try {
    const r = await pollTask(asset);

    if (r.state === "running") {
      return NextResponse.json(
        await updateAsset(id, { status: "running", progress: Math.round(r.progress), stageLabel: r.stageLabel }),
      );
    }
    if (r.state === "next-stage") {
      return NextResponse.json(
        await updateAsset(id, { progress: 50, stageLabel: "Memulai texturing", provider: { ...asset.provider, taskId: r.taskId, stage: r.stage } }),
      );
    }
    if (r.state === "failed") {
      return NextResponse.json(await updateAsset(id, { status: "failed", error: r.error, stageLabel: undefined }));
    }

    // done -> keep a local copy (provider links expire within minutes)
    finalizing.add(id);
    await updateAsset(id, { progress: 99, stageLabel: "Mengunduh model ke storage lokal" });
    const target = modelKey({ id, format: r.format })!;
    let size: number;
    if (r.localModel) {
      const src = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "demo", path.basename(r.localModel));
      size = await saveBuffer(target, await fs.readFile(src));
    } else {
      size = await download(r.modelUrl, target);
    }
    let hasThumb = false;
    if (r.thumbUrl) {
      try {
        const ext = /\.png(\?|$)/i.test(r.thumbUrl) ? "png" : /\.jpe?g(\?|$)/i.test(r.thumbUrl) ? "jpg" : "webp";
        await download(r.thumbUrl, `thumbs/${id}.${ext}`);
        hasThumb = true;
      } catch {}
    }
    const ready = await updateAsset(id, {
      status: "ready",
      progress: 100,
      stageLabel: undefined,
      format: r.format,
      fileSize: size,
      hasThumb,
      completedAt: Date.now(),
    });
    return NextResponse.json(ready);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Network hiccups shouldn't kill the job; report but keep it running.
    return NextResponse.json({ ...asset, stageLabel: `Retry… (${msg.slice(0, 80)})` });
  } finally {
    finalizing.delete(id);
  }
}
