import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { blobUploads, type BlobUpload } from "@/db/schema";
import {
  classifyBlobUrl,
  deleteStoredBlob,
  headPrivateBlob,
  readBlobHeadBytes,
} from "@/lib/blob-store";
import {
  SIGNATURE_BYTES,
  isPathnameForIntent,
  matchesSignature,
  resolveUploadType,
} from "@/lib/upload-policy";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// A client token can be requested for 30 minutes after the intent is created;
// large uploads then have a further grace window to be registered.
export const INTENT_TTL_MS = 30 * 60 * 1000;
export const LINK_GRACE_MS = 6 * 60 * 60 * 1000;

export type VerifyResult =
  | { ok: true; intent: BlobUpload; blobUrl: string; sizeBytes: number }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): VerifyResult => ({ ok: false, status, error });

// Confirm that a finished upload is exactly what the server authorised: an
// unused intent owned by this user, an object on our private store under the
// intent's key prefix, within the size cap, with bytes matching the type.
// Anything else is rejected, and a bad object is deleted.
export async function verifyUploadIntent(
  userId: string,
  intentId: unknown,
  claimedUrl: unknown
): Promise<VerifyResult> {
  if (!isUuid(intentId)) {
    return fail(400, "File location was not produced by this portal's upload flow.");
  }

  const [intent] = await db
    .select()
    .from(blobUploads)
    .where(and(eq(blobUploads.id, intentId), eq(blobUploads.userId, userId)))
    .limit(1);

  if (!intent) return fail(404, "Upload not found.");
  if (intent.status !== "pending" && intent.status !== "uploaded") {
    return fail(409, "This upload has already been used.");
  }
  if (new Date(intent.expiresAt).getTime() + LINK_GRACE_MS < Date.now()) {
    return fail(410, "This upload has expired. Please upload the file again.");
  }

  const url = typeof claimedUrl === "string" && claimedUrl ? claimedUrl : intent.blobUrl;
  if (!url) return fail(400, "Upload is not complete.");

  const loc = classifyBlobUrl(url);
  if (!loc || loc.access !== "private") {
    return fail(400, "File location was not produced by this portal's upload flow.");
  }

  const meta = await headPrivateBlob(loc.url);
  if (!meta) return fail(400, "Uploaded file was not found in storage.");
  if (!isPathnameForIntent(meta.pathname, userId, intent.id)) {
    return fail(400, "File location does not match this upload.");
  }

  const rule = resolveUploadType(intent.fileName, intent.mimeType);
  let problem: string | null = null;
  if (!rule) {
    problem = "This file type is not allowed.";
  } else if (meta.size > intent.maxBytes) {
    problem = "File is larger than allowed.";
  } else {
    const headBytes = await readBlobHeadBytes(loc.url, SIGNATURE_BYTES);
    if (!matchesSignature(rule.signature, headBytes)) {
      problem = "File contents do not match its type.";
    }
  }

  if (problem) {
    await deleteStoredBlob(loc.url);
    await db
      .update(blobUploads)
      .set({ status: "rejected", blobUrl: loc.url, completedAt: new Date() })
      .where(eq(blobUploads.id, intent.id));
    return fail(400, problem);
  }

  return { ok: true, intent, blobUrl: meta.url, sizeBytes: meta.size };
}

// Atomically mark the intent as used, so one upload can back only one resource
export async function claimUploadIntent(intentId: string, userId: string, blobUrl: string) {
  const rows = await db
    .update(blobUploads)
    .set({ status: "linked", blobUrl, completedAt: new Date() })
    .where(
      and(
        eq(blobUploads.id, intentId),
        eq(blobUploads.userId, userId),
        inArray(blobUploads.status, ["pending", "uploaded"])
      )
    )
    .returning({ id: blobUploads.id });
  return rows.length === 1;
}
