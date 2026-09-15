// Backfill: embed knowledgebase entries with OpenAI (same model as lib/embeddings.ts).
//   node scripts/backfill-embeddings.mjs         # only rows with no embedding (+ freshness policy)
//   node scripts/backfill-embeddings.mjs --all   # re-embed EVERY row (required after a model
//                                                # change); leaves expires_at untouched
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local", quiet: true });

const sql = neon(process.env.DATABASE_URL);
const MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-large";
const ALL = process.argv.includes("--all");

const EXPIRY_DAYS = {
  campaign_result: 90,
  sponsor_info: 180,
  content_insight: 180,
};

async function embed(text, attempt = 0) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, input: text.slice(0, 8000), dimensions: 768 }),
  });
  if (res.status === 429 && attempt < 5) {
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    return embed(text, attempt + 1);
  }
  if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const values = (await res.json()).data[0].embedding;
  const norm = Math.sqrt(values.reduce((a, v) => a + v * v, 0)) || 1;
  return values.map((v) => v / norm);
}

const rows = ALL
  ? await sql`SELECT id, title, content, category FROM knowledgebase_entries`
  : await sql`SELECT id, title, content, category FROM knowledgebase_entries WHERE embedding IS NULL`;
console.log(`${rows.length} entries to embed (${ALL ? "all rows" : "missing only"}, model ${MODEL})`);

let done = 0;
for (const row of rows) {
  const vec = await embed(`${row.title}\n${row.content}`);
  const literal = `[${vec.join(",")}]`;
  const days = EXPIRY_DAYS[row.category];
  if (days && !ALL) {
    await sql`
      UPDATE knowledgebase_entries
      SET embedding = ${literal}::vector,
          expires_at = now() + make_interval(days => ${days})
      WHERE id = ${row.id}
    `;
  } else {
    await sql`UPDATE knowledgebase_entries SET embedding = ${literal}::vector WHERE id = ${row.id}`;
  }
  done++;
  if (done % 10 === 0) console.log(`${done}/${rows.length}`);
  await new Promise((r) => setTimeout(r, 100));
}

const [counts] = await sql`
  SELECT count(*)::int AS total, count(embedding)::int AS embedded
  FROM knowledgebase_entries
`;
console.log(`Done. Total: ${counts.total}, embedded: ${counts.embedded}`);
process.exit(0);
