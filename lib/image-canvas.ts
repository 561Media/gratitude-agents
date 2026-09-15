/**
 * Exact delivery canvases and safe-zone logo placement for generated images.
 * No database or network imports, so it can be checked locally.
 */
import { GRATITUDE_LOGO_WHITE_SVG } from "@/lib/brand-logo";

export type ImageAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "4:5";
export const IMAGE_ASPECT_RATIOS: ImageAspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4", "4:5"];

export interface CanvasSpec {
  width: number;
  height: number;
  /** Logo inset from the right and bottom edges at this canvas size (px) */
  logoRight: number;
  logoBottom: number;
}

// Exact delivery canvases (design-kit/platform-specs.yaml). Logo insets keep
// the mark inside each format's safe zone: square posts 80px from the edges,
// portrait posts clear the 120px bottom caption zone, stories clear the 280px
// bottom UI zone.
export const CANVAS: Record<ImageAspectRatio, CanvasSpec> = {
  "1:1": { width: 1080, height: 1080, logoRight: 80, logoBottom: 80 },
  "16:9": { width: 1920, height: 1080, logoRight: 80, logoBottom: 80 },
  "4:3": { width: 1440, height: 1080, logoRight: 80, logoBottom: 80 },
  "3:4": { width: 1080, height: 1440, logoRight: 80, logoBottom: 80 },
  "4:5": { width: 1080, height: 1350, logoRight: 80, logoBottom: 160 },
  "9:16": { width: 1080, height: 1920, logoRight: 80, logoBottom: 320 },
};

/** Crop (cover, centered) to the exact requested canvas. */
export async function fitToCanvas(bytes: Buffer, aspect: ImageAspectRatio): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const { width, height } = CANVAS[aspect];
  return Buffer.from(
    await sharp(bytes).resize({ width, height, fit: "cover", position: "centre" }).png().toBuffer()
  );
}

export interface LogoPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the wordmark goes on a canvas of this size: 120px wide at the 1080 reference. */
export function logoPlacement(aspect: ImageAspectRatio, W: number, H: number): LogoPlacement {
  const spec = CANVAS[aspect];
  const scale = Math.min(W, H) / 1080;
  const width = Math.max(96, Math.round(120 * scale));
  const height = Math.round(width * (287.89 / 1449)); // wordmark aspect ratio
  return {
    left: W - width - Math.round(spec.logoRight * scale),
    top: H - height - Math.round(spec.logoBottom * scale),
    width,
    height,
  };
}

// Composite the real Gratitude wordmark. Runs AFTER fitToCanvas so the crop
// can never cut the logo off.
export async function compositeBrandLogo(bytes: Buffer, aspect: ImageAspectRatio): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(bytes).metadata();
  const W = meta.width || CANVAS[aspect].width;
  const H = meta.height || CANVAS[aspect].height;
  const place = logoPlacement(aspect, W, H);

  const logo = await sharp(Buffer.from(GRATITUDE_LOGO_WHITE_SVG), { density: 300 })
    .resize({ width: place.width })
    .png()
    .toBuffer();

  return Buffer.from(
    await sharp(bytes)
      .composite([{ input: logo, left: place.left, top: place.top }])
      .png()
      .toBuffer()
  );
}
