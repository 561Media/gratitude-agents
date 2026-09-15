// DRAFT - NOT RUN. Supersede stale investor KB entries and insert replacements
// built from the rewritten brand-kit/investor-core.yaml.
//
// Default is a DRY RUN (prints what it would do, writes nothing).
// Apply only after: (1) the brand-kit rewrite is finished and reviewed,
// (2) Michael approves the stale list, (3) a fresh snapshot exists
// (scripts/kb-snapshot-2026-09-15.mjs).
//
//   set -a; . ./.env.local; set +a
//   node scripts/supersede-investor-kb-DRAFT.mjs            # dry run
//   node scripts/supersede-investor-kb-DRAFT.mjs --apply    # writes
//
// How "superseded" works (no schema change; the knowledge_status enum is only
// draft/review/approved and there is no archived flag):
//   - append tag "superseded-2026-09-15"
//   - set expires_at = now()
// searchKnowledge() (lib/kb.ts) excludes rows where expires_at <= now(), so the
// entry stops being injected into prompts but stays visible/auditable in the KB
// page and is reversible (set expires_at = null, drop the tag).
// Alternative if Michael prefers: set status = 'draft' instead of expires_at.
import fs from "fs";
import yaml from "js-yaml";
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const SUPERSEDED_TAG = "superseded-2026-09-15";
const NEW_TAGS = ["investor", "raise-2026", "investor-core-2026-09-15"];

// Stale entries (from the 9/15/26 review; confirm before apply)
const STALE = [
  ["2e73c5b2-c3a8-453f-8396-3e0249fcfd44", "Says cap not published and 60/20/10/10 use of funds; 9/8 deck: $20M post-money cap, no discount, SAFE funds build + launch, gifts fund nonprofit seeding"],
  ["9a4888f2-3d2c-49c1-b02b-28bb2305290c", "$600B+/$500B+ frames; 9/8 deck: $100B+ wellbeing, $2.3T+ giving, $2.4T+ combined"],
  ["d9c08f92-6fed-4f16-9145-f238ac1dd69a", "Says PBC; entity is Gratitude.com, Inc., Delaware C-Corp, B Corp pending"],
  ["f7a2ee27-397e-4481-89d6-273149f871ed", "Tell Them as flagship; System Story v3 says do not position Tell Them as flagship, MVP = Activate + Fund"],
  ["38b153e9-be84-4c01-b5a1-0a6bc78921cf", "Companies sponsor / people activate framework; v3 model is Pre-fund, Activate, Deliver, Verify, Show Impact, Refill"],
  // Verify against the new yaml before including:
  // ["777525d8-7a3e-44dc-a3f3-1f176295673b", "Roadmap 'MVP live' predates MVP = Activate + Fund"],
];

const TITLES = {
  round: "2026 raise: round terms",
  structure: "Entity structure: Gratitude.com and ActivateGratitude.org",
  founder: "Founder and investor contact: Michael Hilf",
  positioning: "Investor positioning: Infrastructure for Human Acknowledgment",
  mvp: "MVP for investors: Activate + Fund",
  participation_modes: "Participation architecture: Activate, Fund, Express, Facilitate",
  market_frames: "Market frames used with investors",
  roadmap_24_months: "24-month roadmap shown to investors",
  voice_for_investors: "Investor voice rules",
  not_yet_available: "Investor facts not yet available ([NEEDS INPUT])",
};
const META_KEYS = new Set(["chunk_id", "domain", "status", "version", "source", "last_updated"]);

function flatten(value, prefix = "") {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) =>
      typeof v === "object" ? flatten(v, `${prefix}${i + 1}. `) : [`${prefix}${v}`]
    );
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      typeof v === "object" ? flatten(v, `${prefix}${k.replace(/_/g, " ")}: `) : [`${prefix}${k.replace(/_/g, " ")}: ${v}`]
    );
  }
  return [`${prefix}${value}`];
}

function buildReplacements(doc) {
  return Object.entries(doc)
    .filter(([k]) => !META_KEYS.has(k))
    .map(([k, v]) => ({
      key: k,
      title: TITLES[k] || `Investor core: ${k.replace(/_/g, " ")}`,
      content: flatten(v).join("; ").replace(/—/g, ","), // no em dashes
    }));
}

async function embed(text, attempt = 0) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 8000) }] }, outputDimensionality: 768 }),
  });
  if (res.status === 429 && attempt < 6) {
    const wait = 5000 * 2 ** attempt;
    console.log(`    embedding 429, retrying in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
    return embed(text, attempt + 1);
  }
  if (!res.ok) throw new Error(`embedding ${res.status}`);
  const v = (await res.json()).embedding.values;
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return `[${v.map((x) => x / n).join(",")}]`;
}

const doc = yaml.load(fs.readFileSync("brand-kit/investor-core.yaml", "utf-8"));
if (String(doc.version) === "1.0" && !process.argv.includes("--allow-old-yaml")) {
  console.error("STOP: investor-core.yaml is still version 1.0 (the 7/20 facts). Wait for the rewrite.");
  process.exit(1);
}
const replacements = buildReplacements(doc);
const sql = neon(process.env.DATABASE_URL);
const [owner] = await sql`select id from users where email = 'mrichards@561media.com'`;

console.log(APPLY ? "APPLY MODE" : "DRY RUN (no writes)");
for (const [id, reason] of STALE) {
  const [row] = await sql`select id, title, status, expires_at, tags from knowledgebase_entries where id = ${id}`;
  if (!row) { console.log(`MISSING ${id}`); continue; }
  console.log(`SUPERSEDE ${id} "${row.title}" (${row.status}) - ${reason}`);
  if (APPLY) {
    await sql`update knowledgebase_entries
      set tags = coalesce(tags, '[]'::jsonb) || ${JSON.stringify([SUPERSEDED_TAG])}::jsonb,
          expires_at = now(), updated_at = now()
      where id = ${id} and not (coalesce(tags, '[]'::jsonb) @> ${JSON.stringify([SUPERSEDED_TAG])}::jsonb)`;
  }
}
for (const r of replacements) {
  const [dup] = await sql`select id from knowledgebase_entries where title = ${r.title}
    and tags @> ${JSON.stringify(["investor-core-2026-09-15"])}::jsonb limit 1`;
  console.log(`${dup ? "SKIP (exists)" : "INSERT"} "${r.title}"\n    ${r.content.slice(0, 300)}`);
  if (APPLY && !dup) {
    // --no-embed: insert with NULL embedding (served by the recency fallback in
    // lib/kb.ts); run scripts/backfill-embeddings.mjs once Gemini credits return.
    const vec = process.argv.includes("--no-embed") ? null : await embed(`${r.title}\n${r.content}`);
    const [row] = await sql`insert into knowledgebase_entries
      (owner_id, agent_id, category, status, visibility, title, content, tags, source_type, embedding)
      values (${owner.id}, 'orchestrator', 'strategy_learning', 'approved', 'internal',
              ${r.title}, ${r.content}, ${JSON.stringify(NEW_TAGS)}::jsonb, 'manual', ${vec}::vector)
      returning id`;
    console.log(`    -> ${row.id}`);
    await new Promise((res) => setTimeout(res, 120));
  }
}
process.exit(0);
