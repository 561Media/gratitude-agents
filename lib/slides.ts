import PptxGenJS from "pptxgenjs";
import { FONT_FAMILY, lineHeightPt, removeEmDashes } from "./brand-fonts";
import { type GraphicAsset, getAsset } from "./brand-graphics";
import { BULLET_INDENT, SLIDE_H, SLIDE_W, layoutDeck } from "./slide-layout";
import {
  extractSlides,
  type PresentationData,
  type SlideData,
} from "./slide-schema";

export type { PresentationData, SlideData } from "./slide-schema";

/**
 * Gratitude-branded PPTX generator.
 *
 * Renders the shared deck layout (lib/slide-layout.ts), so the PPTX and the
 * presentation PDF are the same slides. Typography is Anton (display, never
 * bold) + Inter (body) by name. PowerPoint does not receive embedded font
 * files from pptxgenjs, so viewers without Anton/Inter installed will see
 * their fallback font; the PDF export embeds both.
 */

const LAYOUT_NAME = "GRATITUDE_16x9";

export async function generatePptx(data: PresentationData): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: LAYOUT_NAME, width: SLIDE_W, height: SLIDE_H });
  pptx.layout = LAYOUT_NAME;
  pptx.author = "Gratitude";
  pptx.company = "Gratitude.com";
  pptx.title = removeEmDashes(data.title);

  const rendered = layoutDeck(data);

  const dataUris = new Map<GraphicAsset, string>();
  const uri = async (asset: GraphicAsset) => {
    let value = dataUris.get(asset);
    if (!value) {
      value = `image/png;base64,${(await getAsset(asset)).png.toString("base64")}`;
      dataUris.set(asset, value);
    }
    return value;
  };

  for (const page of rendered) {
    const slide = pptx.addSlide();
    slide.background = { color: "0A0A0A" };
    if (page.notes) slide.addNotes(page.notes);

    for (const prim of page.prims) {
      if (prim.kind === "rect") {
        slide.addShape(prim.radius ? "roundRect" : "rect", {
          x: prim.x,
          y: prim.y,
          w: prim.w,
          h: prim.h,
          fill: { color: prim.color },
          line: prim.line ? { color: prim.line, width: 0.75 } : { type: "none" },
          ...(prim.radius ? { rectRadius: prim.radius } : {}),
        });
      } else if (prim.kind === "image") {
        slide.addImage({ data: await uri(prim.asset), x: prim.x, y: prim.y, w: prim.w, h: prim.h });
      } else {
        const last = prim.paras.length - 1;
        slide.addText(
          prim.paras.map((p, i) => ({
            text: p.text,
            options: {
              fontFace: FONT_FAMILY[p.face],
              fontSize: p.size,
              color: p.color,
              bold: false, // Anton is weight 400 only; Inter SemiBold is its own face
              bullet: p.bullet ? { code: "2022", indent: Math.round(BULLET_INDENT * 72) } : false,
              breakLine: i < last,
              lineSpacing: Math.round(lineHeightPt(p.size, prim.spacing) * 10) / 10,
              paraSpaceAfter: p.spaceAfter || 0,
            },
          })),
          {
            x: prim.x,
            y: prim.y,
            w: prim.w,
            h: prim.h,
            margin: 0,
            align: prim.align,
            valign: prim.valign,
            fit: "none",
          }
        );
      }
    }
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  return output as Buffer;
}

/**
 * Structured slide data from a chat message. Uses validated slide JSON when
 * present; otherwise converts Markdown into slides, keeping prose AND bullets.
 */
export function parseSlideContent(content: string, title: string): PresentationData {
  const deck = extractSlides(content);
  if (deck) return { title: deck.title || title, slides: deck.slides };

  const slides: SlideData[] = [{ type: "title", title, subtitle: "Prepared by Gratitude.com" }];

  const sections = content.split(/^##\s+/m).filter((s) => s.trim());
  for (const section of sections) {
    const lines = section.trim().split("\n");
    const heading = lines[0]?.replace(/^#+\s*/, "").trim();
    const bodyLines = lines.slice(1).filter((l) => l.trim());
    const bullets = bodyLines
      .filter((l) => /^\s*([-*+]|\d+\.)\s/.test(l))
      .map((l) => l.trim().replace(/^([-*+]|\d+\.)\s+/, ""));
    const prose = bodyLines
      .filter((l) => !/^\s*([-*+]|\d+\.)\s/.test(l))
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .join("\n");

    if (bullets.length > 0 || prose) {
      slides.push({
        type: "content",
        title: heading,
        body: prose || undefined,
        bullets: bullets.length > 0 ? bullets : undefined,
      });
    }
  }

  if (slides.length === 1) {
    const all = content
      .split("\n")
      .map((l) => l.replace(/^[-*#+]+\s*/, "").trim())
      .filter(Boolean);
    slides.push({ type: "content", title: "Overview", bullets: all });
  }

  slides.push({ type: "closing", title: "Thank you", subtitle: "gratitude.com" });
  return { title, slides };
}
