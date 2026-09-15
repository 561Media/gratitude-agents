import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { blobUploads } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { uploadPathname, validateUploadRequest } from "@/lib/upload-policy";
import { consumeBudgets, rateLimitResponse } from "@/lib/rate-limit";
import { INTENT_TTL_MS } from "@/lib/resource-uploads";

// Step 1 of a browser upload. The server validates the declared file, picks
// the object key, and records a one-time intent. The browser then asks
// /api/blob/upload for a token bound to that intent, uploads, and registers
// the result with POST /api/resources { intentId, blobUrl }.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    fileName?: unknown;
    mimeType?: unknown;
    sizeBytes?: unknown;
    purpose?: unknown;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const purpose = body.purpose === "chat" ? "chat" : "resource";
  const validation = validateUploadRequest({
    fileName: body.fileName,
    mimeType: body.mimeType,
    sizeBytes: body.sizeBytes,
    purpose,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const limited = await consumeBudgets(session.userId, ["upload_hour"]);
  if (limited) return rateLimitResponse(limited);

  const intentId = randomUUID();
  const pathname = uploadPathname(session.userId, intentId, validation.fileName);

  await db.insert(blobUploads).values({
    id: intentId,
    userId: session.userId,
    purpose,
    pathname,
    fileName: validation.fileName,
    mimeType: validation.mimeType,
    maxBytes: validation.maxBytes,
    expiresAt: new Date(Date.now() + INTENT_TTL_MS),
  });

  return NextResponse.json({
    intentId,
    pathname,
    contentType: validation.mimeType,
    maxBytes: validation.maxBytes,
  });
}
