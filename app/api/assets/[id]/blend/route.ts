import { getAsset, modelKey, readFile, saveBuffer } from "@/lib/server/storage";
import { blendFromModel, blendSupported } from "@/lib/server/blender";
import { clearRemote, finishRemote, remoteBlendReady, remoteState, startRemote, workerAuthorized } from "@/lib/server/blendRemote";
import { assemble, validUploadId } from "@/lib/server/uploads";
import { streamResponse } from "@/lib/server/blobstore";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

// One local conversion per asset at a time.
const running = new Map<string, Promise<Buffer>>();

/**
 * Download the asset as .blend.
 *  - cached        -> the file
 *  - on the PC     -> converted with the local Blender (waits), then the file
 *  - online        -> 202 {status:"pending"} while GitHub Actions converts it; poll again
 */
export async function GET(req: Request, { params }: Ctx) {
  const asset = await getAsset((await params).id);
  const key = asset && modelKey(asset);
  if (!asset || !key || asset.status !== "ready") return Response.json({ error: "Model belum tersedia." }, { status: 404 });

  const out = `blend/${asset.id}.blend`;
  let buf = await readFile(out);
  if (!buf && blendSupported()) {
    try {
      let job = running.get(asset.id);
      if (!job) {
        job = (async () => {
          const src = await readFile(key);
          if (!src) throw new Error("File model hilang.");
          const b = await blendFromModel(src, asset.format!, asset.name);
          await saveBuffer(out, b);
          return b;
        })().finally(() => running.delete(asset.id));
        running.set(asset.id, job);
      }
      buf = await job;
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  if (!buf) {
    if (!remoteBlendReady())
      return Response.json(
        { error: ".BLEND online belum disetel (GITHUB_TOKEN, GITHUB_REPO, BLEND_WORKER_SECRET). Sementara pakai .GLB." },
        { status: 501 },
      );
    const st = await remoteState(asset.id);
    if (st.state === "error") {
      await clearRemote(asset.id); // next click retries
      return Response.json({ error: `Konversi .blend gagal: ${st.error}` }, { status: 500 });
    }
    if (st.state === "none") {
      try {
        const site = process.env.URL || new URL(req.url).origin;
        await startRemote(asset, site);
      } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
      }
      return Response.json({ status: "pending", since: Date.now() }, { status: 202 });
    }
    return Response.json({ status: "pending", since: st.since }, { status: 202 });
  }

  const safe = asset.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || asset.id;
  return streamResponse(buf, {
    "Content-Type": "application/x-blender",
    "Content-Disposition": `attachment; filename="${safe}.blend"`,
  });
}

/** Called by the GitHub Actions worker: {uploadId} (chunks already sent) or {error}. */
export async function POST(req: Request, { params }: Ctx) {
  if (!workerAuthorized(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  if (!(await getAsset(id))) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { uploadId?: string; error?: string };
  if (body.uploadId) {
    if (!validUploadId(body.uploadId)) return Response.json({ error: "bad uploadId" }, { status: 400 });
    const buf = await assemble(body.uploadId, 300 * 1024 * 1024);
    await finishRemote(id, { buf });
  } else {
    await finishRemote(id, { error: String(body.error ?? "Konversi gagal.") });
  }
  return Response.json({ ok: true });
}
