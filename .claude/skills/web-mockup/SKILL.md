---
name: web-mockup
description: Create Gratitude.com page mockups as self-contained HTML with the dark glow aesthetic and hover system
argument-hint: "[page type + purpose + key content]"
---

# Web Mockup Skill

## Purpose
Create high-fidelity mockups of landing pages, hero sections, and UI
components using Gratitude.com's exact design system, as a reference for
development or presentations.

## Context
Brand memory, the visual system (including the hover system), voice,
positioning, and the typography guide are already loaded above.

## How This Portal Produces Mockups
You cannot render or screenshot pages. Deliver:
1. A short section-by-section outline (layout, which tokens apply), under 150 words. Do not repeat copy that is already in the HTML.
2. ONE self-contained HTML file in an ```html code block: inline CSS, Anton and Inter from Google Fonts, no external images. The team opens it in a browser to view it.
   The whole reply must fit in one response: compact CSS with shared classes (no repeated inline styles), no filler sections, and always close the code block.
3. If background art is wanted, offer to generate it with the image tool (16:9 for a hero).

## Locked Language (Activate + Fund)
- Activate: a person chooses an available pre-funded act. It costs them nothing at the moment. Activate is the dominant action and the primary CTA.
- Fund: creates capacity for future acts, once or recurring. Secondary CTA, fully functional.
- Never "donate" or "donation".
- Sponsors appear only as optional, subtle attribution ("Made possible by [Sponsor]") on an act. No sponsor logo bars.
- Express is NEXT and Facilitate is FUTURE. Never present them as available now.
- Demo names, places, and receipts are fictional; label them as sample content. Never invent real metrics: use [NEEDS INPUT].
- No em dashes.

## Process

### Step 1: Define the Mockup
1. **Page type:** landing page, hero section, act detail, funder page, partner page, CTA section
2. **Purpose:** first activation, new funders, sponsored capacity, partner onboarding, awareness
3. **Key content:** headline, body copy, CTAs, proof
4. **Audience:** participants, funders, sponsoring organizations, nonprofit partners

If direct-response copy was written earlier in the conversation, use it.

### Step 2: Layout Planning

**Landing Page Structure (default)**
1. Hero: headline built on an available act ("Good is ready to happen"), subheadline, dominant Activate CTA, secondary Fund CTA, glow background
2. Available acts: 3 act cards with status "Funded and ready" and optional subtle "Made possible by [Sponsor]"
3. How it works: Pre-fund, Activate, Deliver, Verify, Show Impact, Refill
4. Verified status: what a participant sees after activating (a result, not a receipt)
5. For funders: what funding makes possible and the funder result loop
6. Proof: supplied testimonial or stats, otherwise a labeled [NEEDS INPUT] block
7. Final CTA: Activate first, Fund second
8. Footer: navigation, contact, Gratitude logo

**Hero Section Only**
- Full-width, 100vh
- Headline (Anton, UPPERCASE, display size, weight 400)
- Subheadline (Inter, body-lg size, white/60)
- Primary CTA: gradient pill (pink to coral to orange). Secondary CTA: ghost button.
- Background: layered pink and orange glow orbs on black

### Step 3: Design System (use exactly)

**Backgrounds**
- All sections: black (#000000) or near-black (#0a0a0a). No light sections, no navy, no cream.
- Hero: layered radial glow orbs (pink + orange) on black
- Optional grid overlay: 60px grid at 3% opacity

**Typography**
- Hero headline: Anton 400, UPPERCASE, white. Never bold.
- Section labels: Inter 400, 14px, uppercase, wide tracking, pink (#FE3184)
- Section titles: Anton 400, UPPERCASE, white
- Body: Inter 400, 16-18px, line-height 1.65, white/60

**Cards (6-component hover system)**
- Background: linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%)
- Border: 1px solid rgba(255,255,255,0.08); radius 1rem; padding 2rem to 2.5rem
- Hover (implement with :hover and show one card in its hover state):
  1. Glow orb: gradient blur in a corner
  2. Text brightness: white/60 to white/80
  3. Icon scale: 110%
  4. Icon glow: 0 0 30px rgba(254,49,132,0.3)
  5. Bottom accent: full-width gradient line
  6. Border glow: inset 1px pink/30 plus outer 40px glow

**Buttons**
- Primary: linear-gradient(135deg, #FE3184 0%, #FF6B35 50%, #ec7211 100%), pill radius, Inter 600, shadow 0 10px 40px rgba(254,49,132,0.3), hover translateY(-2px)
- Secondary: ghost with 1px white/20 border

**Icon Containers**
- rgba(254,49,132,0.1) background, 1px rgba(254,49,132,0.2) border, 12px radius, 56x56px, 1.5px pink line icon (inline SVG)

**Spacing**
- Sections: 6rem to 8rem vertical; container max-width 1200px, 20px side padding

### Step 4: Responsive
Design for 1440px desktop first. Include a 375px mobile layout with CSS media
queries: single column, no horizontal scroll, tap targets at least 44px.

### Step 5: Quality Check
Before delivering, verify in the code itself:
- [ ] Only brand tokens: black backgrounds, pink/coral/orange accents, no navy
- [ ] Anton is weight 400 and UPPERCASE everywhere it appears
- [ ] Primary CTA is Activate; Fund is secondary
- [ ] No sponsor logo bar; attribution only as subtle "Made possible by [Sponsor]"
- [ ] Hover system implemented on cards
- [ ] Mobile media query present; nothing wider than the viewport
- [ ] Sample content labeled as sample; no invented metrics
- [ ] No em dashes in any copy

## Chain From
Works best when fed copy from direct-response-copy work earlier in the conversation.
