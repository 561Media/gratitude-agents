import { describe, expect, it } from "vitest";
import {
  isPathnameForIntent,
  matchesSignature,
  resolveUploadType,
  sniffImageType,
  uploadPathname,
  validateUploadRequest,
} from "@/lib/upload-policy";

const MB = 1024 * 1024;
const enc = (s: string) => new TextEncoder().encode(s);

describe("validateUploadRequest", () => {
  it("accepts an allowed type and returns the canonical MIME", () => {
    const r = validateUploadRequest({ fileName: "deck.pdf", mimeType: "application/pdf", sizeBytes: 1000, purpose: "resource" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mimeType).toBe("application/pdf");
  });

  it.each([
    ["payload.exe", "application/x-msdownload"],
    ["page.html", "text/html"],
    ["script.js", "text/javascript"],
    ["noext", "application/octet-stream"],
  ])("rejects disallowed file %s", (fileName, mimeType) => {
    expect(validateUploadRequest({ fileName, mimeType, sizeBytes: 10, purpose: "resource" }).ok).toBe(false);
  });

  it("rejects a MIME type that contradicts the extension", () => {
    expect(resolveUploadType("photo.png", "text/html")).toBeNull();
    expect(validateUploadRequest({ fileName: "photo.png", mimeType: "text/html", sizeBytes: 10, purpose: "resource" }).ok).toBe(false);
  });

  it("accepts a generic browser MIME when the extension is allowed", () => {
    expect(resolveUploadType("notes.md", "")?.id).toBe("md");
    expect(resolveUploadType("data.csv", "application/vnd.ms-excel")?.id).toBe("csv");
  });

  it("enforces per-type and per-purpose size caps", () => {
    expect(validateUploadRequest({ fileName: "a.png", mimeType: "image/png", sizeBytes: 21 * MB, purpose: "resource" }).ok).toBe(false);
    expect(validateUploadRequest({ fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 30 * MB, purpose: "resource" }).ok).toBe(true);
    expect(validateUploadRequest({ fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 30 * MB, purpose: "chat" }).ok).toBe(false);
    expect(validateUploadRequest({ fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 0, purpose: "chat" }).ok).toBe(false);
  });
});

describe("byte signatures", () => {
  it("recognises real headers", () => {
    expect(matchesSignature("png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(matchesSignature("jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(matchesSignature("gif", enc("GIF89a...."))).toBe(true);
    expect(matchesSignature("webp", enc("RIFF\0\0\0\0WEBPVP8 "))).toBe(true);
    expect(matchesSignature("pdf", enc("%PDF-1.7\n"))).toBe(true);
    expect(matchesSignature("zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe(true);
    expect(matchesSignature("text", enc("# heading\nbody"))).toBe(true);
  });

  it("rejects mislabeled content", () => {
    expect(matchesSignature("png", enc("<html><script>alert(1)</script>"))).toBe(false);
    expect(matchesSignature("pdf", enc("<svg onload=alert(1)>"))).toBe(false);
    // A DOCX must be a zip container
    expect(matchesSignature("zip", enc("<html>"))).toBe(false);
    expect(matchesSignature("text", new Uint8Array([0x4d, 0x5a, 0x00, 0x00]))).toBe(false);
    expect(sniffImageType(enc("<svg/>"))).toBeNull();
  });
});

describe("server-chosen pathnames", () => {
  const user = "11111111-1111-1111-1111-111111111111";
  const intent = "22222222-2222-2222-2222-222222222222";

  it("puts uploads under the owner's intent prefix with a safe name", () => {
    const p = uploadPathname(user, intent, "../../etc/My Deck (final).pdf");
    expect(p).toBe(`uploads/${user}/${intent}/My-Deck-_final_.pdf`);
    expect(isPathnameForIntent(`${p.replace(".pdf", "")}-AbC123.pdf`, user, intent)).toBe(true);
  });

  it("rejects pathnames for another user or intent", () => {
    expect(isPathnameForIntent(`uploads/other/${intent}/a.pdf`, user, intent)).toBe(false);
    expect(isPathnameForIntent(`uploads/${user}/33333333-3333-3333-3333-333333333333/a.pdf`, user, intent)).toBe(false);
  });
});
