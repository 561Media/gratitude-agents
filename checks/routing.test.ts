/**
 * Unit checks for request routing and brand context. No network, no database.
 *
 *   npx tsx --test checks/routing.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRequestContext } from "@/lib/detect-domain";
import { getBrandContext } from "@/lib/brand-context";

const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

// The request table from the 2026-09-15 output-quality review, plus revisions
const CASES: { request: string; domain: string | null; presentation: boolean; investor: boolean }[] = [
  { request: "Create a sponsor pitch deck", domain: "deliverable-design", presentation: true, investor: false },
  { request: "Create a deck", domain: "deliverable-design", presentation: true, investor: false },
  { request: "Create a one-pager", domain: "deliverable-design", presentation: true, investor: false },
  { request: "Create slides", domain: "deliverable-design", presentation: true, investor: false },
  { request: "Create an investor presentation", domain: "deliverable-design", presentation: true, investor: true },
  { request: "Create a designed PDF", domain: "deliverable-design", presentation: false, investor: false },
  { request: "Create an impact report", domain: "deliverable-design", presentation: false, investor: false },
  { request: "Build a pitch deck for prospective funders", domain: "deliverable-design", presentation: true, investor: false },
  { request: "Make a PowerPoint for the board", domain: "deliverable-design", presentation: true, investor: false },
  { request: "Write a nurture email sequence", domain: "email-sequences", presentation: false, investor: false },
  { request: "Draft copy for our landing page", domain: "direct-response-copy", presentation: false, investor: false },
  { request: "Update the investor one-pager for the seed round", domain: "deliverable-design", presentation: true, investor: true },
  { request: "Write an update email to our investors about the raise", domain: "email-sequences", presentation: false, investor: true },
  { request: "Help us raise awareness on Instagram", domain: "social-creative", presentation: false, investor: false },
];

for (const c of CASES) {
  test(`routes: ${c.request}`, () => {
    const ctx = detectRequestContext([user(c.request)]);
    assert.equal(ctx.domain, c.domain, "domain");
    assert.equal(ctx.presentation, c.presentation, "presentation");
    assert.equal(ctx.investor, c.investor, "investor");
  });
}

test("deck revisions keep presentation context", () => {
  const ctx = detectRequestContext([
    user("Create an investor presentation"),
    assistant("```json\n[]\n```"),
    user("Make the closing shorter and punchier"),
  ]);
  assert.equal(ctx.domain, "deliverable-design");
  assert.equal(ctx.presentation, true);
  assert.equal(ctx.investor, true);
});

test("a clearly different new request leaves the deck behind", () => {
  const ctx = detectRequestContext([
    user("Create a deck"),
    assistant("ok"),
    user("Now write a welcome email sequence for new funders"),
  ]);
  assert.equal(ctx.presentation, false);
  assert.equal(ctx.domain, "email-sequences");
});

test("the current message outweighs history", () => {
  const ctx = detectRequestContext([
    user("Write a newsletter digest about our weekly update"),
    assistant("done"),
    user("Now draft landing page copy with a headline and cta"),
  ]);
  assert.equal(ctx.domain, "direct-response-copy");
});

test("presentation context loads design and terminology files", () => {
  const context = getBrandContext("direct-response-copy", { presentation: true });
  assert.match(context, /## Visual System/);
  assert.match(context, /## template registry/);
  assert.match(context, /## terminology/);
});

test("investor intent loads investor-core even for design profiles", () => {
  const context = getBrandContext("deliverable-design", { presentation: true, investor: true });
  assert.match(context, /## investor core/);
  const without = getBrandContext("deliverable-design", { presentation: true });
  assert.doesNotMatch(without, /## investor core/);
});

test("every copy profile carries terminology", () => {
  for (const agent of ["orchestrator", "positioning-angles", "direct-response-copy", "email-sequences", "content-atomizer", "newsletter", "lead-magnet"]) {
    assert.match(getBrandContext(agent), /## terminology/, agent);
  }
});
