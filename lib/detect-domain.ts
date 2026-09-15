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

// Any deck-shaped artifact goes to deliverable-design with presentation context
const PRESENTATION_RE =
  /\b(decks?|slides?|slideshow|slide ?deck|presentations?|pitch ?deck|keynote|powerpoint|pptx|one[- ]?pagers?)\b/i;

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

  // Presentation intent in the current message always wins. In a revision
  // ("make slide 3 shorter", "tighten the closing") the artifact type persists
  // from earlier turns unless the current message clearly asks for something else.
  const currentPresentation = PRESENTATION_RE.test(current);
  const currentBest = [...currentScores.entries()].sort((a, b) => b[1] - a[1])[0];
  const currentIsOtherArtifact = !!currentBest && currentBest[1] >= 2 && currentBest[0] !== "deliverable-design";
  const presentation = currentPresentation || (PRESENTATION_RE.test(earlier) && !currentIsOtherArtifact);

  if (presentation) {
    return { domain: "deliverable-design", presentation: true, investor };
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
