import { createSell, getSell, listSell, looksLikeBlend, nameFromFile, replaceSell } from "@/lib/server/sell";
import { listKeys, PACK_VER } from "@/lib/server/storage";
import { takeFile } from "@/lib/server/uploads";

export const dynamic = "force-dynamic";

/** Siap Jual items with their package state (from key names only — no big downloads). */
export async function GET() {
  const [items, keys] = await Promise.all([listSell(), listKeys("sell/")]);
  const has = new Set(keys);
  return Response.json(
    items.map((it) => {
      const base = `sell/${it.id}.${PACK_VER}`;
      const state = has.has(`${base}.zip`) ? "ready" : has.has(`${base}.error.txt`) ? "error" : has.has(`${base}.pending.json`) ? "rendering" : "new";
      return { ...it, state };
    }),
  );
}

/** Upload one fixed .blend (form "file" or chunked "fileUploadId"); "replace" = id of an item to update. */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Upload tidak valid." }, { status: 400 });
  }
  let file;
  try {
    file = await takeFile(form, "file", 250 * 1024 * 1024);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Upload gagal." }, { status: 400 });
  }
  if (!file) return Response.json({ error: "Pilih file .blend." }, { status: 400 });
  if (!/\.blend\d*$/i.test(file.name) || !looksLikeBlend(file.buf))
    return Response.json({ error: `${file.name}: bukan file .blend.` }, { status: 400 });
  const replace = String(form.get("replace") ?? "");
  if (replace) {
    const cur = await getSell(replace);
    if (!cur) return Response.json({ error: "Item tidak ditemukan." }, { status: 404 });
    return Response.json(await replaceSell(cur, file.buf));
  }
  const name = String(form.get("name") ?? "").trim().slice(0, 80) || nameFromFile(file.name);
  return Response.json(await createSell(name, file.buf), { status: 201 });
}
