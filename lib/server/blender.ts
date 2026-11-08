import "server-only";
import { spawn } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { isHosted } from "./blobstore";

/** Find a Blender executable: BLENDER_PATH, then common install locations, then PATH. */
export async function findBlender(): Promise<string | null> {
  const env = process.env.BLENDER_PATH?.trim();
  if (env) return existsSync(env) ? env : null;

  const candidates: string[] = [];
  if (process.platform === "win32") {
    candidates.push("C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender\\blender.exe");
    for (const base of ["C:\\Program Files\\Blender Foundation", "C:\\Program Files (x86)\\Blender Foundation"]) {
      try {
        const dirs = (await fs.readdir(base)).filter((d) => /^blender/i.test(d)).sort().reverse();
        for (const d of dirs) candidates.push(path.join(base, d, "blender.exe"));
      } catch {}
    }
    const local = process.env.LOCALAPPDATA;
    if (local) candidates.push(path.join(local, "Programs", "Blender Foundation", "Blender", "blender.exe"));
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Blender.app/Contents/MacOS/Blender");
  } else {
    candidates.push("/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender");
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** Run a script from scripts/ in a background Blender. */
async function runBlender(scriptName: string, scriptArgs: string[]): Promise<void> {
  const exe = await findBlender();
  if (!exe) {
    throw new Error(
      "Blender tidak ditemukan. Isi BLENDER_PATH di .env.local, mis. BLENDER_PATH=C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe",
    );
  }
  const script = path.join(/* turbopackIgnore: true */ process.cwd(), "scripts", scriptName);
  const args = ["-b", "--factory-startup", "--python-exit-code", "1", "-P", script, "--", ...scriptArgs];
  const output = scriptArgs[1];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ exe, args, { windowsHide: true });
    let log = "";
    const keep = (d: Buffer) => {
      log = (log + d.toString()).slice(-4000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Blender terlalu lama (lebih dari 3 menit)."));
    }, 180_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Gagal menjalankan Blender: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && existsSync(output)) resolve();
      else reject(new Error(`Konversi Blender gagal (exit ${code}). ${log.split("\n").slice(-6).join(" ").trim()}`));
    });
  });
}

/** .glb/.fbx -> clean .blend (scripts/to_blend.py). */
export function convertToBlend(input: string, output: string, name: string) {
  return runBlender("to_blend.py", [input, output, name]);
}

/** .blend -> .glb (scripts/from_blend.py). */
export function convertFromBlend(input: string, output: string) {
  return runBlender("from_blend.py", [input, output]);
}

/** Blender works on files: run a conversion through temp files and return the bytes. */
async function viaTemp(inExt: string, outExt: string, input: Buffer, run: (i: string, o: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `kc-${crypto.randomBytes(3).toString("hex")}-`));
  const i = path.join(dir, `in.${inExt}`);
  const o = path.join(dir, `out.${outExt}`);
  try {
    await fs.writeFile(i, input);
    await run(i, o);
    return await fs.readFile(o);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export const blendFromModel = (buf: Buffer, format: "glb" | "fbx", name: string) =>
  viaTemp(format, "blend", buf, (i, o) => convertToBlend(i, o, name));

export const glbFromBlend = (buf: Buffer) => viaTemp("blend", "glb", buf, (i, o) => convertFromBlend(i, o));

/** .blend conversion needs a local Blender install; not available on Netlify. */
export const blendSupported = () => !isHosted() || !!process.env.BLENDER_PATH;
