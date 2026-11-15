import { blendKey, fixedBlendKey, getAsset, modelKey, packKey, readFile, removeFile, saveBuffer, updateAsset } from "@/lib/server/storage";
import { blendFromModel, blendSupported } from "@/lib/server/blender";
import { clearRemote, finishRemote, remoteBlendReady, remoteState, startRemote, workerAuthorized } from "@/lib/server/blendRemote";
import { assemble, takeFile, validUploadId } from "@/lib/server/uploads";
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

  const out = blendKey(asset.id);
  // The user's own fixed .blend wins over the generated one.
  let buf = (await readFile(fixedBlendKey(asset.id))) ?? (await readFile(out));
  // The package worker only reads; it never starts a conversion.
  if (new URL(req.url).searchParams.has("worker")) {
    if (!workerAuthorized(req)) return Response.json({ error: "forbidden" }, { status: 403 });
    if (!buf) return Response.json({ error: "Belum ada .blend." }, { status: 409 });
    return streamResponse(buf, { "Content-Type": "application/x-blender" });
  }
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

/** Real .blend files: plain ("BLENDER"), gzip, or zstd-compressed (Blender 3+/5 "compress"). */
function looksLikeBlend(b: Buffer) {
  if (b.length < 12) return false;
  if (b.subarray(0, 7).toString("latin1") === "BLENDER") return true;
  if (b[0] === 0x1f && b[1] === 0x8b) return true;
  return b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;
}

/**
 * POST from the GitHub Actions worker (x-worker-secret): {uploadId} (chunks already sent) or {error}.
 * POST from the user (form "file" / "fileUploadId"): their fixed .blend, used from now on for
 * downloads and the ready-to-sell package.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!req.headers.get("x-worker-secret")) {
    const asset = await getAsset(id);
    if (!asset) return Response.json({ error: "Not found" }, { status: 404 });
    let file;
    try {
      file = await takeFile(await req.formData(), "file", 300 * 1024 * 1024);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "Upload gagal." }, { status: 400 });
    }
    if (!file) return Response.json({ error: "Pilih file .blend." }, { status: 400 });
    if (!looksLikeBlend(file.buf)) return Response.json({ error: "Itu bukan file .blend." }, { status: 400 });
    await saveBuffer(fixedBlendKey(id), file.buf);
    await removeFile(packKey(id)); // the old package showed the old model
    await clearRemote(id, "pack");
    const next = await updateAsset(id, { blendFixedAt: Date.now() });
    return Response.json(next ?? { ok: true });
  }
  if (!workerAuthorized(req)) return Response.json({ error: "forbidden" }, { status: 403 });
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

/** Go back to the generated .blend (drops the uploaded fix and its package). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await getAsset(id))) return Response.json({ error: "Not found" }, { status: 404 });
  await Promise.all([removeFile(fixedBlendKey(id)), removeFile(packKey(id)), clearRemote(id, "pack")]);
  const next = await updateAsset(id, { blendFixedAt: undefined });
  return Response.json(next ?? { ok: true });
}
