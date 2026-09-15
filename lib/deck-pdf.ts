/**
 * Presentation PDF: one landscape 16:9 page per slide, rendered from the SAME
 * layout primitives as the PPTX (lib/slide-layout.ts). Anton and Inter are
 * embedded, so the PDF looks identical on every machine.
 */
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { type FontFace, LAYOUT_FEATURES, fontBytes, fontMetrics, lineHeightPt, measureText } from "./brand-fonts";
import { type GraphicAsset, getAsset } from "./brand-graphics";
import { BULLET_INDENT, type Prim, SLIDE_H, SLIDE_W, layoutDeck, paraLines } from "./slide-layout";
import type { PresentationData } from "./slide-schema";

const PT = 72;

export function hexToRgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function embedBrandFonts(pdf: PDFDocument): Promise<Record<FontFace, PDFFont>> {
  pdf.registerFontkit(fontkit);
  const faces: FontFace[] = ["display", "body", "bodySemi"];
  // pdf-lib's subsetter drops most Inter glyphs (verified by rendering), so
  // Inter is embedded whole; Anton subsets cleanly and stays small.
  const entries = await Promise.all(
    faces.map(
      async (f) =>
        [f, await pdf.embedFont(new Uint8Array(fontBytes(f)), { subset: f === "display", features: LAYOUT_FEATURES })] as const
    )
  );
  return Object.fromEntries(entries) as Record<FontFace, PDFFont>;
}

export function roundedRectPath(w: number, h: number, r: number): string {
  return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`;
}

/** Baseline for a line box: cap height centered in the line. */
export function baselineY(lineTop: number, lineH: number, face: FontFace, size: number): number {
  return lineTop + (lineH + fontMetrics(face).capHeight * size) / 2;
}

function drawPrim(
  page: PDFPage,
  prim: Prim,
  fonts: Record<FontFace, PDFFont>,
  images: Map<GraphicAsset, PDFImage>
) {
  const pageH = page.getHeight();

  if (prim.kind === "rect") {
    if (prim.radius) {
      page.drawSvgPath(roundedRectPath(prim.w * PT, prim.h * PT, prim.radius * PT), {
        x: prim.x * PT,
        y: pageH - prim.y * PT,
        color: hexToRgb(prim.color),
        borderColor: prim.line ? hexToRgb(prim.line) : undefined,
        borderWidth: prim.line ? 0.75 : 0,
      });
    } else {
      page.drawRectangle({
        x: prim.x * PT,
        y: pageH - (prim.y + prim.h) * PT,
        width: prim.w * PT,
        height: prim.h * PT,
        color: hexToRgb(prim.color),
      });
    }
    return;
  }

  if (prim.kind === "image") {
    page.drawImage(images.get(prim.asset)!, {
      x: prim.x * PT,
      y: pageH - (prim.y + prim.h) * PT,
      width: prim.w * PT,
      height: prim.h * PT,
    });
    return;
  }

  // Text: wrap with the same metrics the layout used, then place line by line
  const laid = prim.paras.map((p) => ({ p, lines: paraLines(p, prim.w) }));
  let totalPt = 0;
  laid.forEach(({ p, lines }, i) => {
    totalPt += lines.length * lineHeightPt(p.size, prim.spacing);
    if (i < laid.length - 1) totalPt += p.spaceAfter || 0;
  });
  const boxH = prim.h * PT;
  let cursor = prim.y * PT;
  if (prim.valign === "middle") cursor += (boxH - totalPt) / 2;
  else if (prim.valign === "bottom") cursor += boxH - totalPt;

  for (const { p, lines } of laid) {
    const lineH = lineHeightPt(p.size, prim.spacing);
    const indent = p.bullet ? BULLET_INDENT * PT : 0;
    const innerW = prim.w * PT - indent;
    lines.forEach((line, li) => {
      const base = baselineY(cursor, lineH, p.face, p.size);
      const width = measureText(line, p.face, p.size);
      let x = prim.x * PT + indent;
      if (prim.align === "center") x += (innerW - width) / 2;
      else if (prim.align === "right") x += innerW - width;
      if (p.bullet && li === 0) {
        page.drawText("•", {
          x: prim.x * PT,
          y: pageH - base,
          size: p.size,
          font: fonts.body,
          color: hexToRgb("FE3184"),
        });
      }
      if (line) {
        page.drawText(line, { x, y: pageH - base, size: p.size, font: fonts[p.face], color: hexToRgb(p.color) });
      }
      cursor += lineH;
    });
    cursor += p.spaceAfter || 0;
  }
}

export async function generateDeckPdf(data: PresentationData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(data.title);
  pdf.setAuthor("Gratitude.com");
  const fonts = await embedBrandFonts(pdf);
  const images = new Map<GraphicAsset, PDFImage>();

  const rendered = layoutDeck(data);
  for (const slide of rendered) {
    const page = pdf.addPage([SLIDE_W * PT, SLIDE_H * PT]);
    for (const prim of slide.prims) {
      if (prim.kind === "image" && !images.has(prim.asset)) {
        images.set(prim.asset, await pdf.embedPng((await getAsset(prim.asset)).png));
      }
      drawPrim(page, prim, fonts, images);
    }
  }

  return Buffer.from(await pdf.save());
}
