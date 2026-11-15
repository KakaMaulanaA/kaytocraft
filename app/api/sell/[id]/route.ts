import { deleteSell, getSell } from "@/lib/server/sell";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await getSell(id))) return Response.json({ error: "Not found" }, { status: 404 });
  await deleteSell(id);
  return Response.json({ ok: true });
}
