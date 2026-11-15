import { getSell } from "@/lib/server/sell";
import { readFile, saveBuffer, sellBlendKey, sellZipKey } from "@/lib/server/storage";
import { blendSupported, packFromBlend } from "@/lib/server/blender";
import { clearRemote, finishRemote, remoteBlendReady, remoteState, startRemote, workerAuthorized } from "@/lib/server/blendRemote";
import { assemble, validUploadId } from "@/lib/server/uploads";
import { streamResponse } from "@/lib/server/blobstore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

const PART = 4 * 1024 * 1024;
const running = new Map<string, Promise<void>>();
const failed = new Map<string, string>();

/**
 * Package of an uploaded fixed .blend: renders from every camera + clay, .blend/.glb/.fbx/.obj, INFO.txt.
 *  GET          -> 202 {status:"pending"} (starts the job the first time), or 200 {status:"ready", size, parts}
 *  GET ?part=N  -> bytes of the ZIP, 4 MB at a time
 */
export async function GET(req: Request, { params }: Ctx) {
  const item = await getSell((await params).id);
  if (!item) return Response.json({ error: "Tidak ditemukan." }, { status: 404 });

  const zip = await readFile(sellZipKey(item.id));
  if (zip) {
    const part = new URL(req.url).searchParams.get("part");
    if (part == null) return Response.json({ status: "ready", size: zip.length, parts: Math.ceil(zip.length / PART) });
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n * PART >= zip.length) return Response.json({ error: "part" }, { status: 416 });
    return streamResponse(zip.subarray(n * PART, (n + 1) * PART), { "Content-Type": "application/octet-stream" });
  }

  if (blendSupported()) {
    const err = failed.get(item.id);
    if (err) {
      failed.delete(item.id);
      return Response.json({ error: `Render gagal: ${err}` }, { status: 500 });
    }
    if (!running.has(item.id)) {
      const job = (async () => {
        const blend = await readFile(sellBlendKey(item.id));
        if (!blend) throw new Error("File .blend hilang.");
        await saveBuffer(sellZipKey(item.id), await packFromBlend(blend, item.name));
      })()
        .catch((e) => void failed.set(item.id, e instanceof Error ? e.message : String(e)))
        .finally(() => running.delete(item.id));
      running.set(item.id, job);
    }
    return Response.json({ status: "pending", step: "render" }, { status: 202 });
  }

  if (!remoteBlendReady())
    return Response.json({ error: "Render online belum disetel (GITHUB_TOKEN, GITHUB_REPO, BLEND_WORKER_SECRET)." }, { status: 501 });
  const st = await remoteState(item.id, "sell");
  if (st.state === "error") {
    await clearRemote(item.id, "sell");
    return Response.json({ error: `Render gagal: ${st.error}` }, { status: 500 });
  }
  if (st.state === "none") {
    try {
      await startRemote({ id: item.id, name: item.name }, process.env.URL || new URL(req.url).origin, "sell");
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }
  return Response.json({ status: "pending", step: "render" }, { status: 202 });
}

/** Called by the GitHub Actions worker: {uploadId} (ZIP chunks already sent) or {error}. */
export async function POST(req: Request, { params }: Ctx) {
  if (!workerAuthorized(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  if (!(await getSell(id))) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { uploadId?: string; error?: string };
  if (body.uploadId) {
    if (!validUploadId(body.uploadId)) return Response.json({ error: "bad uploadId" }, { status: 400 });
    await finishRemote(id, { buf: await assemble(body.uploadId, 300 * 1024 * 1024) }, "sell");
  } else {
    await finishRemote(id, { error: String(body.error ?? "Render gagal.") }, "sell");
  }
  return Response.json({ ok: true });
}
