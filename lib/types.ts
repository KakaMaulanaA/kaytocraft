// Shared types between client and server.

export type GenMode = "text" | "image";

export type EngineId =
  | "tripo-v3.1"
  | "tripo-v3.0"
  | "tripo-p2"
  | "meshy"
  | "claude"
  | "gemini"
  | "demo";

export type MeshDensity = "low" | "balanced" | "high";
export type TextureQuality = "standard" | "detailed" | "extreme";
export type PresetId = "hard-surface" | "low-poly" | "furniture";

export interface GenerateSettings {
  mode: GenMode;
  prompt: string;
  negativePrompt?: string;
  engine: EngineId;
  density: MeshDensity;
  textureQuality: TextureQuality;
  pbr: boolean;
  quad: boolean;
  smartLowPoly: boolean;
  presets: PresetId[];
}

export type AssetStatus = "queued" | "running" | "ready" | "failed";

export interface AssetStats {
  vertices: number;
  triangles: number;
  meshes: number;
  materials: number;
}

export interface Asset {
  id: string;
  name: string;
  status: AssetStatus;
  progress: number; // 0..100
  stageLabel?: string;
  error?: string;
  settings: GenerateSettings;
  /** Provider-side bookkeeping (task ids, stage). Server-only meaning. */
  provider: {
    engine: EngineId;
    taskId?: string;
    stage?: "preview" | "refine";
    startedAt?: number;
    demoModel?: string;
  };
  /** Where the model came from when not an AI engine. */
  source?: "procedural" | "import" | "claude" | "gemini" | "library";
  /** Set when the model was made from an approved 2D concept. */
  conceptId?: string;
  format?: "glb" | "fbx";
  fileSize?: number;
  hasThumb?: boolean;
  stats?: AssetStats;
  createdAt: number;
  completedAt?: number;
}

export interface EngineInfo {
  id: EngineId;
  label: string;
  provider: "tripo" | "meshy" | "claude" | "gemini" | "demo";
  available: boolean;
  supportsImage: boolean;
  /** Can make 2D concept images before 3D. */
  supportsConcept: boolean;
  note?: string;
}

export interface AppConfig {
  engines: EngineInfo[];
  defaultEngine: EngineId;
  storage: { used: number; count: number };
  /** Tripo credits available (null = unknown / no key). */
  balance: number | null;
  features: {
    /** .blend export/import (needs Blender on the machine running the server). */
    blend: boolean;
    /** .blend is made by the GitHub Actions worker (takes 1–2 minutes the first time). */
    blendRemote?: boolean;
    /** Running as the online (Netlify) version. */
    hosted: boolean;
    /** Password login is on (show a logout button). */
    auth: boolean;
  };
}

export type ConceptStatus = "running" | "ready" | "failed";

export interface Concept {
  id: string;
  batchId: string;
  prompt: string;
  engine: EngineId;
  status: ConceptStatus;
  progress: number;
  error?: string;
  taskId?: string;
  ext?: "png" | "jpg" | "svg";
  startedAt: number;
}
