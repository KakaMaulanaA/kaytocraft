import { NextResponse } from "next/server";
import { deleteAsset, getAsset, updateAsset } from "@/lib/server/storage";
import type { AssetStats } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const asset = await getAsset((await params).id);
  return asset ? NextResponse.json(asset) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** Rename an asset or store mesh stats measured by the viewer. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json()) as { name?: string; stats?: AssetStats };
  const patch: { name?: string; stats?: AssetStats } = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (body.stats) patch.stats = body.stats;
  const asset = await updateAsset(id, patch);
  return asset ? NextResponse.json(asset) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const asset = await deleteAsset((await params).id);
  return asset ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
