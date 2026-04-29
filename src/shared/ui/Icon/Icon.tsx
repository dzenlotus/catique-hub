/**
 * Icon — CSS sprite component backed by the pixel-art icon set (sprite.png).
 *
 * sprite.png dimensions: 1402 × 1122 px
 * Grid: 10 columns × 9 rows
 * Cell size: 140.2 × 124.7 px
 *
 * The component renders a <span> with background-image + background-position
 * to show a single cell. Displayed at `size` px square; background-size
 * is calculated proportionally so each cell appears at exactly `size` px.
 *
 * For 16 px display:
 *   scale  = 16 / 124.7 ≈ 0.1283
 *   sheet  = 1402 × 0.1283 ≈ 179.8 px wide, 1122 × 0.1283 ≈ 143.9 px tall
 *   cell_w = 140.2 × 0.1283 ≈ 17.98 px  (so x-offset = col × 17.98)
 *   cell_h = 124.7 × 0.1283 ≈ 16 px      (so y-offset = row × 16)
 *
 * Icon map — confirmed positions (measured from visual inspection of image3.png):
 *   ROW 0: cat-face(0,0) | croissant(1,0) | grid-4(2,0) | bread(3,0)
 *           Eiffel(4,0) | pretzel(5,0) | anchor(6,0) | stripes(7,0) | anchor2(8,0) | ? (9,0)
 *   ROW 1: house(0,1) | envelope(1,1) | checklist(2,1) | document(3,1)
 *           folder(4,1) | tag(5,1) | flag(6,1) | star(7,1) | heart(8,1) | bookmark(9,1)
 *   ROW 2: search(0,2) | filter(1,2) | sliders(2,2) | browser(3,2)
 *           code-brackets(4,2) | bug(5,2) | flask(6,2) | graph-nodes(7,2) | dumbbell(8,2) | ?(9,2)
 *   ROW 3: plus(0,3) | pencil(1,3) | trash(2,3) | eye(3,3)
 *           speech-bubble(4,3) | bell(5,3) | gear(6,3) | person(7,3) | persons(8,3) | ?(9,3)
 *   ROW 4: check(0,4) | x-close(1,4) | warning(2,4) | info(3,4)
 *           clock(4,4) | calendar(5,4) | lightning(6,4) | rocket(7,4) | globe(8,4) | monitor(9,4)
 *   ROW 5: database(0,5) | cloud-up(1,5) | cloud-down(2,5) | server-rack(3,5)
 *           lock(4,5) | key(5,5) | shield(6,5) | link(7,5) | upload(8,5) | download(9,5)
 *   ROW 6: browser-window(0,6) | browser-tabs(1,6) | pie-chart(2,6) | bar-chart(3,6)
 *           analytics(4,6) | mail(5,6) | app-grid(6,6) | window2(7,6) | sparkles?(8,6) | lifebuoy(9,6)
 *   ROW 7: grid-table(0,7) | ?(1,7) | ?(2,7) | stacked-layers(3,7)
 *           ?(4,7) | ?(5,7) | ?(6,7) | ?(7,7) | ?(8,7) | ?(9,7)
 *   ROW 8: (more icons — not fully mapped)
 *
 * Confirmed icon → grid cell mapping:
 *   catique        → (0, 0)   cat face — top-left, confirmed
 *   side-projects  → (1, 0)   croissant/coffee area — GUESS (no espresso cup visible; croissant is closest)
 *   engineering    → (2, 0)   4-cell grid / board layout — confirmed
 *   boards         → (2, 0)   same grid icon (filled tint applied via CSS when active)
 *   roadmap        → (4, 0)   Eiffel tower (map/destination) — confirmed shape; map icon would be better
 *   agent-ops      → (7, 2)   graph-nodes / network topology — confirmed
 *   agent-roles    → (8, 3)   persons/group — confirmed
 *   prompts        → (4, 3)   speech bubble — confirmed
 *   prompt-groups  → (3, 7)   stacked layers — GUESS (position may be off)
 *   skills         → (8, 6)   sparkles area — GUESS (row 6 col 8 area)
 *   mcp-servers    → (3, 5)   server rack — confirmed
 *   settings       → (6, 3)   gear — confirmed
 *   mascot         → (0, 0)   reuses cat-face; beret-cat is designer asset
 */

import styles from "./Icon.module.css";

export type IconName =
  | "catique"
  | "side-projects"
  | "engineering"
  | "boards"
  | "roadmap"
  | "agent-ops"
  | "agent-roles"
  | "prompts"
  | "prompt-groups"
  | "skills"
  | "mcp-servers"
  | "settings"
  | "mascot"
  | "tag";

export interface IconProps {
  name: IconName;
  /** Display size in px. Default: 16. */
  size?: number;
  /**
   * When true, applies a CSS filter to tint the icon red (--color-cta-bg).
   * Used for the active "boards" workspace nav item.
   */
  active?: boolean;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}

/**
 * Sprite sheet dimensions (px).
 * Measured from sprite.png: 1402 × 1122 px, 10 cols × 9 rows.
 */
const SHEET_W = 1402;
const SHEET_H = 1122;
const COLS = 10;
const ROWS = 9;
const CELL_W = SHEET_W / COLS; // 140.2
const CELL_H = SHEET_H / ROWS; // 124.7

/**
 * Icon name → [col, row] in the sprite grid.
 *
 * Confirmed = visually verified from image3.png.
 * GUESS     = reasonable approximation, designer should verify.
 */
const ICON_MAP: Record<IconName, [number, number]> = {
  // Confirmed positions
  catique: [0, 0],        // cat face, row 0 col 0 — confirmed
  engineering: [2, 0],    // 4-grid / board layout, row 0 col 2 — confirmed
  boards: [2, 0],         // same icon, active tint via CSS
  "agent-ops": [7, 2],    // network/graph nodes, row 2 col 7 — confirmed
  "agent-roles": [8, 3],  // people group, row 3 col 8 — confirmed
  prompts: [4, 3],        // speech bubble, row 3 col 4 — confirmed
  "mcp-servers": [3, 5],  // server rack, row 5 col 3 — confirmed
  settings: [6, 3],       // gear, row 3 col 6 — confirmed

  // Best-guess positions (designer should verify offsets)
  "side-projects": [1, 0],   // GUESS: croissant (closest to "coffee cup" food icon)
  roadmap: [4, 0],            // GUESS: Eiffel tower as map/destination metaphor
  "prompt-groups": [3, 7],    // GUESS: stacked layers in row 7
  skills: [8, 6],             // GUESS: sparkle-like icon in row 6
  mascot: [0, 0],             // Placeholder: reuses cat-face; beret-cat is a designer asset

  // Confirmed from image3.png: label/tag shape with small hole, row 1 col 5
  tag: [5, 1],
};

export function Icon({
  name,
  size = 16,
  active = false,
  className,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: IconProps): React.ReactElement {
  const [col, row] = ICON_MAP[name];

  // Scale the sheet so one cell fills exactly `size` px in height.
  const scale = size / CELL_H;
  const bgW = SHEET_W * scale;
  const bgH = SHEET_H * scale;

  // Offset to the correct cell (top-left of cell).
  const bgX = -(col * CELL_W * scale);
  const bgY = -(row * CELL_H * scale);

  return (
    <span
      className={[styles.icon, active ? styles.active : "", className ?? ""].join(" ").trim()}
      style={{
        width: size,
        height: size,
        backgroundSize: `${bgW}px ${bgH}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
      }}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
    />
  );
}
