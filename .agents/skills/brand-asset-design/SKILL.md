---
name: brand-asset-design
description: Create general brand assets: email headers, OG images, infographics, and other visual collateral
argument-hint: "[asset type + purpose + key content]"
---

# Brand Asset Design Skill

## Purpose
Create general-purpose branded visual assets for Gratitude.com. This is the
catch-all design skill for anything that is not social creative, a deck or
document, a web mockup, or canvas art.

## Context
Brand memory, the visual system, voice, positioning, the typography guide,
and the template registry are already loaded above.

## How This Portal Produces Assets
You cannot save files, set type on an image, or look at rendered output.
- **Background art and imagery:** the image tool, at exact canvases: 1:1 = 1080x1080, 4:5 = 1080x1350, 9:16 = 1080x1920, 16:9 = 1920x1080, 4:3 = 1440x1080, 3:4 = 1080x1440. The official white logo is applied automatically inside the safe zone.
- **Text on the asset:** the image model cannot render text reliably. Deliver the headline and supporting copy separately with type specs (Anton size, Inter size, placement) so it can be set in the brand fonts.
- **Presentation slides:** route to slide JSON (deliverable-design). It downloads as PowerPoint or PDF with the brand system applied.

## Asset Types

### Email Headers
- Target 600x200 (standard) or 600x250 (hero). Generate 16:9 art and note that it will be cropped to the header size; keep the subject centered.
- Budget: 100-150KB after export for email delivery.
- Black background, pink/orange gradient accents, logo white variant.
- Headline copy: Anton, UPPERCASE, white, 24-32px, delivered as text.
- Must communicate with images off: include alt text.

### Infographics
- 4:5 (1080x1350) or 9:16 (1080x1920)
- Deliver the data layout as a structured spec: title (Anton, UPPERCASE), rows of stat + label, gradient divider positions
- Generate only the background art with the image tool; the numbers and labels are set in the brand fonts from your spec
- Stat values are supplied or [NEEDS INPUT]

### OG Images (Open Graph)
- Target 1200x630. Generate 16:9 art with the subject centered.
- Title copy: Anton, UPPERCASE, white, 36-48px, legible at small preview sizes.

### Miscellaneous
- Meeting backgrounds (16:9, black with subtle glow)
- Profile images (1:1)
- Event banners (16:9)

## Process

### Step 1: Identify the Asset
1. What type of asset?
2. What dimensions? (check the platform specs above)
3. What content goes on it?
4. Where will it be used?

### Step 2: Design
**Brand rules (non-negotiable)**
- Colors: brand palette only. Black backgrounds, pink/coral/orange accents. No navy.
- Fonts: Anton for display (UPPERCASE, weight 400, never bold), Inter for body.
- Logo: applied automatically to generated images; do not ask the user to place it.
- Style: dark, luminous, warm glow. Never cluttered.

**Composition**
- One focal point per asset
- Clear hierarchy: primary, secondary, tertiary
- Generous negative space; keep the bottom-right clear for the logo
- Pink as primary accent, orange as secondary warmth

### Step 3: Quality Check
- [ ] Correct canvas for the platform
- [ ] Prompt keeps words out of the image
- [ ] Headline and copy delivered separately with type specs
- [ ] Brand colors only, no navy
- [ ] Anton copy is UPPERCASE
- [ ] Email assets note the file-size budget and alt text
- [ ] No em dashes in any copy

## When to Use This Skill vs Others
- Social media graphics: social-creative
- Decks and multi-page documents: deliverable-design
- Landing page mockups: web-mockup
- Abstract art and hero backgrounds: canvas-art
- Everything else: this skill
