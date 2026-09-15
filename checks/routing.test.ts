/**
 * Unit checks for request routing and brand context. No network, no database.
 *
 *   npx tsx --test checks/routing.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRequestContext } from "@/lib/detect-domain";
import { getBrandContext } from "@/lib/brand-context";
import fs from "node:fs";
import path from "node:path";
import {
  CHAT_FINAL_TURN_RESERVE_MS,
  CHAT_MAX_DURATION_S,
  CHAT_SAFETY_MARGIN_MS,
  CHAT_TURN_BUDGET_MS,
} from "@/lib/chat-prompt";

// Read the lib/image-gen.ts default from source (importing it pulls in the database client)
const IMAGE_TIMEOUT_MS = Number(
  (fs.readFileSync(path.join(process.cwd(), "lib/image-gen.ts"), "utf8").match(/IMAGE_TIMEOUT_MS\) \|\| ([\d_]+)/)?.[1] ?? "NaN").replace(/_/g, "")
);

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

  // Asset-type precedence (owner decision 2026-09-15): route by what is being made
  // Lead magnet assets beat generic "copy" and "email"
  { request: "Generate 5 lead magnet concepts for foundation funders, then build the strongest one with opt-in page copy and the delivery email.", domain: "lead-magnet", presentation: false, investor: false },
  { request: "Write the opt-in page copy for our funder checklist", domain: "lead-magnet", presentation: false, investor: false },
  { request: "Write a headline and copy for a freebie for nonprofit partners", domain: "lead-magnet", presentation: false, investor: false },
  { request: "Write the delivery email for the lead magnet", domain: "lead-magnet", presentation: false, investor: false },
  { request: "Draft copy for a checklist download for new participants", domain: "lead-magnet", presentation: false, investor: false },
  // Social formats beat decks-by-"slide" and generic copy
  { request: "Create a 5-slide Instagram carousel for funders on how funding creates capacity. Give the slide copy and type specs, and generate the cover background.", domain: "social-creative", presentation: false, investor: false },
  { request: "Write copy for a LinkedIn carousel about verified delivery", domain: "social-creative", presentation: false, investor: false },
  { request: "Make a TikTok reel cover with headline copy", domain: "social-creative", presentation: false, investor: false },
  { request: "Write the copy for a Facebook post announcing Activate", domain: "social-creative", presentation: false, investor: false },
  { request: "Design an Instagram story for the Fund launch", domain: "social-creative", presentation: false, investor: false },
  { request: "Make an Instagram carousel promoting our checklist download", domain: "social-creative", presentation: false, investor: false },
  // Decks, presentations, pitch and investor slides still go to deliverable-design
  { request: "Create 8 investor slides on the round", domain: "deliverable-design", presentation: true, investor: true },
  { request: "Build a 10-slide pitch deck for sponsors", domain: "deliverable-design", presentation: true, investor: false },
  // Brand assets beat headline copy and alt text
  { request: "Create an email header for the funder welcome email: the art, headline copy, alt text, and the file size budget.", domain: "brand-asset-design", presentation: false, investor: false },
  { request: "Write headline copy and alt text for a launch banner", domain: "brand-asset-design", presentation: false, investor: false },
  { request: "Design a logo lockup with Harbor Table Network", domain: "brand-asset-design", presentation: false, investor: false },
  { request: "Make a brand graphic with headline copy for the blog", domain: "brand-asset-design", presentation: false, investor: false },
  // Repurposing into posts stays with the atomizer; guides that are not downloads stay put
  { request: "Repurpose this line into social posts for LinkedIn and X", domain: "content-atomizer", presentation: false, investor: false },
  { request: "How should we sound on social versus in investor emails? I need a tone of voice guide.", domain: "brand-voice", presentation: false, investor: true },
  { request: "Mockup the opt-in page for the funder guide", domain: "web-mockup", presentation: false, investor: false },
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

test("a revision keeps the asset named earlier", () => {
  const ctx = detectRequestContext([
    user("Create a 5-slide Instagram carousel for funders"),
    assistant("| Slide | Copy |"),
    user("Make slide 3 shorter"),
  ]);
  assert.equal(ctx.domain, "social-creative");
  assert.equal(ctx.presentation, false);
});

test("a new writing request leaves an earlier asset behind", () => {
  const ctx = detectRequestContext([
    user("Create an email header for the launch"),
    assistant("done"),
    user("Now write a welcome email sequence for new funders"),
  ]);
  assert.equal(ctx.domain, "email-sequences");
});

test("chat route maxDuration matches the shared time budget", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app/api/chat/route.ts"), "utf8");
  const m = src.match(/export const maxDuration = (\d+);/);
  assert.ok(m, "route must export a literal maxDuration");
  assert.equal(Number(m[1]), CHAT_MAX_DURATION_S);
  assert.ok(CHAT_FINAL_TURN_RESERVE_MS + CHAT_SAFETY_MARGIN_MS < CHAT_MAX_DURATION_S * 1000);
  assert.ok(IMAGE_TIMEOUT_MS <= CHAT_TURN_BUDGET_MS - CHAT_FINAL_TURN_RESERVE_MS);
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
