/**
 * Slide deck schema shared by the chat UI (client) and the exporters (server).
 *
 * Pure TypeScript: no fs, no fonts, no pptxgenjs. The model emits slide JSON;
 * this module finds it in a message, validates EVERY slide (not just the
 * first), and normalizes it so PPTX and PDF render exactly the same data.
 */

export const SLIDE_TYPES = [
  "title",
  "content",
  "two-column",
  "quote",
  "stats",
  "closing",
] as const;

export type SlideType = (typeof SLIDE_TYPES)[number];

export interface SlideStat {
  value: string;
  label: string;
}

export interface SlideColumn {
  heading?: string;
  bullets?: string[];
  body?: string;
}

export interface SlideData {
  type: SlideType;
  title?: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  left?: SlideColumn;
  right?: SlideColumn;
  quote?: string;
  attribution?: string;
  stats?: SlideStat[];
  notes?: string;
}

export interface PresentationData {
  title: string;
  slides: SlideData[];
}

// Common model spellings mapped onto the six supported layouts
const TYPE_ALIASES: Record<string, SlideType> = {
  title: "title",
  cover: "title",
  intro: "title",
  opening: "title",
  content: "content",
  bullets: "content",
  text: "content",
  section: "content",
  "two-column": "two-column",
  "two_column": "two-column",
  twocolumn: "two-column",
  columns: "two-column",
  comparison: "two-column",
  quote: "quote",
  testimonial: "quote",
  stats: "stats",
  metrics: "stats",
  numbers: "stats",
  closing: "closing",
  close: "closing",
  end: "closing",
  cta: "closing",
  "thank-you": "closing",
};

function str(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number") return String(value);
  return undefined;
}

function strList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    const single = str(value);
    return single ? [single] : undefined;
  }
  const items = value
    .map((v) => (typeof v === "object" && v !== null && "text" in v ? str((v as { text: unknown }).text) : str(v)))
    .filter((v): v is string => !!v);
  return items.length > 0 ? items : undefined;
}

function column(value: unknown): SlideColumn | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const col: SlideColumn = {
    heading: str(v.heading) ?? str(v.title),
    bullets: strList(v.bullets) ?? strList(v.items) ?? strList(v.points),
    body: str(v.body) ?? str(v.text),
  };
  return col.heading || col.bullets || col.body ? col : undefined;
}

/** Validate and normalize one slide. Returns null when nothing renderable is present. */
export function normalizeSlide(raw: unknown): SlideData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const rawType = (str(v.type) || "").toLowerCase().replace(/\s+/g, "-");

  const stats = Array.isArray(v.stats)
    ? v.stats
        .map((s) => {
          if (!s || typeof s !== "object") return null;
          const o = s as Record<string, unknown>;
          const value = str(o.value) ?? str(o.number) ?? str(o.stat);
          const label = str(o.label) ?? str(o.description) ?? "";
          return value ? { value, label } : null;
        })
        .filter((s): s is SlideStat => !!s)
    : undefined;

  const slide: SlideData = {
    type: TYPE_ALIASES[rawType] ?? "content",
    title: str(v.title) ?? str(v.heading),
    subtitle: str(v.subtitle),
    body: str(v.body) ?? str(v.text),
    bullets: strList(v.bullets) ?? strList(v.points),
    left: column(v.left),
    right: column(v.right),
    quote: str(v.quote),
    attribution: str(v.attribution) ?? str(v.author),
    stats: stats && stats.length > 0 ? stats : undefined,
    notes: str(v.notes) ?? str(v.speakerNotes),
  };

  // Unknown or mismatched types degrade to a layout that can show the content
  if (slide.type === "stats" && !slide.stats) slide.type = "content";
  if (slide.type === "quote" && !slide.quote) slide.type = "content";
  if (slide.type === "two-column" && !slide.left && !slide.right) slide.type = "content";

  const hasContent =
    slide.title ||
    slide.subtitle ||
    slide.body ||
    slide.bullets ||
    slide.left ||
    slide.right ||
    slide.quote ||
    slide.stats;

  return hasContent ? slide : null;
}

function slidesFromParsed(parsed: unknown): { slides: SlideData[]; invalid: number } | null {
  let list: unknown = parsed;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    list = (parsed as { slides?: unknown }).slides;
  }
  if (!Array.isArray(list) || list.length === 0) return null;
  // Must look like a deck: every entry an object, and at least one typed slide
  if (!list.every((s) => s && typeof s === "object" && !Array.isArray(s))) return null;
  if (!list.some((s) => typeof (s as { type?: unknown }).type === "string")) return null;

  const slides: SlideData[] = [];
  let invalid = 0;
  for (const raw of list) {
    const normalized = normalizeSlide(raw);
    if (normalized) slides.push(normalized);
    else invalid++;
  }
  return slides.length > 0 ? { slides, invalid } : null;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Find slide JSON in a chat message: fenced ```json blocks first (largest
 * valid deck wins), then a raw top-level array. Returns null when the message
 * is not a deck.
 */
export function extractSlides(content: string): PresentationData | null {
  if (!content) return null;
  let best: SlideData[] | null = null;

  const fence = /```(?:json|JSON)?[ \t]*\n([\s\S]*?)\n[ \t]*```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(content)) !== null) {
    const result = slidesFromParsed(tryParse(match[1].trim()));
    if (result && (!best || result.slides.length > best.length)) best = result.slides;
  }

  if (!best) {
    const start = content.indexOf("[");
    const end = content.lastIndexOf("]");
    if (start !== -1 && end > start) {
      const result = slidesFromParsed(tryParse(content.slice(start, end + 1)));
      if (result) best = result.slides;
    }
  }

  if (!best) return null;
  const titleSlide = best.find((s) => s.type === "title" && s.title);
  return { title: titleSlide?.title || best[0].title || "Gratitude Presentation", slides: best };
}

export function isSlideDeck(content: string): boolean {
  return extractSlides(content) !== null;
}
