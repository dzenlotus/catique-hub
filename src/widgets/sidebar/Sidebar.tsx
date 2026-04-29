import {
  useState,
  useEffect,
  type ReactElement,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { cn } from "@shared/lib";
import { Button, Scrollable } from "@shared/ui";
import {
  PixelPetAnimalsCat,
  PixelCodingAppsWebsitesModule,
  PixelInterfaceEssentialMessage,
  PixelInterfaceEssentialList,
  PixelDesignMagicWand,
  PixelCodingAppsWebsitesDatabase,
  PixelInterfaceEssentialSettingCog,
  PixelEcologyOrganicSunGrowth,
  PixelWeatherMoon,
  PixelInterfaceEssentialNavigationMenu1,
} from "@shared/ui/Icon";
import HeartSolid from "./assets/heart-solid.svg?react";
import { useSpaces } from "@entities/space";
import type { Space } from "@entities/space";
import { useBoards } from "@entities/board";
import type { Board } from "@entities/board";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { SpaceCreateDialog } from "@widgets/space-create-dialog";
import { taskPath as _taskPath, boardPath } from "@app/routes";
import { PixelInterfaceEssentialAlertCircle1 } from "@shared/ui/Icon";
import mascotUrl from "./assets/mascot.png";
import styles from "./Sidebar.module.css";

// Suppress unused-import warnings for routes helpers we may need later
void _taskPath;

// ---------------------------------------------------------------------------
// NavView — the 7 navigable top-level views shown in WORKSPACE section.
// "spaces" is kept for internal routing but not shown as a nav item.
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

export interface SidebarProps {
  activeView: NavView;
  onSelectView: (view: NavView) => void;
}

interface WorkspaceItem {
  view: NavView;
  label: string;
  /** SVG icon component reference. */
  icon: ReactNode;
}

/**
 * WORKSPACE section — 7 core navigable views matching the pixel-art mockup.
 * Icons inherit `color` from the parent nav item (`.navItem.active` sets
 * `color: var(--color-cta-bg)` which flows through via `currentColor`).
 */
const WORKSPACE_ITEMS: WorkspaceItem[] = [
  { view: "boards",        label: "Boards",        icon: <PixelCodingAppsWebsitesModule width={16} height={16} aria-hidden /> },
  { view: "agent-roles",   label: "Agent roles",   icon: <PixelPetAnimalsCat width={16} height={16} aria-hidden /> },
  { view: "prompts",       label: "Prompts",        icon: <PixelInterfaceEssentialMessage width={16} height={16} aria-hidden /> },
  { view: "prompt-groups", label: "Prompt groups",  icon: <PixelInterfaceEssentialList width={16} height={16} aria-hidden /> },
  { view: "skills",        label: "Skills",         icon: <PixelDesignMagicWand width={16} height={16} aria-hidden /> },
  { view: "mcp-servers",   label: "MCP servers",    icon: <PixelCodingAppsWebsitesDatabase width={16} height={16} aria-hidden /> },
  { view: "settings",      label: "Settings",       icon: <PixelInterfaceEssentialSettingCog width={16} height={16} aria-hidden /> },
];

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function getExpandedKey(spaceId: string): string {
  return `catique:sidebar:expanded:${spaceId}`;
}

function readExpandedFromStorage(spaceId: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(getExpandedKey(spaceId));
    if (stored === null) return defaultValue;
    return stored === "true";
  } catch {
    return defaultValue;
  }
}

function writeExpandedToStorage(spaceId: string, value: boolean): void {
  try {
    localStorage.setItem(getExpandedKey(spaceId), String(value));
  } catch {
    /* restricted environment — in-memory state still works */
  }
}

// ---------------------------------------------------------------------------
// ThemeToggle
// ---------------------------------------------------------------------------

function readTheme(): "dark" | "light" {
  const t = document.documentElement.dataset["theme"];
  return t === "light" ? "light" : "dark";
}

function ThemeToggle(): ReactElement {
  const [theme, setTheme] = useState<"dark" | "light">(readTheme);

  function toggle(): void {
    const next: "dark" | "light" = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset["theme"] = next;
    setTheme(next);
    try {
      localStorage.setItem("catique:theme", next);
    } catch {
      /* private mode — DOM attribute still updated */
    }
  }

  const nextLabel = theme === "dark" ? "Светлая тема" : "Тёмная тема";
  const ariaLabel = `Переключить на ${nextLabel.toLowerCase()}`;

  return (
    <Button
      variant="ghost"
      size="sm"
      onPress={toggle}
      aria-pressed={theme === "light"}
      aria-label={ariaLabel}
      className={styles.themeToggle}
    >
      {theme === "dark" ? (
        <PixelEcologyOrganicSunGrowth width={14} height={14} aria-hidden={true} />
      ) : (
        <PixelWeatherMoon width={14} height={14} aria-hidden={true} />
      )}
      <span>{nextLabel}</span>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// SpaceRow — inline collapsible space item
// ---------------------------------------------------------------------------

interface SpaceRowProps {
  space: Space;
  boards: Board[];
  isActiveSpace: boolean;
  activeBoardId: string | null;
  onSelectSpace: (id: string) => void;
  onSelectBoard: (id: string) => void;
  isDefaultExpanded: boolean;
}

function SpaceRow({
  space,
  boards,
  isActiveSpace,
  activeBoardId,
  onSelectSpace,
  onSelectBoard,
  isDefaultExpanded,
}: SpaceRowProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(() =>
    readExpandedFromStorage(space.id, isDefaultExpanded),
  );

  // Persist on every toggle
  useEffect(() => {
    writeExpandedToStorage(space.id, isExpanded);
  }, [space.id, isExpanded]);

  const spaceBoards = boards.filter((b) => b.spaceId === space.id);

  function handleNameClick(): void {
    onSelectSpace(space.id);
  }

  function handleChevronClick(e: React.MouseEvent): void {
    e.stopPropagation();
    setIsExpanded((prev) => !prev);
  }

  return (
    <li className={styles.spaceItem}>
      {/* Space header row */}
      <div
        className={cn(styles.spaceRow, isActiveSpace && styles.spaceRowActive)}
      >
        {/* Chevron — toggles expand/collapse, does NOT change active space */}
        <button
          type="button"
          className={styles.spaceChevronBtn}
          onClick={handleChevronClick}
          aria-label={isExpanded ? `Свернуть ${space.name}` : `Развернуть ${space.name}`}
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <span aria-hidden={true}>⌄</span>
          ) : (
            <span aria-hidden={true}>›</span>
          )}
        </button>

        {/* Space icon + name — clicking sets active space */}
        <button
          type="button"
          className={styles.spaceNameBtn}
          onClick={handleNameClick}
          aria-label={`${space.name}${isActiveSpace ? " (активное пространство)" : ""}`}
        >
          <PixelPetAnimalsCat width={14} height={14} aria-hidden={true} />
          <span className={styles.spaceNameText}>{space.name}</span>
        </button>

        {/* Kebab placeholder — visual only in v1 */}
        <button
          type="button"
          className={styles.spaceKebabBtn}
          aria-label={`Действия для ${space.name}`}
          tabIndex={-1}
        >
          <PixelInterfaceEssentialNavigationMenu1 width={12} height={12} aria-hidden={true} />
        </button>
      </div>

      {/* Board rows inside expanded space */}
      {isExpanded && spaceBoards.length > 0 && (
        <ul className={styles.boardList} role="list">
          {spaceBoards.map((board) => {
            const isActive = activeBoardId === board.id;
            return (
              <li key={board.id}>
                <button
                  type="button"
                  className={cn(styles.boardRow, isActive && styles.boardRowActive)}
                  onClick={() => onSelectBoard(board.id)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={board.name}
                >
                  {/* Active strip for board row */}
                  {isActive && <span className={styles.boardActiveStrip} aria-hidden="true" />}
                  <PixelCodingAppsWebsitesModule width={14} height={14} aria-hidden={true} />
                  <span className={styles.boardRowLabel}>{board.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// NavRow — single workspace / recent-board row
// ---------------------------------------------------------------------------

interface NavRowProps {
  isActive: boolean;
  onClick: () => void;
  "aria-current"?: "page" | undefined;
  children: React.ReactNode;
  className?: string;
}

function NavRow({
  isActive,
  onClick,
  "aria-current": ariaCurrent,
  children,
  className,
}: NavRowProps): ReactElement {
  return (
    <button
      type="button"
      className={cn(styles.navItem, isActive && styles.active, className)}
      aria-current={ariaCurrent}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sidebar — main export
// ---------------------------------------------------------------------------

/**
 * Left-rail navigation sidebar — DS v1 (Round 4).
 *
 * Structure:
 *   Wordmark block (Catique Hub / ♥ / tagline)
 *   Search button (Cmd+K)
 *   ──────────
 *   SPACES section label
 *     ▼ [cat] Catique  ···      ← inline collapsible space rows
 *       ┃ [grid] Engineering    ← active board
 *         [grid] Agent Ops
 *         [map]  Roadmap
 *     ▶ [cup]  Side projects ···
 *   ──────────
 *   WORKSPACE section label
 *     [boards] Boards           ← active when activeView === "boards"
 *     [roles]  Agent roles
 *     [bubble] Prompts
 *     [layers] Prompt groups
 *     [spark]  Skills
 *     [server] MCP servers
 *     [gear]   Settings
 *   ──────────
 *   RECENT BOARDS section label
 *     [grid] Engineering
 *     [grid] Roadmap
 *   ──────────
 *   Mascot area + tagline
 *   Theme toggle
 */
export function Sidebar({ activeView, onSelectView }: SidebarProps): ReactElement {
  const spacesQuery = useSpaces();
  const { activeSpaceId, setActiveSpaceId } = useActiveSpace();
  const [location, setLocation] = useLocation();

  const boardsQuery = useBoards();

  const spaces = spacesQuery.data ?? [];
  const boards = boardsQuery.data ?? [];

  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Derive the currently active board id from the URL
  const activeBoardId: string | null = (() => {
    const match = location.match(/^\/boards\/(.+)$/);
    return match ? match[1] : null;
  })();

  // ── SPACES section renderer ─────────────────────────────────────────────

  const renderSpacesSection = (): ReactElement => {
    if (spacesQuery.status === "pending") {
      return (
        <div className={styles.spaceSwitcher} aria-hidden="true">
          <div className={styles.spaceSwitcherSkeleton} />
        </div>
      );
    }

    if (spacesQuery.status === "error") {
      return (
        <div
          className={styles.spaceSwitcher}
          role="alert"
          title={spacesQuery.error.message}
          aria-label="Failed to load spaces"
        >
          <PixelInterfaceEssentialAlertCircle1
            width={14}
            height={14}
            aria-hidden={true}
            className={styles.spaceErrorIcon}
          />
          <span className={styles.spaceErrorText}>Spaces unavailable</span>
        </div>
      );
    }

    if (spaces.length === 0 || activeSpaceId === null) {
      return (
        <div className={styles.sectionEmpty}>
          <span className={styles.sectionEmptyText}>Нет пространств</span>
        </div>
      );
    }

    return (
      <ul className={styles.spaceList} role="list">
        {spaces.map((space, index) => (
          <SpaceRow
            key={space.id}
            space={space}
            boards={boards}
            isActiveSpace={space.id === activeSpaceId}
            activeBoardId={activeBoardId}
            onSelectSpace={(id) => setActiveSpaceId(id)}
            onSelectBoard={(id) => setLocation(boardPath(id))}
            isDefaultExpanded={index === 0 || space.isDefault}
          />
        ))}
      </ul>
    );
  };

  return (
    <nav className={styles.sidebar} aria-label="Main navigation">

      {/* ── Wordmark block ─────────────────────────────────────────────────
          Per Round 18 reference (Image #2): "Catique Hub" on a single
          serif line, solid pixel-heart centred below, tagline below. */}
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

      <Scrollable axis="y" className={styles.sectionsWrap}>

        {/* ── SPACES ────────────────────────────────────────────────────────── */}
        <div className={styles.sectionLabel} aria-label="Пространства">
          SPACES
        </div>
        {renderSpacesSection()}

        <div className={styles.divider} aria-hidden="true" />

        {/* ── WORKSPACE ─────────────────────────────────────────────────────── */}
        <div className={styles.sectionLabel} aria-label="Workspace">
          WORKSPACE
        </div>
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

      </Scrollable>

      {/* ── Footer: Mascot + theme toggle ───────────────────────────────────── */}
      <div className={styles.sidebarFooter}>
        <div className={styles.mascotArea} aria-hidden="true">
          <img
            src={mascotUrl}
            alt="Catique mascot — a cat in beret with espresso"
            className={styles.mascot}
            aria-hidden="true"
          />
          <p className={styles.mascotTagline}>
            Bonjour, développeur.{" "}
            <em>Stay curious. Ship lovely things.</em>
          </p>
        </div>
        <ThemeToggle />
      </div>

      <SpaceCreateDialog
        isOpen={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={(space) => setActiveSpaceId(space.id)}
      />
    </nav>
  );
}
