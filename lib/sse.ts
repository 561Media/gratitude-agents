/**
 * Incremental Server-Sent Events parser for the chat stream.
 *
 * Network chunks can end mid-event and mid-UTF-8 character. This keeps a
 * persistent text buffer, decodes with { stream: true }, and only emits
 * COMPLETE events (terminated by a blank line). The unfinished tail waits for
 * the next chunk; flush() handles a stream that ends without a final blank line.
 */
export class SseParser {
  private decoder = new TextDecoder();
  private buffer = "";

  /** Feed raw bytes; returns the data payloads of every complete event. */
  push(chunk: Uint8Array): string[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  /** Call once at end of stream. */
  flush(): string[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(final: boolean): string[] {
    this.buffer = this.buffer.replace(/\r\n/g, "\n");
    const out: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const data = parseEvent(raw);
      if (data !== null) out.push(data);
    }
    if (final && this.buffer.trim()) {
      const data = parseEvent(this.buffer);
      if (data !== null) out.push(data);
      this.buffer = "";
    }
    return out;
  }
}

function parseEvent(raw: string): string | null {
  const dataLines = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}
