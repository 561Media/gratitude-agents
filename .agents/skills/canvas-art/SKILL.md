---
name: canvas-art
description: Create abstract/artistic visual compositions for hero backgrounds, campaign key art, and creative visual pieces using Gratitude.com's glow aesthetic
argument-hint: "[describe the concept, mood, or purpose of the visual]"
---

# Canvas Art Skill

Create visual art for Gratitude.com grounded in a written design philosophy.
Use this skill for hero backgrounds, campaign key visuals, abstract
compositions, or any artistic visual piece.

Complete this in two steps, both in the chat:
1. Design philosophy (Markdown, in your reply)
2. Express it with the image tool

You cannot save files or look at the generated result, so the checks below are
things you control in the prompt.

## Context
Brand memory, the visual system, positioning, the canvas philosophy library,
and the illustration guide are already loaded above.

## DESIGN PHILOSOPHY

Create a VISUAL PHILOSOPHY (not a layout or template) expressed through:
- Form, space, color, composition
- Light, glow, energy, warmth

### Brand Integration
The philosophy MUST use Gratitude.com's visual system:
- **Palette:** pink (#FE3184), coral (#FF6B35), orange (#ec7211). Backgrounds pure black (#000000) to #2a2a2a.
- **Aesthetic:** dark, luminous, warm glow. Not cold neon. Not navy.
- **Gradients:** the three-stop pink to coral to orange gradient, glow radials.
- **Glow:** pink rgba(254,49,132,0.15-0.40), orange rgba(236,114,17,0.10-0.30).

You may start from a philosophy in the canvas philosophy library or create a
new one. Either way it must feel like Gratitude.com.

### How to Write It
**Name the movement** (1-2 words), e.g. "Radiant Warmth" or "Luminous Silence".

**Articulate the philosophy** in 3-4 short paragraphs covering:
- Space and form (black void, luminous focal points)
- Color and light (pink and orange glow fields)
- Scale, rhythm, and balance
- Visual hierarchy

Mention each aspect once. Be specific about direction while leaving room for
interpretation.

## THE SUBTLE REFERENCE
Identify the conceptual thread from the request. The topic should live inside
the art as a subtle reference that someone familiar with the subject would feel.

## EXPRESS IT
Call the image tool with a prompt written from the philosophy.
- **Canvas:** 16:9 (1920x1080) for hero art by default; otherwise match the placement (1:1, 4:5, 9:16, 4:3, 3:4). The image is center-cropped to that canvas.
- **Logo:** the official white logo is composited bottom-right automatically. Keep that corner calm.
- **Text:** keep words, letters, and numbers out of the image. If the piece needs a phrase, give it separately with Anton/Inter type specs.

### Checks you control in the prompt
- One clear focal point, placed so a center crop keeps it
- Glow and key shapes stay inside the frame with margin; nothing touches the edges
- Palette strictly black with pink, coral, and orange light; explicitly no navy, no blue, no white backgrounds
- No text, lettering, watermarks, or logos in the generated image
- Bottom-right corner uncluttered
- Repetition and structure over random noise: repeated forms, layered glow, precise geometry

## REFINEMENT
If the user asks for changes, revise the prompt with specific, named changes
(for example "shrink the central glow to a third of the frame, move it left")
and generate again.

## MULTIPLE PIECES
For a series, write one philosophy and generate distinctly different pieces
that share it, one image per call.
