---
name: social-creative
description: "Create platform-specific social media graphics with Gratitude.com's dark glow aesthetic: Instagram posts, stories, LinkedIn images, carousels, ad creatives"
argument-hint: "[platform + post type + content/copy to visualize]"
---

# Social Creative Skill

## Purpose
Create production-ready social media graphics that are on-brand, platform-native,
and optimized for engagement.

## Context
Brand memory, the visual system, voice, positioning, platform specs, and the
typography guide are already loaded above.

## How This Portal Produces Graphics
You cannot save files, set type on an image, or look at rendered output.
- Generate each graphic with the image tool at the exact canvas for the placement. Images are center-cropped to that canvas.
- The official white Gratitude logo is composited automatically, bottom-right, inside the format's safe zone (above the bottom UI area on stories). Never ask the user to add it.
- The image model cannot render text reliably. Keep words out of the image. Deliver the headline, supporting text, and CTA separately with type specs so they can be set in Anton and Inter.
- Carousels can also be delivered as slide JSON, which downloads as a branded PDF or PowerPoint.

## Process

### Step 1: Identify the Deliverable
1. **Platform:** Instagram, LinkedIn, Facebook, X, YouTube
2. **Format:** post (square or portrait), story, carousel, landscape image, ad creative
3. **Content type:** stat callout, impact story, available act, CTA, infographic
4. **Copy:** headline, body, CTA

If atomized content was written earlier in the conversation, use it.

### Step 2: Choose the Canvas

| Placement | Aspect ratio | Delivered size | Notes |
|-----------|--------------|----------------|-------|
| Instagram or LinkedIn square | 1:1 | 1080x1080 | Default. 60px safe zone. |
| Instagram portrait post | 4:5 | 1080x1350 | Bottom 120px can sit under the caption. |
| Instagram or Facebook story, reel cover | 9:16 | 1080x1920 | Top 200px and bottom 280px are UI zones. |
| Carousel slide | 1:1 | 1080x1080 per slide | Slide 1 = hook. Last = CTA. |
| LinkedIn, Facebook, X landscape | 16:9 | 1920x1080 | Crop to 1200x627 or 1200x675 if needed; keep the subject centered. |
| YouTube thumbnail | 16:9 | 1920x1080 | Bottom-right carries the timestamp: keep key detail away from it. |

### Step 3: Art Direction

**Brand rules (non-negotiable)**
- Colors: pink #FE3184, coral #FF6B35, orange #ec7211. Backgrounds #000000 to #2a2a2a. Not navy.
- Fonts for the copy you deliver: Anton for headlines (UPPERCASE, weight 400 only), Inter for body and labels.
- Corners: 0px (platforms crop to their own shapes).
- Gradient: three stops, pink to coral to orange, for CTAs and accents.

**Composition**
- Keep all important detail inside the safe zone and centered enough to survive the crop.
- One hero element per graphic.
- Leave clear space where the headline will be set, and keep the bottom-right clear for the logo.
- Black backgrounds with pink and orange glow for depth.

**Type specs to deliver with each graphic**
- Headline: Anton 400, 36-64px, UPPERCASE
- Supporting text: Inter Regular, 16-24px
- Stats: Anton 400, 72-120px
- CTA: Inter SemiBold, 16-20px
- Labels: Inter SemiBold, 12px, uppercase, 0.1em tracking, pink

### Step 4: Carousels
- **Slide 1 (cover):** black background, hook headline, gradient accent bar.
- **Slides 2-N:** black background, pink slide number ("01", "02"), one point each.
- **Final slide:** full three-stop gradient background, centered CTA.
Deliver a table of slide copy plus one generated background per distinct look,
or deliver the carousel as slide JSON when the user wants a downloadable file.

### Step 5: Quality Check
Before delivering, verify:
- [ ] Canvas matches the placement
- [ ] Prompt keeps words and logos out of the generated image
- [ ] Composition leaves the safe zones and the logo corner clear
- [ ] Copy and type specs delivered for every graphic
- [ ] Brand colors only, no navy
- [ ] Copy uses Activate + Fund language and no em dashes

## Chain From
Works best when fed content from content-atomizer or direct-response-copy work
earlier in the conversation.
