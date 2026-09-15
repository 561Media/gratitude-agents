/**
 * Frozen knowledgebase fixtures that stand in for semantic KB retrieval
 * (lib/kb.ts). Every entry restates a fact from brand-kit/investor-core.yaml
 * (2026-09-15, v2.0). No database is touched. The same entries are injected
 * for every case through the production formatter (formatKbSection).
 */
export interface KbFixture {
  title: string;
  category: string;
  content: string;
}

export const KB_FIXTURES: KbFixture[] = [
  {
    title: "Round terms",
    category: "investor_fact",
    content:
      "Friends & Family SAFE, 2026. Raising $3-5M. Valuation cap $20M post-money. No discount. Investment amount is the investor's choice and converts at the cap at a future priced round. A SAFE earns no return until it converts; no projected returns or IRR. Do not state committed amounts.",
  },
  {
    title: "Optional gift alongside the SAFE",
    category: "investor_fact",
    content:
      "An optional gift to ActivateGratitude.org is the investor's choice, separate from the SAFE, with no equity attached. There is no fixed investment/gift split. Tax treatment is [NEEDS INPUT]; never say the gift is deductible.",
  },
  {
    title: "Entity structure",
    category: "investor_fact",
    content:
      "Gratitude.com, Inc. is a Delaware C-Corp, B Corp PENDING (never 'certified'). It makes participation possible. ActivateGratitude.org is the charitable entity that makes the impact possible; its 501(c)(3) determination is unconfirmed [NEEDS INPUT] and must not be stated as granted.",
  },
  {
    title: "Mechanism",
    category: "investor_fact",
    content:
      "Fund first. Act instantly. Pre-fund, Activate, Deliver, Verify, Show Impact, Refill. Activate costs the participant nothing at the moment because the act is pre-funded. Fund creates capacity for future acts, once or recurring. Reserve and flow-of-funds language is pending attorney review.",
  },
  {
    title: "Flywheel (Jo approved 9/15/26)",
    category: "investor_fact",
    content:
      "Every action strengthens the network. Millions of actions create the infrastructure for human acknowledgment. Funding, Capacity, Activation, Delivery, Verification, Trust, More Participation. Retired: 'every message builds the network'.",
  },
  {
    title: "Market frames",
    category: "investor_fact",
    content:
      "$100B+ corporate wellbeing and engagement spend (2026), growing to $240B by 2035. $2.3 trillion+ annual global charitable giving. $2.4 trillion+ combined addressable market. Retired: $600B+ and $500B+ frames.",
  },
  {
    title: "Problem stats",
    category: "investor_fact",
    content:
      "60% of people never or rarely express gratitude to coworkers and 74% never or rarely to their boss (John Templeton Foundation). 82% of employees say recognition matters (SurveyMonkey).",
  },
  {
    title: "Not yet available",
    category: "investor_fact",
    content:
      "[NEEDS INPUT] before use: 501(c)(3) determination, attorney-approved reserve language, gift tax treatment, confirmed use-of-funds percentages, current traction numbers (users, activations, pilots, partners), team beyond founder, committed capital to date.",
  },
];
