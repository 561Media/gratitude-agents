#!/usr/bin/env node
// Move resource files from the legacy PUBLIC Vercel Blob store to the PRIVATE
// store, one row at a time. DRY RUN BY DEFAULT: nothing is written without
// --apply. Do not run until reviewed.
//
// For each resources row whose blob_url is on the legacy public store:
//   1. download the public object and hash it
//   2. put a copy on the private store (uploads kept under migrated/<owner>/<id>/)
//   3. read the private copy back and confirm size + sha256 match
//   4. UPDATE resources.blob_url, guarded on the old value (no lost updates)
//   5. re-read the row to confirm the new URL is stored
//   6. only then delete the public copy (skip with --keep-public)
// A failure before step 4 deletes the new private copy; the row is untouched.
//
// Env (read from .env.local, or the shell):
//   DATABASE_URL                          target database
//   PRIVATE_BLOB_READ_WRITE_TOKEN         private store token (falls back to BLOB_READ_WRITE_TOKEN)
//   LEGACY_PUBLIC_BLOB_READ_WRITE_TOKEN   public store token (needed to delete public copies)
//
// Usage:
//   node scripts/migrate-blobs-to-private.mjs                  # dry run, all rows
//   node scripts/migrate-blobs-to-private.mjs --limit 5        # dry run, first 5
//   node scripts/migrate-blobs-to-private.mjs --apply --limit 1
//   node scripts/migrate-blobs-to-private.mjs --apply --id <resource uuid>
//   node scripts/migrate-blobs-to-private.mjs --apply --keep-public
//   --log <path>   JSON log location (default output/blob-migration-<timestamp>.json)

import { config } from "dotenv";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { neon } from "@neondatabase/serverless";
import { del, get, put } from "@vercel/blob";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const APPLY = flag("--apply");
const KEEP_PUBLIC = flag("--keep-public");
const LIMIT = option("--limit") ? Number(option("--limit")) : null;
const ONLY_ID = option("--id") || null;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const LOG_PATH = option("--log") || `output/blob-migration-${stamp}.json`;

const DATABASE_URL = process.env.DATABASE_URL;
const PRIVATE_TOKEN = process.env.PRIVATE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
const PUBLIC_TOKEN = process.env.LEGACY_PUBLIC_BLOB_READ_WRITE_TOKEN;

const storeIdFromToken = (token) =>
  token && token.startsWith("vercel_blob_rw_") ? (token.split("_")[3] || "").toLowerCase() : null;

function die(message) {
  console.error(`STOP: ${message}`);
  process.exit(1);
}

if (!DATABASE_URL) die("DATABASE_URL is not set");
if (!PRIVATE_TOKEN) die("PRIVATE_BLOB_READ_WRITE_TOKEN (or BLOB_READ_WRITE_TOKEN) is not set");
if (LIMIT !== null && !(LIMIT > 0)) die("--limit must be a positive number");
if (ONLY_ID && !/^[0-9a-f-]{36}$/i.test(ONLY_ID)) die("--id must be a resource uuid");

const privateStore = storeIdFromToken(PRIVATE_TOKEN);
const publicStore = storeIdFromToken(PUBLIC_TOKEN);
if (!privateStore) die("could not read the store id from the private token");
if (publicStore && publicStore === privateStore) {
  die("private and legacy public tokens point at the same store");
}
if (APPLY && !KEEP_PUBLIC && !PUBLIC_TOKEN) {
  die("LEGACY_PUBLIC_BLOB_READ_WRITE_TOKEN is required to delete public copies (or pass --keep-public)");
}

const sql = neon(DATABASE_URL);
const dbHost = new URL(DATABASE_URL).host;
const log = {
  startedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "dry-run",
  keepPublic: KEEP_PUBLIC,
  database: dbHost,
  privateStore,
  legacyPublicStore: publicStore,
  summary: { candidates: 0, migrated: 0, planned: 0, skipped: 0, failed: 0 },
  messagesReferencingPublicBlobs: null,
  rows: [],
};

function saveLog() {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function fetchWithTimeout(url, init = {}, ms = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parsePublicUrl(url) {
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^([a-z0-9]+)\.public\.blob\.vercel-storage\.com$/i);
    if (u.protocol !== "https:" || !m) return null;
    return { storeId: m[1].toLowerCase(), pathname: decodeURIComponent(u.pathname.slice(1)) };
  } catch {
    return null;
  }
}

function targetPathname(row, publicPathname) {
  const base = (publicPathname.split("/").pop() || row.file_name || "file")
    .replace(/[^\w.\- ]/g, "_")
    .replace(/\s+/g, "-")
    .slice(-120);
  return `migrated/${row.owner_id}/${row.id}/${base}`;
}

async function migrateRow(row) {
  const entry = { id: row.id, oldUrl: row.blob_url, steps: [] };
  const step = (name, detail = {}) => entry.steps.push({ name, at: new Date().toISOString(), ...detail });
  log.rows.push(entry);

  const parsed = parsePublicUrl(row.blob_url);
  if (!parsed) {
    entry.result = "skipped";
    entry.reason = "not a public Vercel Blob URL";
    log.summary.skipped++;
    return;
  }
  if (publicStore && parsed.storeId !== publicStore) {
    entry.result = "skipped";
    entry.reason = `public URL is on store ${parsed.storeId}, not the configured legacy store`;
    log.summary.skipped++;
    return;
  }

  const pathname = targetPathname(row, parsed.pathname);
  entry.targetPathname = pathname;

  if (!APPLY) {
    const res = await fetchWithTimeout(row.blob_url, { method: "HEAD" }, 20000).catch((e) => ({ ok: false, status: String(e) }));
    entry.publicObject = res.ok
      ? { status: res.status, size: Number(res.headers.get("content-length")), contentType: res.headers.get("content-type") }
      : { status: res.status };
    entry.result = res.ok ? "planned" : "failed";
    if (!res.ok) entry.reason = "public object not reachable";
    log.summary[res.ok ? "planned" : "failed"]++;
    return;
  }

  let newUrl = null;
  try {
    const res = await fetchWithTimeout(row.blob_url);
    if (!res.ok) throw new Error(`download failed with HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const hash = sha256(bytes);
    const contentType = row.mime_type || res.headers.get("content-type") || "application/octet-stream";
    step("downloaded", { size: bytes.byteLength, sha256: hash });

    const blob = await put(pathname, bytes, {
      access: "private",
      token: PRIVATE_TOKEN,
      addRandomSuffix: true,
      contentType: contentType.split(";")[0],
    });
    newUrl = blob.url;
    entry.newUrl = newUrl;
    step("copied", { newUrl });

    const readBack = await get(newUrl, { access: "private", token: PRIVATE_TOKEN, useCache: false });
    if (!readBack || readBack.statusCode !== 200) throw new Error("private copy not readable");
    const copyBytes = Buffer.from(await new Response(readBack.stream).arrayBuffer());
    if (copyBytes.byteLength !== bytes.byteLength || sha256(copyBytes) !== hash) {
      throw new Error("private copy does not match the original");
    }
    step("verified-copy");

    const updated = await sql`
      UPDATE resources SET blob_url = ${newUrl}, updated_at = now()
      WHERE id = ${row.id}::uuid AND blob_url = ${row.blob_url}
      RETURNING id`;
    if (updated.length !== 1) throw new Error("row changed during migration; not updated");
    step("db-updated");
  } catch (error) {
    entry.result = "failed";
    entry.reason = error instanceof Error ? error.message : String(error);
    if (newUrl) {
      await del(newUrl, { token: PRIVATE_TOKEN }).then(
        () => step("rolled-back-private-copy"),
        (e) => step("rollback-failed", { error: String(e) })
      );
    }
    log.summary.failed++;
    return;
  }

  // Past this point the row points at the private copy
  const [check] = await sql`SELECT blob_url FROM resources WHERE id = ${row.id}::uuid`;
  if (!check || check.blob_url !== newUrl) {
    entry.result = "failed";
    entry.reason = "row does not show the new URL after update; public copy kept";
    log.summary.failed++;
    return;
  }
  step("verified-db");

  if (KEEP_PUBLIC) {
    step("public-copy-kept");
  } else {
    try {
      await del(row.blob_url, { token: PUBLIC_TOKEN });
      const gone = await fetchWithTimeout(row.blob_url, { method: "HEAD", cache: "no-store" }, 20000).catch(() => null);
      step("public-copy-deleted", { headStatusAfterDelete: gone ? gone.status : "unreachable" });
    } catch (error) {
      // Row is migrated; the public copy needs a manual delete
      step("public-delete-failed", { error: String(error) });
      entry.publicCopyRemains = true;
    }
  }

  entry.result = "migrated";
  log.summary.migrated++;
}

async function main() {
  console.log(`Mode: ${log.mode}${KEEP_PUBLIC ? " (keep public copies)" : ""}`);
  console.log(`Database: ${dbHost}`);
  console.log(`Private store: ${privateStore}   Legacy public store: ${publicStore || "(not set)"}`);

  const rows = ONLY_ID
    ? await sql`
        SELECT id, owner_id, blob_url, mime_type, file_name FROM resources
        WHERE id = ${ONLY_ID}::uuid AND blob_url LIKE 'https://%.public.blob.vercel-storage.com/%'`
    : await sql`
        SELECT id, owner_id, blob_url, mime_type, file_name FROM resources
        WHERE blob_url LIKE 'https://%.public.blob.vercel-storage.com/%'
        ORDER BY created_at ASC`;
  const selected = LIMIT ? rows.slice(0, LIMIT) : rows;
  log.summary.candidates = selected.length;
  console.log(`Rows with public blob URLs: ${rows.length} (processing ${selected.length})`);

  // Read-only check: raw public URLs pasted into chat history are not migrated
  const [msgCount] = await sql`
    SELECT count(*)::int AS n FROM messages WHERE content LIKE '%.public.blob.vercel-storage.com/%'`;
  log.messagesReferencingPublicBlobs = msgCount.n;

  for (const row of selected) {
    await migrateRow(row);
    const last = log.rows[log.rows.length - 1];
    console.log(`${last.result.padEnd(9)} ${row.id}${last.reason ? `  (${last.reason})` : ""}`);
    saveLog();
  }

  log.finishedAt = new Date().toISOString();
  saveLog();
  console.log(JSON.stringify(log.summary));
  if (log.messagesReferencingPublicBlobs) {
    console.log(`Note: ${log.messagesReferencingPublicBlobs} chat messages contain raw public blob URLs (not changed).`);
  }
  console.log(`Log: ${LOG_PATH}`);
  if (!APPLY) console.log("Dry run only. Re-run with --apply to migrate.");
}

main().catch((error) => {
  log.fatal = error instanceof Error ? error.message : String(error);
  saveLog();
  console.error(error);
  process.exit(1);
});
