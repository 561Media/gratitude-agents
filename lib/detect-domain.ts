/**
 * Lightweight keyword classifier that maps conversation content to the most
 * relevant specialist agent ID, plus the context the request needs.
 *
 * This runs on every request for the unified "gratitude" agent so it must be
 * zero-latency (no API calls). Artifact type (presentation) and audience
 * (investor) are classified independently from writing expertise, and the
 * CURRENT message outweighs older history.
 */

export interface RequestContext {
  /** Specialist whose skill body is injected, or null */
  domain: string | null;
  /** Deck, slides, presentation, or one-pager: needs presentation design context */
  presentation: boolean;
  /** Investor or fundraising intent: needs investor-core.yaml */
  investor: boolean;
}

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  // Marketing specialists
  "positioning-angles": [
    "positioning", "angle", "value prop", "differentiator", "competitive",
    "funder acquisition", "sponsor acquisition", "unique selling", "usp", "pitch angle",
    "market position", "competitive advantage",
  ],
  "direct-response-copy": [
    "landing page", "copy", "headline", "cta", "call to action",
    "sales page", "page copy", "website copy",
    "conversion copy", "persuasive", "copywriting", "ad copy",
  ],
  "email-sequences": [
    "email", "sequence", "drip", "nurture", "onboarding email",
    "welcome series", "follow-up", "outreach", "cold email",
    "email campaign", "subject line",
  ],
  "content-atomizer": [
    "repurpose", "atomize", "break down", "social posts from",
    "turn into posts", "content pieces", "slice", "redistribute",
    "social content", "content calendar",
  ],
  "lead-magnet": [
    "lead magnet", "guide", "checklist", "download",
    "ebook", "whitepaper", "free resource", "gated content",
  ],
  "newsletter": [
    "newsletter", "digest", "weekly update", "monthly update",
    "subscriber", "email blast",
  ],
  "gratitude-content-strategy": [
    "content strategy", "editorial", "thought leadership",
    "authority", "blog strategy", "content plan", "pillar content",
    "content roadmap",
  ],
  "brand-voice": [
    "brand voice", "tone of voice", "messaging guide", "voice guide",
    "how we sound", "brand personality", "writing style",
  ],

  // Design specialists
  "social-creative": [
    "social graphic", "instagram", "facebook post", "linkedin graphic",
    "social media design", "post graphic", "carousel", "story design",
    "social visual",
  ],
  "deliverable-design": [
    "sponsor kit", "funder kit", "impact report", "deck design",
    "presentation design", "report layout", "formatted document",
    "designed pdf", "brochure", "case study",
  ],
  "web-mockup": [
    "mockup", "wireframe", "page design", "layout", "landing page design",
    "web design", "homepage design", "ui design",
  ],
  "brand-asset-design": [
    "email header", "og image", "open graph", "banner",
    "header image", "social banner", "infographic",
  ],
  "canvas-art": [
    "hero art", "abstract", "key visual", "illustration",
    "campaign visual", "artistic", "canvas", "generative art",
  ],
};

// Any deck-shaped artifact goes to deliverable-design with presentation context.
// STRONG words always mean a deck; a bare "slide(s)" means a deck unless the
// request is a social carousel ("a 5-slide Instagram carousel").
const STRONG_PRESENTATION_RE =
  /\b(decks?|slideshow|slide ?deck|presentations?|pitch ?deck|keynote|powerpoint|pptx|one[- ]?pagers?|investor slides?|board slides?)\b/i;
const SLIDES_RE = /\bslides?\b/i;

/**
 * Asset-type precedence (owner decision 2026-09-15: route by what is being
 * made). When the message names the ASSET, that wins over generic writing
 * words like "copy", "headline", or "email".
 */
// Social formats: carousels, stories, reel covers, platform posts and graphics
const SOCIAL_ASSET_RE =
  /\b(carousels?|reel covers?|story (design|graphic|post)s?|social (post|graphic|visual|media design)s?|post graphics?|(instagram|insta|ig|linkedin|tiktok|facebook|fb)( \w+)? (posts?|stor(y|ies)|reels?|graphics?|visuals?|carousels?|stat callouts?))\b/i;
// Repurposing a source into posts stays with the content atomizer
const ATOMIZE_RE = /\b(repurpose|atomi[sz]e|turn (this |these |it )?into posts|break (this |it )?down|social posts from|posts from (this|the|our) )/i;
// Lead magnet assets: opt-in pages, freebies, downloads, and their delivery email
const LEAD_MAGNET_ASSET_RE =
  /\b(lead magnets?|opt-?in (page|form)s?|freebies?|free (resource|download)s?|gated (content|guide|download)s?|downloadable|(checklist|guide|ebook|e-book|whitepaper|workbook|template|toolkit)s? (download|pdf)s?|delivery emails? for (the|our|a|this) (lead magnet|guide|checklist|download|freebie))\b/i;
// A mockup of an opt-in page is web design (web-mockup), not the lead magnet itself
const MOCKUP_RE = /\b(mock ?-?ups?|wireframes?)\b/i;
// Brand assets: email headers and banners, logo lockups, OG images, brand graphics
const BRAND_ASSET_RE =
  /\b(email headers?|email banners?|header images?|banners?|logo lockups?|lockups?|brand graphics?|og images?|open graph( images?)?|infographics?)\b/i;

/** The asset named in one message, or null. Social is checked first so a
 * "LinkedIn carousel for our checklist download" is still a carousel. */
function assetDomain(text: string): string | null {
  if (SOCIAL_ASSET_RE.test(text) && !ATOMIZE_RE.test(text)) return "social-creative";
  if (BRAND_ASSET_RE.test(text) && !SOCIAL_ASSET_RE.test(text)) return "brand-asset-design";
  if (LEAD_MAGNET_ASSET_RE.test(text)) return MOCKUP_RE.test(text) ? "web-mockup" : "lead-magnet";
  return null;
}

function isPresentation(text: string): boolean {
  if (STRONG_PRESENTATION_RE.test(text)) return true;
  return SLIDES_RE.test(text) && !/\bcarousels?\b/i.test(text);
}

const INVESTOR_RE =
  /\b(investors?|investment memo|fundrais(e|ing)|venture capital|vcs?\b|angel investors?|pre-?seed|seed round|series [ab]\b|cap table|valuation|safe note|the raise|our raise|raising (capital|money|a round)|data room)\b/i;

const CURRENT_WEIGHT = 3;
const HISTORY_WINDOW = 6;

function scoreText(text: string): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [agentId, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        // Longer keywords are more specific, weight them higher
        score += keyword.split(" ").length;
      }
    }
    if (score > 0) scores.set(agentId, score);
  }
  return scores;
}

export function detectRequestContext(msgs: { role: string; content: string }[]): RequestContext {
  const userMsgs = msgs
    .filter((m) => m.role === "user")
    .slice(-HISTORY_WINDOW)
    .map((m) => m.content.toLowerCase());

  if (userMsgs.length === 0) return { domain: null, presentation: false, investor: false };

  const current = userMsgs[userMsgs.length - 1];
  const earlier = userMsgs.slice(0, -1).join(" ");

  const currentScores = scoreText(current);
  const earlierScores = scoreText(earlier);

  const investor = INVESTOR_RE.test(current) || INVESTOR_RE.test(earlier);

  const currentAsset = assetDomain(current);
  let lastEarlierAsset: string | null = null;
  for (let i = userMsgs.length - 2; i >= 0 && !lastEarlierAsset; i--) lastEarlierAsset = assetDomain(userMsgs[i]);

  // Presentation intent in the current message always wins over writing
  // specialists. In a revision ("make slide 3 shorter", "tighten the closing")
  // the artifact type persists from earlier turns unless the current message
  // clearly asks for something else. A named social carousel is not a deck,
  // and a bare "slide 3" while revising a carousel stays with the carousel.
  const weakSlideInCarouselRevision =
    !STRONG_PRESENTATION_RE.test(current) && !currentAsset && lastEarlierAsset === "social-creative";
  const currentPresentation =
    isPresentation(current) && currentAsset !== "social-creative" && !weakSlideInCarouselRevision;
  const currentBest = [...currentScores.entries()].sort((a, b) => b[1] - a[1])[0];
  const currentIsOtherArtifact =
    !!currentAsset || (!!currentBest && currentBest[1] >= 2 && currentBest[0] !== "deliverable-design");
  const presentation = currentPresentation || (isPresentation(earlier) && !currentIsOtherArtifact);

  if (presentation) {
    return { domain: "deliverable-design", presentation: true, investor };
  }

  // The asset being made wins over generic words like "copy" or "email"
  if (currentAsset) {
    return { domain: currentAsset, presentation: false, investor };
  }

  // A revision with no domain signal of its own ("make it shorter") keeps the
  // asset named in the most recent earlier message that named one
  if (lastEarlierAsset && (!currentBest || currentBest[1] < 2)) {
    return { domain: lastEarlierAsset, presentation: false, investor };
  }

  const combined = new Map<string, number>();
  for (const [id, s] of earlierScores) combined.set(id, s);
  for (const [id, s] of currentScores) combined.set(id, (combined.get(id) || 0) + s * CURRENT_WEIGHT);

  const best = [...combined.entries()].sort((a, b) => b[1] - a[1])[0];
  // Require a meaningful match (at least 2 keyword-words, current message weighted)
  const domain = best && best[1] >= 2 ? best[0] : null;

  return { domain, presentation: false, investor };
}

/** Back-compat wrapper: specialist id only. */
export function detectSpecialistDomain(msgs: { role: string; content: string }[]): string | null {
  return detectRequestContext(msgs).domain;
}
