"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";

type BoardSection = "capabilities" | "workflows" | "exports" | "tips";

// 24px-viewBox stroke icon paths, rendered at 16px / 1.5 weight like the
// chat task rows
const ICONS: Record<string, React.ReactNode> = {
  pencil: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </>
  ),
  chart: (
    <>
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="12" y1="20" x2="12" y2="8" />
      <line x1="18" y1="20" x2="18" y2="4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <polyline points="22 6 12 13 2 6" />
    </>
  ),
  layers: (
    <>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </>
  ),
  file: (
    <>
      <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </>
  ),
};

const CAPABILITIES = [
  {
    icon: "pencil",
    title: "Copy & messaging",
    description: "Landing pages, sponsor pitches, email sequences, ad copy, brand voice",
    examples: ["Write a sponsor acquisition email sequence", "Draft landing page copy for our activator program"],
  },
  {
    icon: "chart",
    title: "Presentations",
    description: "Branded PPTX decks with dark theme, gradient accents, and multiple slide layouts",
    examples: ["Create a sponsor pitch deck", "Build a quarterly impact report presentation"],
  },
  {
    icon: "calendar",
    title: "Content calendars",
    description: "Multi-platform content plans exportable as branded Excel or CSV",
    examples: ["Build a 4-week social media rollout", "Create a content calendar for next month"],
  },
  {
    icon: "search",
    title: "Live research",
    description: "Searches the web in real-time for current trends, competitor data, and industry stats",
    examples: ["Research latest CSR sponsorship trends", "What are competitors doing in the gratitude space?"],
  },
  {
    icon: "mail",
    title: "Email sequences",
    description: "Nurture flows, onboarding series, sponsor outreach, and newsletter content",
    examples: ["Write a 5-email sponsor nurture sequence", "Create a partner onboarding welcome series"],
  },
  {
    icon: "layers",
    title: "Design direction",
    description: "Creative briefs, layout specs, visual system guidance, and brand-compliant direction",
    examples: ["Spec out a social media graphic for our campaign", "What should our impact report layout look like?"],
  },
  {
    icon: "share",
    title: "Social media",
    description: "Platform-specific posts, carousel concepts, hashtag strategies, and content atomization",
    examples: ["Create Instagram carousel content from our blog post", "Generate a week of LinkedIn posts"],
  },
  {
    icon: "file",
    title: "Documents & reports",
    description: "Impact reports, case studies, lead magnets, sponsor kits, and partner decks",
    examples: ["Write a case study for our latest sponsor", "Create a lead magnet PDF outline"],
  },
];

const WORKFLOWS = [
  {
    title: "Sponsor acquisition campaign",
    steps: [
      { label: "Research", detail: "Identify positioning angles and competitor landscape" },
      { label: "Messaging", detail: "Craft the core value proposition and sponsor benefits" },
      { label: "Copy", detail: "Write outreach emails, landing page, and pitch deck" },
      { label: "Distribute", detail: "Create social content and email sequences to amplify" },
    ],
    prompt: "I need to build a complete sponsor acquisition campaign",
  },
  {
    title: "Content launch",
    steps: [
      { label: "Strategy", detail: "Define content pillars, audience, and cadence" },
      { label: "Calendar", detail: "Build multi-platform calendar with specific posts" },
      { label: "Create", detail: "Write each piece with platform-specific formatting" },
      { label: "Export", detail: "Download calendar as Excel and content as documents" },
    ],
    prompt: "Plan and create a full month content launch",
  },
  {
    title: "Partner onboarding kit",
    steps: [
      { label: "Welcome", detail: "Write the onboarding email sequence" },
      { label: "Guide", detail: "Create a partner guide or lead magnet" },
      { label: "Deck", detail: "Build a branded presentation for the partnership" },
      { label: "Nurture", detail: "Set up ongoing nurture content" },
    ],
    prompt: "Build a complete partner onboarding kit",
  },
  {
    title: "Impact report",
    steps: [
      { label: "Data", detail: "Research and compile activation metrics" },
      { label: "Narrative", detail: "Write the story around the numbers" },
      { label: "Slides", detail: "Generate a branded PPTX with stats and insights" },
      { label: "Document", detail: "Export as PDF for distribution" },
    ],
    prompt: "Create a quarterly impact report with our latest numbers",
  },
];

const EXPORTS = [
  {
    format: "PPTX",
    label: "PowerPoint",
    description: "Branded dark-theme slides with Gratitude colors, logo, and 6 layout types",
    bestFor: "Presentations, pitch decks, reports",
    accent: true,
  },
  {
    format: "XLSX",
    label: "Excel",
    description: "Branded spreadsheet with pink header, dark theme, auto-sized columns, and logo",
    bestFor: "Content calendars, data exports, schedules",
    accent: true,
  },
  {
    format: "CSV",
    label: "CSV",
    description: "Raw comma-separated data for import into any tool",
    bestFor: "Data imports, custom processing",
    accent: false,
  },
  {
    format: "PDF",
    label: "PDF",
    description: "Clean formatted document for sharing and printing",
    bestFor: "Final deliverables, client-facing documents",
    accent: false,
  },
  {
    format: "DOC",
    label: "Word",
    description: "Editable document format for further refinement",
    bestFor: "Drafts that need team editing",
    accent: false,
  },
  {
    format: "MD",
    label: "Markdown",
    description: "Plain text with formatting for developers and CMS",
    bestFor: "Blog posts, documentation, CMS content",
    accent: false,
  },
];

const TIPS = [
  {
    title: "Be specific about the deliverable",
    body: "Instead of 'help with marketing,' say 'write a 5-email sponsor nurture sequence targeting Fortune 500 CSR directors.' The more context you give, the better the output.",
    category: "Prompting",
  },
  {
    title: "Ask for the format you need",
    body: "Say 'give me this as a presentation' or 'create a content calendar' and the assistant will structure the output for that specific export format.",
    category: "Exports",
  },
  {
    title: "Use follow-ups to refine",
    body: "Start broad, then drill down. 'Make the tone more urgent' or 'add a slide about ROI metrics' - the assistant remembers the full conversation.",
    category: "Prompting",
  },
  {
    title: "Research is built in",
    body: "Ask about current trends, competitor activity, or industry data and the assistant will search the web and cite its sources automatically.",
    category: "Research",
  },
  {
    title: "Your conversations stay yours",
    body: "Teammates don't see your conversations or files in their workspace. Approved key learnings (never your full chats) can be added to the shared knowledgebase so everyone's results improve over time.",
    category: "Privacy",
  },
  {
    title: "Download from code blocks",
    body: "When the assistant outputs a CSV or table, look for the download buttons directly on the code block - CSV for raw data, Excel for the branded version.",
    category: "Exports",
  },
  {
    title: "Presentations auto-detect",
    body: "When Gratitude creates a deck, the export bar automatically switches to show PPTX and PDF instead of document formats.",
    category: "Exports",
  },
  {
    title: "Start from the suggested tasks",
    body: "The empty chat lists starter tasks covering the most common requests. Click any of them to jump right in.",
    category: "Getting started",
  },
];

function StrokeIcon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {ICONS[name]}
    </svg>
  );
}

function CapabilityCard({ item, onTry }: { item: typeof CAPABILITIES[0]; onTry: (prompt: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="group rounded-lg p-4 bg-white/[0.02] border border-white/[0.06] transition-colors hover:border-white/[0.12] cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3">
        <StrokeIcon
          name={item.icon}
          className="shrink-0 mt-0.5 text-white/30 group-hover:text-white/60 transition-colors"
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-[13px] font-medium text-white/85">{item.title}</h3>
          <p className="text-[12px] text-white/40 mt-1 leading-relaxed">{item.description}</p>
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 mt-0.5 text-white/20 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-white/25 mb-2">Try asking</p>
          {item.examples.map((ex) => (
            <button
              key={ex}
              onClick={(e) => { e.stopPropagation(); onTry(ex); }}
              className="block w-full text-left px-3 py-2 rounded-md text-[12px] text-white/50 border border-white/[0.04] hover:text-white/80 hover:border-white/[0.1] hover:bg-white/[0.03] transition-colors"
            >
              &ldquo;{ex}&rdquo;
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GuidePage() {
  const [activeSection, setActiveSection] = useState<BoardSection>("capabilities");

  function handleTryPrompt(prompt: string) {
    // Store the prompt BEFORE navigating - ChatInterface reads this key on
    // mount and prefills the input, ready to send
    sessionStorage.setItem("gratitude_starter_prompt", prompt);
    window.location.href = `/chat`;
  }

  const sections: { id: BoardSection; label: string }[] = [
    { id: "capabilities", label: "Capabilities" },
    { id: "workflows", label: "Workflows" },
    { id: "exports", label: "Export formats" },
    { id: "tips", label: "Tips" },
  ];

  return (
    <AppShell title="Guide">
      {/* Page title */}
      <div className="mb-8">
        <h1 className="font-display uppercase text-[26px] sm:text-[30px] leading-[1.05] tracking-[-0.01em] text-white mb-2">
          Guide
        </h1>
        <p className="text-[14px] text-white/45 max-w-md leading-relaxed">
          Everything you can do with the Gratitude assistant, organized for quick reference.
        </p>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 mb-8 border-b border-white/[0.06] -mx-1 overflow-x-auto">
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            className={`shrink-0 whitespace-nowrap px-3 sm:px-4 py-2.5 text-[13px] font-medium transition-colors relative ${
              activeSection === section.id
                ? "text-white/90"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            {section.label}
            {activeSection === section.id && (
              <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-white/80" />
            )}
          </button>
        ))}
      </div>

      {/* Capabilities board */}
      {activeSection === "capabilities" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {CAPABILITIES.map((item) => (
            <CapabilityCard key={item.title} item={item} onTry={handleTryPrompt} />
          ))}
        </div>
      )}

      {/* Workflows board */}
      {activeSection === "workflows" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {WORKFLOWS.map((workflow) => (
            <div
              key={workflow.title}
              className="rounded-lg p-5 bg-white/[0.02] border border-white/[0.06]"
            >
              <h3 className="text-[14px] font-medium text-white/85 mb-4">{workflow.title}</h3>

              {/* Step flow */}
              <div className="space-y-3 mb-5">
                {workflow.steps.map((step, i) => (
                  <div key={step.label} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-medium mt-0.5 text-white/50 bg-white/[0.05] border border-white/[0.08]">
                      {i + 1}
                    </div>
                    <div>
                      <span className="text-[12px] font-medium text-white/70">{step.label}</span>
                      <p className="text-[11px] text-white/35 mt-0.5">{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Try it CTA */}
              <button
                onClick={() => handleTryPrompt(workflow.prompt)}
                className="group w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] font-medium text-white/60 bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.14] hover:text-white/90 transition-colors"
              >
                Try this workflow
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
                >
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Exports board */}
      {activeSection === "exports" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {EXPORTS.map((exp) => (
            <div
              key={exp.format}
              className={`rounded-lg p-4 border ${
                exp.accent
                  ? "bg-brand-pink/[0.03] border-brand-pink/[0.14]"
                  : "bg-white/[0.02] border-white/[0.06]"
              }`}
            >
              <div className="flex items-baseline gap-2 mb-2.5">
                <span
                  className={`font-mono text-[11px] px-1.5 py-0.5 rounded border ${
                    exp.accent
                      ? "text-brand-pink/80 border-brand-pink/20 bg-brand-pink/[0.06]"
                      : "text-white/45 border-white/[0.08] bg-white/[0.03]"
                  }`}
                >
                  .{exp.format.toLowerCase()}
                </span>
                <span className="text-[13px] font-medium text-white/85">{exp.label}</span>
              </div>
              <p className="text-[12px] text-white/40 leading-relaxed mb-3">{exp.description}</p>
              <p className="text-[11px] text-white/45">
                <span className="text-white/25">Best for </span>
                {exp.bestFor.toLowerCase()}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Tips board */}
      {activeSection === "tips" && (
        <div className="columns-1 md:columns-2 lg:columns-3 gap-3 space-y-3">
          {TIPS.map((tip) => (
            <div
              key={tip.title}
              className="rounded-lg p-4 break-inside-avoid bg-white/[0.02] border border-white/[0.06]"
            >
              <p className="text-[10px] font-medium uppercase tracking-wider text-white/25 mb-2">
                {tip.category}
              </p>
              <h3 className="text-[13px] font-medium text-white/80 mb-1.5">{tip.title}</h3>
              <p className="text-[12px] text-white/40 leading-relaxed">{tip.body}</p>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
