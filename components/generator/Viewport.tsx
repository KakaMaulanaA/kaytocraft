"use client";
import { useEffect, useRef, useState } from "react";
import {
  Box,
  Brush,
  Copy,
  Download,
  FileBox,
  Focus,
  Grid3x3,
  Loader2,
  Palette,
  RotateCw,
  ScanEye,
  Sun,
  Zap,
} from "lucide-react";
import type { Asset, AssetStats } from "@/lib/types";
import type { LightPreset, ModelViewer, ShadingMode } from "@/lib/three/viewer";
import { formatBytes, useConfig } from "@/lib/useConfig";
import { downloadBlend } from "@/lib/blendDownload";

interface Props {
  asset: Asset | null; // asset to show (ready) or track (running)
  onLoaded: (asset: Asset, stats: AssetStats, viewer: ModelViewer) => void;
  toast: (msg: string) => void;
}

const LIGHTS: LightPreset[] = ["studio", "sunset", "night"];

export function Viewport({ asset, onLoaded, toast }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<ModelViewer | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stats, setStats] = useState<AssetStats | null>(null);
  const [shownAsset, setShownAsset] = useState<Asset | null>(null);
  const shownId = shownAsset?.id ?? null;
  const [wire, setWire] = useState(false);
  const [rotate, setRotate] = useState(false);
  const [light, setLight] = useState<LightPreset>("studio");
  const [shading, setShading] = useState<ShadingMode>("pbr");
  // 3D engine state: `gen` bumps to rebuild the viewer after a WebGL failure.
  const [gen, setGen] = useState(0);
  const [glError, setGlError] = useState<string | null>(null);
  // Bumped for every new viewer instance, so the current model is loaded into it.
  const [viewerVer, setViewerVer] = useState(0);


  // Boot three.js (dynamic import keeps it out of the server bundle).
  useEffect(() => {
    let disposed = false;
    import("@/lib/three/viewer")
      .then(({ ModelViewer }) => {
        if (disposed || !host.current) return;
        const v = new ModelViewer(host.current);
        v.onContextLost = () => setGlError("Tampilan 3D terputus (GPU browser direset).");
        viewer.current = v;
        setGlError(null);
        setReady(true);
        setViewerVer((n) => n + 1);
      })
      .catch((e) => {
        if (disposed) return;
        const msg = e instanceof Error ? e.message : String(e);
        setGlError(
          /dynamically imported module|Loading chunk|ChunkLoadError/i.test(msg)
            ? "Versi web baru tersedia — muat ulang halaman."
            : "Tampilan 3D tidak bisa dimulai (WebGL tidak tersedia).",
        );
      });
    return () => {
      disposed = true;
      setReady(false);
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, [gen]);

  // Watchdog: a ready model that isn't loading and isn't on screen after 12 s means the 3D engine is stuck.
  // (only while nothing is downloading — a big model can legitimately take long)
  const waitingId = asset?.status === "ready" && asset.id !== shownId && !loadError && !loading ? asset.id : null;
  useEffect(() => {
    if (!waitingId) return;
    const t = window.setTimeout(() => setGlError((cur) => cur ?? "Model belum tampil — tampilan 3D macet."), 12_000);
    return () => window.clearTimeout(t);
  }, [waitingId, gen]);

  const restart3D = () => {
    setGlError(null);
    setShownAsset(null);
    setStats(null);
    setGen((g) => g + 1);
  };

  // Load the model whenever a different ready asset is selected.
  const readyId = asset?.status === "ready" ? asset.id : null;
  useEffect(() => {
    const v = viewer.current;
    if (!ready || !v || !readyId || !asset) return;
    if (readyId === shownId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const url = `/api/assets/${asset.id}/file`;
    const fmt = asset.format ?? "glb";
    // One quiet retry: a single hiccup on the server shouldn't show an error.
    v.load(url, fmt)
      .catch(() => new Promise((r) => setTimeout(r, 1200)).then(() => v.load(`${url}?retry=1`, fmt)))
      .then((st) => {
        if (cancelled) return;
        setStats(st);
        setShownAsset(asset);
        onLoaded(asset, st, v);
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : "Gagal memuat model"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, readyId, viewerVer]);

  // Selected asset was deleted -> empty the scene.
  useEffect(() => {
    if (!asset && shownAsset) {
      viewer.current?.clear();
      setShownAsset(null);
      setStats(null);
    }
  }, [asset, shownAsset]);

  const v = viewer.current;
  // Keep showing the last loaded model while a new one is generating.
  const shown = asset && asset.id === shownId ? asset : shownAsset;
  const generating = asset && (asset.status === "queued" || asset.status === "running");
  const ext = shown?.format ?? "glb";
  const fileName = shown ? `${shown.name.replace(/\s+/g, "_")}.${ext}` : "Untitled_Scene";

  const [blendBusy, setBlendBusy] = useState(false);
  const features = useConfig()?.features;
  const blendOk = features?.blend ?? true;
  const blendRemote = !!features?.blendRemote;
  const exportBlend = async () => {
    if (!shown) return;
    setBlendBusy(true);
    toast(blendRemote ? "Menyiapkan .blend…" : "Membuat .blend dengan Blender… (5–20 detik)");
    try {
      await downloadBlend(shown.id, shown.name, toast);
      toast(".blend siap — buka langsung di Blender");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBlendBusy(false);
    }
  };

  const exportObj = () => {
    const txt = v?.exportOBJ();
    if (!txt || !shown) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
    a.download = `${shown.name.replace(/\s+/g, "_")}.obj`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("OBJ diekspor (geometri saja, tanpa tekstur).");
  };

  const copyScript = async () => {
    if (!shown) return;
    const url = `${window.location.origin}/api/assets/${shown.id}/file`;
    const importer = ext === "fbx" ? "bpy.ops.import_scene.fbx(filepath=path)" : "bpy.ops.import_scene.gltf(filepath=path)";
    const script = [
      "# KaytoCraft 3D -> Blender (Scripting tab > New > Paste > Run)",
      "import bpy, os, tempfile, urllib.request",
      `url = "${url}"`,
      `path = os.path.join(tempfile.gettempdir(), "${fileName}")`,
      "urllib.request.urlretrieve(url, path)",
      importer,
      `print("Imported", path)`,
    ].join("\n");
    await navigator.clipboard.writeText(script);
    toast("Script Python disalin. Paste di Blender > Scripting lalu Run.");
  };

  return (
    <section className="relative flex h-full w-full min-w-0 flex-1 overflow-hidden rounded-[12px] bg-[rgba(2,6,23,0.8)]">
      <div ref={host} className="absolute inset-0" />
      {glError && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-[rgba(2,6,23,0.85)] p-4">
          <div className="max-w-sm rounded-[8px] border border-amber-400/30 bg-panel px-4 py-3 text-center">
            <p className="text-[13px] font-semibold text-amber-200">{glError}</p>
            <div className="mt-2 flex justify-center gap-2">
              <button type="button" onClick={restart3D} className="btn-primary text-[12px]">
                Nyalakan ulang 3D
              </button>
              <button type="button" onClick={() => window.location.reload()} className="btn-secondary text-[12px]">
                Muat ulang halaman
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top HUD */}
      <div className="pointer-events-none absolute left-2 right-2 top-2 flex items-start justify-between gap-2">
        <div className="pointer-events-auto min-w-0 max-w-[calc(100%-3rem)] rounded-[8px] border border-white/5 bg-[rgba(10,14,23,0.85)] px-2.5 py-1.5 shadow-2xl backdrop-blur md:max-w-[70%] md:px-3 md:py-2">
          <div className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-[4px] bg-accent/10 text-accent">
              <Box size={14} />
            </span>
            <span className="truncate text-[14px] font-semibold tracking-[-0.16px] md:text-[16px]">{fileName}</span>
            <span className="label-mono hidden shrink-0 rounded-[2px] bg-raised px-1 text-accent sm:inline">LIVE VIEWPORT</span>
          </div>
          {stats && shown ? (
            <div className="label-mono mt-1 flex flex-wrap gap-x-2 text-dim">
              <span>
                <b className="text-ink">{stats.triangles.toLocaleString()}</b> Tris
              </span>
              •
              <span>
                <b className="text-ink">{stats.vertices.toLocaleString()}</b> Verts
              </span>
              •
              <span>
                {stats.meshes} Mesh · {stats.materials} Mat
              </span>
              •<span>{formatBytes(shown.fileSize ?? 0)}</span>
            </div>
          ) : (
            <p className="label-mono mt-1 text-dim">Belum ada model dimuat</p>
          )}
        </div>
        <div className="pointer-events-auto hidden rounded-[8px] border border-white/5 bg-[rgba(10,14,23,0.85)] px-2.5 py-1.5 lg:block">
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-dim/50" />
            <span className="label-mono text-ink">Blender Bridge</span>
          </div>
          <span className="label-mono text-dim">Offline · Fase 3</span>
        </div>
      </div>

      {/* Right toolbar */}
      <div className="absolute right-2 top-[76px] flex flex-col gap-1 md:top-[84px] rounded-[8px] border border-white/5 bg-[rgba(10,14,23,0.8)] p-1">
        <Tool label="Wireframe" active={wire} onClick={() => (v?.setWireframe(!wire), setWire(!wire))}>
          <Grid3x3 size={15} />
        </Tool>
        <Tool label="Turntable Auto-Rotate" active={rotate} onClick={() => (v?.setAutoRotate(!rotate), setRotate(!rotate))}>
          <RotateCw size={15} />
        </Tool>
        <Tool label="Reset Camera" onClick={() => v?.resetView()}>
          <Focus size={15} />
        </Tool>
        <Tool
          label={`Lighting: ${light}`}
          onClick={() => {
            const next = LIGHTS[(LIGHTS.indexOf(light) + 1) % LIGHTS.length];
            v?.setLighting(next);
            setLight(next);
            toast(`Lighting: ${next}`);
          }}
        >
          <Sun size={15} />
        </Tool>
        <span className="mx-1 my-0.5 h-px bg-line" />
        {(
          [
            ["pbr", "Shading: PBR Textured", <Palette key="p" size={15} />],
            ["clay", "Shading: Clay", <Brush key="c" size={15} />],
            ["normals", "Shading: Normals", <ScanEye key="n" size={15} />],
          ] as const
        ).map(([mode, label, icon]) => (
          <Tool key={mode} label={label} solid={shading === mode} onClick={() => (v?.setShading(mode), setShading(mode))}>
            {icon}
          </Tool>
        ))}
      </div>

      {/* Centre states */}
      {(generating || loading || loadError || !shown || asset?.status === "failed") && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {generating ? (
            <ProgressRing asset={asset!} />
          ) : loading || (asset?.status === "ready" && !shown && !loadError) ? (
            <span className="flex items-center gap-2 text-[12px] text-dim">
              <Loader2 size={16} className="animate-spin" /> Memuat model…
            </span>
          ) : loadError ? (
            <span className="max-w-xs text-center text-[12px] text-red-300">{loadError}</span>
          ) : asset?.status === "failed" ? (
            <div className="max-w-sm rounded-[8px] border border-red-500/30 bg-[rgba(10,14,23,0.92)] px-4 py-3 text-center">
              <p className="text-[13px] font-semibold text-red-300">Generate gagal</p>
              <p className="label-mono mt-1 text-dim">{asset.error}</p>
            </div>
          ) : (
            <div className="text-center">
              <FileBox size={36} className="mx-auto mb-2 text-line" />
              <p className="text-[13px] text-ink">Viewport kosong</p>
              <p className="label-mono mt-1 text-dim">Tulis prompt atau unggah gambar, lalu Generate.</p>
            </div>
          )}
        </div>
      )}

      {/* Axis legend */}
      <div className="label-mono pointer-events-none absolute bottom-3 left-3 hidden flex-col gap-0.5 text-dim md:flex">
        <span><b className="text-red-400">X</b> Lateral</span>
        <span><b className="text-green-400">Y</b> Elevation</span>
        <span><b className="text-blue-400">Z</b> Depth</span>
      </div>

      {/* Export dock */}
      <div className="absolute bottom-3 left-1/2 flex w-max max-w-[calc(100%-1rem)] -translate-x-1/2 flex-col items-center gap-1.5">
        <a
          href={shown ? `/api/assets/${shown.id}/file?download=1` : undefined}
          aria-disabled={!shown}
          className={`flex items-center gap-1.5 rounded-[8px] bg-accent px-3 py-1.5 text-[12px] font-semibold text-on-accent shadow-[0_10px_15px_-3px_rgba(78,222,163,0.25)] ${
            shown ? "hover:brightness-110" : "pointer-events-none opacity-40"
          }`}
        >
          <Download size={14} /> Export .{ext.toUpperCase()}<span className="hidden sm:inline"> (Blender Ready)</span>
        </a>
        <div className="flex gap-1 rounded-[8px] border border-white/5 bg-[rgba(10,14,23,0.9)] p-1">
          <DockBtn
            disabled={!shown || blendBusy || !blendOk}
            onClick={exportBlend}
            title={
              !blendOk
                ? ".BLEND online belum disetel. Sementara pakai .GLB lalu import di Blender."
                : blendRemote
                  ? "File .blend siap buka (dibuat di server Blender, pertama kali ±1–2 menit)"
                  : "File .blend siap buka (dikonversi dengan Blender di komputer ini)"
            }
          >
            {blendBusy ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} .BLEND
          </DockBtn>
          <DockBtn disabled={!shown} onClick={exportObj} title="Ekspor geometri .OBJ dari viewport">
            .OBJ
          </DockBtn>
          <span className="hidden sm:contents">
            <DockBtn disabled title="Fase 2 — konversi FBX via engine">
              .FBX
            </DockBtn>
          </span>
          <DockBtn disabled={!shown} onClick={copyScript} title="Script import untuk Blender">
            <Copy size={12} /> <span className="hidden sm:inline">Python </span>Script
          </DockBtn>
        </div>
      </div>
    </section>
  );
}

function Tool(props: { label: string; active?: boolean; solid?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active ?? props.solid}
      onClick={props.onClick}
      className={`grid size-8 place-items-center rounded-[4px] transition-colors ${
        props.solid
          ? "bg-accent text-on-accent"
          : props.active
            ? "bg-raised text-accent"
            : "text-dim hover:bg-raised hover:text-ink"
      }`}
    >
      {props.children}
    </button>
  );
}

function DockBtn(props: { disabled?: boolean; onClick?: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex items-center gap-1 whitespace-nowrap rounded-[4px] bg-field px-2 py-1 font-mono text-[10px] text-ink hover:bg-raised disabled:cursor-not-allowed disabled:text-dim/50 disabled:hover:bg-field"
    >
      {props.children}
    </button>
  );
}

function ProgressRing({ asset }: { asset: Asset }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const p = Math.max(2, asset.progress);
  return (
    <div className="flex flex-col items-center gap-2 rounded-[12px] bg-[rgba(10,14,23,0.7)] px-6 py-5 backdrop-blur">
      <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-90">
        <circle cx="42" cy="42" r={r} stroke="#262a34" strokeWidth="6" fill="none" />
        <circle
          cx="42"
          cy="42"
          r={r}
          stroke="url(#g)"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p / 100)}
          style={{ transition: "stroke-dashoffset .6s ease" }}
        />
        <defs>
          <linearGradient id="g" x1="0" x2="1">
            <stop offset="0" stopColor="#10b981" />
            <stop offset="1" stopColor="#d0bcff" />
          </linearGradient>
        </defs>
      </svg>
      <span className="-mt-[62px] mb-[34px] font-mono text-[15px] text-ink">{asset.progress}%</span>
      <p className="max-w-56 truncate text-center text-[13px] text-ink">{asset.name}</p>
      <p className="label-mono text-dim">{asset.stageLabel ?? "Memproses…"}</p>
    </div>
  );
}
