// Upload the 9/15/26 Gratitude source documents to the Files library.
//
// Mirrors the app's own browser upload path exactly (components/ResourcesManager.tsx):
//   1. @vercel/blob upload(f.name, ...) with access "public" + addRandomSuffix
//      (set by /api/blob/upload onBeforeGenerateToken)  -> here: put(fileName, ...)
//   2. POST /api/resources JSON body -> row in `resources` with
//      type "upload", status "draft" (browser never sends status),
//      visibility "internal" (browser default), fileName, mimeType, extension,
//      sizeBytes, blobUrl, tags = user tags + kind tag ("example:deck").
//      textContent / binaryContentBase64 / externalUrl / conversationId stay null.
// Owner = mrichards@561media.com (admin).
//
// Idempotent: skips any file whose title already exists for the owner.
// Run:  set -a; . ./.env.local; set +a; node scripts/upload-resources-2026-09-15.mjs [--verify-only]
import fs from "fs";
import path from "path";
import os from "os";
import { neon } from "@neondatabase/serverless";
import { put } from "@vercel/blob";

const HOME = os.homedir();
const OWNER_EMAIL = "mrichards@561media.com";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const FILES = [
  {
    path: `${HOME}/gratitude-docs-2026-09-14/Gratitude_System_Story_v3_LOCKED.docx`,
    title: "System Story v3 (locked copy)",
    description: "Locked System Story v3 (Word). Reference document and source of truth for Gratitude messaging.",
    tags: ["reference", "source-of-truth", "messaging", "system-story-v3"],
    mimeType: DOCX,
  },
  {
    path: `${HOME}/gratitude-docs-2026-09-14/Gratitude_MVP_UX_Story_FINAL_for_Richards.docx`,
    title: "MVP UX Story (first draft copy)",
    description: "MVP UX Story, first draft copy (Word). Draft, not final.",
    tags: ["draft", "mvp-ux-story"],
    mimeType: DOCX,
  },
  {
    path: `${HOME}/gratitude-investor-deck-staging/GRATITUDE-INVESTOR-DECK-2026-09-08-v3.pdf`,
    title: "Investor Deck (9/8/26, MVP aligned)",
    description: "Investor deck 9/8/26, MVP aligned. Slide 14 reserve language pending attorney review.",
    tags: ["investor", "example:deck"],
    mimeType: "application/pdf",
  },
  {
    path: `${HOME}/gratitude-system-story-v3/GRATITUDE-SYSTEM-STORY-V3-2026-09-14.pdf`,
    title: "System Story v3 deck (design 9/14/26)",
    description: "System Story v3 designed deck, 9/14/26. Photos are AI placeholders, not real people.",
    tags: ["system-story-v3", "example:deck"],
    mimeType: "application/pdf",
  },
  {
    path: `${HOME}/gratitude-mvp-ux-story/GRATITUDE-MVP-UX-STORY-2026-09-14.pdf`,
    title: "MVP UX Story deck (design 9/14/26)",
    description: "MVP UX Story designed deck, 9/14/26.",
    tags: ["mvp-ux-story", "example:deck"],
    mimeType: "application/pdf",
  },
  {
    path: `${HOME}/gratitude-meeting-2026-09-15/Gratitude Content Inventory 2026-09-15.pdf`,
    title: "Content Inventory (9/15/26)",
    description: "Gratitude content inventory prepared for the 9/15/26 team meeting.",
    tags: ["content-inventory", "meeting-2026-09-15"],
    mimeType: "application/pdf",
  },
];

const sql = neon(process.env.DATABASE_URL);
const verifyOnly = process.argv.includes("--verify-only");

const [owner] = await sql`select id from users where email = ${OWNER_EMAIL}`;
if (!owner) throw new Error(`owner ${OWNER_EMAIL} not found`);

if (!verifyOnly) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN missing");
  for (const f of FILES) {
    const [dup] = await sql`select id from resources where owner_id = ${owner.id} and title = ${f.title} limit 1`;
    if (dup) {
      console.log(`SKIP (exists) ${f.title} -> ${dup.id}`);
      continue;
    }
    const bytes = fs.readFileSync(f.path);
    const fileName = path.basename(f.path);
    let blob;
    try {
      blob = await put(fileName, bytes, {
        // Private store (phase0): served only through the authorized download route
        access: "private",
        addRandomSuffix: true,
        contentType: f.mimeType,
      });
    } catch (e) {
      console.error(`STOP: blob upload failed for ${fileName}:`, e.message);
      process.exit(1);
    }
    try {
      const [row] = await sql`
        insert into resources
          (owner_id, conversation_id, title, description, type, visibility, status,
           file_name, mime_type, extension, size_bytes, external_url, text_content,
           binary_content_base64, blob_url, tags)
        values
          (${owner.id}, null, ${f.title}, ${f.description}, 'upload', 'internal', 'draft',
           ${fileName}, ${f.mimeType}, ${fileName.split(".").pop() || null}, ${bytes.byteLength},
           null, null, null, ${blob.url}, ${JSON.stringify(f.tags)}::jsonb)
        returning id`;
      console.log(`UPLOADED ${f.title} -> ${row.id}`);
    } catch (e) {
      console.error(`STOP: DB insert failed for ${fileName}; orphan blob ${blob.url}:`, e.message);
      process.exit(1);
    }
  }
}

// ---- Verification ----
// Files page list = GET /api/resources: owner's rows, updated_at desc, limit 200
const listIds = new Set(
  (await sql`select id from resources where owner_id = ${owner.id} order by updated_at desc limit 200`).map((r) => r.id)
);
// Chat "Team Example Library" query (what agents see), first 12 rows
const exampleIds = (await sql`
  select id from resources
  where exists (select 1 from jsonb_array_elements_text(tags) t where t like 'example:%')
    and (visibility <> 'private' or owner_id = ${owner.id})
  order by created_at desc limit 12`).map((r) => r.id);

let allOk = true;
for (const f of FILES) {
  const [row] = await sql`select id, blob_url, size_bytes, tags, status, visibility from resources where owner_id = ${owner.id} and title = ${f.title} limit 1`;
  if (!row) {
    console.log(`VERIFY FAIL ${f.title}: no DB row`);
    allOk = false;
    continue;
  }
  const head = await fetch(row.blob_url, { method: "HEAD" });
  const len = Number(head.headers.get("content-length"));
  const inList = listIds.has(row.id);
  const isDeck = f.tags.includes("example:deck");
  const inExamples = exampleIds.includes(row.id);
  const ok = head.status === 200 && len === row.size_bytes && inList && (!isDeck || inExamples);
  if (!ok) allOk = false;
  console.log(
    `VERIFY ${ok ? "OK  " : "FAIL"} ${row.id} | ${f.title} | HEAD ${head.status} len ${len}/${row.size_bytes} | filesList ${inList}` +
      (isDeck ? ` | exampleLibrary ${inExamples}` : "") +
      ` | ${row.status}/${row.visibility} | ${row.blob_url}`
  );
}
process.exit(allOk ? 0 : 2);
