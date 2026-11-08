/**
 * Turns a short, casual prompt ("meja kayu bulat") into what 3D engines read best
 * ("round wooden table, single object, ..."). Pure functions, shared by client
 * (preview line) and server (what is actually sent).
 */

type Kind = "noun" | "size" | "shape" | "style" | "color" | "material" | "num" | "word";

// Multi-word phrases first (matched before single words).
const PHRASES: Record<string, [string, Kind]> = {
  "meja makan": ["dining table", "noun"],
  "meja belajar": ["study desk", "noun"],
  "meja kerja": ["office desk", "noun"],
  "meja kopi": ["coffee table", "noun"],
  "meja rias": ["vanity dressing table", "noun"],
  "kursi kantor": ["office chair", "noun"],
  "sandaran tangan": ["armrests", "noun"],
  "cerobong asap": ["chimney", "noun"],
  "kotak surat": ["mailbox", "noun"],
  "pohon natal": ["christmas tree", "noun"],
  "lampu meja": ["desk lamp", "noun"],
  "lampu tidur": ["bedside lamp", "noun"],
  "lampu gantung": ["pendant lamp", "noun"],
  "lampu jalan": ["street lamp", "noun"],
  "mobil sport": ["sports car", "noun"],
  "kayu jati": ["teak wood", "material"],
  "kayu pinus": ["pine wood", "material"],
  "kayu oak": ["oak wood", "material"],
  "kursi goyang": ["rocking chair", "noun"],
  "kursi roda": ["wheelchair", "noun"],
  "kursi malas": ["lounge chair", "noun"],
  "tempat tidur": ["bed", "noun"],
  "lemari pakaian": ["wardrobe", "noun"],
  "lemari es": ["refrigerator", "noun"],
  "rak buku": ["bookshelf", "noun"],
  "jam tangan": ["wristwatch", "noun"],
  "jam dinding": ["wall clock", "noun"],
  "peti harta karun": ["treasure chest", "noun"],
  "peti harta": ["treasure chest", "noun"],
  "kunci inggris": ["wrench", "noun"],
  "tanah liat": ["clay", "material"],
  "abu abu": ["grey", "color"],
  "abu-abu": ["grey", "color"],
  "merah muda": ["pink", "color"],
  "persegi panjang": ["rectangular", "shape"],
  "abad pertengahan": ["medieval", "style"],
  "luar angkasa": ["space", "style"],
  "fiksi ilmiah": ["sci-fi", "style"],
  "low poly": ["low poly", "style"],
};

const WORDS: Record<string, [string, Kind]> = {
  // furniture & home
  meja: ["table", "noun"], kursi: ["chair", "noun"], sofa: ["sofa", "noun"], bangku: ["bench", "noun"],
  lemari: ["cabinet", "noun"], rak: ["shelf", "noun"], kasur: ["mattress", "noun"], ranjang: ["bed", "noun"],
  lampu: ["lamp", "noun"], jam: ["clock", "noun"], pintu: ["door", "noun"], jendela: ["window", "noun"],
  vas: ["vase", "noun"], pot: ["flower pot", "noun"], guci: ["jar", "noun"], botol: ["bottle", "noun"],
  gelas: ["drinking glass", "noun"], cangkir: ["cup", "noun"], mug: ["mug", "noun"], piring: ["plate", "noun"],
  mangkuk: ["bowl", "noun"], sendok: ["spoon", "noun"], garpu: ["fork", "noun"], pisau: ["knife", "noun"],
  panci: ["cooking pot", "noun"], wajan: ["frying pan", "noun"], kulkas: ["refrigerator", "noun"],
  televisi: ["television", "noun"], tv: ["television", "noun"], komputer: ["computer", "noun"],
  laptop: ["laptop", "noun"], monitor: ["monitor", "noun"], ponsel: ["smartphone", "noun"], hp: ["smartphone", "noun"],
  kamera: ["camera", "noun"], speaker: ["speaker", "noun"], gitar: ["guitar", "noun"], piano: ["piano", "noun"],
  buku: ["book", "noun"], tas: ["bag", "noun"], ransel: ["backpack", "noun"], sepatu: ["shoe", "noun"],
  topi: ["hat", "noun"], helm: ["helmet", "noun"], kacamata: ["glasses", "noun"], cincin: ["ring", "noun"],
  kalung: ["necklace", "noun"], bantal: ["pillow", "noun"], karpet: ["rug", "noun"], cermin: ["mirror", "noun"],
  lukisan: ["painting", "noun"], patung: ["statue", "noun"], mahkota: ["crown", "noun"], tengkorak: ["skull", "noun"],
  lentera: ["lantern", "noun"], obor: ["torch", "noun"], lilin: ["candle", "noun"], bola: ["ball", "noun"],
  boneka: ["doll", "noun"], mainan: ["toy", "noun"], piala: ["trophy", "noun"], trofi: ["trophy", "noun"],
  peti: ["chest", "noun"], kotak: ["box", "noun"], kardus: ["cardboard box", "noun"], tong: ["barrel", "noun"],
  karung: ["sack", "noun"], koper: ["suitcase", "noun"], payung: ["umbrella", "noun"], kipas: ["fan", "noun"],
  tangga: ["ladder", "noun"], pagar: ["fence", "noun"], keranjang: ["basket", "noun"], ember: ["bucket", "noun"],
  // tools & weapons
  pedang: ["sword", "noun"], tombak: ["spear", "noun"], panah: ["arrow", "noun"], busur: ["bow", "noun"],
  perisai: ["shield", "noun"], tameng: ["shield", "noun"], pistol: ["pistol", "noun"], senapan: ["rifle", "noun"],
  kapak: ["axe", "noun"], palu: ["hammer", "noun"], obeng: ["screwdriver", "noun"], gergaji: ["saw", "noun"],
  cangkul: ["hoe", "noun"], keris: ["kris dagger", "noun"], golok: ["machete", "noun"],
  // vehicles & structures
  mobil: ["car", "noun"], motor: ["motorcycle", "noun"], sepeda: ["bicycle", "noun"], truk: ["truck", "noun"],
  bus: ["bus", "noun"], kapal: ["ship", "noun"], perahu: ["boat", "noun"], pesawat: ["airplane", "noun"],
  helikopter: ["helicopter", "noun"], roket: ["rocket", "noun"], robot: ["robot", "noun"], tank: ["tank", "noun"],
  rumah: ["house", "noun"], gedung: ["building", "noun"], menara: ["tower", "noun"], jembatan: ["bridge", "noun"],
  kastil: ["castle", "noun"], istana: ["palace", "noun"], gubuk: ["hut", "noun"], tenda: ["tent", "noun"],
  // nature, animals, food
  pohon: ["tree", "noun"], bunga: ["flower", "noun"], tanaman: ["plant", "noun"], kaktus: ["cactus", "noun"],
  jamur: ["mushroom", "noun"], batu: ["rock", "noun"], kucing: ["cat", "noun"], anjing: ["dog", "noun"],
  burung: ["bird", "noun"], ikan: ["fish", "noun"], kuda: ["horse", "noun"], sapi: ["cow", "noun"],
  ayam: ["chicken", "noun"], gajah: ["elephant", "noun"], harimau: ["tiger", "noun"], singa: ["lion", "noun"],
  naga: ["dragon", "noun"], dinosaurus: ["dinosaur", "noun"], kelinci: ["rabbit", "noun"], beruang: ["bear", "noun"],
  monyet: ["monkey", "noun"], ular: ["snake", "noun"], penyu: ["turtle", "noun"], buah: ["fruit", "noun"],
  apel: ["apple", "noun"], pisang: ["banana", "noun"], jeruk: ["orange fruit", "noun"], semangka: ["watermelon", "noun"],
  roti: ["bread", "noun"], kue: ["cake", "noun"], burger: ["burger", "noun"], pizza: ["pizza", "noun"],
  // parts
  kaki: ["legs", "noun"], sandaran: ["backrest", "noun"], roda: ["wheels", "noun"], laci: ["drawers", "noun"],
  atap: ["roof", "noun"], teras: ["porch", "noun"], cerobong: ["chimney", "noun"], balkon: ["balcony", "noun"], gagang: ["handle", "noun"], tutup: ["lid", "noun"], sayap: ["wings", "noun"],
  ekor: ["tail", "noun"], tanduk: ["horns", "noun"], lengan: ["armrests", "noun"],
  // materials
  kayu: ["wooden", "material"], besi: ["iron", "material"], baja: ["steel", "material"], logam: ["metal", "material"],
  emas: ["golden", "material"], perak: ["silver", "material"], kaca: ["glass", "material"], plastik: ["plastic", "material"],
  keramik: ["ceramic", "material"], marmer: ["marble", "material"], kulit: ["leather", "material"],
  kain: ["fabric", "material"], rotan: ["rattan", "material"], bambu: ["bamboo", "material"], beton: ["concrete", "material"],
  karet: ["rubber", "material"], kertas: ["paper", "material"], kuningan: ["brass", "material"], tembaga: ["copper", "material"],
  jati: ["teak wood", "material"],
  // colors
  merah: ["red", "color"], biru: ["blue", "color"], hijau: ["green", "color"], kuning: ["yellow", "color"],
  hitam: ["black", "color"], putih: ["white", "color"], coklat: ["brown", "color"], cokelat: ["brown", "color"],
  ungu: ["purple", "color"], oranye: ["orange", "color"], jingga: ["orange", "color"], krem: ["cream", "color"],
  // shape & size
  bulat: ["round", "shape"], bundar: ["round", "shape"], persegi: ["square", "shape"], lonjong: ["oval", "shape"],
  segitiga: ["triangular", "shape"], silinder: ["cylindrical", "shape"], melengkung: ["curved", "shape"],
  besar: ["large", "size"], kecil: ["small", "size"], panjang: ["long", "size"], pendek: ["short", "size"],
  tinggi: ["tall", "size"], rendah: ["low", "size"], lebar: ["wide", "size"], tipis: ["thin", "size"],
  tebal: ["thick", "size"], raksasa: ["giant", "size"], mini: ["mini", "size"],
  // style
  taman: ["garden", "style"], kebun: ["garden", "style"],
  modern: ["modern", "style"], klasik: ["classic", "style"], antik: ["antique", "style"], minimalis: ["minimalist", "style"],
  futuristik: ["futuristic", "style"], kuno: ["ancient", "style"], tua: ["old", "style"], rusak: ["damaged", "style"],
  lucu: ["cute", "style"], kartun: ["cartoon", "style"], realistis: ["realistic", "style"], mewah: ["luxurious", "style"],
  sederhana: ["simple", "style"], tradisional: ["traditional", "style"], jepang: ["japanese", "style"],
  jawa: ["javanese", "style"], bali: ["balinese", "style"], industrial: ["industrial", "style"], vintage: ["vintage", "style"],
  scifi: ["sci-fi", "style"], skandinavia: ["scandinavian", "style"], rustic: ["rustic", "style"],
  // numbers
  satu: ["one", "num"], dua: ["two", "num"], tiga: ["three", "num"], empat: ["four", "num"], lima: ["five", "num"],
  enam: ["six", "num"],
};

const CONNECT: Record<string, string> = { dengan: "with", pakai: "with", dan: "and", untuk: "for", tanpa: "without" };
const DROP = new Set(["yang", "sebuah", "seekor", "buah", "satu", "berbentuk", "bentuk", "warna", "berwarna", "bahan", "dari", "terbuat", "model", "gaya", "ala", "di", "ke", "itu", "ini", "agak", "sangat", "banget", "aja", "saja"]);
const ADJ_ORDER: Kind[] = ["size", "shape", "style", "color", "material"];

export const QUALITY_SUFFIX = "single object, accurate real-world proportions, clean detailed geometry, high quality 3D asset";

export interface SmartResult {
  /** Translated + reordered core prompt (no quality suffix). */
  core: string;
  /** What is actually sent to the 3D engine. */
  final: string;
  /** True when Indonesian words were recognized and translated. */
  translated: boolean;
}

/** User dictionary from the Knowledge Library: "kata" -> "english". */
export type UserDictionary = Record<string, string>;

function translateSegment(seg: string, extra: UserDictionary = {}): { text: string; hits: number } {
  let s = ` ${seg.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const items: { text: string; kind: Kind }[] = [];
  let hits = 0;
  // Replace phrases with placeholders so their words are not re-split.
  const phraseHits: [string, Kind][] = [];
  const userPhrases = Object.entries(extra)
    .map(([k, v]) => [k.toLowerCase().trim(), [v.trim(), "noun"]] as [string, [string, Kind]])
    .filter(([k, [v]]) => k && v)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [ph, val] of [...userPhrases, ...Object.entries(PHRASES)]) {
    if (s.includes(` ${ph} `)) {
      s = s.replaceAll(` ${ph} `, ` §${phraseHits.length}§ `);
      phraseHits.push(val);
    }
  }
  for (const tok of s.trim().split(" ")) {
    if (!tok) continue;
    const ph = tok.match(/^§(\d+)§$/);
    if (ph) {
      const [text, kind] = phraseHits[Number(ph[1])];
      items.push({ text, kind });
      hits++;
      continue;
    }
    if (DROP.has(tok) && !WORDS[tok]) {
      hits++;
      continue;
    }
    const w = WORDS[tok];
    if (w) {
      // "satu"/"buah" are mostly filler; keep numbers only before a noun-ish word.
      items.push({ text: w[0], kind: w[1] });
      hits++;
    } else {
      items.push({ text: tok, kind: /^\d+$/.test(tok) ? "num" : "word" });
    }
  }
  if (!hits) return { text: seg.trim(), hits: 0 };
  // "6 kursi" -> "6 chairs"
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const isMany = prev.kind === "num" && !["1", "one"].includes(prev.text);
    if (isMany && items[i].kind === "noun" && !/s$/.test(items[i].text)) items[i] = { ...items[i], text: `${items[i].text}s` };
  }
  // Indonesian puts adjectives after the noun; English wants them before.
  const adjs = ADJ_ORDER.flatMap((k) => items.filter((i) => i.kind === k).map((i) => i.text));
  const rest = items.filter((i) => !ADJ_ORDER.includes(i.kind)).map((i) => i.text);
  return { text: [...adjs, ...rest].join(" "), hits };
}

export function smartPrompt(raw: string, extra: UserDictionary = {}): SmartResult {
  const input = raw.trim();
  if (!input) return { core: "", final: "", translated: false };
  // Split on connectors / commas, translate each part, keep connectors in English.
  const parts = input.split(/(\s*,\s*|\s+(?:dengan|pakai|dan|untuk|tanpa)\s+)/i);
  let hits = 0;
  const out: string[] = [];
  for (const part of parts) {
    const conn = part.trim().toLowerCase();
    if (!conn) continue;
    if (conn === ",") {
      out.push(",");
      continue;
    }
    if (CONNECT[conn]) {
      out.push(CONNECT[conn]);
      hits++;
      continue;
    }
    const r = translateSegment(part, extra);
    hits += r.hits;
    if (r.text) out.push(r.text);
  }
  const core = out.join(" ").replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
  const translated = hits > 0 && core.toLowerCase() !== input.toLowerCase();
  const finalCore = translated ? core : input;
  return { core: finalCore, final: `${finalCore}, ${QUALITY_SUFFIX}`, translated };
}
