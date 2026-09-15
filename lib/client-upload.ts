import { upload } from "@vercel/blob/client";

// Browser upload flow shared by the Files page and chat attachments:
// 1. ask the server for an upload intent (validates type/size, picks the key)
// 2. upload the file to private Vercel Blob with a token bound to that intent
// 3. register it; the server re-verifies the stored object before saving
export class PortalUploadError extends Error {}

async function errorMessage(res: Response, fallback: string) {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return data?.error || fallback;
}

export async function uploadFileToPortal<T = { id: string }>(
  file: File,
  purpose: "resource" | "chat",
  metadata: Record<string, unknown>
): Promise<T> {
  const intentRes = await fetch("/api/blob/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      purpose,
    }),
  });
  if (!intentRes.ok) {
    throw new PortalUploadError(await errorMessage(intentRes, `Upload failed for "${file.name}".`));
  }
  const intent = (await intentRes.json()) as {
    intentId: string;
    pathname: string;
    contentType: string;
  };

  const blob = await upload(intent.pathname, file, {
    access: "private",
    handleUploadUrl: "/api/blob/upload",
    clientPayload: intent.intentId,
    contentType: intent.contentType,
    multipart: file.size > 20 * 1024 * 1024,
  });

  const res = await fetch("/api/resources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...metadata, intentId: intent.intentId, blobUrl: blob.url }),
  });
  if (!res.ok) {
    throw new PortalUploadError(await errorMessage(res, `Upload failed for "${file.name}".`));
  }
  return (await res.json()) as T;
}
