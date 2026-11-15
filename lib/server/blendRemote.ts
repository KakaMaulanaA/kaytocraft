import "server-only";
import { BLEND_VER, PACK_VER, blendKey, packKey, readFile, removeFile, saveBuffer, sellZipKey } from "./storage";

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

/**
 * "blend" = .blend conversion of an asset, "pack" = ready-to-sell package of an asset,
 * "sell"  = ready-to-sell package of an uploaded (fixed) .blend from the Siap Jual page.
 */
export type RemoteKind = "blend" | "pack" | "sell";
const PREFIX: Record<RemoteKind, (id: string) => string> = {
  blend: (id) => `blend/${id}.${BLEND_VER}`,
  pack: (id) => `pack/${id}.${PACK_VER}`,
  sell: (id) => `sell/${id}.${PACK_VER}`,
};
const pendingKey = (id: string, kind: RemoteKind) => `${PREFIX[kind](id)}.pending.json`;
const errorKey = (id: string, kind: RemoteKind) => `${PREFIX[kind](id)}.error.txt`;
// Rendering takes longer than converting.
const MAX_PENDING = { blend: 12 * 60_000, pack: 35 * 60_000, sell: 35 * 60_000 };

export type RemoteState = { state: "pending"; since: number } | { state: "error"; error: string } | { state: "none" };

export async function remoteState(id: string, kind: RemoteKind = "blend"): Promise<RemoteState> {
  const err = await readFile(errorKey(id, kind));
  if (err) return { state: "error", error: err.toString("utf8") };
  const p = await readFile(pendingKey(id, kind));
  if (p) {
    const since = Number(JSON.parse(p.toString("utf8")).since) || 0;
    if (Date.now() - since < MAX_PENDING[kind]) return { state: "pending", since };
  }
  return { state: "none" };
}

export async function clearRemote(id: string, kind: RemoteKind = "blend") {
  await Promise.all([removeFile(pendingKey(id, kind)), removeFile(errorKey(id, kind))]);
}

export async function startRemote(asset: { id: string; name: string; format?: string }, site: string, kind: RemoteKind = "blend") {
  await clearRemote(asset.id, kind);
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
      event_type: kind === "blend" ? "make-blend" : "make-pack",
      client_payload: { id: asset.id, name: asset.name.slice(0, 80), format: asset.format ?? "glb", site, scope: kind === "sell" ? "sell" : "assets" },
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
  await saveBuffer(pendingKey(asset.id, kind), JSON.stringify({ since: Date.now() }));
}

export async function finishRemote(id: string, result: { buf?: Buffer; error?: string }, kind: RemoteKind = "blend") {
  if (result.buf) await saveBuffer(kind === "blend" ? blendKey(id) : kind === "pack" ? packKey(id) : sellZipKey(id), result.buf);
  else await saveBuffer(errorKey(id, kind), (result.error || "Proses gagal.").slice(0, 500));
  await removeFile(pendingKey(id, kind));
}
