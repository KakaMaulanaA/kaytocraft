// Server code only (also bundled into netlify/functions/design-background.mts, so no "server-only").
import { BUILD_MODEL_TOOL, DESIGN_SYSTEM_PROMPT, sanitizeSpec, type ModelSpec } from "../modelSpec";
import { smartPrompt } from "../smartPrompt";
import { readDictionary } from "./library";

/**
 * "Design a model" with an LLM: the model returns a parts recipe (ModelSpec).
 * Claude (paid, best) and Gemini (free tier) share the same prompt + validation.
 */

export interface DesignInput {
  prompt: string;
  image?: { mediaType: string; data: string };
  /** Online without a background function: answer within ~25 s (less "thinking", hard deadline). */
  fast?: boolean;
  /** Progress notes for long background jobs ("gemini-3.8-flash sibuk, coba lagi…"). */
  onProgress?: (note: string) => void;
}

const FAST_DEADLINE_MS = 24_000;
export interface DesignResult {
  spec: ModelSpec;
  model: string;
  usage?: { input_tokens: number; output_tokens: number } | null;
}

export class DesignError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

async function userText(input: DesignInput) {
  const hint = input.prompt ? smartPrompt(input.prompt, await readDictionary()).core : "";
  return input.image
    ? `Build a 3D base mesh of the main object in this image.${input.prompt ? ` Notes from the user: "${input.prompt}"` : ""}`
    : `Object to build: "${input.prompt}"${hint && hint.toLowerCase() !== input.prompt.toLowerCase() ? ` (English: ${hint})` : ""}`;
}

function finish(raw: unknown, model: string, usage: DesignResult["usage"]): DesignResult {
  const spec = sanitizeSpec(raw);
  if (!spec.parts.length) throw new DesignError("Resep dari AI kosong. Coba prompt yang lebih jelas.");
  return { spec, model, usage };
}

// ------------------------------------------------------------------ Claude (Anthropic API)

export async function designWithClaude(input: DesignInput): Promise<DesignResult> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new DesignError("ANTHROPIC_API_KEY belum diisi di .env.local", 400);
  const base = process.env.ANTHROPIC_BASE_URL?.replace(/\/$/, "") || "https://api.anthropic.com";
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";

  const content: unknown[] = [];
  if (input.image) content.push({ type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data } });
  content.push({ type: "text", text: await userText(input) });

  let res: Response;
  try {
    res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      signal: input.fast ? AbortSignal.timeout(FAST_DEADLINE_MS) : undefined,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: input.fast ? 8000 : 16000,
        system: DESIGN_SYSTEM_PROMPT,
        tools: [BUILD_MODEL_TOOL],
        tool_choice: { type: "tool", name: "build_model" },
        messages: [{ role: "user", content }],
      }),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))
      throw new DesignError("Claude terlalu lama menjawab (batas waktu server online). Coba lagi atau pakai Gemini.", 504);
    throw new DesignError(`Tidak bisa menghubungi Claude API: ${e instanceof Error ? e.message : e}`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    const hint =
      res.status === 401
        ? " — cek ANTHROPIC_API_KEY"
        : /credit/i.test(msg)
          ? " — saldo API Anthropic habis. Top up di console.anthropic.com, atau pakai engine Gemini (gratis)."
          : res.status === 404 && /model/i.test(msg)
            ? " — set ANTHROPIC_MODEL di .env.local ke model yang tersedia"
            : "";
    throw new DesignError(`Claude: ${msg}${hint}`, res.status);
  }
  const tool = (data?.content ?? []).find((b: { type: string }) => b.type === "tool_use");
  if (!tool) throw new DesignError("Claude tidak mengirim resep model. Coba lagi.");
  return finish(tool.input, data?.model ?? model, data?.usage ?? null);
}

// ------------------------------------------------------------------ Gemini (Google AI Studio, free tier)

/** Tried in order; the first that exists and still has quota wins. */
const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-flash-latest", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"];
let modelCache: { at: number; list: string[] } | null = null;

/**
 * Pick text "flash" models: the 4 newest full ones, then gemini-flash-latest, then 2 lite ones.
 * Gemini 2.x is skipped (retired for new API keys even though it is still listed).
 */
export function rankGeminiModels(names: string[]) {
  const ver = (n: string) => Number(n.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const byNew = (a: string, b: string) => ver(b) - ver(a) || Number(a.includes("preview")) - Number(b.includes("preview"));
  const full = names.filter((n) => /^gemini-\d+(\.\d+)?-flash(-preview)?$/.test(n) && ver(n) >= 3).sort(byNew);
  const lite = names.filter((n) => /^gemini-\d+(\.\d+)?-flash-lite(-preview)?$/.test(n) && ver(n) >= 3).sort(byNew);
  return [
    ...full.slice(0, 4),
    ...(names.includes("gemini-flash-latest") ? ["gemini-flash-latest"] : []),
    ...lite.slice(0, 1),
    ...(names.includes("gemini-flash-lite-latest") ? ["gemini-flash-lite-latest"] : []),
  ];
}

/**
 * Models to try, in order. Read from the API (cached 1 h) so retired models like
 * gemini-2.5-flash drop out and new ones are picked up without a code change.
 */
async function geminiModels(base: string, key: string) {
  const preferred = process.env.GEMINI_MODEL?.trim();
  if (!modelCache || Date.now() - modelCache.at > 60 * 60_000) {
    try {
      const res = await fetch(`${base}/v1beta/models?pageSize=200`, {
        headers: { "x-goog-api-key": key },
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      const names: string[] = (data?.models ?? [])
        .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m: { name: string }) => m.name.replace(/^models\//, ""));
      const ranked = rankGeminiModels(names);
      if (ranked.length) modelCache = { at: Date.now(), list: ranked };
    } catch {}
  }
  const list = modelCache?.list ?? FALLBACK_MODELS;
  return preferred ? [preferred, ...list.filter((m) => m !== preferred)] : list;
}

const GEMINI_FORMAT = `
Reply with ONLY one JSON object (no markdown, no comments) that matches this JSON Schema:
${JSON.stringify(BUILD_MODEL_TOOL.input_schema)}`;

function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("bukan JSON");
  }
}

/** Readable reason for a network error (undici hides it in `cause`). */
function netReason(e: unknown) {
  const c = (e as { cause?: { code?: string; message?: string } })?.cause;
  return [c?.code, c?.message, e instanceof Error ? e.message : String(e)].filter(Boolean).join(" · ").slice(0, 160);
}

/**
 * One Gemini call, streamed (SSE). Streaming keeps the connection busy while the model
 * thinks; a silent long request can be cut by the network ("fetch failed").
 */
async function geminiStream(url: string, key: string, body: unknown, signal: AbortSignal, maxMs: number) {
  // Own timer on top of the overall deadline: a call that stalls (no data for 60 s) or runs
  // past maxMs is cut, so the next attempt / model gets its turn instead of waiting forever.
  const ctl = new AbortController();
  let last = Date.now();
  const started = Date.now();
  const watch = setInterval(() => {
    if (Date.now() - last > 60_000 || Date.now() - started > maxMs) ctl.abort(new DOMException("stalled", "TimeoutError"));
  }, 2000);
  signal.addEventListener("abort", () => ctl.abort(signal.reason), { once: true });
  try {
    return await geminiStreamInner(url, key, body, ctl.signal, () => (last = Date.now()));
  } finally {
    clearInterval(watch);
  }
}

async function geminiStreamInner(url: string, key: string, body: unknown, signal: AbortSignal, tick: () => void) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  tick();
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    return { ok: false as const, status: res.status, msg: String(data?.error?.message || res.statusText) };
  }
  let text = "";
  let finish = "";
  let usage: DesignResult["usage"] = null;
  let buf = "";
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    tick();
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      let chunk: {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        error?: { message?: string };
      };
      try {
        chunk = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      if (chunk.error) return { ok: false as const, status: 500, msg: String(chunk.error.message ?? "stream error") };
      const cand = chunk.candidates?.[0];
      for (const part of cand?.content?.parts ?? []) if (!part.thought && part.text) text += part.text;
      if (cand?.finishReason) finish = cand.finishReason;
      if (chunk.usageMetadata)
        usage = { input_tokens: chunk.usageMetadata.promptTokenCount ?? 0, output_tokens: chunk.usageMetadata.candidatesTokenCount ?? 0 };
    }
  }
  return { ok: true as const, text, finish, usage };
}

export async function designWithGemini(input: DesignInput): Promise<DesignResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new DesignError("GEMINI_API_KEY belum diisi di .env.local", 400);
  const base = process.env.GEMINI_BASE_URL?.replace(/\/$/, "") || "https://generativelanguage.googleapis.com";

  const parts: unknown[] = [];
  if (input.image) parts.push({ inlineData: { mimeType: input.image.mediaType, data: input.image.data } });
  parts.push({ text: await userText(input) });

  const errors: string[] = [];
  const deadline = input.fast ? Date.now() + FAST_DEADLINE_MS : Date.now() + 12 * 60_000;
  for (const model of await geminiModels(base, key)) {
    // Keep thinking short: a parts recipe doesn't need long reasoning, and it keeps answers fast.
    let thinking: Record<string, unknown> | null = /^gemini-2\.5/.test(model)
      ? { thinkingBudget: input.fast ? 0 : 2048, includeThoughts: !input.fast }
      : { thinkingLevel: "low", includeThoughts: !input.fast };
    let jsonMode = true;
    let networkRetry = true;
    let busyRetries = input.fast ? 1 : 2; // 503 "high demand" is usually over in seconds
    for (let attempt = 0; attempt < 7; attempt++) {
      const left = deadline - Date.now();
      if (left < 3000) break;
      let r: Awaited<ReturnType<typeof geminiStream>>;
      const t0 = Date.now();
      console.log(`[gemini] ${model} attempt ${attempt + 1}${thinking ? "" : " (no thinking cfg)"}`);
      input.onProgress?.(`Gemini (${model}) sedang merancang…`);
      try {
        r = await geminiStream(
          `${base}/v1beta/models/${model}:streamGenerateContent?alt=sse`,
          key,
          {
            systemInstruction: { parts: [{ text: DESIGN_SYSTEM_PROMPT + GEMINI_FORMAT }] },
            contents: [{ role: "user", parts }],
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: input.fast ? 8000 : 16000,
              ...(jsonMode ? { responseMimeType: "application/json" } : {}),
              ...(thinking ? { thinkingConfig: thinking } : {}),
            },
          },
          AbortSignal.timeout(left),
          input.fast ? left : 150_000,
        );
        console.log(`[gemini] ${model} -> ${r.ok ? "ok" : r.status} in ${Math.round((Date.now() - t0) / 1000)}s`);
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        console.error(`[gemini] ${model} ${timedOut ? "stalled/timeout" : "network error"} after ${Math.round((Date.now() - t0) / 1000)}s`, timedOut ? "" : e);
        if (timedOut && deadline - Date.now() < 5000)
          throw new DesignError("Gemini terlalu lama menjawab. Coba lagi atau pakai prompt yang lebih singkat.", 504);
        if (timedOut) {
          // this model hangs: move on to the next one
          errors.push(`${model}: tidak menjawab (macet ${Math.round((Date.now() - t0) / 1000)} detik)`);
          input.onProgress?.(`${model} tidak menjawab, mencoba model lain…`);
          break;
        }
        console.error("[gemini] network", model, e);
        if (networkRetry) {
          networkRetry = false; // one retry for a dropped connection
          continue;
        }
        errors.push(`${model}: koneksi gagal (${netReason(e)})`);
        break;
      }
      if (!r.ok) {
        if (r.status === 400 && thinking && /thinking|include_thoughts|includeThoughts/i.test(r.msg)) {
          thinking = null; // this model doesn't take that thinking setting
          continue;
        }
        if (r.status === 400 && jsonMode && /responseMimeType|response_mime_type|Unknown name/i.test(r.msg)) {
          jsonMode = false;
          continue;
        }
        if (r.status === 400 && /API key not valid|API_KEY_INVALID/i.test(r.msg))
          throw new DesignError("Gemini: API key tidak valid — cek GEMINI_API_KEY (buat di aistudio.google.com).", 401);
        if (r.status === 403) throw new DesignError(`Gemini: akses ditolak (${r.msg}).`, 403);
        if ((r.status === 503 || r.status === 500) && busyRetries > 0 && deadline - Date.now() > 8000) {
          busyRetries--;
          input.onProgress?.(`Server Gemini (${model}) sedang sibuk, mencoba lagi…`);
          await new Promise((res) => setTimeout(res, input.fast ? 1500 : 4000));
          continue;
        }
        // 404 = model not available, 429 = quota used up, 503 = still busy -> try the next model
        errors.push(`${model}: ${r.status} ${r.msg.slice(0, 120)}`);
        break;
      }
      if (!r.text) {
        errors.push(`${model}: jawaban kosong (${r.finish || "?"})`);
        break;
      }
      try {
        return finish(parseJsonLoose(r.text), model, r.usage);
      } catch (e) {
        errors.push(`${model}: ${e instanceof Error ? e.message : e}${r.finish && r.finish !== "STOP" ? ` (${r.finish})` : ""}`);
        break;
      }
    }
  }
  if (Date.now() > deadline - 3000)
    throw new DesignError("Gemini terlalu lama menjawab. Coba lagi atau pakai prompt yang lebih singkat.", 504);
  if (errors.length && errors.every((e) => /: 50[03] /.test(e) || /: 404 /.test(e)) && errors.some((e) => /: 503 /.test(e)))
    throw new DesignError(
      "Server Gemini (Google) sedang sangat sibuk untuk semua model. Ini dari pihak Google dan biasanya pulih dalam beberapa menit — coba lagi sebentar lagi, atau pakai Mode Gratis / Library.",
      503,
    );
  const quota = errors.length > 0 && errors.every((e) => /: 429 /.test(e) || /: 404 /.test(e)) && errors.some((e) => /: 429 /.test(e));
  throw new DesignError(
    quota
      ? "Gemini: kuota gratis habis untuk semua model (coba lagi nanti / besok)."
      : `Gemini gagal di semua model. ${errors.join(" | ").slice(0, 500)}`,
    quota ? 429 : 502,
  );
}

export function designWith(engine: string, input: DesignInput) {
  if (engine === "gemini") return designWithGemini(input);
  if (engine === "claude") return designWithClaude(input);
  throw new DesignError(`Engine ${engine} tidak bisa merancang resep.`, 400);
}
