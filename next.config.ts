import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const isPreview = process.env.VERCEL_ENV === "preview";
// HTTPS-only directives are sent only on Vercel, so a local `next start`
// over plain http still works
const httpsOnly = !isDev && Boolean(process.env.VERCEL);

// Clerk (identity workstream): dev instances on *.clerk.accounts.dev, the
// production Frontend API on a clerk.<domain> CNAME. Extra origins can be
// added without a code change via CSP_EXTRA_ORIGINS (space-separated).
const clerkOrigins = [
  "https://*.clerk.accounts.dev",
  "https://clerk.gratitude.com",
  "https://clerk.agents.gratitude.com",
];
const extraOrigins = (process.env.CSP_EXTRA_ORIGINS || "").split(/\s+/).filter(Boolean);
const vercelLive = isPreview ? ["https://vercel.live"] : [];

const csp = [
  "default-src 'self'",
  // Next.js App Router injects inline bootstrap scripts; nonces would require
  // middleware, which belongs to the auth workstream
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${[...clerkOrigins, "https://challenges.cloudflare.com", ...vercelLive, ...extraOrigins].join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  // Chat images are served from our own authorized route; remote images in
  // model markdown are deliberately blocked
  `img-src 'self' data: blob: https://img.clerk.com ${vercelLive.join(" ")}`.trim(),
  "font-src 'self' data:",
  // Browser uploads go to the Vercel Blob API
  `connect-src 'self' https://vercel.com https://*.blob.vercel-storage.com https://clerk-telemetry.com ${[...clerkOrigins, ...vercelLive, ...extraOrigins].join(" ")}${isDev ? " ws: wss:" : ""}`,
  `frame-src 'self' https://challenges.cloudflare.com ${[...clerkOrigins, ...vercelLive].join(" ")}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(httpsOnly ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  ...(httpsOnly
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas", "sharp"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
