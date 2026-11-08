/**
 * Get an asset as .blend. On the PC the server converts right away; online the first
 * request starts a GitHub Actions job (202) and we poll until the file is ready.
 */
export async function downloadBlend(id: string, name: string, onStatus?: (msg: string) => void) {
  const started = Date.now();
  let announced = false;
  for (;;) {
    const res = await fetch(`/api/assets/${id}/blend`, { cache: "no-store" });
    if (res.status === 202) {
      if (!announced) onStatus?.("Membuat .blend di server Blender (±1–2 menit, berikutnya instan)…");
      announced = true;
      if (Date.now() - started > 10 * 60_000) throw new Error("Pembuatan .blend terlalu lama. Coba klik lagi nanti.");
      await new Promise((r) => setTimeout(r, 6000));
      continue;
    }
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Gagal membuat .blend");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || id}.blend`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return;
  }
}
