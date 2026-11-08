import "server-only";
import { download, newId, readFile, saveBuffer } from "./storage";
import { TRIPO_BASE, invalidateBalance, jsonOrThrow, providerOf, tripoKey } from "./providers";
import type { Concept, EngineId } from "@/lib/types";
import { smartPrompt } from "@/lib/smartPrompt";
import { readDictionary } from "./library";

/**
 * 2D concept images generated before spending credits on 3D.
 * Each concept is stored as storage/concepts/<id>.json (+ <id>.png once ready).
 */

const metaKey = (id: string) => `concepts/${id}.json`;
export const conceptImageKey = (c: Pick<Concept, "id" | "ext">) => `concepts/${c.id}.${c.ext ?? "png"}`;
export const readConceptImage = (c: Pick<Concept, "id" | "ext">) => readFile(conceptImageKey(c));

async function save(c: Concept) {
  await saveBuffer(metaKey(c.id), JSON.stringify(c));
  return c;
}

export async function getConcept(id: string): Promise<Concept | null> {
  if (!/^[a-f0-9]{12}$/.test(id)) return null;
  const b = await readFile(metaKey(id));
  if (!b) return null;
  try {
    return JSON.parse(b.toString("utf8"));
  } catch {
    return null;
  }
}

/** Wrap the user's idea so the image is easy to turn into 3D. */
export function conceptPrompt(prompt: string, variant: number, dict: Record<string, string> = {}) {
  const views = ["three-quarter front view", "front view", "three-quarter side view", "slightly elevated three-quarter view"];
  return [
    smartPrompt(prompt, dict).core,
    "single isolated object, entire object fully visible and centered",
    views[variant % views.length],
    "plain pure white background, soft even studio lighting, no cast shadows",
    "clean product concept render, no text, no people, no other objects",
  ].join(", ");
}

export async function createConcepts(opts: { prompt: string; engine: EngineId; count: number }): Promise<Concept[]> {
  const batchId = newId();
  const count = Math.max(1, Math.min(4, Math.round(opts.count)));
  const provider = providerOf(opts.engine);
  if (provider === "meshy") throw new Error("Konsep 2D belum tersedia untuk Meshy. Pakai Tripo3D atau Demo.");
  if (provider === "tripo" && !tripoKey()) throw new Error("TRIPO_API_KEY belum diisi di .env.local");

  const dict = await readDictionary();
  const jobs = Array.from({ length: count }, async (_, i) => {
    const c: Concept = {
      id: newId(),
      batchId,
      prompt: opts.prompt,
      engine: opts.engine,
      status: "running",
      progress: 0,
      startedAt: Date.now() + i * 600, // stagger demo timings a bit
    };
    if (provider === "tripo") {
      try {
        const res = await fetch(`${TRIPO_BASE}/generation/text-to-image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tripoKey()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: conceptPrompt(opts.prompt, i, dict), model: "seedream_v4", size: "2K", output_format: "png" }),
        });
        const json = await jsonOrThrow(res, "Tripo konsep");
        c.taskId = json.data.task_id;
      } catch (e) {
        c.status = "failed";
        c.error = e instanceof Error ? e.message : String(e);
      }
    } else {
      c.taskId = `demo-${c.id}`;
    }
    return save(c);
  });
  const list = await Promise.all(jobs);
  invalidateBalance();
  return list;
}

const finishing = new Set<string>();

export async function pollConcept(c: Concept): Promise<Concept> {
  if (c.status !== "running" || finishing.has(c.id)) return c;

  if (providerOf(c.engine) === "demo") {
    const p = Math.min(100, Math.round(((Date.now() - c.startedAt) / 3500) * 100));
    if (p < 100) return { ...c, progress: Math.max(0, p) };
    await saveBuffer(conceptImageKey({ id: c.id, ext: "svg" }), demoSvg(c));
    return save({ ...c, status: "ready", progress: 100, ext: "svg" });
  }

  const res = await fetch(`${TRIPO_BASE}/tasks/${c.taskId}`, {
    headers: { Authorization: `Bearer ${tripoKey()}` },
    cache: "no-store",
  });
  const { data } = await jsonOrThrow(res, "Tripo konsep");
  const status = String(data.status || "").toLowerCase();
  if (status === "success") {
    const url = data.output?.generated_image_url || data.output?.image_url;
    if (!url) return save({ ...c, status: "failed", error: "Tripo tidak mengirim gambar konsep." });
    finishing.add(c.id);
    try {
      const ext = /\.jpe?g(\?|$)/i.test(url) ? "jpg" : "png";
      await download(url, conceptImageKey({ id: c.id, ext }));
      invalidateBalance();
      return save({ ...c, status: "ready", progress: 100, ext });
    } finally {
      finishing.delete(c.id);
    }
  }
  if (["failed", "cancelled", "banned", "expired", "unknown"].includes(status)) {
    return save({ ...c, status: "failed", error: data.error_message || `Task ${status}` });
  }
  return { ...c, progress: Number(data.progress) || 0 };
}

/** Placeholder concept art for Demo Mode (no credits). */
function demoSvg(c: Concept) {
  const hue = [...c.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 360;
  const esc = (s: string) => s.replace(/[<>&"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch]!);
  const label = esc(c.prompt.slice(0, 40));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#f4f4f2"/>
<ellipse cx="256" cy="400" rx="150" ry="22" fill="#000" opacity=".08"/>
<g transform="translate(256 250)">
<rect x="-120" y="-30" width="240" height="40" rx="8" fill="hsl(${hue} 45% 55%)"/>
<rect x="-110" y="-150" width="220" height="120" rx="10" fill="hsl(${hue} 45% 65%)"/>
<rect x="-105" y="10" width="16" height="140" rx="6" fill="hsl(${(hue + 40) % 360} 35% 45%)"/>
<rect x="89" y="10" width="16" height="140" rx="6" fill="hsl(${(hue + 40) % 360} 35% 45%)"/>
</g>
<text x="256" y="470" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#555">DEMO · ${label}</text>
</svg>`;
}
