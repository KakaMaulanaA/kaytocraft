import "server-only";
import type { Asset, EngineId, EngineInfo } from "@/lib/types";
import { DENSITY, ENGINE_LABELS, composePrompt } from "@/lib/presets";
import { readDictionary } from "./library";

export interface UploadedImage {
  buf: Buffer;
  mime: string;
  name: string;
}

export interface CreateResult {
  taskId: string;
  stage?: "preview" | "refine";
  demoModel?: string;
}

export type PollResult =
  | { state: "running"; progress: number; stageLabel?: string }
  | { state: "next-stage"; taskId: string; stage: "refine" }
  | { state: "failed"; error: string }
  | { state: "done"; modelUrl: string; format: "glb" | "fbx"; thumbUrl?: string; localModel?: string };

// tripo3d.ai accounts use openapi.tripo3d.ai; tripo3d.com accounts can set TRIPO_API_BASE.
export const TRIPO_BASE = (process.env.TRIPO_API_BASE?.trim() || "https://openapi.tripo3d.ai/v3").replace(/\/$/, "");
const MESHY_BASE = "https://api.meshy.ai/openapi";

export const tripoKey = () => process.env.TRIPO_API_KEY?.trim();
const meshyKey = () => process.env.MESHY_API_KEY?.trim();

export function engineList(): EngineInfo[] {
  const t = !!tripoKey();
  const m = !!meshyKey();
  const c = !!process.env.ANTHROPIC_API_KEY?.trim();
  const g = !!process.env.GEMINI_API_KEY?.trim();
  return [
    { id: "tripo-v3.1", label: ENGINE_LABELS["tripo-v3.1"], provider: "tripo", available: t, supportsImage: true, supportsConcept: true },
    { id: "tripo-v3.0", label: ENGINE_LABELS["tripo-v3.0"], provider: "tripo", available: t, supportsImage: true, supportsConcept: true },
    { id: "tripo-p2", label: ENGINE_LABELS["tripo-p2"], provider: "tripo", available: t, supportsImage: true, supportsConcept: true },
    { id: "gemini", label: ENGINE_LABELS.gemini, provider: "gemini", available: g, supportsImage: true, supportsConcept: false },
    { id: "claude", label: ENGINE_LABELS.claude, provider: "claude", available: c, supportsImage: true, supportsConcept: false },
    { id: "meshy", label: ENGINE_LABELS.meshy, provider: "meshy", available: m, supportsImage: true, supportsConcept: false },
    {
      id: "demo",
      label: ENGINE_LABELS.demo,
      provider: "demo",
      available: true,
      supportsImage: true,
      supportsConcept: false,
      note: "Gratis: pakai Library, lalu Mode Gratis procedural, lalu Gemini (kalau key diisi). Tidak memakai kredit berbayar.",
    },
  ];
}

export function defaultEngine(): EngineId {
  if (tripoKey()) return "tripo-v3.1";
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "claude";
  if (meshyKey()) return "meshy";
  return "demo";
}

export const providerOf = (e: EngineId) =>
  e.startsWith("tripo") ? "tripo" : e === "meshy" ? "meshy" : e === "claude" ? "claude" : e === "gemini" ? "gemini" : "demo";

// ---------------------------------------------------------------- helpers

export async function jsonOrThrow(res: Response, who: string) {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok || (body && typeof body.code === "number" && body.code !== 0)) {
    const msg = body?.message || body?.error || body?.detail || text.slice(0, 200) || res.statusText;
    const hint = body?.suggestion ? ` (${body.suggestion})` : "";
    throw new Error(`${who}: ${msg}${hint}`);
  }
  return body;
}

function formatFromUrl(url: string): "glb" | "fbx" {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".fbx") ? "fbx" : "glb";
  } catch {
    return "glb";
  }
}

// ---------------------------------------------------------------- Tripo3D

const TRIPO_MODEL: Record<string, string> = {
  "tripo-v3.1": "v3.1-20260211",
  "tripo-v3.0": "v3.0-20250812",
  "tripo-p2": "P2-20260801",
};

async function tripoUpload(img: UploadedImage): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(img.buf)], { type: img.mime }), img.name);
  const res = await fetch(`${TRIPO_BASE}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tripoKey()}` },
    body: form,
  });
  const body = await jsonOrThrow(res, "Tripo upload");
  return body.data.file_token;
}

async function tripoCreate(asset: Asset, image?: UploadedImage): Promise<CreateResult> {
  const s = asset.settings;
  const model = TRIPO_MODEL[s.engine];
  const isP = s.engine === "tripo-p2";

  let faces = DENSITY[s.density].faces;
  if (s.smartLowPoly) faces = Math.min(faces, s.quad ? 10_000 : 20_000);

  const common: Record<string, unknown> = {
    model,
    face_limit: faces,
    texture: true,
    pbr: s.pbr,
  };
  if (!isP) {
    Object.assign(common, {
      texture_quality: s.textureQuality,
      quad: s.quad,
      smart_low_poly: s.smartLowPoly,
    });
  }

  let path: string;
  let body: Record<string, unknown>;
  if (s.mode === "image") {
    if (!image) throw new Error("Gambar referensi belum diunggah.");
    const token = await tripoUpload(image);
    path = "/generation/image-to-model";
    body = { ...common, input: token };
  } else {
    path = "/generation/text-to-model";
    body = { ...common, prompt: composePrompt(s.prompt, s.presets, await readDictionary()).slice(0, 1024) };
    if (s.negativePrompt?.trim()) body.negative_prompt = s.negativePrompt.trim().slice(0, 255);
  }

  const res = await fetch(TRIPO_BASE + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${tripoKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await jsonOrThrow(res, "Tripo");
  return { taskId: json.data.task_id };
}

async function tripoPoll(asset: Asset): Promise<PollResult> {
  const res = await fetch(`${TRIPO_BASE}/tasks/${asset.provider.taskId}`, {
    headers: { Authorization: `Bearer ${tripoKey()}` },
    cache: "no-store",
  });
  const { data } = await jsonOrThrow(res, "Tripo");
  const status = String(data.status || "").toLowerCase();
  if (status === "success") {
    const out = data.output || {};
    const modelUrl = out.model_url || out.pbr_model || out.model || out.base_model;
    if (!modelUrl) return { state: "failed", error: "Tripo selesai tapi tidak mengirim file model." };
    return {
      state: "done",
      modelUrl,
      format: formatFromUrl(modelUrl),
      thumbUrl: out.rendered_image_url || out.rendered_image,
    };
  }
  if (["failed", "cancelled", "banned", "expired", "unknown"].includes(status)) {
    const detail = data.error_message || data.error_msg;
    return { state: "failed", error: `Tripo task ${status}${detail ? `: ${detail}` : ""}${data.error_code ? ` (code ${data.error_code})` : ""}` };
  }
  return {
    state: "running",
    progress: Number(data.progress) || 0,
    stageLabel: status === "queued" ? "Antre di server Tripo" : "Membangun mesh & tekstur",
  };
}

/** Available Tripo credits, or null when unknown. Cached briefly. */
let balanceCache: { at: number; value: number | null } | null = null;
export async function tripoBalance(): Promise<number | null> {
  if (!tripoKey()) return null;
  if (balanceCache && Date.now() - balanceCache.at < 15_000) return balanceCache.value;
  let value: number | null = null;
  try {
    const res = await fetch(`${TRIPO_BASE}/account/balance`, {
      headers: { Authorization: `Bearer ${tripoKey()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json();
    const b = body?.data?.balance;
    value = typeof b === "number" ? b : null;
  } catch {}
  balanceCache = { at: Date.now(), value };
  return value;
}
export function invalidateBalance() {
  balanceCache = null;
}

// ---------------------------------------------------------------- Meshy

const meshyHeaders = () => ({ Authorization: `Bearer ${meshyKey()}`, "Content-Type": "application/json" });
const meshyPath = (a: Asset) => (a.settings.mode === "image" ? "/v1/image-to-3d" : "/v2/text-to-3d");

async function meshyCreate(asset: Asset, image?: UploadedImage): Promise<CreateResult> {
  const s = asset.settings;
  const geo = {
    should_remesh: true,
    target_polycount: DENSITY[s.density].faces,
    topology: s.quad ? "quad" : "triangle",
  };
  let body: Record<string, unknown>;
  if (s.mode === "image") {
    if (!image) throw new Error("Gambar referensi belum diunggah.");
    body = {
      ...geo,
      image_url: `data:${image.mime};base64,${image.buf.toString("base64")}`,
      should_texture: true,
      enable_pbr: s.pbr,
    };
  } else {
    body = { ...geo, mode: "preview", prompt: composePrompt(s.prompt, s.presets, await readDictionary()).slice(0, 800) };
  }
  const res = await fetch(MESHY_BASE + meshyPath(asset), {
    method: "POST",
    headers: meshyHeaders(),
    body: JSON.stringify(body),
  });
  const json = await jsonOrThrow(res, "Meshy");
  return { taskId: json.result, stage: s.mode === "text" ? "preview" : undefined };
}

async function meshyPoll(asset: Asset): Promise<PollResult> {
  const res = await fetch(`${MESHY_BASE}${meshyPath(asset)}/${asset.provider.taskId}`, {
    headers: meshyHeaders(),
    cache: "no-store",
  });
  const data = await jsonOrThrow(res, "Meshy");
  const twoStage = asset.settings.mode === "text";
  const stage = asset.provider.stage;
  const raw = Number(data.progress) || 0;
  const progress = twoStage ? (stage === "refine" ? 50 + raw / 2 : raw / 2) : raw;

  if (data.status === "SUCCEEDED") {
    if (twoStage && stage === "preview") {
      // Geometry done -> start texturing (refine) stage.
      const r = await fetch(MESHY_BASE + "/v2/text-to-3d", {
        method: "POST",
        headers: meshyHeaders(),
        body: JSON.stringify({ mode: "refine", preview_task_id: asset.provider.taskId, enable_pbr: asset.settings.pbr }),
      });
      const j = await jsonOrThrow(r, "Meshy refine");
      return { state: "next-stage", taskId: j.result, stage: "refine" };
    }
    const modelUrl = data.model_urls?.glb || data.model_urls?.fbx;
    if (!modelUrl) return { state: "failed", error: "Meshy selesai tapi tidak ada file GLB." };
    return { state: "done", modelUrl, format: data.model_urls?.glb ? "glb" : "fbx", thumbUrl: data.thumbnail_url };
  }
  if (data.status === "FAILED" || data.status === "CANCELED") {
    return { state: "failed", error: `Meshy ${data.status.toLowerCase()}: ${data.task_error?.message || "tanpa detail"}` };
  }
  return {
    state: "running",
    progress,
    stageLabel:
      data.status === "PENDING" ? "Antre di server Meshy" : stage === "refine" ? "Texturing PBR" : "Membangun geometri",
  };
}

// ---------------------------------------------------------------- Demo (offline)

const DEMO_MS = 7000;
const DEMO_MODELS: [RegExp, string][] = [
  [/table|desk|meja/i, "table"],
  [/chair|kursi|seat|stool|sofa|bench|bangku/i, "chair"],
  [/crate|box|peti|kotak|cargo|container|chest/i, "crate"],
  [/vase|vas|pot|jar|bottle|botol|guci|cup|gelas/i, "vase"],
];

function demoCreate(asset: Asset): CreateResult {
  const text = asset.settings.prompt;
  const hit = DEMO_MODELS.find(([re]) => re.test(text))?.[1];
  const pool = ["chair", "crate", "vase", "table"];
  const pick = hit ?? pool[[...asset.id].reduce((n, c) => n + c.charCodeAt(0), 0) % pool.length];
  return { taskId: `demo-${asset.id}`, demoModel: pick };
}

function demoPoll(asset: Asset): PollResult {
  const elapsed = Date.now() - (asset.provider.startedAt ?? Date.now());
  if (elapsed < DEMO_MS) {
    const p = Math.min(99, Math.round((elapsed / DEMO_MS) * 100));
    return { state: "running", progress: p, stageLabel: p < 55 ? "Membangun geometri (demo)" : "Texturing (demo)" };
  }
  return { state: "done", modelUrl: "", format: "glb", localModel: `${asset.provider.demoModel}.glb` };
}

// ---------------------------------------------------------------- dispatch

export async function createTask(asset: Asset, image?: UploadedImage): Promise<CreateResult> {
  const p = providerOf(asset.settings.engine);
  if (p === "tripo") {
    if (!tripoKey()) throw new Error("TRIPO_API_KEY belum diisi di .env.local");
    return tripoCreate(asset, image);
  }
  if (p === "meshy") {
    if (!meshyKey()) throw new Error("MESHY_API_KEY belum diisi di .env.local");
    return meshyCreate(asset, image);
  }
  if (p === "claude" || p === "gemini") throw new Error("Engine ini dijalankan lewat /api/design, bukan /api/generate.");
  return demoCreate(asset);
}

export async function pollTask(asset: Asset): Promise<PollResult> {
  const p = providerOf(asset.settings.engine);
  if (p === "tripo") return tripoPoll(asset);
  if (p === "meshy") return meshyPoll(asset);
  return demoPoll(asset);
}
