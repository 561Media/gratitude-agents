import { del, get, head, type HeadBlobResult } from "@vercel/blob";

// Server-side access to the portal's Blob storage. Every read goes through
// here, and only URLs on OUR stores are ever touched: the private store
// (BLOB_READ_WRITE_TOKEN) and, until the migration finishes, the legacy public
// store (LEGACY_PUBLIC_BLOB_STORE_ID or LEGACY_PUBLIC_BLOB_READ_WRITE_TOKEN).
// No user-supplied URL is ever fetched.

export class BlobUrlNotAllowedError extends Error {
  constructor() {
    super("Blob URL is not on a configured store");
    this.name = "BlobUrlNotAllowedError";
  }
}

export class BlobTooLargeError extends Error {
  constructor(limit: number) {
    super(`Blob exceeds ${limit} bytes`);
    this.name = "BlobTooLargeError";
  }
}

// Token format: vercel_blob_rw_<storeId>_<secret> (the SDK splits on "_")
export function storeIdFromToken(token: string | null | undefined): string | null {
  if (!token || !token.startsWith("vercel_blob_rw_")) return null;
  const id = token.split("_")[3];
  return id ? id.toLowerCase() : null;
}

function normalizeStoreId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.replace(/^store_/i, "").toLowerCase() || null;
}

export function configuredStores(env: Record<string, string | undefined> = process.env) {
  return {
    privateStoreId:
      normalizeStoreId(env.BLOB_STORE_ID) || storeIdFromToken(env.BLOB_READ_WRITE_TOKEN),
    legacyPublicStoreId:
      normalizeStoreId(env.LEGACY_PUBLIC_BLOB_STORE_ID) ||
      storeIdFromToken(env.LEGACY_PUBLIC_BLOB_READ_WRITE_TOKEN),
  };
}

export interface BlobLocation {
  access: "private" | "public";
  storeId: string;
  url: string;
  pathname: string;
}

const HOST_RE = /^([a-z0-9]+)\.(private|public)\.blob\.vercel-storage\.com$/;

export function classifyBlobUrl(
  rawUrl: string | null | undefined,
  stores = configuredStores()
): BlobLocation | null {
  if (!rawUrl) return null;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const m = u.hostname.toLowerCase().match(HOST_RE);
  if (!m) return null;
  const [, storeId, access] = m;
  if (access === "private" && storeId !== stores.privateStoreId) return null;
  if (access === "public" && storeId !== stores.legacyPublicStoreId) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
  return {
    access: access as "private" | "public",
    storeId,
    url: `${u.origin}${u.pathname}`,
    pathname,
  };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// Read the first n bytes of a stream and hand back an equivalent stream that
// still yields every byte, so a response can be type-checked before streaming.
export async function peekStream(stream: ReadableStream<Uint8Array>, n: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let finished = false;
  while (total < n) {
    const r = await reader.read();
    if (r.done) {
      finished = true;
      break;
    }
    chunks.push(r.value);
    total += r.value.byteLength;
  }
  const headBytes = concat(chunks).subarray(0, n);
  const rest = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      if (finished) controller.close();
    },
    async pull(controller) {
      const r = await reader.read();
      if (r.done) controller.close();
      else controller.enqueue(r.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { head: headBytes, stream: rest };
}

export interface OpenedBlob {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
}

// Open a blob for streaming. The timeout covers reaching storage and getting
// response headers; the body then streams at the client's pace.
export async function openBlob(
  url: string,
  options: { timeoutMs?: number; headers?: HeadersInit } = {}
): Promise<OpenedBlob | null> {
  const loc = classifyBlobUrl(url);
  if (!loc) throw new BlobUrlNotAllowedError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    const result = await get(loc.url, {
      access: loc.access,
      abortSignal: controller.signal,
      headers: options.headers,
    });
    if (!result || result.statusCode !== 200) return null;
    return {
      stream: result.stream,
      contentType: result.blob.contentType,
      size: result.blob.size,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Read a whole blob into memory with a hard byte cap and an end-to-end timeout.
export async function readBlobBytes(
  url: string,
  options: { maxBytes: number; timeoutMs?: number }
): Promise<Uint8Array | null> {
  const loc = classifyBlobUrl(url);
  if (!loc) throw new BlobUrlNotAllowedError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    const result = await get(loc.url, { access: loc.access, abortSignal: controller.signal });
    if (!result || result.statusCode !== 200) return null;
    if (result.blob.size > options.maxBytes) {
      await result.stream.cancel().catch(() => {});
      throw new BlobTooLargeError(options.maxBytes);
    }
    const reader = result.stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      total += r.value.byteLength;
      if (total > options.maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BlobTooLargeError(options.maxBytes);
      }
      chunks.push(r.value);
    }
    return concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

export async function readBlobHeadBytes(url: string, n: number): Promise<Uint8Array> {
  const opened = await openBlob(url, { headers: { Range: `bytes=0-${n - 1}` } });
  if (!opened) return new Uint8Array();
  const { head: headBytes, stream } = await peekStream(opened.stream, n);
  await stream.cancel().catch(() => {});
  return headBytes;
}

// Metadata for a blob on the private store only (null if missing or foreign)
export async function headPrivateBlob(url: string): Promise<HeadBlobResult | null> {
  const loc = classifyBlobUrl(url);
  if (!loc || loc.access !== "private") return null;
  try {
    return await head(loc.url);
  } catch (error) {
    if (error instanceof Error && error.name === "BlobNotFoundError") return null;
    throw error;
  }
}

// Delete a blob we own. Never throws: a failed delete is logged so the caller
// can finish removing the database row.
export async function deleteStoredBlob(url: string | null | undefined): Promise<boolean> {
  const loc = classifyBlobUrl(url);
  if (!loc) {
    if (url) console.warn("Skipping delete of blob on an unconfigured store");
    return false;
  }
  try {
    if (loc.access === "private") {
      await del(loc.url);
      return true;
    }
    const legacyToken = process.env.LEGACY_PUBLIC_BLOB_READ_WRITE_TOKEN;
    if (!legacyToken) {
      console.warn("Legacy public blob not deleted: LEGACY_PUBLIC_BLOB_READ_WRITE_TOKEN is not set");
      return false;
    }
    await del(loc.url, { token: legacyToken });
    return true;
  } catch (error) {
    console.error("Blob delete failed:", error);
    return false;
  }
}
