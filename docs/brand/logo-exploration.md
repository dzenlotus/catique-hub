# Logo Exploration — Catique HUB

Version 1.0 · May 2026 · Decision log entry for ctq-66

---

## Design Constraints

- Must read at 16×16 px in macOS Dock (dark background) and Launchpad (light background)
- Must scale cleanly to 1024×1024 for app icon
- Dark-first brand — the mark lives primarily on `warm-900` (#17140f) background
- Accent palette: gold (`#cd9b58` dark theme) and red-cta (`#e8413a`)
- No raster embeds, no gradients that collapse at small size
- Geometric / monospaced feel — app uses JetBrains Mono throughout

---

## Concept A — Monogram "CH"

### Description

A compact ligature of the letters C and H constructed on a strict grid.
The C is a partial circle (270° arc, open at 3 o'clock), and the vertical
stroke of the H passes directly through the gap, creating a single unified
glyph. Stroke weight is uniform (approx 1/10 of the bounding box).

```
  ╭───╮
  │   │
  │   ├── ──┤
  │   │      │
  ╰───╯
```

### Evaluation

| Criterion            | Score | Notes                                        |
|---------------------|-------|----------------------------------------------|
| 16 px dock legibility | 3/5  | Two strokes at 16 px are tight; works at 32+ |
| Memorability         | 3/5  | Initials are safe but generic                |
| 16 → 1024 scaling    | 4/5  | Stroke-based — scales without detail loss    |
| Brand differentiation | 2/5 | CH monogram is used by many SaaS products    |

### Verdict: Not selected. Functional but not distinctive enough for the product category.

---

## Concept B — Symbolic: Node-Graph / Context Structure

### Description

An abstract mark representing an agent orchestration graph: three nodes
arranged in an inverted triangle (one top-center, two bottom), connected
by lines. The top node is filled solid (the hub / orchestrator); the two
lower nodes are outlined (agents / contexts). At small sizes the three
nodes collapse into a single recognizable triangular glyph — the triangle
communicates hierarchy and structure without needing the connecting lines.

```
       ●
      /|\
     / | \
    ○     ○
```

At 16×16: effectively reads as a filled downward-pointing triangle with
two small dots at bottom corners — distinctive silhouette.

### Evaluation

| Criterion            | Score | Notes                                         |
|---------------------|-------|-----------------------------------------------|
| 16 px dock legibility | 4/5  | Triangle silhouette holds at tiny sizes       |
| Memorability         | 4/5  | Geometric + abstract = recognizable over time |
| 16 → 1024 scaling    | 5/5  | Scales perfectly; at 1024 detail is rich      |
| Brand differentiation | 4/5 | Graph metaphor unique in kanban-tool space    |

### Verdict: Strong candidate but the graph metaphor risks feeling generic "AI / network" without tighter execution.

---

## Concept C — Typographic Wordmark: "catique" Custom Setting

### Description

The word "catique" set in a modified version of JetBrains Mono (the
application's UI font) with two custom interventions:

1. The dot on the lowercase "i" is replaced by a small filled square
   rotated 45° (a diamond) — referencing precision and kanban card
   geometry.
2. Tight letter-spacing (-0.04em) with the "c" opening deliberately
   wider than default — referencing the open-ended, contextual nature
   of the product.

This is a pure wordmark — no symbolic mark. Used at large sizes (lendos
header, README hero, onboarding screen). Too long for dock icon.

```
catique
  ^
  ◆ (diamond dot on i)
```

### Evaluation

| Criterion            | Score | Notes                                          |
|---------------------|-------|------------------------------------------------|
| 16 px dock legibility | 1/5  | 7-character word is unreadable at 16 px        |
| Memorability         | 4/5  | Clean, product-name-forward                    |
| 16 → 1024 scaling    | 2/5  | Only works at display sizes (≥ 32 px height)   |
| Brand differentiation | 3/5 | Mono wordmark is used by Linear, Vercel, etc.  |

### Verdict: Not selected as primary mark. Selected as the basis for logo-wordmark-only.svg companion piece.

---

## Decision: Concept C wordmark + Custom Symbol (Hybrid)

### Chosen direction

The final logo is a hybrid of a purpose-built geometric symbol with the
Concept C wordmark. The symbol is new — a "context hub" glyph derived
from a rounded square (app icon safe zone, Apple HIG) containing three
horizontal lines of decreasing width, left-aligned, representing a
structured context / prompt hierarchy. This is:

- Directly legible at 16×16 as "a list inside a container" — the mental
  model of the product (structuring context for agents)
- Referencing kanban cards / markdown structure simultaneously
- Minimal enough to be laser-cut, embossed, or printed 1-color

```
┌──────────┐
│ ████     │
│ ██████   │
│ ████████ │
└──────────┘
```

Three-line descending — lines narrow from bottom to top (base concept
is widest at bottom = foundation / context) then shorter = more specific
layers above. Subtle nod to an inverted pyramid / inheritance chain.

### Why this concept

1. The silhouette (rounded rectangle + 3 horizontal lines) is unique in
   the desktop-AI-tool category — no direct competitor uses it.
2. Scales from 16 px (just the rect + 2–3 pixels of line) to 1024 px
   (detailed proportions, padding, rounded ends on lines).
3. Connected to the actual product function: structured context layers
   for AI agents. Not generic "AI", not generic "kanban" — both at once.
4. Works on dark and light backgrounds: gold fill on dark, navy fill on
   light, maintaining WCAG 3:1 minimum at all icon sizes.

### Color decision

- Mark on dark: `#cd9b58` (gold-500, brand accent in dark theme)
  on `#17140f` background (warm-900) — contrast ratio ≈ 4.8:1 (WCAG AA)
- Mark on light: `#6f4d24` (gold-800) on `#faf8f5` background (cream-50)
  — contrast ratio ≈ 6.9:1 (WCAG AA+)
- App icon background: deep warm `#1a1714` with gold mark — readable in
  both dark Dock and light Launchpad

---

## References

- Apple Human Interface Guidelines — App Icons (visionOS / macOS)
- Linear logo: monochrome geometric, scales 16→1024 with no detail loss
- Vercel logo: single shape, context-free recognition
- Stripe S-mark: custom letterform as icon, wordmark separate
