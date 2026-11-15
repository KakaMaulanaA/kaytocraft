import { getSell } from "@/lib/server/sell";
import { readFile, sellBlendKey } from "@/lib/server/storage";
import { workerAuthorized } from "@/lib/server/blendRemote";
import { streamResponse } from "@/lib/server/blobstore";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** The uploaded .blend (for the user, or the package worker with ?worker + secret). */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (new URL(req.url).searchParams.has("worker") && !workerAuthorized(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const item = await getSell(id);
  const buf = item && (await readFile(sellBlendKey(id)));
  if (!item || !buf) return Response.json({ error: "Not found" }, { status: 404 });
  const safe = item.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || id;
  return streamResponse(buf, { "Content-Type": "application/x-blender", "Content-Disposition": `attachment; filename="${safe}.blend"` });
}
