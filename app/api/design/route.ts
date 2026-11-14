import { NextResponse } from "next/server";
import { DesignError, designWith } from "@/lib/server/design";
import { createJob, deleteJob, readJob } from "@/lib/server/designJobs";
import { isHosted } from "@/lib/server/blobstore";
import { badJson, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Body: { engine: "claude" | "gemini", prompt, image?: { mediaType, data } }
 *  - on the PC: waits and returns { spec, model, usage }
 *  - online:    returns { jobId } at once (the design runs in a background function); poll GET ?job=<id>
 */
export async function POST(req: Request) {
  const body = await readJson<{ engine?: string; prompt?: string; image?: { mediaType?: string; data?: string } }>(req);
  if (!body) return badJson();
  const prompt = String(body.prompt ?? "").trim().slice(0, 2000);
  const img = body.image?.data ? { mediaType: String(body.image.mediaType), data: body.image.data } : undefined;
  if (!prompt && !img) return NextResponse.json({ error: "Prompt atau gambar masih kosong." }, { status: 400 });
  if (img && !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(img.mediaType))
    return NextResponse.json({ error: "Gambar harus PNG, JPG, WebP, atau GIF." }, { status: 400 });
  const engine = String(body.engine ?? "claude");
  if (engine !== "claude" && engine !== "gemini") return NextResponse.json({ error: `Engine ${engine} tidak bisa merancang.` }, { status: 400 });

  let fast = false;
  if (isHosted()) {
    // Preferred: background function (no time limit worth worrying about).
    const jobId = await createJob(engine, { prompt, image: img });
    const origin = process.env.KC_FUNCTIONS_ORIGIN || new URL(req.url).origin;
    const res = await fetch(`${origin}/.netlify/functions/design-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (res && res.status === 202) return NextResponse.json({ jobId }, { status: 202 });
    // Not deployed (e.g. drag & drop deploy): answer directly, in fast mode.
    await deleteJob(jobId);
    fast = true;
  }

  try {
    return NextResponse.json(await designWith(engine, { prompt, image: img, fast }));
  } catch (e) {
    const status = e instanceof DesignError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}

/** Poll an online job: { status: "pending" } | the result | { error } */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("job") ?? "";
  const job = await readJob(id);
  if (!job) return NextResponse.json({ error: "Proses AI tidak ditemukan. Coba lagi." }, { status: 404 });
  if (job.status === "done") {
    await deleteJob(id);
    return NextResponse.json(job.result);
  }
  if (job.status === "error") {
    await deleteJob(id);
    return NextResponse.json({ error: job.error }, { status: job.code || 500 });
  }
  if (Date.now() - job.at > 16 * 60_000) {
    await deleteJob(id);
    return NextResponse.json({ error: "Proses AI terlalu lama dan dihentikan. Coba lagi." }, { status: 504 });
  }
  return NextResponse.json({ status: job.status === "queued" ? "pending" : "running" }, { status: 202 });
}
