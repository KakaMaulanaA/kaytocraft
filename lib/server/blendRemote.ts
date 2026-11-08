import "server-only";
import { readFile, removeFile, saveBuffer } from "./storage";

/**
 * .blend for the online version: Netlify has no Blender, so a GitHub Actions job
 * (.github/workflows/blend.yml) runs Blender, converts the model and posts the .blend back.
 *
 * Netlify env: GITHUB_TOKEN (fine-grained, Actions/Contents read-write on the repo),
 *              GITHUB_REPO ("owner/repo"), BLEND_WORKER_SECRET (random string).
 * GitHub repo secret: BLEND_WORKER_SECRET (same value).
 */
export const remoteBlendReady = () =>
  !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO && process.env.BLEND_WORKER_SECRET);

export function workerAuthorized(req: Request) {
  const secret = process.env.BLEND_WORKER_SECRET ?? "";
  const given = req.headers.get("x-worker-secret") ?? "";
  if (secret.length < 16 || given.length !== secret.length) return false;
  let d = 0;
  for (let i = 0; i < secret.length; i++) d |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  return d === 0;
}

const pendingKey = (id: string) => `blend/${id}.pending.json`;
const errorKey = (id: string) => `blend/${id}.error.txt`;

export type RemoteState = { state: "pending"; since: number } | { state: "error"; error: string } | { state: "none" };

export async function remoteState(id: string): Promise<RemoteState> {
  const err = await readFile(errorKey(id));
  if (err) return { state: "error", error: err.toString("utf8") };
  const p = await readFile(pendingKey(id));
  if (p) {
    const since = Number(JSON.parse(p.toString("utf8")).since) || 0;
    if (Date.now() - since < 12 * 60_000) return { state: "pending", since };
  }
  return { state: "none" };
}

export async function clearRemote(id: string) {
  await Promise.all([removeFile(pendingKey(id)), removeFile(errorKey(id))]);
}

export async function startRemote(asset: { id: string; name: string; format?: string }, site: string) {
  await clearRemote(asset.id);
  const res = await fetch(`${process.env.GITHUB_API_URL || "https://api.github.com"}/repos/${process.env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kaytocraft-3d",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "make-blend",
      client_payload: { id: asset.id, name: asset.name.slice(0, 80), format: asset.format ?? "glb", site },
    }),
  });
  if (res.status !== 204) {
    const text = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(
      res.status === 401 || res.status === 403 || res.status === 404
        ? `GitHub menolak (${res.status}). Cek GITHUB_TOKEN (izin Contents: Read and write) dan GITHUB_REPO.`
        : `GitHub error ${res.status}: ${text}`,
    );
  }
  await saveBuffer(pendingKey(asset.id), JSON.stringify({ since: Date.now() }));
}

export async function finishRemote(id: string, result: { buf?: Buffer; error?: string }) {
  if (result.buf) await saveBuffer(`blend/${id}.blend`, result.buf);
  else await saveBuffer(errorKey(id), (result.error || "Konversi gagal.").slice(0, 500));
  await removeFile(pendingKey(id));
}
