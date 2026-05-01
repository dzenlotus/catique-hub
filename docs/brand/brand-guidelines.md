# Catique HUB — Brand Guidelines

Version 1.0 · May 2026

---

## Mission Statement

Catique HUB is a desktop kanban for managing the context structure of AI agents.

---

## Brand Associations

Five words that should come to mind when a user sees or uses Catique HUB:

1. **Precision** — every token of context is placed intentionally
2. **Orchestration** — coordinating multiple agents, not just using one
3. **Structure** — hierarchy, inheritance, layers — not chaos
4. **Craft** — the product feels built by someone who cares about the details
5. **Focus** — removes noise; brings the essential to the surface

---

## Anti-Brand

What Catique HUB is NOT:

- Not **cute or playful** — no rounded mascots, no confetti, no cheerful microcopy
- Not **corporate enterprise** — no blue-gradient SaaS buttons, no stock photography
- Not **generic "AI"** — no neural-network blob visualisations, no robot emoji
- Not **noisy or busy** — no unnecessary chrome, no feature-announcement banners in the UI
- Not **trendy** — resists glass-morphism fads; prefers timeless geometric forms

---

## Tone of Voice

**Primary register:** precise, direct, technically literate.

Write as if you are a senior engineer who also appreciates good design. One sentence
is better than two. Active voice. No filler words.

**Guidelines:**
- Use product terminology consistently: "context", "agent", "space", "board", "prompt"
- No em-dash overuse; prefer a full stop or semicolon
- Avoid "powerful", "seamless", "intuitive" — show, don't claim
- Error messages: state what happened + what to do. Never blame the user.
- Microcopy: imperative ("Create space", not "Create a new space")

**English and Russian registers are equal.** Neither is a translation of the other — both
are written native-first. Russian copy does not use informal «ты» for error messages;
neutral register throughout.

---

## Visual Language

### Dark-first

The primary UI theme is dark (`data-theme="dark"`). All design decisions are made
dark-first; light theme is a fully supported variant, not an afterthought. Marketing
materials default to dark presentation.

### Color Palette

Derived from `design-tokens/tokens.json`. Do not introduce new primitive colors without
updating the token file.

#### Brand Accent — Gold

The accent for interactive elements, highlights, and the logo mark.

| Token                   | Dark theme    | Light theme   | Hex (dark)  |
|------------------------|---------------|---------------|-------------|
| `--color-accent-bg`     | gold-500      | gold-800      | `#cd9b58`   |
| `--color-accent-hover`  | gold-400      | gold-900      | `#d6a843`   |
| `--color-accent-active` | gold-600      | gold-950      | `#b48241`   |

#### CTA / Destructive — Red

Used for primary call-to-action buttons and danger states. Not used in the logo.

| Token              | Hex         |
|-------------------|-------------|
| `--color-cta-bg`   | `#e8413a`   |
| `--color-cta-hover`| `#f05248`   |

#### Backgrounds (dark theme)

| Surface         | Hex        |
|----------------|------------|
| Canvas          | `#17140f`  |
| Sidebar         | `#1a1714`  |
| Raised surface  | `#1f1c17`  |
| Column          | `#1c1916`  |

#### Text (dark theme)

| Role    | Token                   | Hex        |
|---------|------------------------|------------|
| Default | `--color-text-default`  | `#ece8e2`  |
| Muted   | `--color-text-muted`    | `#ddd6c9`  |
| Subtle  | `--color-text-subtle`   | `#7a746a`  |

### Typography

**UI font:** JetBrains Mono Variable — used for every UI element including headings,
labels, and body text. The monospaced choice is intentional: it reinforces the
technical, precise character of the tool and unifies all text into a single
typographic register.

**Wordmark font:** Playfair Display Variable — used exclusively for the "catique"
wordmark in the sidebar and marketing materials. The contrast between mono UI and
serif wordmark creates a deliberate tension: technical tool with considered identity.

**Do not introduce additional typefaces.**

Type scale is defined in `src/app/styles/tokens.foundation.css`. All sizes in px,
no rem — intentional for a native desktop app context.

### Logo

See `docs/brand/logo-exploration.md` for the concept decision log.

The chosen mark is a rounded-square container holding three left-aligned horizontal
bars of decreasing length (longest at bottom, shortest at top), representing layered
context structure. The symbol is used as the app icon; paired with the "catique hub"
wordmark for full-lockup use.

#### Logo Files

| File                             | Use case                                      |
|---------------------------------|-----------------------------------------------|
| `assets/logo/logo-master.svg`    | Source of truth, 1024×1024, full lockup       |
| `assets/logo/logo-mark-only.svg` | App icon, favicon, social avatar              |
| `assets/logo/logo-wordmark-only.svg` | Landing header, README banner             |
| `assets/logo/logo-dark.svg`      | Full lockup on dark backgrounds               |
| `assets/logo/logo-light.svg`     | Full lockup on light backgrounds              |

#### Logo Clear Space

Minimum clear space = 1× the height of the bar group on all sides.

#### Logo Don'ts

- Do not recolor the mark to anything outside the approved palette
- Do not add drop-shadows or glows to the SVG mark
- Do not stretch or distort the lockup aspect ratio
- Do not place the dark variant on a light background or vice versa

### Iconography

UI icons: custom pixel-grid set at 16×16 nominal, 1 px stroke.
No third-party icon libraries in the shipping UI.

### Motion

- Transitions: 120 ms ease-out for micro-interactions, 200 ms ease-in-out for panel open/close
- No decorative animation that carries information — animation is purely feedback
- `prefers-reduced-motion` is respected: all transitions are set to 0 ms when active
- No looping animations in the UI (no spinners unless loading state is active)

### Spacing and Radius

Spacing scale: 0, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96 px.
Radius scale: 2, 3, 5, 7, 10 px, full (9999).

App icon radius follows Apple HIG: 22.5% of icon size (continuous squircle via
the OS mask — SVG is delivered as a square, OS applies the squircle clip).

---

## App Icon Spec

- **Format:** PNG, 1024×1024, transparent background
- **Safe area:** content within 820×820 px centered (Apple 80% safe zone)
- **Background:** `#1a1714` (warm sidebar, slightly lighter than canvas)
- **Mark:** gold-500 `#cd9b58` — the three-bar context glyph
- **Generated sizes** (via `pnpm tauri icon`): 32, 128, 256, 512, 1024 (PNG);
  icon.icns (macOS multi-res); icon.ico (Windows multi-res)

---

## Marketing Assets

### OG Image (1200×630)

Dark background (`#17140f`), centered logo-master lockup at ~50% width,
tagline below in JetBrains Mono 24 px warm-200.

### GitHub Social Preview (1280×640)

Same layout as OG. Product screenshot inset on right half (optional if screenshot
not ready for release).

### Favicon

32×32 PNG — the mark-only glyph, no background (transparent), gold mark.
`favicon.ico` — 16, 24, 32 px multi-res.

---

## Open Items

- PNG renders (`logo-master.png`, marketing PNGs, favicons) are deferred until
  `rsvg-convert` or ImageMagick is available on the build machine. Neither was
  found on PATH at time of writing (ctq-66, May 2026). The SVG sources are
  complete and well-formed. To generate PNGs run:
  ```
  rsvg-convert -w 1024 -h 1024 assets/logo/logo-master.svg -o assets/logo/logo-master.png
  pnpm tauri icon assets/logo/logo-master.png
  ```
- `pnpm tauri icon` and `pnpm tauri build --debug` are consequently deferred
  (Part 2 of ctq-66, assigned to Sergey). Blocked only on PNG generation.
- Marketing PNG assets (`og-image-1200x630.png`, `github-social-1280x640.png`,
  `favicon-32x32.png`, `favicon.ico`) are deferred for the same reason.
