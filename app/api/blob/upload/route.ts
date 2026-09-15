import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { db } from "@/lib/db";
import { blobUploads } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { isPathnameForIntent } from "@/lib/upload-policy";
import { INTENT_TTL_MS, isUuid } from "@/lib/resource-uploads";

// Token exchange for browser -> private Vercel Blob uploads (bypasses the
// ~4.5MB serverless body cap). A token is issued only for an unused intent
// the caller owns (see /api/blob/intent): exact server-chosen pathname, the
// intent's MIME type, and the intent's size cap. The resource row is created
// later by POST /api/resources, which re-verifies the stored object.
export async function POST(request: Request) {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Completion callbacks come from Vercel Blob (handleUpload verifies their
  // signature), not from a browser session. Note: middleware currently
  // requires a session cookie on this path, so callbacks are only recorded
  // once the auth workstream exempts it. Resource creation does not depend
  // on the callback.
  const isCompletion = body.type === "blob.upload-completed";
  const session = isCompletion ? null : await getSession();
  if (!isCompletion && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!session) throw new Error("Unauthorized");
        if (!isUuid(clientPayload)) throw new Error("Missing upload reference");

        const [intent] = await db
          .select()
          .from(blobUploads)
          .where(and(eq(blobUploads.id, clientPayload), eq(blobUploads.userId, session.userId)))
          .limit(1);

        if (!intent || intent.status !== "pending") throw new Error("Upload not allowed");
        const expires = new Date(intent.expiresAt).getTime();
        if (expires < Date.now()) throw new Error("Upload intent expired");
        if (pathname !== intent.pathname) throw new Error("Pathname mismatch");

        return {
          allowedContentTypes: [intent.mimeType],
          maximumSizeInBytes: intent.maxBytes,
          addRandomSuffix: true,
          allowOverwrite: false,
          validUntil: Math.min(expires, Date.now() + INTENT_TTL_MS),
          tokenPayload: JSON.stringify({ intentId: intent.id, userId: session.userId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let payload: { intentId?: unknown; userId?: unknown } = {};
        try {
          payload = JSON.parse(tokenPayload || "{}");
        } catch {
          return;
        }
        if (!isUuid(payload.intentId) || !isUuid(payload.userId)) return;
        if (!isPathnameForIntent(blob.pathname, payload.userId, payload.intentId)) return;

        await db
          .update(blobUploads)
          .set({ status: "uploaded", blobUrl: blob.url, completedAt: new Date() })
          .where(
            and(
              eq(blobUploads.id, payload.intentId),
              eq(blobUploads.userId, payload.userId),
              eq(blobUploads.status, "pending")
            )
          );
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error("Blob upload token error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 400 });
  }
}
