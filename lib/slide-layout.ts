/**
 * Deck layout engine: turns validated slide data into positioned primitives
 * (rects, images, text boxes) on a true 16:9 grid. PPTX and PDF both render
 * THESE primitives, so the two downloads show the same slides.
 *
 * Rules enforced here rather than left to PowerPoint:
 * - every x/w/center derives from SLIDE_W x SLIDE_H (13.333 x 7.5 in)
 * - text is measured with the real Anton/Inter metrics
 * - sizes never drop below readable minimums; overflow becomes continuation slides
 * - stats beyond one row are paginated, never dropped
 * - prose and bullets on the same slide are both kept
 */
import { type FontFace, lineHeightPt, safeText, wrapText } from "./brand-fonts";
import { BRAND, type GraphicAsset, LOGO_ASPECT } from "./brand-graphics";
import type { PresentationData, SlideColumn, SlideData, SlideStat } from "./slide-schema";

// ---- Grid (inches) ---------------------------------------------------------
export const SLIDE_W = 13.333333;
export const SLIDE_H = 7.5;
export const MARGIN_X = 0.75;
export const CONTENT_W = SLIDE_W - 2 * MARGIN_X;
export const CENTER_X = SLIDE_W / 2;
export const TITLE_Y = 0.6;
export const BODY_BOTTOM = SLIDE_H - 1.0;
export const BULLET_INDENT = 0.32;
export const STATS_PER_SLIDE = 4;

/** Readable minimums (pt). Content that does not fit at these sizes continues on a new slide. */
export const MIN_SIZE = { body: 14, column: 14, statLabel: 12, quote: 20, title: 24 } as const;

const DISPLAY_SPACING = 1.0;
const BODY_SPACING = 1.25;
const CONT = " (CONT.)";

// ---- Primitives ------------------------------------------------------------
export interface TextPara {
  text: string;
  face: FontFace;
  size: number;
  color: string;
  bullet?: boolean;
  /** Space after this paragraph, in points */
  spaceAfter?: number;
}

export type Prim =
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: string; radius?: number; line?: string }
  | { kind: "image"; asset: GraphicAsset; x: number; y: number; w: number; h: number }
  | {
      kind: "text";
      x: number;
      y: number;
      w: number;
      h: number;
      align: "left" | "center" | "right";
      valign: "top" | "middle" | "bottom";
      spacing: number;
      paras: TextPara[];
    };

export interface RenderedSlide {
  prims: Prim[];
  notes?: string;
}

interface Page {
  prims: Prim[];
  notes?: string;
  bar: boolean;
  footer: boolean;
}

// ---- Measurement helpers ---------------------------------------------------
export function paraLines(p: TextPara, w: number): string[] {
  return wrapText(p.text, p.face, p.size, (w - (p.bullet ? BULLET_INDENT : 0)) * 72);
}

/** Height in inches of a paragraph stack in a box of width w. */
export function parasHeight(paras: TextPara[], w: number, spacing: number): number {
  let pt = 0;
  paras.forEach((p, i) => {
    pt += paraLines(p, w).length * lineHeightPt(p.size, spacing);
    if (i < paras.length - 1) pt += p.spaceAfter || 0;
  });
  return pt / 72;
}

interface Fit {
  size: number;
  lines: number;
  h: number;
}

function fitText(text: string, face: FontFace, w: number, sizes: number[], maxLines: number, spacing: number): Fit {
  let fit: Fit = { size: sizes[sizes.length - 1], lines: 0, h: 0 };
  for (const size of sizes) {
    const lines = wrapText(text, face, size, w * 72).length;
    fit = { size, lines, h: (lines * lineHeightPt(size, spacing)) / 72 };
    if (lines <= maxLines) return fit;
  }
  return fit;
}

const upper = (s: string) => safeText(s.toUpperCase(), "display");
const body = (s: string) => safeText(s, "body");

interface Unit {
  text: string;
  bullet: boolean;
}

function bodyUnits(bodyText?: string, bullets?: string[]): Unit[] {
  const units: Unit[] = [];
  if (bodyText) {
    for (const para of bodyText.split(/\n\s*\n|\n/)) {
      const t = body(para.replace(/^[-*]\s+/, "").trim());
      if (t) units.push({ text: t, bullet: /^\s*[-*]\s+/.test(para) });
    }
  }
  for (const b of bullets || []) {
    const t = body(b);
    if (t) units.push({ text: t, bullet: true });
  }
  return units;
}

function unitParas(units: Unit[], size: number, color: string): TextPara[] {
  return units.map((u, i) => ({
    text: u.text,
    face: "body" as const,
    size,
    color,
    bullet: u.bullet,
    spaceAfter: i < units.length - 1 ? Math.round(size * 0.55) : 0,
  }));
}

/** Split one unit into pieces that each fit maxH at this size. */
function splitUnit(unit: Unit, size: number, w: number, maxH: number): Unit[] {
  const lines = wrapText(unit.text, "body", size, (w - (unit.bullet ? BULLET_INDENT : 0)) * 72);
  const perPage = Math.max(1, Math.floor((maxH * 72) / lineHeightPt(size, BODY_SPACING)));
  const pieces: Unit[] = [];
  for (let i = 0; i < lines.length; i += perPage) {
    pieces.push({ text: lines.slice(i, i + perPage).join(" "), bullet: unit.bullet && i === 0 });
  }
  return pieces;
}

/** Largest size in `sizes` where all units fit; otherwise paginate at the minimum. */
function fitUnits(units: Unit[], w: number, maxH: number, sizes: number[], color: string): { size: number; pages: Unit[][] } {
  for (const size of sizes) {
    if (parasHeight(unitParas(units, size, color), w, BODY_SPACING) <= maxH) {
      return { size, pages: [units] };
    }
  }
  const size = sizes[sizes.length - 1];
  const pages: Unit[][] = [];
  let current: Unit[] = [];
  for (const unit of units) {
    const alone = parasHeight(unitParas([unit], size, color), w, BODY_SPACING);
    const pieces = alone > maxH ? splitUnit(unit, size, w, maxH) : [unit];
    for (const piece of pieces) {
      const next = [...current, piece];
      if (current.length > 0 && parasHeight(unitParas(next, size, color), w, BODY_SPACING) > maxH) {
        pages.push(current);
        current = [piece];
      } else {
        current = next;
      }
    }
  }
  if (current.length > 0) pages.push(current);
  return { size, pages: pages.length > 0 ? pages : [[]] };
}

function textBox(
  x: number,
  y: number,
  w: number,
  h: number,
  paras: TextPara[],
  opts: { align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom"; spacing?: number } = {}
): Prim {
  return {
    kind: "text",
    x,
    y,
    w,
    h,
    align: opts.align || "left",
    valign: opts.valign || "top",
    spacing: opts.spacing ?? BODY_SPACING,
    paras,
  };
}

// ---- Slide titles ----------------------------------------------------------
interface TitleFit {
  prim: (cont: boolean) => Prim[];
  bottom: number;
}

function slideTitle(title: string | undefined, willContinue: boolean): TitleFit {
  if (!title) return { prim: () => [], bottom: TITLE_Y - 0.1 };
  const base = upper(title);
  // Size against the longest variant so every continuation slide lines up
  const fit = fitText(willContinue ? base + CONT : base, "display", CONTENT_W, [40, 36, 32, 28, 26, MIN_SIZE.title], 2, DISPLAY_SPACING);
  return {
    bottom: TITLE_Y + fit.h,
    prim: (cont) => [
      textBox(MARGIN_X, TITLE_Y, CONTENT_W, fit.h, [
        { text: cont ? base + CONT : base, face: "display", size: fit.size, color: BRAND.white },
      ], { spacing: DISPLAY_SPACING }),
    ],
  };
}

// ---- Builders ----------------------------------------------------------------
function buildContent(slide: SlideData): Page[] {
  const units = bodyUnits(slide.body, slide.bullets);
  const probeTitle = slideTitle(slide.title, true);
  const top = probeTitle.bottom + 0.35;
  const maxH = BODY_BOTTOM - top;
  const fit = fitUnits(units, CONTENT_W, maxH, [22, 20, 18, 16, 15, MIN_SIZE.body], BRAND.body);
  const title = fit.pages.length > 1 ? probeTitle : slideTitle(slide.title, false);
  const bodyTop = title.bottom + 0.35;

  return fit.pages.map((pageUnits, i) => ({
    bar: true,
    footer: true,
    notes: i === 0 ? slide.notes : undefined,
    prims: [
      ...title.prim(i > 0),
      ...(pageUnits.length > 0
        ? [textBox(MARGIN_X, bodyTop, CONTENT_W, BODY_BOTTOM - bodyTop, unitParas(pageUnits, fit.size, BRAND.body))]
        : []),
    ],
  }));
}

function buildTwoColumn(slide: SlideData): Page[] {
  const gap = 0.8;
  const colW = (CONTENT_W - gap) / 2;
  const title = slideTitle(slide.title, true);
  const top = title.bottom + 0.4;
  const cols: (SlideColumn | undefined)[] = [slide.left, slide.right];

  const headings = cols.map((c) =>
    c?.heading ? { text: upper(c.heading), fit: fitText(upper(c.heading), "display", colW, [24, 22, 20], 2, DISPLAY_SPACING) } : null
  );
  const headingH = Math.max(0, ...headings.map((h) => (h ? h.fit.h + 0.2 : 0)));
  const bodyTop = top + headingH;
  const maxH = BODY_BOTTOM - bodyTop;
  const units = cols.map((c) => bodyUnits(c?.body, c?.bullets));

  const sizes = [20, 18, 16, 15, MIN_SIZE.column];
  let size = MIN_SIZE.column as number;
  let pagesPerCol: Unit[][][] | null = null;
  for (const s of sizes) {
    if (units.every((u) => parasHeight(unitParas(u, s, BRAND.body), colW, BODY_SPACING) <= maxH)) {
      size = s;
      pagesPerCol = units.map((u) => [u]);
      break;
    }
  }
  if (!pagesPerCol) {
    pagesPerCol = units.map((u) => fitUnits(u, colW, maxH, [MIN_SIZE.column], BRAND.body).pages);
  }
  const pageCount = Math.max(1, ...pagesPerCol.map((p) => p.length));
  const finalTitle = pageCount > 1 ? title : slideTitle(slide.title, false);

  const pages: Page[] = [];
  for (let i = 0; i < pageCount; i++) {
    const prims: Prim[] = [...finalTitle.prim(i > 0)];
    prims.push({ kind: "rect", x: MARGIN_X + colW + gap / 2 - 0.005, y: top, w: 0.01, h: BODY_BOTTOM - top, color: BRAND.border });
    cols.forEach((_, c) => {
      const x = MARGIN_X + c * (colW + gap);
      const heading = headings[c];
      if (heading) {
        prims.push(
          textBox(x, top, colW, heading.fit.h, [
            { text: i > 0 ? heading.text + CONT : heading.text, face: "display", size: heading.fit.size, color: BRAND.pink },
          ], { spacing: DISPLAY_SPACING })
        );
      }
      const pageUnits = pagesPerCol![c][i];
      if (pageUnits && pageUnits.length > 0) {
        prims.push(textBox(x, bodyTop, colW, maxH, unitParas(pageUnits, size, BRAND.body)));
      }
    });
    pages.push({ bar: true, footer: true, notes: i === 0 ? slide.notes : undefined, prims });
  }
  return pages;
}

function chunkStats(stats: SlideStat[]): SlideStat[][] {
  const pageCount = Math.ceil(stats.length / STATS_PER_SLIDE);
  const per = Math.ceil(stats.length / pageCount);
  const chunks: SlideStat[][] = [];
  for (let i = 0; i < stats.length; i += per) chunks.push(stats.slice(i, i + per));
  return chunks;
}

function buildStats(slide: SlideData): Page[] {
  const chunks = chunkStats(slide.stats || []);
  const title = slideTitle(slide.title, chunks.length > 1);
  const top = title.bottom + 0.35;
  const availableH = BODY_BOTTOM - top;

  return chunks.map((chunk, i) => {
    const k = chunk.length;
    const gap = 0.35;
    const cardW = Math.min(3.8, (CONTENT_W - gap * (k - 1)) / k);
    const cardH = Math.min(3.6, availableH - 0.2);
    const totalW = k * cardW + (k - 1) * gap;
    const startX = CENTER_X - totalW / 2;
    const cardY = top + (availableH - cardH) / 2;
    const innerW = cardW - 0.5;

    // One value size and one label size per slide keeps the row even
    const values = chunk.map((s) => safeText(s.value.toUpperCase(), "display"));
    const labels = chunk.map((s) => body(s.label));
    const valueSizes = [72, 64, 56, 48, 40, 34, 28];
    const valueSize = valueSizes.find((sz) => values.every((v) => wrapText(v, "display", sz, innerW * 72).length === 1)) ?? 28;
    const valueH = Math.max(...values.map((v) => wrapText(v, "display", valueSize, innerW * 72).length)) * lineHeightPt(valueSize, DISPLAY_SPACING) / 72;
    const labelTop = 0.45 + valueH + 0.2;
    const labelMaxH = cardH - labelTop - 0.6;
    const labelSizes = [18, 16, 15, 14, 13, MIN_SIZE.statLabel];
    const labelSize =
      labelSizes.find((sz) =>
        labels.every((l) => parasHeight([{ text: l, face: "body", size: sz, color: BRAND.body }], innerW, BODY_SPACING) <= labelMaxH)
      ) ?? MIN_SIZE.statLabel;

    const prims: Prim[] = [...title.prim(i > 0)];
    chunk.forEach((_, c) => {
      const x = startX + c * (cardW + gap);
      prims.push({ kind: "rect", x, y: cardY, w: cardW, h: cardH, color: BRAND.card, radius: 0.12, line: BRAND.border });
      prims.push(
        textBox(x + 0.25, cardY + 0.45, innerW, valueH, [
          { text: values[c], face: "display", size: valueSize, color: BRAND.pink },
        ], { align: "center", spacing: DISPLAY_SPACING })
      );
      if (labels[c]) {
        prims.push(
          textBox(x + 0.25, cardY + labelTop, innerW, Math.max(labelMaxH, 0.4), [
            { text: labels[c], face: "body", size: labelSize, color: BRAND.body },
          ], { align: "center" })
        );
      }
      prims.push({ kind: "image", asset: "gradient-h", x: x + cardW / 2 - 0.45, y: cardY + cardH - 0.38, w: 0.9, h: 0.05 });
    });
    return { bar: true, footer: true, notes: i === 0 ? slide.notes : undefined, prims };
  });
}

function buildQuote(slide: SlideData): Page[] {
  const x = MARGIN_X + 1.1;
  const w = CONTENT_W - 2.2;
  const regionTop = 1.3;
  const regionH = SLIDE_H - 1.2 - regionTop;
  const quote = body(slide.quote || slide.body || "");
  const attribution = slide.attribution ? body(slide.attribution) : "";

  const parasFor = (text: string, size: number, withAttribution: boolean): TextPara[] => {
    const paras: TextPara[] = [{ text, face: "body", size, color: BRAND.white, spaceAfter: withAttribution ? 20 : 0 }];
    // Attribution on its own line: no programmatic dash
    if (withAttribution) paras.push({ text: attribution, face: "bodySemi", size: 18, color: BRAND.pink });
    return paras;
  };

  const sizes = [36, 32, 28, 26, 24, 22, MIN_SIZE.quote];
  let size: number = MIN_SIZE.quote;
  let chunks: string[] = [quote];
  const fitsAt = sizes.find((sz) => parasHeight(parasFor(quote, sz, !!attribution), w, BODY_SPACING) <= regionH);
  if (fitsAt) {
    size = fitsAt;
  } else {
    const attributionH = attribution ? (lineHeightPt(18, BODY_SPACING) + 20) / 72 : 0;
    chunks = splitUnit({ text: quote, bullet: false }, size, w, regionH - attributionH).map((u) => u.text);
  }

  return chunks.map((text, i) => ({
    bar: false,
    footer: true,
    notes: i === 0 ? slide.notes : undefined,
    prims: [
      textBox(MARGIN_X + 0.1, 0.55, 1.4, 1.7, [{ text: "“", face: "display", size: 150, color: BRAND.pink }], {
        spacing: DISPLAY_SPACING,
      }),
      textBox(x, regionTop, w, regionH, parasFor(text, size, !!attribution && i === chunks.length - 1), { valign: "middle" }),
    ],
  }));
}

function buildHero(slide: SlideData, closing: boolean): Page[] {
  const titleText = upper(slide.title || (closing ? "Thank you" : "Gratitude.com"));
  const titleW = CONTENT_W - 1.0;
  const title = fitText(titleText, "display", titleW, closing ? [60, 54, 48, 44, 40, 36] : [72, 66, 60, 54, 48, 44, 40, 36], 3, DISPLAY_SPACING);
  const subtitle = slide.subtitle ? body(slide.subtitle) : "";
  const subW = CONTENT_W - 2.0;
  const sub = subtitle ? fitText(subtitle, "body", subW, [26, 24, 22, 20, 18], 3, BODY_SPACING) : null;
  const bodyText = closing && slide.body ? body(slide.body) : "";
  const bodyW = CONTENT_W - 2.5;
  const bodyFit = bodyText ? fitText(bodyText, "body", bodyW, [18, 16, 15, MIN_SIZE.body], 4, BODY_SPACING) : null;

  const barGap = 0.3;
  const groupH = title.h + barGap + 0.06 + (sub ? barGap + sub.h : 0) + (bodyFit ? 0.25 + bodyFit.h : 0);
  const logoH = 0.36;
  const usableH = SLIDE_H - 1.2;
  const top = Math.max(0.5, (usableH - groupH) / 2 + 0.1);

  const prims: Prim[] = [
    { kind: "image", asset: "glow-pink", x: CENTER_X - 3.6, y: 0.1, w: 7.2, h: 7.2 },
    { kind: "image", asset: "glow-orange", x: CENTER_X + 1.0, y: 0.2, w: 4.6, h: 4.6 },
  ];
  let y = top;
  prims.push(textBox(CENTER_X - titleW / 2, y, titleW, title.h, [
    { text: titleText, face: "display", size: title.size, color: BRAND.white },
  ], { align: "center", spacing: DISPLAY_SPACING }));
  y += title.h + barGap;
  prims.push({ kind: "image", asset: "gradient-h", x: CENTER_X - 1.2, y, w: 2.4, h: 0.06 });
  y += 0.06;
  if (sub) {
    y += barGap;
    prims.push(textBox(CENTER_X - subW / 2, y, subW, sub.h, [
      { text: subtitle, face: "body", size: sub.size, color: BRAND.body },
    ], { align: "center" }));
    y += sub.h;
  }
  if (bodyFit) {
    y += 0.25;
    prims.push(textBox(CENTER_X - bodyW / 2, y, bodyW, bodyFit.h, [
      { text: bodyText, face: "body", size: bodyFit.size, color: BRAND.muted },
    ], { align: "center" }));
  }
  const logoW = logoH * LOGO_ASPECT;
  prims.push({ kind: "image", asset: "logo-white", x: CENTER_X - logoW / 2, y: SLIDE_H - 0.95, w: logoW, h: logoH });

  return [{ bar: false, footer: false, notes: slide.notes, prims }];
}

function buildSlide(slide: SlideData): Page[] {
  switch (slide.type) {
    case "title":
      return buildHero(slide, false);
    case "closing":
      return buildHero(slide, true);
    case "two-column":
      return buildTwoColumn(slide);
    case "quote":
      return buildQuote(slide);
    case "stats":
      return buildStats(slide);
    default:
      return buildContent(slide);
  }
}

export function layoutDeck(data: PresentationData): RenderedSlide[] {
  const pages = data.slides.flatMap(buildSlide);
  const total = pages.length;
  const logoH = 0.26;

  return pages.map((page, i) => {
    const prims: Prim[] = [{ kind: "rect", x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, color: BRAND.nearBlack }];
    if (page.bar) prims.push({ kind: "image", asset: "gradient-h", x: 0, y: 0, w: SLIDE_W, h: 0.07 });
    prims.push(...page.prims);
    if (page.footer) {
      prims.push({ kind: "image", asset: "logo-white", x: MARGIN_X, y: SLIDE_H - 0.6, w: logoH * LOGO_ASPECT, h: logoH });
      prims.push(
        textBox(SLIDE_W - MARGIN_X - 1.5, SLIDE_H - 0.66, 1.5, 0.38, [
          { text: `${i + 1} / ${total}`, face: "body", size: 11, color: BRAND.muted },
        ], { align: "right", valign: "middle" })
      );
    }
    return { prims, notes: page.notes ? safeText(page.notes, "body") : undefined };
  });
}

/** Every primitive must sit inside the 13.333 x 7.5 slide. Returns offenders. */
export function outOfBounds(slides: RenderedSlide[]): string[] {
  const issues: string[] = [];
  const eps = 0.001;
  slides.forEach((s, i) =>
    s.prims.forEach((p) => {
      if (p.x < -eps || p.y < -eps || p.x + p.w > SLIDE_W + eps || p.y + p.h > SLIDE_H + eps) {
        issues.push(`slide ${i + 1}: ${p.kind} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) ${p.w.toFixed(2)}x${p.h.toFixed(2)}`);
      }
    })
  );
  return issues;
}
