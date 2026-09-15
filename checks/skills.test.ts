/**
 * Every skill must load. lib/agents.ts parses SKILL.md frontmatter with
 * gray-matter; one unquoted "key: value: more" line throws, and getAgents()
 * then fails for EVERY chat request (found by the 2026-09-15 eval harness).
 *
 *   npx tsx --test checks/skills.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAgents } from "@/lib/agents";

const EXPECTED = [
  "orchestrator",
  "brand-voice",
  "positioning-angles",
  "direct-response-copy",
  "email-sequences",
  "content-atomizer",
  "lead-magnet",
  "newsletter",
  "gratitude-content-strategy",
  "social-creative",
  "deliverable-design",
  "web-mockup",
  "brand-asset-design",
  "canvas-art",
];

test("all 14 skills parse and load", () => {
  const ids = getAgents().map((a) => a.id);
  for (const id of EXPECTED) assert.ok(ids.includes(id), `missing agent ${id}`);
  assert.equal(ids.length, EXPECTED.length);
});

test("every skill has a description and a body", () => {
  for (const a of getAgents()) {
    assert.ok(a.description.length > 10, `${a.id} description`);
    assert.ok(a.body.length > 200, `${a.id} body`);
  }
});
