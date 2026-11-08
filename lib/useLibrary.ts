"use client";
import { useCallback, useEffect, useState } from "react";
import type { LibraryData } from "./library";

const EVENT = "kc:library-refresh";
export const refreshLibrary = () => window.dispatchEvent(new Event(EVENT));

export function useLibrary() {
  const [data, setData] = useState<LibraryData>({ entries: [], dictionary: {} });
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/library", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {}
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(EVENT, load);
    return () => window.removeEventListener(EVENT, load);
  }, [load]);
  return data;
}

/** Export a three.js object to a GLB Blob (browser only). */
export async function groupToGlb(group: import("three").Object3D): Promise<Blob> {
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const glb = (await new GLTFExporter().parseAsync(group, { binary: true })) as ArrayBuffer;
  return new Blob([glb], { type: "model/gltf-binary" });
}
