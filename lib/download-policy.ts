import { matchesSignature, normalizeMime, signatureForMime } from "@/lib/upload-policy";

// Types the portal will render in the browser. Everything else downloads.
export const INLINE_SAFE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

// Types that can run script if a browser renders them on our origin. These are
// always sent as an opaque download, whatever the stored MIME type claims.
const ACTIVE_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "application/ecmascript",
  "text/xsl",
  "application/octet-stream",
  "",
]);

function contentDisposition(kind: "inline" | "attachment", fileName: string) {
  const ascii = fileName.replace(/[^\w.\- ]/g, "_").slice(0, 150) || "download";
  const encoded = encodeURIComponent(fileName.slice(0, 150));
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export interface DownloadHeaderInput {
  mimeType: string | null | undefined;
  fileName: string | null | undefined;
  inlineRequested: boolean;
  // Leading bytes of the object. Inline rendering requires the bytes to match
  // the declared type, so a mislabeled file never renders on our origin.
  headBytes?: Uint8Array | null;
}

export function buildDownloadHeaders(input: DownloadHeaderInput): {
  headers: Record<string, string>;
  inline: boolean;
} {
  const mime = normalizeMime(input.mimeType);
  const fileName = input.fileName || "download";

  let inline = false;
  if (input.inlineRequested && INLINE_SAFE_TYPES.has(mime)) {
    const sig = signatureForMime(mime);
    inline = Boolean(sig && input.headBytes && matchesSignature(sig, input.headBytes));
  }

  const contentType = inline
    ? mime
    : ACTIVE_TYPES.has(mime)
      ? "application/octet-stream"
      : mime.startsWith("text/")
        ? `${mime}; charset=utf-8`
        : mime;

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", fileName),
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    // Even if something does render, it gets no script, no network, no forms
    "Content-Security-Policy": inline
      ? "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'"
      : "default-src 'none'; sandbox; frame-ancestors 'none'",
    "Cache-Control": inline ? "private, max-age=3600" : "private, no-store",
  };

  return { headers, inline };
}
