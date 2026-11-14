import { strFromU8, unzipSync } from "fflate";

/**
 * Read a list of item names from a file the user drops in:
 *   .docx  -> each paragraph / table cell / list item
 *   .xlsx  -> first column of the first sheet with text (header like "Nama barang" skipped)
 *   .csv / .txt -> each line (first column for CSV)
 * Numbering ("1.", "2)"), bullets and quantities in brackets are cleaned up.
 */
export async function readListFile(file: File): Promise<string[]> {
  const name = file.name.toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  // Documents often carry a title or a note line; drop sentence-like lines there (typed lists keep everything).
  if (name.endsWith(".docx")) return clean(docxLines(buf)).filter((s) => !isSentence(s));
  if (name.endsWith(".xlsx")) return clean(xlsxFirstColumn(buf));
  if (name.endsWith(".doc") || name.endsWith(".xls"))
    throw new Error("Format lama (.doc/.xls) belum didukung. Simpan ulang sebagai .docx / .xlsx (File › Save As).");
  const text = new TextDecoder().decode(buf);
  const lines = text.split(/\r?\n/);
  return clean(name.endsWith(".csv") ? bestColumn(lines.map(splitCsv)) : lines);
}

/** Split pasted text into items (one per line, commas also separate). */
export function parseListText(text: string): string[] {
  return clean(text.split(/\r?\n/).flatMap((l) => (l.includes(",") && !l.includes(":") ? l.split(",") : [l])));
}

const HEADER = /^(no\.?|nomor|nama( barang)?|barang|item|items?|objek|object|produk|daftar.*|list.*)$/i;

/** Notes / instructions in a document ("Daftar untuk ruang tamu, tolong dibuat."), not item names. */
function isSentence(s: string) {
  const words = s.split(" ").length;
  return words > 8 || (words > 4 && /[.!?:]$/.test(s)) || /[.!?]\s+\p{Lu}/u.test(s);
}

function clean(items: string[]): string[] {
  return items
    .map((s) =>
      s
        .replace(/ /g, " ")
        .replace(/^\s*(?:[-*•·◦▪●○–—]|\d+[.)]|[a-z][.)])\s+/i, "") // bullets / numbering
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((s) => s && s.length <= 200 && !HEADER.test(s) && !/^\d+$/.test(s));
}

// ------------------------------------------------------------------ docx

function unzip(buf: Uint8Array) {
  try {
    return unzipSync(buf);
  } catch {
    throw new Error("File tidak bisa dibuka (rusak atau bukan .docx/.xlsx).");
  }
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

function docxLines(buf: Uint8Array): string[] {
  const files = unzip(buf);
  const doc = files["word/document.xml"];
  if (!doc) throw new Error("Isi dokumen Word tidak ditemukan.");
  const xml = strFromU8(doc);
  // One entry per paragraph (table cells are paragraphs too).
  return xml.split(/<\/w:p>/).map((p) => decode((p.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
}

// ------------------------------------------------------------------ xlsx

function xlsxFirstColumn(buf: Uint8Array): string[] {
  const files = unzip(buf);
  const shared: string[] = [];
  const ss = files["xl/sharedStrings.xml"];
  if (ss) {
    for (const si of strFromU8(ss).split(/<\/si>/)) {
      const parts = si.match(/<t[^>]*>[^<]*<\/t>/g);
      if (parts) shared.push(decode(parts.map((t) => t.replace(/<[^>]+>/g, "")).join("")));
      else if (si.includes("<si")) shared.push("");
    }
  }
  const sheets = Object.keys(files)
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  for (const key of sheets) {
    const rows: Record<string, string>[] = [];
    for (const row of strFromU8(files[key]).split(/<\/row>/)) {
      const cells: Record<string, string> = {};
      for (const m of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = m[1];
        const col = attrs.match(/\br="([A-Z]+)\d+"/)?.[1] ?? "A";
        const type = attrs.match(/\bt="([^"]+)"/)?.[1];
        const inner = m[2] ?? "";
        let v = "";
        if (type === "s") v = shared[Number(inner.match(/<v>([^<]*)<\/v>/)?.[1])] ?? "";
        else if (type === "inlineStr") v = decode((inner.match(/<t[^>]*>[^<]*<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join(""));
        else v = decode(inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? "");
        if (v.trim()) cells[col] = v;
      }
      if (Object.keys(cells).length) rows.push(cells);
    }
    if (!rows.length) continue;
    // The column with the most text values (usually A, or B when A is "No").
    const count: Record<string, number> = {};
    for (const r of rows) for (const [c, v] of Object.entries(r)) if (/\p{L}/u.test(v)) count[c] = (count[c] ?? 0) + 1;
    const col = Object.entries(count).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    if (col) return rows.map((r) => r[col] ?? "");
  }
  return [];
}

/** From a table, keep the column that holds the most text (skips a "No" column of numbers). */
function bestColumn(rows: string[][]): string[] {
  const count: number[] = [];
  for (const r of rows) r.forEach((v, i) => /\p{L}/u.test(v) && (count[i] = (count[i] ?? 0) + 1));
  let col = 0;
  count.forEach((c, i) => c > (count[col] ?? 0) && (col = i));
  return rows.map((r) => r[col] ?? "");
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if ((ch === "," || ch === ";") && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
