import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { resources } from "@/db/schema";
import {
  CANVAS,
  compositeBrandLogo,
  fitToCanvas,
  type ImageAspectRatio,
} from "@/lib/image-canvas";

// OpenAI gpt-image-2 image generation for the design agents (561 Media account,
// switched from Gemini Imagen 9/15/26 after the Gemini prepay credits ran out).
// The PNG is stored in Vercel Blob; a `resources` row records metadata so chat
// responses can embed it via /api/resources/{id}/download?inline=1 (which
// permission-gates then redirects to the blob CDN URL).

const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-2";
// "medium" keeps a generation well inside the chat function's time budget;
// set IMAGE_QUALITY=high only with a longer maxDuration.
const IMAGE_QUALITY = process.env.IMAGE_QUALITY || "medium";
const IMAGE_TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS) || 90_000;

export { IMAGE_ASPECT_RATIOS, CANVAS } from "@/lib/image-canvas";
export type { ImageAspectRatio } from "@/lib/image-canvas";

// gpt-image models take fixed sizes: generate at the closest, then crop to the
// exact delivery canvas (lib/image-canvas.ts)
const OPENAI_SIZE: Record<ImageAspectRatio, string> = {
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "4:3": "1536x1024",
  "9:16": "1024x1536",
  "3:4": "1024x1536",
  "4:5": "1024x1536",
};

export interface GeneratedImage {
  resourceId: string;
  title: string;
  /** Set when the image shipped without the logo because compositing failed */
  logoError?: string;
}

export async function generateImage(options: {
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  ownerId: string;
  conversationId?: string | null;
  title?: string;
  includeLogo?: boolean;
  /** Hard ceiling for the API call; defaults to IMAGE_TIMEOUT_MS */
  timeoutMs?: number;
}): Promise<GeneratedImage> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Image generation is not configured (missing OPENAI_API_KEY)");
  }
  const aspect = options.aspectRatio || "1:1";

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: options.prompt,
        size: OPENAI_SIZE[aspect],
        quality: IMAGE_QUALITY,
        n: 1,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? IMAGE_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("Image generation timed out");
    }
    throw err;
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Image generation failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    data?: { b64_json?: string }[];
    output_format?: string;
  };

  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("Image generation returned no image (possibly blocked by safety filters)");
  }

  const title = options.title || options.prompt.slice(0, 80).trim() || "Generated image";

  // Exact delivery size first (1920x1080, 1080x1920, 1080x1350...), then logo
  let bytes = await fitToCanvas(Buffer.from(b64, "base64"), aspect);
  const mimeType = "image/png";
  let logoError: string | undefined;

  if (options.includeLogo !== false) {
    try {
      bytes = await compositeBrandLogo(bytes, aspect);
    } catch (e) {
      console.error("Logo compositing failed, delivering un-stamped image:", e);
      logoError = "The official logo could not be applied to this image.";
    }
  }

  const fileName = `${title.replace(/[^\w\- ]/g, "").replace(/\s+/g, "-").toLowerCase() || "image"}.png`;
  const blob = await put(`generated/${fileName}`, bytes, {
    // Private store: served only through the authorized download route
    access: "private",
    addRandomSuffix: true,
    contentType: mimeType,
  });

  const { width, height } = CANVAS[aspect];
  const [resource] = await db
    .insert(resources)
    .values({
      ownerId: options.ownerId,
      conversationId: options.conversationId || null,
      title,
      description: `AI-generated image (${width}x${height}). Prompt: ${options.prompt.slice(0, 500)}`,
      type: "generated",
      visibility: "private",
      status: "draft",
      fileName,
      mimeType,
      extension: "png",
      sizeBytes: bytes.byteLength,
      blobUrl: blob.url,
      tags: ["generated-image"],
    })
    .returning({ id: resources.id });

  return { resourceId: resource.id, title, logoError };
}
