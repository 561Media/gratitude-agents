import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { blobUploads, conversations, resources } from "@/db/schema";
import { getSession, type SessionUser } from "@/lib/auth";
import {
  canPublishResource,
  canWriteConversation,
  defaultVisibilityForRole,
} from "@/lib/permissions";
import {
  SIGNATURE_BYTES,
  fileExtension,
  matchesSignature,
  normalizeMime,
  uploadPathname,
  validateUploadRequest,
} from "@/lib/upload-policy";
import { claimUploadIntent, isUuid, verifyUploadIntent } from "@/lib/resource-uploads";
import { consumeBudgets, rateLimitResponse } from "@/lib/rate-limit";

const VISIBILITIES = ["private", "internal", "partner"] as const;
type Visibility = (typeof VISIBILITIES)[number];

const TEXT_MIMES = new Set(["text/markdown", "text/plain", "text/csv"]);
const MAX_TEXT_CONTENT_CHARS = 1_000_000;
const MAX_TITLE_CHARS = 300;
const MAX_DESCRIPTION_CHARS = 5000;
const MAX_TAGS = 20;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function resolveVisibility(session: SessionUser, requested: unknown): Visibility {
  if (!canPublishResource(session)) return "private";
  return VISIBILITIES.includes(requested as Visibility)
    ? (requested as Visibility)
    : (defaultVisibilityForRole(session) as Visibility);
}

function resolveStatus(session: SessionUser, requested: unknown): "draft" | "published" {
  return requested === "published" && canPublishResource(session) ? "published" : "draft";
}

function cleanTags(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  return list
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, MAX_TAGS);
}

// Linking a resource to a conversation requires write access to it
async function resolveConversation(
  session: SessionUser,
  raw: unknown
): Promise<{ id: string | null } | { error: NextResponse }> {
  if (raw === undefined || raw === null || raw === "") return { id: null };
  if (!isUuid(raw)) return { error: bad("Invalid conversation.") };
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, raw)).limit(1);
  if (!conv) return { error: bad("Conversation not found.", 404) };
  if (!canWriteConversation(session, conv)) return { error: bad("Forbidden", 403) };
  return { id: conv.id };
}

// Generated text outputs and links (no file bytes)
async function createTextResource(
  session: SessionUser,
  fields: Record<string, unknown>,
  conversationId: string | null
) {
  const title = str(fields.title, MAX_TITLE_CHARS).trim();
  if (!title) return bad("A title is required.");

  const textContent = typeof fields.textContent === "string" ? fields.textContent : "";
  if (textContent.length > MAX_TEXT_CONTENT_CHARS) return bad("Content is too long.");

  const externalUrl = str(fields.externalUrl, 2048).trim();
  if (externalUrl) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(externalUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
      return bad("Links must start with http:// or https://.");
    }
  }

  const mime = normalizeMime(str(fields.mimeType, 100));
  const mimeType = TEXT_MIMES.has(mime) ? `${mime}; charset=utf-8` : "text/markdown; charset=utf-8";

  const [resource] = await db
    .insert(resources)
    .values({
      ownerId: session.userId,
      conversationId,
      title,
      description: str(fields.description, MAX_DESCRIPTION_CHARS) || null,
      type: externalUrl ? "link" : "generated",
      visibility: resolveVisibility(session, fields.visibility),
      status: resolveStatus(session, fields.status),
      externalUrl: externalUrl || null,
      textContent: textContent || null,
      fileName: str(fields.fileName, 255) || null,
      mimeType,
      extension: str(fields.extension, 20) || null,
      tags: cleanTags(fields.tags),
    })
    .returning();

  return NextResponse.json(resource);
}

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Each user only sees their own files.
  // Project columns explicitly: binaryContentBase64/textContent can be many MB
  // per row - listing must never haul file bodies out of the database.
  const rows = await db
    .select({
      id: resources.id,
      ownerId: resources.ownerId,
      conversationId: resources.conversationId,
      title: resources.title,
      description: resources.description,
      type: resources.type,
      status: resources.status,
      visibility: resources.visibility,
      fileName: resources.fileName,
      mimeType: resources.mimeType,
      extension: resources.extension,
      sizeBytes: resources.sizeBytes,
      externalUrl: resources.externalUrl,
      tags: resources.tags,
      createdAt: resources.createdAt,
      updatedAt: resources.updatedAt,
    })
    .from(resources)
    .where(eq(resources.ownerId, session.userId))
    .orderBy(desc(resources.updatedAt))
    .limit(200);

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") || "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const conv = await resolveConversation(session, formData.get("conversationId"));
      if ("error" in conv) return conv.error;

      const file = formData.get("file");
      if (!(file instanceof File)) {
        const fields = Object.fromEntries(
          Array.from(formData.entries()).filter(([, v]) => typeof v === "string")
        );
        return createTextResource(session, fields, conv.id);
      }

      // Small server-side upload path: same type, size and signature rules
      // as the browser flow, stored privately under the owner's prefix
      const validation = validateUploadRequest({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        purpose: "resource",
      });
      if (!validation.ok) return bad(validation.error);

      const limited = await consumeBudgets(session.userId, ["upload_hour"]);
      if (limited) return rateLimitResponse(limited);

      const bytes = Buffer.from(await file.arrayBuffer());
      if (!matchesSignature(validation.rule.signature, bytes.subarray(0, SIGNATURE_BYTES))) {
        return bad("File contents do not match its type.");
      }

      const blob = await put(uploadPathname(session.userId, randomUUID(), file.name), bytes, {
        access: "private",
        addRandomSuffix: true,
        contentType: validation.mimeType,
      });

      const [resource] = await db
        .insert(resources)
        .values({
          ownerId: session.userId,
          conversationId: conv.id,
          title: str(formData.get("title"), MAX_TITLE_CHARS) || file.name.slice(0, MAX_TITLE_CHARS),
          description: str(formData.get("description"), MAX_DESCRIPTION_CHARS) || null,
          type: "upload",
          visibility: resolveVisibility(session, formData.get("visibility")),
          status: "draft",
          fileName: file.name.slice(0, 255),
          mimeType: validation.mimeType,
          extension: fileExtension(file.name) || null,
          sizeBytes: bytes.byteLength,
          textContent:
            validation.rule.signature === "text" && bytes.byteLength <= MAX_TEXT_CONTENT_CHARS
              ? bytes.toString("utf-8")
              : null,
          blobUrl: blob.url,
          tags: cleanTags(formData.get("tags")),
        })
        .returning();

      return NextResponse.json(resource);
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return bad("Invalid request.");

    if (body.binaryContentBase64) {
      return bad("Inline file content is not accepted. Upload the file instead.");
    }

    // File registration: only objects produced by our own upload flow
    if (body.intentId !== undefined || body.blobUrl !== undefined) {
      if (!body.intentId) {
        return bad("File location was not produced by this portal's upload flow.");
      }

      const conv = await resolveConversation(session, body.conversationId);
      if ("error" in conv) return conv.error;

      const verified = await verifyUploadIntent(session.userId, body.intentId, body.blobUrl);
      if (!verified.ok) return bad(verified.error, verified.status);

      const claimed = await claimUploadIntent(verified.intent.id, session.userId, verified.blobUrl);
      if (!claimed) return bad("This upload has already been used.", 409);

      const intent = verified.intent;
      const [resource] = await db
        .insert(resources)
        .values({
          ownerId: session.userId,
          conversationId: conv.id,
          title: str(body.title, MAX_TITLE_CHARS).trim() || intent.fileName.slice(0, MAX_TITLE_CHARS),
          description: str(body.description, MAX_DESCRIPTION_CHARS) || null,
          type: "upload",
          visibility: resolveVisibility(session, body.visibility),
          status: resolveStatus(session, body.status),
          fileName: intent.fileName,
          mimeType: intent.mimeType,
          extension: fileExtension(intent.fileName) || null,
          sizeBytes: verified.sizeBytes,
          blobUrl: verified.blobUrl,
          tags: cleanTags(body.tags),
        })
        .returning();

      await db
        .update(blobUploads)
        .set({ resourceId: resource.id })
        .where(eq(blobUploads.id, intent.id));

      return NextResponse.json(resource);
    }

    const conv = await resolveConversation(session, body.conversationId);
    if ("error" in conv) return conv.error;
    return createTextResource(session, body, conv.id);
  } catch (error) {
    console.error("Failed to create resource", error);
    return NextResponse.json(
      { error: "Failed to create resource" },
      { status: 500 }
    );
  }
}
