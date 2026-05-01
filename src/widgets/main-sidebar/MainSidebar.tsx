import type { ReactElement } from "react";

import HeartSolid from "./assets/heart-solid.svg?react";
import { NavRow } from "./NavRow";
import { WORKSPACE_ITEMS } from "./workspaceItems";
import styles from "./MainSidebar.module.css";

// ---------------------------------------------------------------------------
// NavView — the 7 navigable top-level views surfaced as nav rows in the
// main sidebar. "spaces" is kept for internal routing (per-space settings
// page) but is not shown as a nav item.
// ---------------------------------------------------------------------------

/** All navigable top-level views in the app shell. */
export type NavView =
  | "boards"
  | "agent-roles"
  | "prompts"
  | "prompt-groups"
  | "skills"
  | "mcp-servers"
  | "settings"
  // Not shown in sidebar nav but still routable:
  | "spaces";

export interface MainSidebarProps {
  activeView: NavView;
  onSelectView: (view: NavView) => void;
}

// ---------------------------------------------------------------------------
// MainSidebar — wordmark + workspace nav rail.
// ---------------------------------------------------------------------------

/**
 * The leftmost column of the three-column app shell.
 *
 * Structure: wordmark on top, workspace nav rows below. The "WORKSPACE"
 * section header was removed in Round 20 — the rows render directly under
 * the wordmark with no section label.
 *
 * The SPACES tree lives in a separate sibling widget (`spaces-sidebar`).
 */
export function MainSidebar({
  activeView,
  onSelectView,
}: MainSidebarProps): ReactElement {
  return (
    <nav
      className={styles.sidebar}
      aria-label="Main navigation"
      data-testid="main-sidebar-root"
    >
      {/* Wordmark block: serif "Catique Hub" + pixel heart + tagline. */}
      <div className={styles.wordmark}>
        <span className={styles.wordmarkTitle}>Catique Hub</span>
        <HeartSolid
          width={14}
          height={14}
          className={styles.wordmarkHeart}
          aria-hidden={true}
        />
        <span className={styles.wordmarkSub}>Orchestrate. Build. Ship.</span>
      </div>

      {/* Workspace nav rows — no section header. */}
      <ul className={styles.navList} role="list">
        {WORKSPACE_ITEMS.map(({ view, label, icon }) => {
          const isActive = view === activeView;
          return (
            <li key={view}>
              <NavRow
                isActive={isActive}
                onClick={() => onSelectView(view)}
                aria-current={isActive ? "page" : undefined}
              >
                {icon}
                <span className={styles.navLabel}>{label}</span>
              </NavRow>
            </li>
          );
        })}
      </ul>

      {/* Mascot — anchored at the bottom of the sidebar column. Sized to
          fill the column width (proportional height). The 1fr grid row
          above pushes this row to the bottom regardless of nav length. */}
      <img
        className={styles.mascot}
        src="/assets/mascot.png"
        alt="Catique mascot"
        data-testid="main-sidebar-mascot"
      />
    </nav>
  );
}
