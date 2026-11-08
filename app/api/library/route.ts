import { NextResponse } from "next/server";
import { addEntry, libId, readLibrary, removeLibFiles, writeLibFile } from "@/lib/server/library";
import { findThumb, getAsset, modelKey, readFile } from "@/lib/server/storage";
import { blendSupported, glbFromBlend } from "@/lib/server/blender";
import { takeFile } from "@/lib/server/uploads";
import { parseKeywords, type LibraryEntry } from "@/lib/library";
import { sanitizeSpec } from "@/lib/modelSpec";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_FILE = 150 * 1024 * 1024;

export async function GET() {
  return NextResponse.json(await readLibrary());
}

/**
 * Add knowledge. multipart fields:
 *   label, keywords (comma separated), origin, description?
 *   + one of: spec (JSON recipe) | file (.glb/.fbx/.blend, inline or chunked) | fromAsset (asset id in the vault)
 *   thumb? (png)
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const label = String(form.get("label") ?? "").trim().slice(0, 80);
  const keywords = parseKeywords(String(form.get("keywords") ?? ""));
  if (!label && !keywords.length) return NextResponse.json({ error: "Isi nama atau kata kunci." }, { status: 400 });
  if (!keywords.length) keywords.push(label.toLowerCase());

  const id = libId();
  const entry: LibraryEntry = {
    id,
    label: label || keywords[0],
    keywords,
    type: "model",
    origin: String(form.get("origin") ?? "file").slice(0, 20),
    description: String(form.get("description") ?? "").slice(0, 500) || undefined,
    createdAt: Date.now(),
    uses: 0,
  };

  try {
    const specRaw = form.get("spec");
    const fromAsset = String(form.get("fromAsset") ?? "");
    const file = typeof specRaw === "string" && specRaw.trim() ? null : await takeFile(form, "file", MAX_FILE);
    if (typeof specRaw === "string" && specRaw.trim()) {
      const spec = sanitizeSpec(JSON.parse(specRaw));
      if (!spec.parts.length) throw new Error("Resep tidak berisi part yang valid.");
      entry.type = "spec";
      await writeLibFile(id, "json", JSON.stringify(spec, null, 2));
    } else if (file) {
      const name = file.name.toLowerCase();
      if (name.endsWith(".glb") || name.endsWith(".fbx")) {
        entry.format = name.endsWith(".fbx") ? "fbx" : "glb";
        await writeLibFile(id, entry.format, file.buf);
      } else if (name.endsWith(".blend")) {
        if (!blendSupported())
          throw new Error("File .blend butuh Blender di komputer — tidak bisa di versi online. Export .glb dari Blender lalu unggah.");
        await writeLibFile(id, "glb", await glbFromBlend(file.buf));
        entry.format = "glb";
      } else {
        throw new Error("Format file harus .glb, .fbx, atau .blend.");
      }
    } else if (fromAsset) {
      const asset = await getAsset(fromAsset);
      if (!asset || asset.status !== "ready") throw new Error("Aset tidak ditemukan.");
      const spec = await readFile(`specs/${asset.id}.json`);
      if (spec) {
        entry.type = "spec";
        await writeLibFile(id, "json", spec);
      } else {
        const buf = await readFile(modelKey(asset)!);
        if (!buf) throw new Error("File model aset hilang.");
        entry.format = asset.format;
        await writeLibFile(id, asset.format!, buf);
      }
      const t = await findThumb(asset.id);
      if (t && t.key.endsWith(".png")) {
        await writeLibFile(id, "png", t.buf);
        entry.hasThumb = true;
      }
    } else {
      throw new Error("Tidak ada isi: kirim resep, file, atau pilih aset.");
    }
    const thumb = form.get("thumb");
    if (thumb instanceof File && thumb.size < 3 * 1024 * 1024) {
      await writeLibFile(id, "png", Buffer.from(await thumb.arrayBuffer()));
      entry.hasThumb = true;
    }
  } catch (e) {
    await removeLibFiles(id);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  return NextResponse.json(await addEntry(entry));
}
