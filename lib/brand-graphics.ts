/**
 * Raster brand elements rendered from the visual-system tokens with sharp,
 * shared by the PPTX and PDF exporters so both show the same thing:
 * - the signature THREE-stop gradient (pink #FE3184 -> coral #FF6B35 -> orange #ec7211)
 * - soft radial glows (pink and orange) with real alpha falloff
 * - the official white wordmark from logos/
 */
import fs from "fs";
import path from "path";

export const BRAND = {
  pink: "FE3184",
  coral: "FF6B35",
  orange: "EC7211",
  black: "000000",
  nearBlack: "0A0A0A",
  card: "111111",
  elevated: "1A1A1A",
  border: "242424",
  white: "FFFFFF",
  body: "B3B3B3", // ~70% white on black
  muted: "808080", // ~50% white on black
} as const;

export type GraphicAsset = "gradient-h" | "glow-pink" | "glow-orange" | "logo-white";

export interface AssetImage {
  png: Buffer;
  width: number;
  height: number;
}

const cache = new Map<GraphicAsset, AssetImage>();

function gradientSvg(w: number, h: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#${BRAND.pink}"/>
    <stop offset="0.5" stop-color="#${BRAND.coral}"/>
    <stop offset="1" stop-color="#${BRAND.orange}"/>
  </linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
</svg>`;
}

function glowSvg(w: number, h: number, hex: string, peak: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><radialGradient id="r" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#${hex}" stop-opacity="${peak}"/>
    <stop offset="0.4" stop-color="#${hex}" stop-opacity="${(peak * 0.35).toFixed(3)}"/>
    <stop offset="1" stop-color="#${hex}" stop-opacity="0"/>
  </radialGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#r)"/>
</svg>`;
}

async function renderSvg(svg: string): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return Buffer.from(await sharp(Buffer.from(svg)).png().toBuffer());
}

export async function getAsset(asset: GraphicAsset): Promise<AssetImage> {
  const hit = cache.get(asset);
  if (hit) return hit;

  let image: AssetImage;
  switch (asset) {
    case "gradient-h":
      image = { png: await renderSvg(gradientSvg(1600, 16)), width: 1600, height: 16 };
      break;
    case "glow-pink":
      image = { png: await renderSvg(glowSvg(900, 900, BRAND.pink, 0.32)), width: 900, height: 900 };
      break;
    case "glow-orange":
      image = { png: await renderSvg(glowSvg(900, 900, BRAND.orange, 0.22)), width: 900, height: 900 };
      break;
    case "logo-white": {
      const file = path.join(process.cwd(), "logos", "gratitude-logo-white.png");
      if (!fs.existsSync(file)) {
        // Fail loudly: silently swapping in a text logo is off-brand
        throw new Error("Brand asset missing: logos/gratitude-logo-white.png");
      }
      const sharp = (await import("sharp")).default;
      const png = fs.readFileSync(file);
      const meta = await sharp(png).metadata();
      image = { png, width: meta.width || 800, height: meta.height || 159 };
      break;
    }
  }
  cache.set(asset, image);
  return image;
}

/** Aspect ratio (w/h) of the wordmark file, for sizing without loading it. */
export const LOGO_ASPECT = 800 / 159;
