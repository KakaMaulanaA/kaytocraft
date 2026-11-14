import { NextResponse } from "next/server";
import { deleteAsset, getAsset, updateAsset } from "@/lib/server/storage";
import type { AssetStats } from "@/lib/types";
import { badJson, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const asset = await getAsset((await params).id);
  return asset ? NextResponse.json(asset) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** Rename an asset or store mesh stats measured by the viewer. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await readJson<{ name?: unknown; stats?: Record<string, unknown> }>(req);
  if (!body) return badJson();
  const patch: { name?: string; stats?: AssetStats } = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  // Only the known numeric mesh stats are kept.
  if (body.stats && typeof body.stats === "object") {
    const n = (k: string) => {
      const v = Number((body.stats as Record<string, unknown>)[k]);
      return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
    };
    const keys = ["vertices", "triangles", "meshes", "materials"] as const;
    const vals = keys.map(n);
    if (vals.every((v) => v !== null)) patch.stats = Object.fromEntries(keys.map((k, i) => [k, vals[i]])) as unknown as AssetStats;
  }
  const asset = await updateAsset(id, patch);
  return asset ? NextResponse.json(asset) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const asset = await deleteAsset((await params).id);
  return asset ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
