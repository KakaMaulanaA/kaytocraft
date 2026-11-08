import { ComingSoon } from "@/components/shell/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="Blender Live Sync"
      phase={3}
      points={[
        "Add-on Blender (Python) yang membuka server lokal",
        "Tombol “Send to Blender” langsung dari viewport",
        "Sementara: pakai tombol “Python Script” di viewport untuk import 1-klik",
      ]}
    />
  );
}
