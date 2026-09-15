import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { resources } from "@/db/schema";
import { GRATITUDE_LOGO_WHITE_SVG } from "@/lib/brand-logo";

// Composite the real Gratitude wordmark onto a generated image, following the
// brand standard in design-kit/platform-specs.yaml: bottom-right, 40px margin,
// 120px max width (scaled proportionally to canvas size), white on dark.
// This is what lets the image tool deliver FINISHED graphics instead of
// backgrounds with a "reserved space" for manual compositing.
async function compositeBrandLogo(bytes: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(bytes).metadata();
  const W = meta.width || 1024;
  const H = meta.height || 1024;

  // Scale the 1080-reference spec (40px margin, 120px logo) to this canvas
  const margin = Math.max(24, Math.round((W * 40) / 1080));
  const logoW = Math.max(96, Math.round((W * 120) / 1080));
  const logoH = Math.round(logoW * (287.89 / 1449)); // wordmark aspect ratio

  const logo = await sharp(Buffer.from(GRATITUDE_LOGO_WHITE_SVG), { density: 300 })
    .resize({ width: logoW })
    .png()
    .toBuffer();

  return sharp(bytes)
    .composite([
      {
        input: logo,
        left: W - logoW - margin,
        top: H - logoH - margin,
      },
    ])
    .png()
    .toBuffer();
}

// Gemini Imagen image generation for the design agents.
// The PNG is stored in Vercel Blob; a `resources` row records metadata so chat
// responses can embed it via /api/resources/{id}/download?inline=1 (which
// permission-gates then redirects to the blob CDN URL).

const IMAGE_MODEL = process.env.IMAGE_MODEL || "imagen-4.0-generate-001";

export type ImageAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export interface GeneratedImage {
  resourceId: string;
  title: string;
}

export async function generateImage(options: {
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  ownerId: string;
  conversationId?: string | null;
  title?: string;
  includeLogo?: boolean;
}): Promise<GeneratedImage> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Image generation is not configured (missing GEMINI_API_KEY)");
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:predict`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        instances: [{ prompt: options.prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: options.aspectRatio || "1:1",
        },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Image generation failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
  };

  const prediction = data.predictions?.[0];
  if (!prediction?.bytesBase64Encoded) {
    throw new Error("Image generation returned no image (possibly blocked by safety filters)");
  }

  const title =
    options.title || options.prompt.slice(0, 80).trim() || "Generated image";
  let mimeType = prediction.mimeType || "image/png";

  let bytes = Buffer.from(prediction.bytesBase64Encoded, "base64");

  // Stamp the real brand wordmark unless explicitly opted out. If compositing
  // fails for any reason, ship the un-stamped image rather than failing the
  // whole generation.
  if (options.includeLogo !== false) {
    try {
      // Buffer.from normalizes sharp's Buffer<ArrayBufferLike> generic
      bytes = Buffer.from(await compositeBrandLogo(bytes));
      mimeType = "image/png"; // compositor always outputs PNG
    } catch (e) {
      console.error("Logo compositing failed, delivering un-stamped image:", e);
    }
  }

  const extension = mimeType.includes("jpeg") ? "jpg" : "png";
  const fileName = `${title.replace(/[^\w\- ]/g, "").replace(/\s+/g, "-").toLowerCase() || "image"}.${extension}`;
  // Private store: served only through the authorized download route
  const blob = await put(`generated/${fileName}`, bytes, {
    access: "private",
    addRandomSuffix: true,
    contentType: mimeType,
  });

  const [resource] = await db
    .insert(resources)
    .values({
      ownerId: options.ownerId,
      conversationId: options.conversationId || null,
      title,
      description: `AI-generated image. Prompt: ${options.prompt.slice(0, 500)}`,
      type: "generated",
      visibility: "private",
      status: "draft",
      fileName,
      mimeType,
      extension,
      sizeBytes: bytes.byteLength,
      blobUrl: blob.url,
      tags: ["generated-image"],
    })
    .returning({ id: resources.id });

  return { resourceId: resource.id, title };
}
