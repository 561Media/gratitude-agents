import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resources } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { canViewResource } from "@/lib/permissions";
import { BlobUrlNotAllowedError, openBlob, peekStream } from "@/lib/blob-store";
import { buildDownloadHeaders } from "@/lib/download-policy";
import { SIGNATURE_BYTES } from "@/lib/upload-policy";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Authorized file delivery. Blob objects are private: this route checks the
// caller's permission on every request, then streams the bytes itself. No
// storage URL ever reaches the browser. Only png/jpeg/webp/gif/pdf whose bytes
// match their type render inline; everything else downloads with nosniff.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [resource] = await db.select().from(resources).where(eq(resources.id, id));

  if (!resource) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!canViewResource(session, resource)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const inlineRequested = new URL(request.url).searchParams.get("inline") === "1";
  const fileName = resource.fileName || resource.title || "download";

  if (resource.externalUrl) {
    // Saved links only; never script or data URLs
    if (/^https?:\/\//i.test(resource.externalUrl)) {
      return NextResponse.redirect(resource.externalUrl);
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (resource.blobUrl) {
    let opened;
    try {
      opened = await openBlob(resource.blobUrl, { timeoutMs: 15000 });
    } catch (error) {
      if (error instanceof BlobUrlNotAllowedError) {
        console.error(`Resource ${resource.id} points at an unconfigured blob store`);
        return NextResponse.json({ error: "File unavailable" }, { status: 404 });
      }
      console.error("Blob read failed:", error);
      return NextResponse.json({ error: "File unavailable" }, { status: 502 });
    }

    if (!opened) {
      return NextResponse.json({ error: "File unavailable" }, { status: 404 });
    }

    const { head, stream } = await peekStream(opened.stream, SIGNATURE_BYTES);
    const { headers } = buildDownloadHeaders({
      mimeType: resource.mimeType || opened.contentType,
      fileName,
      inlineRequested,
      headBytes: head,
    });
    if (opened.size) headers["Content-Length"] = String(opened.size);

    return new Response(stream, { headers });
  }

  const body = resource.binaryContentBase64
    ? Buffer.from(resource.binaryContentBase64, "base64")
    : Buffer.from(resource.textContent || "", "utf-8");

  const { headers } = buildDownloadHeaders({
    mimeType: resource.mimeType,
    fileName,
    inlineRequested,
    headBytes: body.subarray(0, SIGNATURE_BYTES),
  });

  return new Response(new Uint8Array(body), { headers });
}
