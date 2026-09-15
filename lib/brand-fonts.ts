/**
 * Brand typography for the exporters: Anton (display, weight 400 only, never
 * bold) and Inter (body). Loads the bundled TTFs from canvas-fonts/, measures
 * text with the real font metrics, and makes any string safe to draw:
 * characters a font cannot render are substituted with an approved
 * equivalent or dropped, so one emoji can never crash an export.
 */
import fs from "fs";
import path from "path";
import fontkit from "@pdf-lib/fontkit";

export type FontFace = "display" | "body" | "bodySemi";

export const FONT_FILES: Record<FontFace, string> = {
  display: "Anton-Regular.ttf",
  body: "Inter-Regular.ttf",
  bodySemi: "Inter-SemiBold.ttf",
};

/** Font family names written into PPTX/DOCX (the PDF embeds the files). */
export const FONT_FAMILY: Record<FontFace, string> = {
  display: "Anton",
  body: "Inter",
  bodySemi: "Inter SemiBold",
};

/** Line box = font size x this factor x spacing multiple. Shared by PPTX and PDF. */
export const LINE_FACTOR = 1.2;

type KitFont = ReturnType<typeof fontkit.create>;

const bytesCache = new Map<FontFace, Buffer>();
const fontCache = new Map<FontFace, KitFont>();

export function fontBytes(face: FontFace): Buffer {
  let bytes = bytesCache.get(face);
  if (!bytes) {
    const file = path.join(process.cwd(), "canvas-fonts", FONT_FILES[face]);
    bytes = fs.readFileSync(file);
    bytesCache.set(face, bytes);
  }
  return bytes;
}

function kitFont(face: FontFace): KitFont {
  let font = fontCache.get(face);
  if (!font) {
    font = fontkit.create(new Uint8Array(fontBytes(face)));
    fontCache.set(face, font);
  }
  return font;
}

/**
 * House rule: no em dashes in any output. Spaced or unspaced em dashes become
 * a comma pause; en dashes used as a spaced dash do the same (ranges like
 * 2025-2026 written with an en dash are kept).
 */
export function removeEmDashes(text: string): string {
  return text
    .replace(/\s*\u2014\s*/g, ", ")
    .replace(/\s+–\s+/g, ", ")
    .replace(/,\s*,/g, ",");
}

// Preferred replacements, tried in order; the first one the font can draw wins
const SUBSTITUTES: Record<string, string[]> = {
  "✅": ["✓", "-"], // white heavy check mark emoji
  "✔": ["✓", "-"], // heavy check mark
  "☑": ["✓", "-"], // ballot box with check
  "✓": ["✓", "-"], // check mark
  "❌": ["✗", "x"], // cross mark emoji
  "✗": ["✗", "x"],
  "✘": ["✗", "x"],
  "→": ["→", "->"], // right arrow
  "←": ["←", "<-"],
  "↑": ["↑", "^"],
  "↓": ["↓", "v"],
  "⟶": ["→", "->"],
  "➜": ["→", "->"],
  "➡": ["→", "->"],
  "➔": ["→", "->"],
  "★": ["★", "*"],
  "●": ["•", "-"],
  "▪": ["•", "-"],
  "•": ["•", "-"],
  "“": ["“", '"'],
  "”": ["”", '"'],
  "‘": ["‘", "'"],
  "’": ["’", "'"],
  "…": ["…", "..."],
  "–": ["–", "-"],
  " ": [" "],
};

// Invisible code points that should never reach a renderer
const INVISIBLE = /[​-‍︎️⁠]/g;

/** Make text drawable in the given face. Never throws. */
export function safeText(text: string, face: FontFace): string {
  const font = kitFont(face);
  const cleaned = removeEmDashes(text).replace(INVISIBLE, "");
  let out = "";
  for (const ch of cleaned) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\n" || ch === "\t") {
      out += ch === "\t" ? " " : ch;
      continue;
    }
    const subs = SUBSTITUTES[ch];
    if (subs) {
      const pick = subs.find((s) => [...s].every((c) => font.hasGlyphForCodePoint(c.codePointAt(0)!)));
      out += pick ?? "";
      continue;
    }
    if (font.hasGlyphForCodePoint(cp)) out += ch;
    // otherwise dropped (emoji and symbols the brand fonts do not carry)
  }
  return out.replace(/[ ]{2,}/g, " ");
}

/**
 * OpenType features used for BOTH measuring and PDF drawing. Inter's
 * contextual alternates (calt) swap punctuation for case variants whose PDF
 * widths do not match, which renders as visible gaps after "+", ":", "[".
 */
export const LAYOUT_FEATURES = { calt: false } as const;

/** Width in points of a (safe) string at a size. */
export function measureText(text: string, face: FontFace, size: number): number {
  if (!text) return 0;
  const font = kitFont(face);
  return (font.layout(text, { ...LAYOUT_FEATURES }).advanceWidth * size) / font.unitsPerEm;
}

export function fontMetrics(face: FontFace) {
  const font = kitFont(face);
  return {
    ascent: font.ascent / font.unitsPerEm,
    descent: font.descent / font.unitsPerEm,
    capHeight: (font.capHeight || font.ascent * 0.7) / font.unitsPerEm,
  };
}

export function lineHeightPt(size: number, spacing = 1): number {
  return size * LINE_FACTOR * spacing;
}

/**
 * Wrap text to a width (points) using real metrics. Honors "\n". Words longer
 * than the line are split by character so nothing runs off the page.
 */
export function wrapText(text: string, face: FontFace, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const spaceW = measureText(" ", face, size);

  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/ +/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    let lineW = 0;
    for (const word of words) {
      const wordW = measureText(word, face, size);
      if (!line) {
        if (wordW <= maxWidth) {
          line = word;
          lineW = wordW;
          continue;
        }
      } else if (lineW + spaceW + wordW <= maxWidth) {
        line += " " + word;
        lineW += spaceW + wordW;
        continue;
      } else {
        lines.push(line);
        line = "";
        lineW = 0;
        if (wordW <= maxWidth) {
          line = word;
          lineW = wordW;
          continue;
        }
      }
      // Overlong token: hard-split by character
      let chunk = "";
      for (const ch of word) {
        if (chunk && measureText(chunk + ch, face, size) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
      lineW = measureText(chunk, face, size);
    }
    if (line) lines.push(line);
  }
  return lines;
}
