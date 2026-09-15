/**
 * Branded document PDF (US Letter) from Markdown: branded header on page one,
 * gradient running header and logo footer on every page, real heading sizes,
 * line height tied to font size, lists, quotes, tables, and long-token
 * splitting. Anton + Inter embedded; unsupported glyphs substituted.
 */
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { type FontFace, lineHeightPt, measureText, safeText, wrapText } from "./brand-fonts";
import { BRAND, LOGO_ASPECT, getAsset } from "./brand-graphics";
import { baselineY, embedBrandFonts, hexToRgb } from "./deck-pdf";
import { type Block, type Run, parseMarkdownBlocks, runsText, splitDocumentTitle } from "./markdown-blocks";

const PAGE_W = 612;
const PAGE_H = 792;
const M_LEFT = 64;
const M_RIGHT = 64;
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;
const TOP = 70;
const BOTTOM = 70;

const BODY_SIZE = 10.5;
const BODY_SPACING = 1.3; // line = size x 1.2 x 1.3 = ~1.56 x size
const BODY_COLOR = "CFCFCF";

interface Word {
  text: string;
  face: FontFace;
  width: number;
  /** True when whitespace preceded this word in the source (no space is added across a run boundary like "**bold**.") */
  space: boolean;
}

/** Wrap styled runs (regular + SemiBold) into lines of positioned words. */
function wrapRuns(runs: Run[], size: number, maxW: number, baseFace: FontFace = "body"): Word[][] {
  const lines: Word[][] = [[]];
  let lineW = 0;
  const spaceW = measureText(" ", "body", size);
  let pendingSpace = false;

  for (const run of runs) {
    const face: FontFace = run.bold && baseFace === "body" ? "bodySemi" : baseFace;
    const text = safeText(run.text, face);
    const parts = text.split(/(\n| +)/);
    for (const part of parts) {
      if (!part) continue;
      if (part === "\n") {
        lines.push([]);
        lineW = 0;
        pendingSpace = false;
        continue;
      }
      if (/^ +$/.test(part)) {
        pendingSpace = true;
        continue;
      }
      const width = measureText(part, face, size);
      const current = lines[lines.length - 1];
      const space = pendingSpace && current.length > 0;
      pendingSpace = false;
      const needed = (space ? spaceW : 0) + width;
      if (lineW + needed <= maxW) {
        current.push({ text: part, face, width, space });
        lineW += needed;
        continue;
      }
      if (width <= maxW) {
        lines.push([{ text: part, face, width, space: false }]);
        lineW = width;
        continue;
      }
      // Overlong token (URL, hash, long compound): split by character
      for (const chunk of wrapText(part, face, size, maxW)) {
        const w = measureText(chunk, face, size);
        const cur = lines[lines.length - 1];
        if (cur.length === 0 && lineW === 0) {
          cur.push({ text: chunk, face, width: w, space: false });
        } else {
          lines.push([{ text: chunk, face, width: w, space: false }]);
        }
        lineW = w;
      }
    }
  }
  return lines.filter((l, i) => l.length > 0 || i < lines.length - 1);
}

class DocWriter {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;

  constructor(
    private pdf: PDFDocument,
    private fonts: Record<FontFace, PDFFont>,
    private images: { gradient: PDFImage; glow: PDFImage; logo: PDFImage },
    private title: string
  ) {}

  newPage(first = false) {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: hexToRgb(BRAND.nearBlack) });
    if (first) {
      this.drawHero();
    } else {
      this.page.drawImage(this.images.gradient, { x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4 });
      const label = safeText(this.title.toUpperCase(), "bodySemi");
      const clipped = wrapText(label, "bodySemi", 7.5, CONTENT_W)[0] || "";
      this.page.drawText(clipped, { x: M_LEFT, y: PAGE_H - 34, size: 7.5, font: this.fonts.bodySemi, color: hexToRgb(BRAND.pink) });
      this.y = TOP;
    }
  }

  private drawHero() {
    const page = this.page;
    page.drawImage(this.images.glow, { x: PAGE_W - 360, y: PAGE_H - 300, width: 420, height: 420 });
    const logoH = 18;
    page.drawImage(this.images.logo, { x: M_LEFT, y: PAGE_H - 56 - logoH, width: logoH * LOGO_ASPECT, height: logoH });

    const titleText = safeText(this.title.toUpperCase(), "display");
    let size = 40;
    let lines = wrapText(titleText, "display", size, CONTENT_W);
    for (const s of [36, 32, 28]) {
      if (lines.length <= 3) break;
      size = s;
      lines = wrapText(titleText, "display", size, CONTENT_W);
    }
    let cursor = 118;
    const lineH = lineHeightPt(size, 1.0);
    for (const line of lines) {
      page.drawText(line, {
        x: M_LEFT,
        y: PAGE_H - baselineY(cursor, lineH, "display", size),
        size,
        font: this.fonts.display,
        color: hexToRgb(BRAND.white),
      });
      cursor += lineH;
    }
    cursor += 14;
    page.drawImage(this.images.gradient, { x: M_LEFT, y: PAGE_H - cursor - 4, width: 120, height: 4 });
    cursor += 20;
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    page.drawText(safeText(`Gratitude.com  |  ${date}`, "body"), {
      x: M_LEFT,
      y: PAGE_H - baselineY(cursor, 14, "body", 9.5),
      size: 9.5,
      font: this.fonts.body,
      color: hexToRgb(BRAND.muted),
    });
    this.y = cursor + 44;
  }

  ensure(height: number) {
    if (this.y + height > PAGE_H - BOTTOM) this.newPage();
  }

  drawLine(words: Word[], x: number, size: number, lineH: number, color: string) {
    const base = baselineY(this.y, lineH, "body", size);
    const spaceW = measureText(" ", "body", size);
    let cx = x;
    for (const w of words) {
      if (w.space) cx += spaceW;
      this.page.drawText(w.text, { x: cx, y: PAGE_H - base, size, font: this.fonts[w.face], color: hexToRgb(color) });
      cx += w.width;
    }
  }

  lines(runs: Run[], opts: { size: number; spacing: number; color: string; x?: number; width?: number; face?: FontFace; marker?: { text: string; x: number; face: FontFace; color: string }; bar?: string }) {
    const x = opts.x ?? M_LEFT;
    const width = opts.width ?? CONTENT_W;
    const lineH = lineHeightPt(opts.size, opts.spacing);
    const wrapped = wrapRuns(runs, opts.size, width, opts.face || "body");
    wrapped.forEach((words, i) => {
      this.ensure(lineH);
      if (opts.bar) {
        this.page.drawRectangle({ x: M_LEFT, y: PAGE_H - this.y - lineH, width: 2.5, height: lineH, color: hexToRgb(opts.bar) });
      }
      if (i === 0 && opts.marker) {
        const base = baselineY(this.y, lineH, "body", opts.size);
        this.page.drawText(opts.marker.text, {
          x: opts.marker.x,
          y: PAGE_H - base,
          size: opts.size,
          font: this.fonts[opts.marker.face],
          color: hexToRgb(opts.marker.color),
        });
      }
      this.drawLine(words, x, opts.size, lineH, opts.color);
      this.y += lineH;
    });
  }

  heading(block: Extract<Block, { type: "heading" }>) {
    const display = block.depth <= 2;
    const size = block.depth === 1 ? 24 : block.depth === 2 ? 17 : block.depth === 3 ? 13 : 11.5;
    const face: FontFace = display ? "display" : "bodySemi";
    const text = display ? runsText(block.runs).toUpperCase() : runsText(block.runs);
    const spacing = display ? 1.0 : 1.2;
    const lineH = lineHeightPt(size, spacing);
    const before = block.depth === 1 ? 22 : block.depth === 2 ? 16 : 12;
    const lineCount = wrapText(safeText(text, face), face, size, CONTENT_W).length;
    // Keep with next: heading plus three body lines stay together
    this.y += before;
    this.ensure(lineCount * lineH + 3 * lineHeightPt(BODY_SIZE, BODY_SPACING));
    const color = block.depth <= 3 ? BRAND.white : "E6E6E6";
    for (const line of wrapText(safeText(text, face), face, size, CONTENT_W)) {
      this.page.drawText(line, {
        x: M_LEFT,
        y: PAGE_H - baselineY(this.y, lineH, face, size),
        size,
        font: this.fonts[face],
        color: hexToRgb(color),
      });
      this.y += lineH;
    }
    if (block.depth === 1) {
      this.page.drawImage(this.images.gradient, { x: M_LEFT, y: PAGE_H - this.y - 6, width: 48, height: 3 });
      this.y += 10;
    }
    this.y += 6;
  }

  table(block: Extract<Block, { type: "table" }>) {
    const cols = Math.max(block.header.length, ...block.rows.map((r) => r.length), 1);
    const colW = CONTENT_W / cols;
    const pad = 6;
    const size = 9.5;
    const lineH = lineHeightPt(size, 1.2);

    const rowHeight = (cells: Run[][], face: FontFace) =>
      Math.max(1, ...cells.map((c) => wrapRuns(c, size, colW - 2 * pad, face).length)) * lineH + 2 * pad;

    const drawRow = (cells: Run[][], face: FontFace, fill: string, color: string) => {
      const h = rowHeight(cells, face);
      this.page.drawRectangle({ x: M_LEFT, y: PAGE_H - this.y - h, width: CONTENT_W, height: h, color: hexToRgb(fill) });
      for (let c = 0; c < cols; c++) {
        const lines = wrapRuns(cells[c] || [], size, colW - 2 * pad, face);
        let ly = this.y + pad;
        for (const words of lines) {
          const base = baselineY(ly, lineH, "body", size);
          const spaceW = measureText(" ", "body", size);
          let cx = M_LEFT + c * colW + pad;
          for (const w of words) {
            if (w.space) cx += spaceW;
            this.page.drawText(w.text, { x: cx, y: PAGE_H - base, size, font: this.fonts[w.face], color: hexToRgb(color) });
            cx += w.width;
          }
          ly += lineH;
        }
      }
      this.y += h;
    };

    const header = () => {
      drawRow(block.header, "bodySemi", BRAND.elevated, BRAND.white);
      this.page.drawImage(this.images.gradient, { x: M_LEFT, y: PAGE_H - this.y - 2, width: CONTENT_W, height: 2 });
      this.y += 2;
    };

    this.ensure(rowHeight(block.header, "bodySemi") + (block.rows[0] ? rowHeight(block.rows[0], "body") : 0) + 2);
    header();
    block.rows.forEach((row, i) => {
      const h = rowHeight(row, "body");
      if (this.y + h > PAGE_H - BOTTOM) {
        this.newPage();
        header(); // repeat the header on the continuation page
      }
      drawRow(row, "body", i % 2 === 0 ? BRAND.card : BRAND.nearBlack, BODY_COLOR);
    });
    this.y += 12;
  }

  block(block: Block) {
    switch (block.type) {
      case "heading":
        this.heading(block);
        break;
      case "paragraph":
        this.lines(block.runs, { size: BODY_SIZE, spacing: BODY_SPACING, color: BODY_COLOR });
        this.y += 9;
        break;
      case "list":
        for (const item of block.items) {
          const indent = 16 + item.depth * 16;
          const marker = block.ordered ? `${item.index}.` : "•";
          this.lines(item.runs, {
            size: BODY_SIZE,
            spacing: BODY_SPACING,
            color: BODY_COLOR,
            x: M_LEFT + indent,
            width: CONTENT_W - indent,
            marker: { text: marker, x: M_LEFT + indent - (block.ordered ? 15 : 11), face: block.ordered ? "bodySemi" : "body", color: BRAND.pink },
          });
          this.y += 3;
        }
        this.y += 7;
        break;
      case "quote":
        this.y += 4;
        this.lines(block.runs, { size: 12.5, spacing: 1.3, color: BRAND.body, x: M_LEFT + 16, width: CONTENT_W - 16, bar: BRAND.pink });
        this.y += 14;
        break;
      case "rule":
        this.ensure(20);
        this.y += 8;
        this.page.drawRectangle({ x: M_LEFT, y: PAGE_H - this.y, width: CONTENT_W, height: 0.75, color: hexToRgb(BRAND.border) });
        this.y += 12;
        break;
      case "code": {
        const size = 9;
        const lineH = lineHeightPt(size, 1.25);
        this.y += 2;
        for (const line of block.text.split("\n")) {
          for (const piece of wrapText(safeText(line, "body"), "body", size, CONTENT_W - 20)) {
            this.ensure(lineH);
            this.page.drawRectangle({ x: M_LEFT, y: PAGE_H - this.y - lineH, width: CONTENT_W, height: lineH, color: hexToRgb(BRAND.card) });
            if (piece) {
              this.page.drawText(piece, {
                x: M_LEFT + 10,
                y: PAGE_H - baselineY(this.y, lineH, "body", size),
                size,
                font: this.fonts.body,
                color: hexToRgb(BRAND.body),
              });
            }
            this.y += lineH;
          }
        }
        this.y += 12;
        break;
      }
      case "table":
        this.table(block);
        break;
    }
  }

  footers() {
    const total = this.pages.length;
    const logoH = 10;
    this.pages.forEach((page, i) => {
      page.drawImage(this.images.logo, { x: M_LEFT, y: 34, width: logoH * LOGO_ASPECT, height: logoH, opacity: 0.8 });
      const label = `${i + 1} / ${total}`;
      const w = measureText(label, "body", 8.5);
      page.drawText(label, { x: PAGE_W - M_RIGHT - w, y: 35, size: 8.5, font: this.fonts.body, color: hexToRgb(BRAND.muted) });
    });
  }
}

export async function generateDocumentPdf(title: string, markdown: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const fonts = await embedBrandFonts(pdf);
  const images = {
    gradient: await pdf.embedPng((await getAsset("gradient-h")).png),
    glow: await pdf.embedPng((await getAsset("glow-pink")).png),
    logo: await pdf.embedPng((await getAsset("logo-white")).png),
  };

  const parsed = splitDocumentTitle(parseMarkdownBlocks(markdown), title);
  pdf.setTitle(parsed.title);
  pdf.setAuthor("Gratitude.com");

  const writer = new DocWriter(pdf, fonts, images, parsed.title);
  writer.newPage(true);
  for (const block of parsed.blocks) writer.block(block);
  writer.footers();

  return Buffer.from(await pdf.save());
}
