import { blendKey, fixedBlendKey, getAsset, modelKey, packKey, readFile, saveBuffer } from "@/lib/server/storage";
import { blendFromModel, blendSupported, packFromBlend } from "@/lib/server/blender";
import { clearRemote, finishRemote, remoteBlendReady, remoteState, startRemote, workerAuthorized } from "@/lib/server/blendRemote";
import { assemble, validUploadId } from "@/lib/server/uploads";
import { streamResponse } from "@/lib/server/blobstore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Download in parts: hosted functions cap response sizes, the browser joins them. */
const PART = 4 * 1024 * 1024;

// Local (PC) jobs run in the background; the page polls.
const running = new Map<string, Promise<void>>();
const failed = new Map<string, string>();

/**
 * "Paket Siap Jual": renders from every camera + clay, .blend/.glb/.fbx/.obj, INFO.txt, zipped.
 *  GET            -> 202 {status:"pending", step} while it is being made (poll), or
 *                    200 {status:"ready", size, parts}
 *  GET ?part=N    -> bytes N*4MB .. (N+1)*4MB of the ZIP
 * Made from the user's fixed .blend when uploaded, otherwise from the generated one.
 */
export async function GET(req: Request, { params }: Ctx) {
  const asset = await getAsset((await params).id);
  const key = asset && modelKey(asset);
  if (!asset || !key || asset.status !== "ready") return Response.json({ error: "Model belum tersedia." }, { status: 404 });

  const zip = await readFile(packKey(asset.id));
  if (zip) {
    const part = new URL(req.url).searchParams.get("part");
    if (part == null) return Response.json({ status: "ready", size: zip.length, parts: Math.ceil(zip.length / PART) });
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n * PART >= zip.length) return Response.json({ error: "part" }, { status: 416 });
    return streamResponse(zip.subarray(n * PART, (n + 1) * PART), { "Content-Type": "application/octet-stream" });
  }

  // On the PC: local Blender (GPU when available).
  if (blendSupported()) {
    const err = failed.get(asset.id);
    if (err) {
      failed.delete(asset.id);
      return Response.json({ error: `Paket gagal: ${err}` }, { status: 500 });
    }
    if (!running.has(asset.id)) {
      const job = (async () => {
        let blend = (await readFile(fixedBlendKey(asset.id))) ?? (await readFile(blendKey(asset.id)));
        if (!blend) {
          const src = await readFile(key);
          if (!src) throw new Error("File model hilang.");
          blend = await blendFromModel(src, asset.format!, asset.name);
          await saveBuffer(blendKey(asset.id), blend);
        }
        await saveBuffer(packKey(asset.id), await packFromBlend(blend, asset.name));
      })()
        .catch((e) => void failed.set(asset.id, e instanceof Error ? e.message : String(e)))
        .finally(() => running.delete(asset.id));
      running.set(asset.id, job);
    }
    return Response.json({ status: "pending", step: "render" }, { status: 202 });
  }

  // Online: GitHub Actions. A .blend has to exist first.
  if (!remoteBlendReady())
    return Response.json({ error: "Paket online belum disetel (GITHUB_TOKEN, GITHUB_REPO, BLEND_WORKER_SECRET)." }, { status: 501 });
  const site = process.env.URL || new URL(req.url).origin;
  const hasBlend = !!((await readFile(fixedBlendKey(asset.id))) || (await readFile(blendKey(asset.id))));
  const kind = hasBlend ? "pack" : "blend";
  const st = await remoteState(asset.id, kind);
  if (st.state === "error") {
    await clearRemote(asset.id, kind); // next click retries
    return Response.json({ error: `${kind === "blend" ? "Konversi .blend" : "Render paket"} gagal: ${st.error}` }, { status: 500 });
  }
  if (st.state === "none") {
    try {
      await startRemote(asset, site, kind);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }
  return Response.json({ status: "pending", step: kind === "blend" ? "blend" : "render" }, { status: 202 });
}

/** Called by the GitHub Actions worker: {uploadId} (ZIP chunks already sent) or {error}. */
export async function POST(req: Request, { params }: Ctx) {
  if (!workerAuthorized(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  if (!(await getAsset(id))) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { uploadId?: string; error?: string };
  if (body.uploadId) {
    if (!validUploadId(body.uploadId)) return Response.json({ error: "bad uploadId" }, { status: 400 });
    await finishRemote(id, { buf: await assemble(body.uploadId, 300 * 1024 * 1024) }, "pack");
  } else {
    await finishRemote(id, { error: String(body.error ?? "Render gagal.") }, "pack");
  }
  return Response.json({ ok: true });
}
