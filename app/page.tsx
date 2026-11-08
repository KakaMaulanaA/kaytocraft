import { Suspense } from "react";
import { GeneratorStudio } from "@/components/generator/GeneratorStudio";

export default function Page() {
  return (
    <Suspense>
      <GeneratorStudio />
    </Suspense>
  );
}
