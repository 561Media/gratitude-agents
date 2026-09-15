/**
 * Regression checks for the chat stream parser (components/ChatInterface.tsx).
 *
 *   npx tsx --test checks/sse.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SseParser } from "@/lib/sse";

const enc = new TextEncoder();

function feed(chunks: Uint8Array[]): string[] {
  const parser = new SseParser();
  const out: string[] = [];
  for (const c of chunks) out.push(...parser.push(c));
  out.push(...parser.flush());
  return out;
}

test("JSON split across two network chunks is reassembled", () => {
  const event = enc.encode('data: {"text":"HELLO"}\n\n');
  const out = feed([event.slice(0, 12), event.slice(12)]);
  assert.deepEqual(out.map((d) => JSON.parse(d)), [{ text: "HELLO" }]);
});

test("a multibyte character split across chunks survives", () => {
  const event = enc.encode('data: {"text":"Activate → ✅ café"}\n\n');
  const arrowStart = event.indexOf(0xe2); // first byte of the 3-byte arrow
  const out = feed([event.slice(0, arrowStart + 1), event.slice(arrowStart + 1)]);
  assert.equal(JSON.parse(out[0]).text, "Activate → ✅ café");
});

test("byte-at-a-time delivery still yields every event", () => {
  const bytes = enc.encode('data: {"a":1}\n\ndata: {"b":"✓"}\n\ndata: [DONE]\n\n');
  const out = feed(Array.from(bytes, (b) => Uint8Array.of(b)));
  assert.deepEqual(out, ['{"a":1}', '{"b":"✓"}', "[DONE]"]);
});

test("multiple events in one chunk", () => {
  const out = feed([enc.encode('data: {"x":1}\n\ndata: {"x":2}\n\ndata: {"x":3}\n\n')]);
  assert.deepEqual(out.map((d) => JSON.parse(d).x), [1, 2, 3]);
});

test("premature EOF without the trailing blank line flushes the last event", () => {
  const out = feed([enc.encode('data: {"x":1}\n\ndata: {"x":2}')]);
  assert.deepEqual(out.map((d) => JSON.parse(d).x), [1, 2]);
});

test("an incomplete event is not emitted early", () => {
  const parser = new SseParser();
  assert.deepEqual(parser.push(enc.encode('data: {"text":"par')), []);
  assert.deepEqual(parser.push(enc.encode('tial"}\n\n')), ['{"text":"partial"}']);
});

test("CRLF line endings are accepted", () => {
  const out = feed([enc.encode('data: {"x":1}\r\n\r\n')]);
  assert.deepEqual(out, ['{"x":1}']);
});
