import { ComingSoon } from "@/components/shell/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="Topology & Retopo"
      phase={2}
      points={[
        "Inspeksi polycount detail per mesh (sudah tampil ringkas di viewport)",
        "Deteksi n-gon, non-manifold, dan face terbalik",
        "Retopo / smart low-poly ulang via API engine",
      ]}
    />
  );
}
