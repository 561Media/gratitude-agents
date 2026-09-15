// Upload policy: which files the portal accepts, how big they may be, and
// how to confirm the bytes match the declared type. Pure functions only (no
// I/O) so the rules are unit-tested and shared by every upload path.

export type UploadPurpose = "resource" | "chat";

export type SignatureKind =
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "pdf"
  | "zip"
  | "ole"
  | "isobmff"
  | "text";

export interface UploadTypeRule {
  id: string;
  // First entry is the canonical MIME type stored on the resource row
  mimes: string[];
  extensions: string[];
  signature: SignatureKind;
  maxBytes: number;
}

const MB = 1024 * 1024;

function envBytes(name: string, fallback: number) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const UPLOAD_MAX_BYTES = () => envBytes("UPLOAD_MAX_BYTES", 100 * MB);
export const CHAT_ATTACHMENT_MAX_BYTES = () =>
  envBytes("CHAT_ATTACHMENT_MAX_BYTES", 25 * MB);

export const UPLOAD_TYPE_RULES: UploadTypeRule[] = [
  { id: "png", mimes: ["image/png"], extensions: ["png"], signature: "png", maxBytes: 20 * MB },
  { id: "jpeg", mimes: ["image/jpeg", "image/jpg", "image/pjpeg"], extensions: ["jpg", "jpeg"], signature: "jpeg", maxBytes: 20 * MB },
  { id: "gif", mimes: ["image/gif"], extensions: ["gif"], signature: "gif", maxBytes: 20 * MB },
  { id: "webp", mimes: ["image/webp"], extensions: ["webp"], signature: "webp", maxBytes: 20 * MB },
  // SVG is accepted as a file but is never served inline or sent to the model
  { id: "svg", mimes: ["image/svg+xml"], extensions: ["svg"], signature: "text", maxBytes: 5 * MB },
  { id: "pdf", mimes: ["application/pdf"], extensions: ["pdf"], signature: "pdf", maxBytes: 100 * MB },
  { id: "docx", mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], extensions: ["docx"], signature: "zip", maxBytes: 50 * MB },
  { id: "pptx", mimes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], extensions: ["pptx"], signature: "zip", maxBytes: 100 * MB },
  { id: "xlsx", mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], extensions: ["xlsx"], signature: "zip", maxBytes: 50 * MB },
  { id: "key", mimes: ["application/vnd.apple.keynote", "application/x-iwork-keynote-sffkey", "application/zip"], extensions: ["key"], signature: "zip", maxBytes: 100 * MB },
  { id: "doc", mimes: ["application/msword"], extensions: ["doc"], signature: "ole", maxBytes: 50 * MB },
  { id: "ppt", mimes: ["application/vnd.ms-powerpoint"], extensions: ["ppt"], signature: "ole", maxBytes: 100 * MB },
  { id: "xls", mimes: ["application/vnd.ms-excel"], extensions: ["xls"], signature: "ole", maxBytes: 50 * MB },
  { id: "md", mimes: ["text/markdown", "text/x-markdown", "text/plain"], extensions: ["md", "markdown"], signature: "text", maxBytes: 10 * MB },
  { id: "txt", mimes: ["text/plain"], extensions: ["txt"], signature: "text", maxBytes: 10 * MB },
  // Windows browsers often report CSV as application/vnd.ms-excel
  { id: "csv", mimes: ["text/csv", "application/vnd.ms-excel", "text/plain"], extensions: ["csv"], signature: "text", maxBytes: 10 * MB },
  { id: "mp4", mimes: ["video/mp4"], extensions: ["mp4"], signature: "isobmff", maxBytes: 100 * MB },
  { id: "mov", mimes: ["video/quicktime"], extensions: ["mov"], signature: "isobmff", maxBytes: 100 * MB },
];

// Browsers send an empty or generic type for files they do not recognise;
// the extension then decides, and the byte signature must still match.
const GENERIC_MIMES = new Set(["", "application/octet-stream"]);

export function normalizeMime(mime: string | null | undefined): string {
  return (mime || "").split(";")[0].trim().toLowerCase();
}

export function fileExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function safeFileName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() || "file").normalize("NFKC");
  const cleaned = base
    .replace(/[^\w.\- ]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .slice(-120);
  return cleaned || "file";
}

export function resolveUploadType(
  fileName: string,
  mimeType: string | null | undefined
): UploadTypeRule | null {
  const ext = fileExtension(fileName);
  const mime = normalizeMime(mimeType);
  const rule = UPLOAD_TYPE_RULES.find((r) => r.extensions.includes(ext));
  if (!rule) return null;
  if (GENERIC_MIMES.has(mime) || rule.mimes.includes(mime)) return rule;
  return null;
}

export type UploadValidation =
  | { ok: true; rule: UploadTypeRule; mimeType: string; maxBytes: number; fileName: string }
  | { ok: false; error: string };

export function validateUploadRequest(input: {
  fileName: unknown;
  mimeType: unknown;
  sizeBytes: unknown;
  purpose: UploadPurpose;
}): UploadValidation {
  if (typeof input.fileName !== "string" || !input.fileName.trim()) {
    return { ok: false, error: "A file name is required." };
  }
  if (input.fileName.length > 255) {
    return { ok: false, error: "File name is too long." };
  }
  const rule = resolveUploadType(
    input.fileName,
    typeof input.mimeType === "string" ? input.mimeType : ""
  );
  if (!rule) {
    return { ok: false, error: "This file type is not allowed." };
  }
  const size = Number(input.sizeBytes);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "File size is missing or invalid." };
  }
  const purposeCap =
    input.purpose === "chat" ? CHAT_ATTACHMENT_MAX_BYTES() : UPLOAD_MAX_BYTES();
  const maxBytes = Math.min(rule.maxBytes, purposeCap);
  if (size > maxBytes) {
    return {
      ok: false,
      error: `File is too large. The limit for this type is ${Math.floor(maxBytes / MB)}MB.`,
    };
  }
  return {
    ok: true,
    rule,
    mimeType: rule.mimes[0],
    maxBytes,
    fileName: input.fileName,
  };
}

// Number of leading bytes needed to check any signature
export const SIGNATURE_BYTES = 512;

function startsWith(bytes: Uint8Array, sig: number[], offset = 0) {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

export function matchesSignature(kind: SignatureKind, bytes: Uint8Array): boolean {
  switch (kind) {
    case "png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "gif":
      return ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a";
    case "webp":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
    case "pdf":
      // %PDF- may follow a short preamble; spec readers scan the first 1024 bytes
      return ascii(bytes, 0, Math.min(bytes.length, SIGNATURE_BYTES)).includes("%PDF-");
    case "zip":
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case "ole":
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case "isobmff": {
      const box = ascii(bytes, 4, 8);
      return ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(box);
    }
    case "text": {
      if (bytes.length === 0) return true;
      // Binary files almost always contain NUL bytes near the start
      for (const b of bytes) if (b === 0) return false;
      return true;
    }
  }
}

// Detect a model-safe raster image type from bytes (never trusts metadata)
export function sniffImageType(
  bytes: Uint8Array
): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null {
  if (matchesSignature("png", bytes)) return "image/png";
  if (matchesSignature("jpeg", bytes)) return "image/jpeg";
  if (matchesSignature("gif", bytes)) return "image/gif";
  if (matchesSignature("webp", bytes)) return "image/webp";
  return null;
}

export function signatureForMime(mime: string): SignatureKind | null {
  const m = normalizeMime(mime);
  const rule = UPLOAD_TYPE_RULES.find((r) => r.mimes[0] === m);
  return rule ? rule.signature : null;
}

// Server-chosen object keys: every upload lives under the owner's prefix and
// a one-time intent id, so a finished blob can be tied back to who asked for it.
export function uploadPrefix(userId: string, intentId: string) {
  return `uploads/${userId}/${intentId}/`;
}

export function uploadPathname(userId: string, intentId: string, fileName: string) {
  return `${uploadPrefix(userId, intentId)}${safeFileName(fileName)}`;
}

export function isPathnameForIntent(pathname: string, userId: string, intentId: string) {
  return pathname.startsWith(uploadPrefix(userId, intentId)) && !pathname.includes("..");
}
