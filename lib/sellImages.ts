/**
 * "Siap Jual" in the browser: turn the package from the server (transparent PNG renders from each
 * camera + clay, models, INFO.txt) into the formats the user picked. No re-render needed.
 */

export interface SellOptions {
  png: boolean; // transparent PNG (as rendered)
  jpgWhite: boolean; // JPG on white
  jpgColor: boolean; // JPG on a colour background
  color: string; // #rrggbb for jpgColor (and the collage background when set)
  webp: boolean; // WebP with transparency (small files for online shops)
  collage: boolean; // one JPG: every angle + clay
  clay: boolean; // include the clay render
  models: { blend: boolean; glb: boolean; fbx: boolean; obj: boolean };
  cover: boolean; // one cover image with every selected item
}

export const DEFAULT_SELL: SellOptions = {
  png: true,
  jpgWhite: true,
  jpgColor: false,
  color: "#69A8E8",
  webp: false,
  collage: true,
  clay: true,
  models: { blend: true, glb: true, fbx: true, obj: true },
  cover: true,
};

/** Background colours from the studio template's palette (sRGB of its base colours). */
export const SWATCHES = [
  { name: "Soft Blue", hex: "#69A8E8" },
  { name: "Blue Marine", hex: "#36A1E8" },
  { name: "Cyan", hex: "#63FFDD" },
  { name: "Yellow", hex: "#E8CF33" },
  { name: "Light Purple", hex: "#B576E8" },
  { name: "Abu muda", hex: "#EEEEEE" },
  { name: "Hitam", hex: "#1A1A1A" },
];

type Files = Record<string, Uint8Array>;

async function decode(png: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }));
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function encode(c: HTMLCanvasElement, type: "image/jpeg" | "image/webp", q = 0.95): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, q));
  if (!blob) throw new Error(`Browser tidak bisa membuat ${type === "image/webp" ? "WebP" : "JPG"}.`);
  return new Uint8Array(await blob.arrayBuffer());
}

async function onBackground(img: ImageBitmap, color: string | null, type: "image/jpeg" | "image/webp") {
  const c = canvas(img.width, img.height);
  const g = c.getContext("2d")!;
  if (color) {
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
  }
  g.drawImage(img, 0, 0);
  return encode(c, type);
}

/** 2×2 grid (angles + clay), or one row when there are fewer. */
async function makeCollage(imgs: ImageBitmap[], color: string) {
  const cols = imgs.length <= 3 ? imgs.length : 2;
  const rows = Math.ceil(imgs.length / cols);
  const cell = 1024;
  const c = canvas(cols * cell, rows * cell);
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  imgs.forEach((im, i) => g.drawImage(im, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell));
  return encode(c, "image/jpeg");
}

const MODEL_EXT: Record<string, keyof SellOptions["models"]> = { blend: "blend", glb: "glb", fbx: "fbx", obj: "obj", mtl: "obj" };

/**
 * One item: package files (paths like "Nama/renders/Nama_1.png") -> files for the final ZIP
 * under `folder/`. Returns the first angle (for the cover).
 */
export async function shapeItem(pkg: Files, folder: string, o: SellOptions, out: Files): Promise<ImageBitmap | null> {
  const strip = (p: string) => p.split("/").slice(1).join("/"); // drop the server's top folder
  const renders = Object.keys(pkg)
    .filter((p) => /\/renders\/[^/]+\.png$/i.test(p))
    .sort();
  const angles = renders.filter((p) => !/_clay\.png$/i.test(p));
  const clay = renders.find((p) => /_clay\.png$/i.test(p));
  const use = o.clay && clay ? [...angles, clay] : angles;

  const bitmaps: ImageBitmap[] = [];
  for (const p of use) {
    const name = strip(p).replace(/\.png$/i, ""); // renders/Nama_1
    const img = await decode(pkg[p]);
    bitmaps.push(img);
    if (o.png) out[`${folder}/${name}.png`] = pkg[p];
    if (o.jpgWhite) out[`${folder}/${name}_putih.jpg`] = await onBackground(img, "#ffffff", "image/jpeg");
    if (o.jpgColor) out[`${folder}/${name}_warna.jpg`] = await onBackground(img, o.color, "image/jpeg");
    if (o.webp) out[`${folder}/${name}.webp`] = await onBackground(img, null, "image/webp");
  }
  if (o.collage && bitmaps.length) {
    const base = strip(angles[0] ?? use[0]).replace(/_\d+\.png$/i, "").replace(/\.png$/i, "");
    out[`${folder}/${base}_kolase.jpg`] = await makeCollage(bitmaps, o.jpgColor ? o.color : "#ffffff");
  }

  for (const [p, data] of Object.entries(pkg)) {
    if (p.endsWith("/")) continue;
    const rel = strip(p);
    if (rel.startsWith("renders/")) continue; // rebuilt above
    const ext = rel.split(".").pop()!.toLowerCase();
    const kind = MODEL_EXT[ext];
    if (kind && !o.models[kind]) continue;
    // textures exported next to .obj/.fbx follow their model
    if (rel.startsWith("model/") && !kind && !(o.models.obj || o.models.fbx)) continue;
    out[`${folder}/${rel}`] = data;
  }
  bitmaps.slice(1).forEach((b) => b.close());
  return bitmaps[0] ?? null;
}

/** One cover image with every item (first angle), on white or the chosen colour. */
export async function makeCover(firsts: ImageBitmap[], color: string): Promise<Uint8Array | null> {
  if (!firsts.length) return null;
  const cols = Math.min(4, firsts.length);
  const rows = Math.ceil(firsts.length / cols);
  const cell = 600;
  const c = canvas(cols * cell, rows * cell);
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  firsts.forEach((im, i) => g.drawImage(im, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell));
  return encode(c, "image/jpeg");
}
