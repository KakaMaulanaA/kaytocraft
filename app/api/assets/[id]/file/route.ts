import { getAsset, modelKey, readFile } from "@/lib/server/storage";
import { streamResponse } from "@/lib/server/blobstore";

export const dynamic = "force-dynamic";

const MIME = { glb: "model/gltf-binary", fbx: "application/octet-stream" } as const;

/** Serves the stored model. `?download=1` sets a friendly filename for saving. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const asset = await getAsset((await params).id);
  const key = asset && modelKey(asset);
  const buf = asset?.status === "ready" && key ? await readFile(key) : null;
  if (!asset || !buf) return new Response("Model belum tersedia", { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": MIME[asset.format!],
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  if (new URL(req.url).searchParams.get("download")) {
    const safe = asset.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || asset.id;
    headers["Content-Disposition"] = `attachment; filename="${safe}.${asset.format}"`;
  }
  return streamResponse(buf, headers);
}
