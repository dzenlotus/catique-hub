import { useMemo, type ReactElement } from "react";

import { EntityTree, type EntityTreeNode, Scrollable } from "@shared/ui";

import HeartSolid from "./assets/heart-solid.svg?react";
import { WORKSPACE_ITEMS, type WorkspaceItem } from "./workspaceItems";
import styles from "./MainSidebar.module.css";

// ---------------------------------------------------------------------------
// NavView — the 6 navigable top-level views surfaced as nav rows in the
// main sidebar. "spaces" is kept for internal routing (per-space settings
// page) but is not shown as a nav item.
// Round-19c: "prompt-groups" was merged into "prompts".
// ---------------------------------------------------------------------------

/** All navigable top-level views in the app shell. */
export type NavView =
  | "boards"
  | "agent-roles"
  | "prompts"
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
 * Wordmark on top, workspace rail underneath driven by `<EntityTree/>`.
 * The rail is headerless (no SECTION label) — `<EntityTree/>` renders
 * only the `<ul>` of label rows. Per-row icons live in
 * `workspaceItems.tsx` and ride through `renderRow` so the existing
 * pixel icons keep their original size + alignment.
 */
export function MainSidebar({
  activeView,
  onSelectView,
}: MainSidebarProps): ReactElement {
  const treeData = useMemo<EntityTreeNode<WorkspaceItem>[]>(
    () =>
      WORKSPACE_ITEMS.map((item) => ({
        id: item.view,
        label: item.label,
        data: item,
      })),
    [],
  );

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

      {/* Workspace rail — headerless EntityTree wrapped in Scrollable so
          the list scrolls when nav items exceed available height. */}
      <Scrollable
        axis="y"
        className={styles.navListShell}
        data-testid="main-sidebar-nav-scroll"
      >
        <EntityTree<WorkspaceItem>
          testIdPrefix="main-sidebar"
          data={treeData}
          rowConfig={(node) => ({
            // EntityTree's Row is non-interactive (no onClick) here — the
            // <button> inside `renderRow` is the click surface so we don't
            // double-fire onSelectView for a single click.
            isActive: node.id === activeView,
          })}
          renderRow={({ node, isActive }) => {
            const item = node.data;
            if (!item) return null;
            return (
              <button
                type="button"
                className={styles.navItemBody}
                onClick={() => onSelectView(node.id as NavView)}
                aria-current={isActive ? "page" : undefined}
                aria-label={item.label}
                data-testid={`main-sidebar-nav-${node.id}`}
              >
                {item.icon}
                <span className={styles.navLabel}>{item.label}</span>
              </button>
            );
          }}
        />
      </Scrollable>
    </nav>
  );
}
