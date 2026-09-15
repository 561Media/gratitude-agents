/**
 * Local export smoke test. No network, no database.
 *
 *   npx tsx checks/smoke-exports.ts [outDir]
 *
 * Writes a sample 8-slide deck (PPTX + PDF) and a sample Markdown document
 * (PDF + DOCX), asserts slide geometry stays inside 13.333 x 7.5 in, and
 * fails if any export throws on Unicode such as arrows and checkmarks.
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { buildExportPayload } from "@/lib/exporters";
import { generatePptx } from "@/lib/slides";
import { SLIDE_H, SLIDE_W, layoutDeck, outOfBounds } from "@/lib/slide-layout";
import { extractSlides } from "@/lib/slide-schema";

const outDir = process.argv[2] || path.join(os.homedir(), "gratitude-agents-review", "output-quality-2026-09-15");
fs.mkdirSync(outDir, { recursive: true });

const deckSlides = [
  { type: "title", title: "Gratitude, delivered.", subtitle: "The infrastructure for human acknowledgment → Activate + Fund", notes: "Open with the category line." },
  {
    type: "stats",
    title: "What the MVP makes measurable",
    stats: [
      { value: "[NEEDS INPUT]", label: "Pre-funded acts available at launch" },
      { value: "0", label: "Cost to a participant at the moment of activation" },
      { value: "6", label: "Mechanism steps from Pre-fund to Refill" },
      { value: "100%", label: "Activations routed to a trusted nonprofit partner ✅" },
      { value: "2", label: "Core actions in the MVP: Activate and Fund" },
    ],
    notes: "Five metrics: must paginate, never drop one.",
  },
  {
    type: "content",
    title: "How it works",
    body:
      "Good intention needs somewhere to go. Acts are funded first, so a participant can put one into motion instantly. Delivery is verified and the participant sees what happened.\n\nThis paragraph is the caveat that used to disappear when bullets were present: flow-of-funds language is pending attorney review.",
    bullets: [
      "Pre-fund → capacity is committed before the moment of action",
      "Activate → a participant chooses an available act ✅",
      "Deliver → a trusted nonprofit partner turns it into real-world good",
      "Verify → delivery is confirmed rather than assumed",
      "Show Impact → the participant sees what happened",
      "Refill → new funding replenishes available capacity",
      "Supercalifragilisticexpialidociouslyextraordinaryunbelievablylongcompoundtokenthatmustwrap",
    ],
  },
  {
    type: "two-column",
    title: "Activate and Fund are distinct",
    left: { heading: "Activate", bullets: ["Choose a pre-funded act", "No payment required ✓", "Dominant action in the product"] },
    right: { heading: "Fund", bullets: ["Create capacity for future acts", "Once or recurring", "Funders get a result loop too"] },
  },
  {
    type: "quote",
    quote: "Most giving ends with a receipt. Gratitude ends with a result.",
    attribution: "Gratitude.com System Story",
  },
  {
    type: "content",
    title: "Where sponsors fit",
    bullets: [
      "Sponsored is one funding type: organizations create funded capacity for employees, customers, or communities",
      "Attribution stays optional and subtle: Made possible by [Sponsor]",
      "Sponsors never overpower the act",
    ],
  },
  { type: "content", title: "Roadmap", bullets: ["NOW: Activate + Fund", "NEXT: Express", "FUTURE: Facilitate"] },
  { type: "closing", title: "Make more possible", subtitle: "gratitude.com", body: "Questions → hello@gratitude.com ✅" },
];

const deckMessage =
  "Here is your deck.\n\n```json\n" + JSON.stringify(deckSlides, null, 2) + "\n```\n\nClick PPTX or PDF to download it.";

const docMarkdown = `# Funder One-Pager: Activate + Fund

Gratitude.com is **the infrastructure for human acknowledgment**. Real acts of good are already funded and ready; a person chooses one and puts it into motion.

## How the mechanism works

1. Pre-fund → capacity is committed first
2. Activate → a participant chooses an act ✅
3. Deliver, Verify, Show Impact, Refill

### Why funders care

- Funders see what their funding made possible
- Activation costs the participant nothing at the moment ✓
  - Nested point: flow-of-funds language pending attorney review
- A long token that must split: https://gratitude.com/a/really/long/path/that/keeps/going/and/going/without/any/spaces/at/all/whatsoever

> Most giving ends with a receipt. Gratitude ends with a result.

| Action | Stage | Cost to participant |
|---|---|---|
| Activate | NOW | None |
| Fund | NOW | Once or recurring |
| Express | NEXT | Not in MVP |

---

${Array.from({ length: 14 }, (_, i) => `Paragraph ${i + 1}. Funding makes good possible. Activation makes it personal. This filler checks pagination, running headers, and footers across pages without clipping text at the bottom margin.`).join("\n\n")}
`;

async function main() {
  const deck = extractSlides(deckMessage);
  assert.ok(deck, "deck JSON should be detected");
  assert.equal(deck.slides.length, 8, "all 8 slides should validate");

  const rendered = layoutDeck(deck);
  const issues = outOfBounds(rendered);
  assert.deepEqual(issues, [], `primitives outside ${SLIDE_W}x${SLIDE_H}: ${issues.join("; ")}`);

  const statsValues = rendered.flatMap((s) =>
    s.prims.flatMap((p) => (p.kind === "text" ? p.paras.map((para) => para.text) : []))
  );
  for (const stat of deckSlides[1].stats!) {
    assert.ok(statsValues.includes(stat.value.toUpperCase()), `stat ${stat.value} must not be dropped`);
  }
  assert.ok(
    statsValues.some((t) => t.startsWith("This paragraph is the caveat")),
    "prose alongside bullets must be kept"
  );
  console.log(`layout: ${deck.slides.length} slides in -> ${rendered.length} rendered slides, all in bounds`);

  const pptx = await generatePptx(deck);
  fs.writeFileSync(path.join(outDir, "sample-deck.pptx"), pptx);

  const deckPdf = await buildExportPayload("pdf", "Sample Deck", deckMessage);
  assert.ok(deckPdf.fileName.endsWith(".pdf"));
  fs.writeFileSync(path.join(outDir, "sample-deck.pdf"), deckPdf.body);

  const docPdf = await buildExportPayload("pdf", "Sample Document", docMarkdown);
  fs.writeFileSync(path.join(outDir, "sample-document.pdf"), docPdf.body);

  const docx = await buildExportPayload("docx", "Sample Document", docMarkdown);
  assert.ok(docx.fileName.endsWith(".docx"));
  fs.writeFileSync(path.join(outDir, "sample-document.docx"), docx.body);

  console.log(`wrote sample-deck.pptx, sample-deck.pdf, sample-document.pdf, sample-document.docx to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
