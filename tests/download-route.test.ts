import { beforeEach, describe, expect, it, vi } from "vitest";
import { PNG_BYTES, TEST_TOKEN, createDbMock, privateUrl, streamOf } from "./helpers/db-mock";

const dbMock = createDbMock();
const getSession = vi.fn();
const blobGet = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock.db }));
vi.mock("@/lib/auth", () => ({ getSession: () => getSession() }));
vi.mock("@vercel/blob", () => ({
  get: (...args: unknown[]) => blobGet(...args),
  head: vi.fn(),
  del: vi.fn(),
  put: vi.fn(),
}));

const { GET } = await import("@/app/api/resources/[id]/download/route");

const ID = "44444444-4444-4444-4444-444444444444";
const OWNER = "11111111-1111-1111-1111-111111111111";

function resourceRow(overrides: Record<string, unknown>) {
  return {
    id: ID,
    ownerId: OWNER,
    title: "file",
    fileName: "file.bin",
    mimeType: "application/octet-stream",
    visibility: "private",
    status: "draft",
    externalUrl: null,
    blobUrl: null,
    textContent: null,
    binaryContentBase64: null,
    ...overrides,
  };
}

async function call(row: Record<string, unknown>, inline = false) {
  dbMock.queue([row]);
  const url = `https://agents.gratitude.com/api/resources/${ID}/download${inline ? "?inline=1" : ""}`;
  return GET(new Request(url), { params: Promise.resolve({ id: ID }) });
}

function blobResult(bytes: Uint8Array | string, contentType: string) {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return {
    statusCode: 200,
    stream: streamOf(data),
    headers: new Headers(),
    blob: { contentType, size: data.byteLength },
  };
}

describe("download route type handling", () => {
  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = TEST_TOKEN;
    delete process.env.LEGACY_PUBLIC_BLOB_STORE_ID;
    dbMock.reset();
    blobGet.mockReset();
    getSession.mockResolvedValue({ userId: OWNER, email: "a@b.c", name: "A", role: "partner" });
  });

  it("requires a session", async () => {
    getSession.mockResolvedValueOnce(null);
    const res = await GET(new Request(`https://x/api/resources/${ID}/download`), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(401);
  });

  it("refuses resources the caller cannot view", async () => {
    const res = await call(resourceRow({ ownerId: "99999999-9999-9999-9999-999999999999" }));
    expect(res.status).toBe(403);
  });

  it("streams a private PNG inline when requested and bytes match", async () => {
    blobGet.mockResolvedValueOnce(blobResult(PNG_BYTES, "image/png"));
    const res = await call(resourceRow({ mimeType: "image/png", fileName: "a.png", blobUrl: privateUrl("uploads/a.png") }), true);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("location")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
    expect(blobGet.mock.calls[0][1]).toMatchObject({ access: "private" });
  });

  it("downloads a mislabeled 'image/png' that is really HTML", async () => {
    blobGet.mockResolvedValueOnce(blobResult("<html><script>alert(1)</script>", "image/png"));
    const res = await call(resourceRow({ mimeType: "image/png", blobUrl: privateUrl("uploads/x.png") }), true);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it.each(["text/html", "image/svg+xml", "application/xhtml+xml"])(
    "never serves %s inline, even with inline=1",
    async (mimeType) => {
      const res = await call(resourceRow({ mimeType, textContent: "<script>alert(1)</script>" }), true);
      expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toContain("sandbox");
    }
  );

  it("serves DOCX as an attachment with nosniff", async () => {
    const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    blobGet.mockResolvedValueOnce(blobResult(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), mime));
    const res = await call(resourceRow({ mimeType: mime, fileName: "a.docx", blobUrl: privateUrl("uploads/a.docx") }), true);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("content-type")).toBe(mime);
  });

  it("refuses to read blob URLs outside the configured stores", async () => {
    const res = await call(resourceRow({ blobUrl: "https://evil.example.com/steal" }));
    expect(res.status).toBe(404);
    expect(blobGet).not.toHaveBeenCalled();
  });

  it("does not redirect to non-http external links", async () => {
    const res = await call(resourceRow({ externalUrl: "javascript:alert(1)" }));
    expect(res.status).toBe(404);
  });
});
