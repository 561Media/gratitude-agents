import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas", "sharp"],
  // Exporters read brand fonts and logos from disk at runtime; make sure the
  // serverless bundles for these routes include them.
  outputFileTracingIncludes: {
    "/api/exports": [
      "./canvas-fonts/Anton-Regular.ttf",
      "./canvas-fonts/Inter-Regular.ttf",
      "./canvas-fonts/Inter-SemiBold.ttf",
      "./logos/**/*",
    ],
    "/api/chat": ["./brand-kit/**/*", "./design-kit/**/*", "./.claude/**/*", "./logos/**/*"],
  },
};

export default nextConfig;
