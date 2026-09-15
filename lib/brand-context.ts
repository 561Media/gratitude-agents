import fs from "fs";
import path from "path";

const BRAND_KIT_DIR = path.join(process.cwd(), "brand-kit");
const DESIGN_KIT_DIR = path.join(process.cwd(), "design-kit");
const BRAND_MEMORY_PATH = path.join(process.cwd(), ".claude", "brand-memory.md");

// Map agent IDs to retrieval rule task profiles
const AGENT_TO_PROFILE: Record<string, string> = {
  "gratitude": "website_copy",
  "orchestrator": "website_copy",
  "brand-voice": "website_copy",
  "positioning-angles": "sponsor_materials",
  "direct-response-copy": "ad_copy",
  "email-sequences": "email_campaign",
  "content-atomizer": "social_media",
  "lead-magnet": "sponsor_materials",
  "newsletter": "email_campaign",
  "gratitude-content-strategy": "website_copy",
  "social-creative": "social_graphic",
  "deliverable-design": "deliverable_design",
  "web-mockup": "web_mockup",
  "brand-asset-design": "brand_asset",
  "canvas-art": "canvas_art",
};

// Hardcoded from _retrieval-rules.yaml to avoid YAML parsing dep
const PROFILE_FILES: Record<string, { always: string[]; design?: string[] }> = {
  // investor-core.yaml is loaded directly so raise facts reach agents even when
  // KB retrieval is degraded (embeddings unavailable).
  // terminology.yaml is in every profile that writes copy: it carries the
  // locked Activate + Fund vocabulary and the retired sponsor-led lines.
  sponsor_materials: { always: ["positioning-core.yaml", "voice-core.md", "messaging-framework.md", "terminology.yaml", "investor-core.yaml"] },
  website_copy: { always: ["voice-core.md", "positioning-core.yaml", "messaging-framework.md", "terminology.yaml", "investor-core.yaml"] },
  social_media: { always: ["voice-core.md", "positioning-core.yaml", "terminology.yaml"] },
  email_campaign: { always: ["voice-core.md", "messaging-framework.md", "positioning-core.yaml", "terminology.yaml"] },
  ad_copy: { always: ["voice-core.md", "positioning-core.yaml", "terminology.yaml"] },
  social_graphic: {
    always: ["voice-core.md", "positioning-core.yaml"],
    design: ["platform-specs.yaml", "typography-guide.md"],
  },
  deliverable_design: {
    always: ["voice-core.md", "positioning-core.yaml", "messaging-framework.md", "terminology.yaml"],
    design: ["template-registry.yaml", "typography-guide.md"],
  },
  web_mockup: {
    always: ["voice-core.md", "positioning-core.yaml"],
    design: ["typography-guide.md"],
  },
  brand_asset: {
    always: ["positioning-core.yaml", "voice-core.md"],
    design: ["template-registry.yaml", "typography-guide.md"],
  },
  canvas_art: {
    always: ["positioning-core.yaml"],
    design: ["canvas-philosophy-library.md", "illustration-style.md"],
  },
};

// Cache loaded files
const fileCache = new Map<string, string>();

function readCached(filePath: string): string {
  if (fileCache.has(filePath)) return fileCache.get(filePath)!;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    fileCache.set(filePath, content);
    return content;
  } catch {
    return "";
  }
}

function loadBrandFile(filename: string): string {
  // Try brand-kit first, then design-kit
  const brandPath = path.join(BRAND_KIT_DIR, filename);
  if (fs.existsSync(brandPath)) return readCached(brandPath);
  const designPath = path.join(DESIGN_KIT_DIR, filename);
  if (fs.existsSync(designPath)) return readCached(designPath);
  return "";
}

export interface BrandContextOptions {
  /** Deck / slides / one-pager: always include presentation design context */
  presentation?: boolean;
  /** Investor or fundraising intent: always include investor-core.yaml */
  investor?: boolean;
}

export function getBrandContext(agentId: string, options: BrandContextOptions = {}): string {
  const profile = options.presentation ? "deliverable_design" : AGENT_TO_PROFILE[agentId] || "website_copy";
  const base = PROFILE_FILES[profile] || PROFILE_FILES.website_copy;
  const always = [...base.always];
  if (options.investor && !always.includes("investor-core.yaml")) always.push("investor-core.yaml");
  const config = { ...base, always };

  const sections: string[] = [];

  // Brand memory (shared across all agents)
  const brandMemory = readCached(BRAND_MEMORY_PATH);
  if (brandMemory) {
    sections.push("## Brand Memory\n" + brandMemory);
  }

  // Messaging constraints - the "what to never say" guardrails. Loaded for EVERY
  // agent unconditionally. (Previously declared only in _retrieval-rules.yaml's
  // load_if_relevant tier, which was never implemented, so no agent ever saw them.)
  const constraints = loadBrandFile("constraints-messaging.yaml");
  if (constraints) {
    sections.push("## Messaging Constraints (never violate these)\n" + constraints);
  }

  // Visual system for all design agents + any profile that uses it
  const isDesign = !!config.design;
  if (isDesign) {
    const vs = loadBrandFile("visual-system.json");
    if (vs) sections.push("## Visual System\n```json\n" + vs + "\n```");
  }

  // Always-load files
  for (const file of config.always) {
    const content = loadBrandFile(file);
    if (content) {
      const name = file.replace(/\.(yaml|yml|md|json)$/, "").replace(/-/g, " ");
      sections.push(`## ${name}\n${content}`);
    }
  }

  // Design-specific files
  if (config.design) {
    for (const file of config.design) {
      const content = loadBrandFile(file);
      if (content) {
        const name = file.replace(/\.(yaml|yml|md|json)$/, "").replace(/-/g, " ");
        sections.push(`## ${name}\n${content}`);
      }
    }
  }

  return sections.join("\n\n---\n\n");
}
