// Text embeddings via OpenAI (561 Media account, switched from Gemini 9/15/26
// after the Gemini prepay credits ran out). 768-dim vectors, matching the
// pgvector column on knowledgebase_entries. text-embedding-3 models support a
// `dimensions` parameter; we still L2-normalize for cosine math.
//
// IMPORTANT: every stored embedding must come from the same model. After
// changing EMBEDDING_MODEL, re-embed all rows: scripts/backfill-embeddings.mjs --all

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-large";

export const EMBEDDING_DIMENSIONS = 768;

function l2Normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((acc, v) => acc + v * v, 0)) || 1;
  return values.map((v) => v / norm);
}

export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Embeddings not configured (missing OPENAI_API_KEY)");
  }

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Embedding failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as { data?: { embedding?: number[] }[] };
  const values = data.data?.[0]?.embedding;
  if (!values || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding returned ${values?.length ?? 0} dims, expected ${EMBEDDING_DIMENSIONS}`
    );
  }
  return l2Normalize(values);
}

// Postgres vector literal for raw SQL queries: '[0.1,0.2,...]'
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
