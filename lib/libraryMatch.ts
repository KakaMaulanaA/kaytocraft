import { COLORS, MATERIALS, matchLibrary, type LibraryEntry } from "./library";
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

/** Words that only describe a saved object (colour, material, size, style) — not a different object. */
const MODIFIER_WORDS = new Set([
  ...Object.keys(COLORS),
  ...MATERIALS.flatMap(([re]) => re.source.replace(/\\b|[()]/g, "").split("|")),
  ...`besar kecil mini mungil tinggi pendek panjang lebar sedang jumbo raksasa tipis tebal
   big small large tiny tall short long wide medium huge thin thick
   modern klasik minimalis minimalist vintage antik retro sederhana simple mewah elegan lucu cute rustic industrial scandinavian classic luxury
   bulat bundar persegi oval round square rounded
   muda tua gelap terang light dark pastel polos glossy doff matte mengkilap
   yang dengan warna model gaya style bahan motif dan with in of a the`.split(/\s+/),
]);

function words(t: string) {
  return t.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean);
}

/** True when every word of `text` outside the matched keyword is just a modifier ("kursi merah" for "kursi"). */
function onlyModifiers(text: string, keyword: string) {
  const w = words(text);
  const k = words(keyword);
  for (let i = 0; i + k.length <= w.length; i++) {
    if (k.every((x, j) => w[i + j] === x)) {
      const rest = [...w.slice(0, i), ...w.slice(i + k.length)];
      return rest.every((x) => MODIFIER_WORDS.has(x) || /^\d+$/.test(x));
    }
  }
  return false;
}

/** The entry fits when one of its keywords appears with nothing but modifiers around it. */
function fits(e: LibraryEntry, texts: string[]) {
  return e.keywords.some((k) => texts.some((t) => onlyModifiers(t, k)));
}

/**
 * Library entry to reuse for a prompt, or null.
 * A keyword hit is skipped when the prompt clearly names a different object than the entry:
 * "kursi kantor" (office chair) must not reuse a saved plain "kursi" (chair), and "lemari arsip"
 * not "lemari": besides the keyword the prompt may only hold modifiers (colour, material, size, style).
 */
export function findLibrary(entries: LibraryEntry[], prompt: string, dict: UserDictionary = {}): LibraryEntry | null {
  const core = smartPrompt(prompt, dict).core;
  const want = detectProcedural(core)?.kind;
  let pool = entries;
  for (let i = 0; i < 20; i++) {
    const hit = matchLibrary(pool, prompt, core);
    if (!hit) return null;
    // "lemari arsip" must not reuse "lemari", "meja rias" not "meja": extra words may only describe it.
    if (fits(hit, [prompt, core])) {
      const have = want ? entryKind(hit, dict) : undefined;
      if (!want || !have || have === want) return hit;
    }
    pool = pool.filter((e) => e !== hit);
  }
  return null;
}
