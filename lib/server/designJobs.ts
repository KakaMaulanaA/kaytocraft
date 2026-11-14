// Server code only (also bundled into netlify/functions/design-background.mts).
import crypto from "node:crypto";
import { storageStore } from "./blobstore";
import { DesignError, designWith, type DesignInput, type DesignResult } from "./design";

/**
 * Online, an AI design can take longer than Netlify's ~30 s limit for normal functions,
 * so it runs in a background function (up to 15 min) and the browser polls the job.
 *   storage: jobs/<id>.json  { status: queued|running|done|error, engine, input?, result?, error?, at }
 */
export type DesignJob =
  | { status: "queued" | "running"; engine: string; input?: DesignInput; at: number; note?: string }
  | { status: "done"; engine: string; result: DesignResult; at: number }
  | { status: "error"; engine: string; error: string; code: number; at: number };

export const validJobId = (id: string) => /^[a-f0-9]{16}$/.test(id);
const key = (id: string) => `jobs/${id}.json`;

export async function readJob(id: string): Promise<DesignJob | null> {
  if (!validJobId(id)) return null;
  const b = await storageStore().get(key(id));
  if (!b) return null;
  try {
    return JSON.parse(b.toString("utf8")) as DesignJob;
  } catch {
    return null;
  }
}
const writeJob = (id: string, job: DesignJob) => storageStore().set(key(id), JSON.stringify(job));
export const deleteJob = (id: string) => storageStore().del(key(id));

export async function createJob(engine: string, input: DesignInput) {
  const id = crypto.randomBytes(8).toString("hex");
  await writeJob(id, { status: "queued", engine, input, at: Date.now() });
  return id;
}

/** Runs inside the background function. */
export async function runJob(id: string) {
  const job = await readJob(id);
  if (!job || job.status !== "queued" || !job.input) return;
  const startedAt = Date.now();
  await writeJob(id, { status: "running", engine: job.engine, at: startedAt });
  // Progress notes for the browser (throttled; the last one wins).
  let lastNote = 0;
  const onProgress = (note: string) => {
    if (Date.now() - lastNote < 1500) return;
    lastNote = Date.now();
    void writeJob(id, { status: "running", engine: job.engine, at: startedAt, note }).catch(() => {});
  };
  try {
    const result = await designWith(job.engine, { ...job.input, onProgress });
    await writeJob(id, { status: "done", engine: job.engine, result, at: Date.now() });
  } catch (e) {
    await writeJob(id, {
      status: "error",
      engine: job.engine,
      error: e instanceof Error ? e.message : String(e),
      code: e instanceof DesignError ? e.status : 500,
      at: Date.now(),
    });
  }
}
