import { readLibFile, validId } from "@/lib/server/library";
import { streamResponse } from "@/lib/server/blobstore";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validId(id)) return new Response(null, { status: 404 });
  for (const ext of ["glb", "fbx"] as const) {
    const buf = await readLibFile(id, ext);
    if (buf)
      return streamResponse(buf, {
        "Content-Type": ext === "glb" ? "model/gltf-binary" : "application/octet-stream",
        "X-Format": ext,
      });
  }
  return new Response(null, { status: 404 });
}
