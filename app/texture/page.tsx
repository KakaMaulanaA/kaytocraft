import { ComingSoon } from "@/components/shell/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="PBR Texture Lab"
      phase={2}
      points={[
        "Preview terpisah map Base Color, Normal, Roughness, Metalness",
        "Ekstrak map dari .GLB menjadi file PNG",
        "Re-texture model dengan prompt baru",
      ]}
    />
  );
}
