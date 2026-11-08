import { ComingSoon } from "@/components/shell/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="Batch Synthesis"
      phase={2}
      points={[
        "Antrian banyak prompt / gambar sekaligus (paste daftar atau CSV)",
        "Kontrol paralelisme sesuai limit API",
        "Semua hasil otomatis masuk Asset Vault",
      ]}
    />
  );
}
