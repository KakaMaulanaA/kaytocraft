import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating "N" dev badge; it overlaps the sidebar footer.
  devIndicators: false,
  // Uploads (reference images) go through route handlers; allow up to ~25MB bodies.
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  // NETLIFY=true only exists during the Netlify build: bake it in so the server knows at runtime.
  env: { KC_DEPLOY_TARGET: process.env.NETLIFY === "true" ? "netlify" : "" },
  // Ship the bundled Knowledge Library and demo models inside the server functions
  // (online they are copied into Netlify Blobs / read on first use).
  outputFileTracingIncludes: { "/api/**": ["./library/**", "./public/demo/**", "./scripts/**"] },
  // Never ship the local PC's generated files or secrets with the server code.
  outputFileTracingExcludes: { "*": ["./storage/**", "./.env*", "./tsconfig.tsbuildinfo"] },
};

export default nextConfig;
