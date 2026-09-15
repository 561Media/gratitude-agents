import { beforeEach, describe, expect, it, vi } from "vitest";
import { PNG_BYTES, TEST_TOKEN, createDbMock, privateUrl, streamOf } from "./helpers/db-mock";

const dbMock = createDbMock();
const getSession = vi.fn();
const blobHead = vi.fn();
const blobGet = vi.fn();
const blobDel = vi.fn();

vi.mock("@/lib/db", () => ({ db: dbMock.db }));
vi.mock("@/lib/auth", () => ({ getSession: () => getSession() }));
vi.mock("@vercel/blob", () => ({
  head: (...a: unknown[]) => blobHead(...a),
  get: (...a: unknown[]) => blobGet(...a),
  del: (...a: unknown[]) => blobDel(...a),
  put: vi.fn(),
}));

const { verifyUploadIntent } = await import("@/lib/resource-uploads");
const { POST } = await import("@/app/api/resources/route");

const USER = "11111111-1111-1111-1111-111111111111";
const INTENT = "22222222-2222-2222-2222-222222222222";
const PATH = `uploads/${USER}/${INTENT}/photo-Xy12.png`;

const intentRow = (overrides: Record<string, unknown> = {}) => ({
  id: INTENT,
  userId: USER,
  purpose: "resource",
  pathname: `uploads/${USER}/${INTENT}/photo.png`,
  fileName: "photo.png",
  mimeType: "image/png",
  maxBytes: 20 * 1024 * 1024,
  status: "pending",
  blobUrl: null,
  resourceId: null,
  expiresAt: new Date(Date.now() + 60_000),
  completedAt: null,
  createdAt: new Date(),
  ...overrides,
});

function jsonRequest(body: unknown) {
  return new Request("https://agents.gratitude.com/api/resources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("upload verification", () => {
  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = TEST_TOKEN;
    dbMock.reset();
    [blobHead, blobGet, blobDel].forEach((m) => m.mockReset());
    getSession.mockResolvedValue({ userId: USER, email: "a@b.c", name: "A", role: "employee" });
  });

  it("rejects a foreign blobUrl without touching storage", async () => {
    dbMock.queue([intentRow()]);
    const r = await verifyUploadIntent(USER, INTENT, "https://attacker.example.com/photo.png");
    expect(r.ok).toBe(false);
    expect(blobHead).not.toHaveBeenCalled();
  });

  it("rejects a blob on a different Vercel Blob store", async () => {
    dbMock.queue([intentRow()]);
    const r = await verifyUploadIntent(USER, INTENT, `https://otherstore.private.blob.vercel-storage.com/${PATH}`);
    expect(r.ok).toBe(false);
    expect(blobHead).not.toHaveBeenCalled();
  });

  it("rejects a legacy public URL", async () => {
    process.env.LEGACY_PUBLIC_BLOB_STORE_ID = "oldpublic";
    dbMock.queue([intentRow()]);
    const r = await verifyUploadIntent(USER, INTENT, `https://oldpublic.public.blob.vercel-storage.com/${PATH}`);
    expect(r.ok).toBe(false);
    delete process.env.LEGACY_PUBLIC_BLOB_STORE_ID;
  });

  it("rejects an object outside the intent's key prefix", async () => {
    dbMock.queue([intentRow()]);
    blobHead.mockResolvedValueOnce({ pathname: `uploads/${USER}/someone-else/photo.png`, size: 10, url: privateUrl("x") });
    const r = await verifyUploadIntent(USER, INTENT, privateUrl(`uploads/${USER}/someone-else/photo.png`));
    expect(r.ok).toBe(false);
  });

  it("rejects and deletes a file whose bytes do not match its type", async () => {
    dbMock.queue([intentRow()], []);
    blobHead.mockResolvedValueOnce({ pathname: PATH, size: 30, url: privateUrl(PATH) });
    blobGet.mockResolvedValueOnce({
      statusCode: 200,
      stream: streamOf("<html><script>alert(1)</script>"),
      headers: new Headers(),
      blob: { contentType: "image/png", size: 30 },
    });
    const r = await verifyUploadIntent(USER, INTENT, privateUrl(PATH));
    expect(r).toMatchObject({ ok: false, error: "File contents do not match its type." });
    expect(blobDel).toHaveBeenCalledWith(privateUrl(PATH));
    expect(dbMock.db.update).toHaveBeenCalled();
  });

  it("rejects an intent that was already used", async () => {
    dbMock.queue([intentRow({ status: "linked" })]);
    const r = await verifyUploadIntent(USER, INTENT, privateUrl(PATH));
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it("accepts a matching PNG on our private store", async () => {
    dbMock.queue([intentRow()]);
    blobHead.mockResolvedValueOnce({ pathname: PATH, size: PNG_BYTES.byteLength, url: privateUrl(PATH) });
    blobGet.mockResolvedValueOnce({
      statusCode: 200,
      stream: streamOf(PNG_BYTES),
      headers: new Headers(),
      blob: { contentType: "image/png", size: PNG_BYTES.byteLength },
    });
    const r = await verifyUploadIntent(USER, INTENT, privateUrl(PATH));
    expect(r.ok).toBe(true);
    expect(blobDel).not.toHaveBeenCalled();
  });
});

describe("POST /api/resources", () => {
  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = TEST_TOKEN;
    dbMock.reset();
    getSession.mockResolvedValue({ userId: USER, email: "a@b.c", name: "A", role: "employee" });
  });

  it("rejects an arbitrary blobUrl with no upload intent", async () => {
    const res = await POST(jsonRequest({ title: "x", blobUrl: "https://attacker.example.com/a.html", mimeType: "text/html" }));
    expect(res.status).toBe(400);
    expect(dbMock.db.insert).not.toHaveBeenCalled();
  });

  it("rejects inline base64 file bodies", async () => {
    const res = await POST(jsonRequest({ title: "x", binaryContentBase64: "PGh0bWw+" }));
    expect(res.status).toBe(400);
  });

  it("rejects linking to a conversation the caller cannot write", async () => {
    dbMock.queue([{ id: INTENT, ownerId: "99999999-9999-9999-9999-999999999999", visibility: "private" }]);
    getSession.mockResolvedValueOnce({ userId: USER, email: "a@b.c", name: "A", role: "partner" });
    const res = await POST(jsonRequest({ title: "x", textContent: "hi", conversationId: INTENT }));
    expect(res.status).toBe(403);
  });

  it("rejects non-http links", async () => {
    const res = await POST(jsonRequest({ title: "x", externalUrl: "javascript:alert(1)" }));
    expect(res.status).toBe(400);
  });
});
