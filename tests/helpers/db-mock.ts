import { vi } from "vitest";

// Minimal drizzle query-builder stand-in. Each top-level call (select, insert,
// update, delete, execute) takes the next queued result; every chained method
// returns the same thenable.
export function createDbMock() {
  const queue: unknown[] = [];
  const calls: { op: string; args: unknown[] }[] = [];

  function chain(result: unknown) {
    const target: Record<string, unknown> = {};
    const methods = ["from", "where", "limit", "orderBy", "set", "values", "returning"];
    for (const m of methods) {
      target[m] = vi.fn((...args: unknown[]) => {
        calls.push({ op: m, args });
        return target;
      });
    }
    target.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return target;
  }

  const top = (op: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ op, args });
      return chain(queue.length ? queue.shift() : []);
    });

  const db = {
    select: top("select"),
    insert: top("insert"),
    update: top("update"),
    delete: top("delete"),
    execute: top("execute"),
  };

  return {
    db,
    calls,
    queue: (...results: unknown[]) => queue.push(...results),
    reset: () => {
      queue.length = 0;
      calls.length = 0;
    },
  };
}

export function streamOf(bytes: Uint8Array | string) {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
export const TEST_STORE = "teststore123";
export const TEST_TOKEN = `vercel_blob_rw_${TEST_STORE}_secretvalue`;
export const privateUrl = (pathname: string) =>
  `https://${TEST_STORE}.private.blob.vercel-storage.com/${pathname}`;
