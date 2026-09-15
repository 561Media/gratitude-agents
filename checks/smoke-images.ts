/**
 * Local image canvas smoke test. No network, no database.
 *
 *   npx tsx checks/smoke-images.ts [outDir]
 *
 * Simulates the gpt-image output sizes (1024x1024, 1536x1024, 1024x1536),
 * crops each to the exact delivery canvas, composites the logo, and asserts
 * the final size and that the logo stays inside the safe zone.
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import {
  CANVAS,
  IMAGE_ASPECT_RATIOS,
  type ImageAspectRatio,
  compositeBrandLogo,
  fitToCanvas,
  logoPlacement,
} from "@/lib/image-canvas";

const outDir = path.join(
  process.argv[2] || path.join(os.homedir(), "gratitude-agents-review", "output-quality-2026-09-15"),
  "images"
);
fs.mkdirSync(outDir, { recursive: true });

const SOURCE: Record<ImageAspectRatio, [number, number]> = {
  "1:1": [1024, 1024],
  "16:9": [1536, 1024],
  "4:3": [1536, 1024],
  "9:16": [1024, 1536],
  "3:4": [1024, 1536],
  "4:5": [1024, 1536],
};

// Bottom UI zones from design-kit/platform-specs.yaml the logo must clear
const BOTTOM_UI_ZONE: Partial<Record<ImageAspectRatio, number>> = { "9:16": 280, "4:5": 120 };

async function fakeGeneration(w: number, h: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#000"/>
    <circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="#FE3184" opacity="0.45"/>
    <rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#ec7211" stroke-width="6"/>
  </svg>`;
  return Buffer.from(await sharp(Buffer.from(svg)).png().toBuffer());
}

async function main() {
  for (const aspect of IMAGE_ASPECT_RATIOS) {
    const [sw, sh] = SOURCE[aspect];
    const fitted = await fitToCanvas(await fakeGeneration(sw, sh), aspect);
    const final = await compositeBrandLogo(fitted, aspect);
    const meta = await sharp(final).metadata();
    const { width, height } = CANVAS[aspect];
    assert.equal(meta.width, width, `${aspect} width`);
    assert.equal(meta.height, height, `${aspect} height`);

    const logo = logoPlacement(aspect, width, height);
    assert.ok(logo.left >= 0 && logo.left + logo.width <= width, `${aspect} logo x inside canvas`);
    const zone = BOTTOM_UI_ZONE[aspect] ?? 60;
    assert.ok(logo.top + logo.height <= height - zone, `${aspect} logo clears the bottom ${zone}px zone`);

    const file = `canvas-${aspect.replace(":", "x")}-${width}x${height}.png`;
    fs.writeFileSync(path.join(outDir, file), final);
    console.log(`${aspect}: ${sw}x${sh} -> ${meta.width}x${meta.height}, logo bottom edge at y=${logo.top + logo.height} (clears ${zone}px zone)`);
  }
  console.log(`wrote canvas samples to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
