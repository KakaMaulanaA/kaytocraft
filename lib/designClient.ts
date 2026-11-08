import type { ModelSpec } from "./modelSpec";

export interface DesignResponse {
  spec: ModelSpec;
  model: string;
  usage?: { input_tokens: number; output_tokens: number } | null;
}

/** Ask Claude/Gemini for a recipe. Online the server answers with a job id; we poll until done. */
export async function requestDesign(
  body: { engine: string; prompt: string; image?: { mediaType: string; data: string } },
  who: string,
): Promise<DesignResponse> {
  type Step = { job: string } | { pending: true } | { result: DesignResponse };
  const read = async (res: Response): Promise<Step> => {
    const text = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (res.status === 202 && data?.jobId) return { job: String(data.jobId) };
    if (res.status === 202) return { pending: true };
    if (!res.ok) {
      const raw = (data?.error ?? data?.errorMessage ?? text.replace(/<[^>]+>/g, " ").trim().slice(0, 160)) as string;
      throw new Error(`${who} gagal (HTTP ${res.status})${raw ? `: ${raw}` : ""}`);
    }
    return { result: data as unknown as DesignResponse };
  };

  const first = await read(
    await fetch("/api/design", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  );
  if ("result" in first) return first.result;
  if (!("job" in first)) throw new Error(`${who} gagal: jawaban server tidak dikenal.`);

  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 2500));
    const r = await read(await fetch(`/api/design?job=${first.job}`, { cache: "no-store" }));
    if ("result" in r) return r.result;
    if (Date.now() - started > 17 * 60_000) throw new Error(`${who} terlalu lama. Coba lagi.`);
  }
}
