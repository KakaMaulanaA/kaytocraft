/**
 * Reads a (translated) prompt into parameters for the free procedural generator.
 * No three.js here so the UI can import it cheaply.
 */

export type ProcKind =
  | "officeChair"
  | "chair"
  | "stool"
  | "bench"
  | "table"
  | "bookshelf"
  | "wardrobe"
  | "dresser"
  | "cabinet"
  | "treasureChest"
  | "crate"
  | "barrel"
  | "vase"
  | "mug"
  | "bottle"
  | "lamp"
  | "sword";

export type MatKind =
  | "wood"
  | "metal"
  | "gold"
  | "plastic"
  | "glass"
  | "ceramic"
  | "fabric"
  | "leather"
  | "stone"
  | "marble"
  | "rattan"
  | "rubber";

export interface ProcParams {
  kind: ProcKind;
  label: string;
  text: string;
  material?: MatKind;
  woodTone?: string;
  metalTone?: string;
  color?: string;
  round: boolean;
  square: boolean;
  oval: boolean;
  scale: number;
  tall: number; // height multiplier
  long: number; // length multiplier
  legs?: number;
  style: { modern: boolean; classic: boolean; scifi: boolean; cartoon: boolean; rustic: boolean; japanese: boolean; industrial: boolean };
  has: (re: RegExp) => boolean;
}

// Order matters: more specific first.
const KINDS: [RegExp, ProcKind, string][] = [
  [/\b(office chair|gaming chair|swivel chair|desk chair)\b/, "officeChair", "kursi kantor"],
  [/\b(treasure chest)\b/, "treasureChest", "peti harta"],
  [/\b(lamp|lantern)\b/, "lamp", "lampu"],
  [/\b(bookshelf|bookcase|book shelf|shelf|shelves|rack)\b/, "bookshelf", "rak"],
  [/\b(wardrobe|closet)\b/, "wardrobe", "lemari pakaian"],
  [/\b(dresser|drawers|chest of drawers|nightstand|bedside table)\b/, "dresser", "laci"],
  [/\b(cabinet|cupboard|sideboard|refrigerator)\b/, "cabinet", "lemari"],
  [/\b(stool|bar stool)\b/, "stool", "stool"],
  [/\b(bench)\b/, "bench", "bangku"],
  [/\b(armchair|chair|seat|wheelchair|lounge chair|rocking chair)\b/, "chair", "kursi"],
  [/\b(table|desk)\b/, "table", "meja"],
  [/\b(chest|crate|box|cardboard box|case|container)\b/, "crate", "peti / kotak"],
  [/\b(barrel|keg|cask)\b/, "barrel", "tong"],
  [/\b(mug|cup|teacup)\b/, "mug", "mug"],
  [/\b(bottle|flask|potion)\b/, "bottle", "botol"],
  [/\b(vase|jar|urn|flower pot|pot|amphora)\b/, "vase", "vas / guci / pot"],
  [/\b(sword|katana|blade|saber|sabre|kris dagger|dagger|machete)\b/, "sword", "pedang"],
];

export const SUPPORTED_LABELS = [
  "meja",
  "kursi",
  "kursi kantor",
  "stool",
  "bangku",
  "rak buku",
  "lemari",
  "laci",
  "peti / kotak",
  "peti harta",
  "tong",
  "vas / guci / pot",
  "mug",
  "botol",
  "lampu",
  "pedang",
];

const COLORS: Record<string, string> = {
  red: "#b3352c",
  blue: "#2f5fa8",
  green: "#2f7a4f",
  yellow: "#e0b52e",
  black: "#202024",
  white: "#ecebe6",
  grey: "#8a8d91",
  gray: "#8a8d91",
  brown: "#6b4a2e",
  purple: "#6b3fa0",
  orange: "#d96a2b",
  pink: "#e48aa8",
  cream: "#e8dcc0",
};

const WOOD: [RegExp, string][] = [
  [/\bteak\b/, "#9b6a3c"],
  [/\bwalnut\b/, "#6b4423"],
  [/\bpine\b/, "#d6b07a"],
  [/\boak\b/, "#c49a6c"],
  [/\bbamboo\b/, "#d9c27e"],
  [/\bmahogany\b/, "#7a3b22"],
  [/\b(ebony|dark wood)\b/, "#3b2a20"],
];

function materialOf(t: string): { material?: MatKind; woodTone?: string; metalTone?: string } {
  for (const [re, tone] of WOOD) if (re.test(t)) return { material: "wood", woodTone: tone };
  if (/\b(wood|wooden|timber|plywood)\b/.test(t)) return { material: "wood" };
  if (/\b(gold|golden)\b/.test(t)) return { material: "gold" };
  if (/\b(brass)\b/.test(t)) return { material: "metal", metalTone: "#b58b3a" };
  if (/\b(copper)\b/.test(t)) return { material: "metal", metalTone: "#b0663f" };
  if (/\b(silver|chrome)\b/.test(t)) return { material: "metal", metalTone: "#c9ccd1" };
  if (/\b(iron|steel|metal|metallic|aluminum|aluminium)\b/.test(t)) return { material: "metal" };
  if (/\b(glass|crystal)\b/.test(t)) return { material: "glass" };
  if (/\b(plastic|acrylic)\b/.test(t)) return { material: "plastic" };
  if (/\b(ceramic|porcelain|clay|terracotta)\b/.test(t)) return { material: "ceramic" };
  if (/\b(marble)\b/.test(t)) return { material: "marble" };
  if (/\b(stone|concrete|granite)\b/.test(t)) return { material: "stone" };
  if (/\b(leather)\b/.test(t)) return { material: "leather" };
  if (/\b(fabric|velvet|linen|cloth|upholstered)\b/.test(t)) return { material: "fabric" };
  if (/\b(rattan|wicker)\b/.test(t)) return { material: "rattan" };
  if (/\b(rubber)\b/.test(t)) return { material: "rubber" };
  return {};
}

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

export function detectProcedural(text: string): ProcParams | null {
  const t = ` ${text.toLowerCase()} `;
  const hit = KINDS.find(([re]) => re.test(t));
  if (!hit) return null;
  const has = (re: RegExp) => re.test(t);

  const legsMatch = t.match(/\b(\d|one|two|three|four|five|six)[\s-]+legs?\b/);
  const legs = legsMatch ? Number(legsMatch[1]) || NUM[legsMatch[1]] : undefined;

  const color = Object.entries(COLORS).find(([k]) => new RegExp(`\\b${k}\\b`).test(t))?.[1];

  let scale = 1;
  if (has(/\b(small|little|mini|tiny)\b/)) scale = 0.75;
  if (has(/\b(large|big|huge|giant)\b/)) scale = 1.3;

  return {
    kind: hit[1],
    label: hit[2],
    text: t,
    ...materialOf(t),
    color,
    round: has(/\b(round|circular|cylindrical)\b/),
    square: has(/\b(square)\b/),
    oval: has(/\b(oval)\b/),
    scale,
    tall: has(/\b(tall|high)\b/) ? 1.3 : has(/\b(low|short)\b/) ? 0.75 : 1,
    long: has(/\b(long|wide)\b/) ? 1.4 : 1,
    legs: legs && legs >= 1 && legs <= 6 ? legs : undefined,
    style: {
      modern: has(/\b(modern|minimalist|scandinavian|contemporary)\b/),
      classic: has(/\b(classic|antique|vintage|victorian|baroque|traditional|old|ancient|medieval|javanese|balinese|royal|luxurious)\b/),
      scifi: has(/\b(sci-fi|scifi|futuristic|cyberpunk|space)\b/),
      cartoon: has(/\b(cartoon|cute|stylized|toy)\b/),
      rustic: has(/\b(rustic|old|damaged|worn|weathered|medieval)\b/),
      japanese: has(/\b(japanese|katana)\b/),
      industrial: has(/\b(industrial)\b/),
    },
    has,
  };
}
