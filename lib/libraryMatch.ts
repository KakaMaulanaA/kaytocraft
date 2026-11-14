import { matchLibrary, type LibraryEntry } from "./library";
import { smartPrompt, type UserDictionary } from "./smartPrompt";
import { detectProcedural } from "./procedural/detect";

/** Object kind a library entry stands for (from its label / keywords), when the free generator knows it. */
function entryKind(e: LibraryEntry, dict: UserDictionary) {
  for (const t of [e.label, ...e.keywords]) {
    const k = detectProcedural(smartPrompt(t, dict).core)?.kind;
    if (k) return k;
  }
  return undefined;
}

/**
 * Library entry to reuse for a prompt, or null.
 * A keyword hit is skipped when the prompt clearly names a different object than the entry:
 * "kursi kantor" (office chair) must not reuse a saved plain "kursi" (chair).
 */
export function findLibrary(entries: LibraryEntry[], prompt: string, dict: UserDictionary = {}): LibraryEntry | null {
  const core = smartPrompt(prompt, dict).core;
  const want = detectProcedural(core)?.kind;
  let pool = entries;
  for (let i = 0; i < 20; i++) {
    const hit = matchLibrary(pool, prompt, core);
    if (!hit) return null;
    const have = want ? entryKind(hit, dict) : undefined;
    if (!want || !have || have === want) return hit;
    pool = pool.filter((e) => e !== hit);
  }
  return null;
}
