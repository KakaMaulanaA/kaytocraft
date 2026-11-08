// npm run siap-netlify  ->  copies only what Netlify needs into ../WEB-netlify
// (no node_modules, .next, storage or .env files), ready to drag & drop on Netlify › Deploys.
import { cpSync, rmSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";

const src = process.cwd();
const out = path.join(path.dirname(src), `${path.basename(src)}-netlify`);
const SKIP = new Set(["node_modules", ".next", "storage", ".git", "out", "tsconfig.tsbuildinfo"]);

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
cpSync(src, out, {
  recursive: true,
  filter: (p) => {
    const rel = path.relative(src, p);
    if (!rel) return true;
    const top = rel.split(path.sep)[0];
    const name = path.basename(p);
    if (SKIP.has(top)) return false;
    if (name.startsWith(".env") && name !== ".env.example") return false;
    return true;
  },
});

let bytes = 0;
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const f = path.join(d, n);
    const s = statSync(f);
    s.isDirectory() ? walk(f) : (bytes += s.size);
  }
};
walk(out);
console.log(`Siap: ${out}  (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
console.log("Seret folder itu ke Netlify › Deploys (kotak drag & drop).");
