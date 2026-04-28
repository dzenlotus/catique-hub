import { useState, useCallback, type ReactElement } from "react";
import {
  LayoutGrid,
  FileText,
  User,
  Tag,
  BarChart3,
  ChevronDown,
  AlertCircle,
  Settings,
  Sun,
  Moon,
  Plus,
  Settings2,
  Search,
  Wrench,
  Plug,
  FolderTree,
  Heart,
} from "lucide-react";
import { Button as AriaButton } from "react-aria-components";
import { useLocation } from "wouter";
import { cn } from "@shared/lib";
import { Button, Menu, MenuItem, MenuTrigger, Separator } from "@shared/ui";
import { useSpaces } from "@entities/space";
import type { Space } from "@entities/space";
import { useBoards } from "@entities/board";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { SpaceCreateDialog } from "@widgets/space-create-dialog";
import { GlobalSearch, useGlobalSearchKeybind } from "@widgets/global-search";
import type { SearchResult } from "@bindings/SearchResult";
import { pathForView, taskPath, boardPath } from "@app/routes";
import styles from "./Sidebar.module.css";

/** All navigable top-level views in the app shell. */
export type NavView =
  | "boards"
  | "prompts"
  | "prompt-groups"
  | "roles"
  | "tags"
  | "reports"
  | "skills"
  | "mcp-tools"
  | "spaces"
  | "settings";

export interface SidebarProps {
  activeView: NavView;
  onSelectView: (view: NavView) => void;
}

interface NavItem {
  view: NavView;
  label: string;
  Icon: React.FC<{ size?: number; "aria-hidden"?: boolean | "true" | "false" }>;
}

/**
 * WORKSPACE section — the 9 core navigable views.
 *
 * Icon substitutions vs. original (matching pixel-art visual weight from image3.png):
 * - Roles: `User` instead of `UserCircle2` — cleaner 16 px pixel match.
 * - Reports: `BarChart3` instead of `FileBarChart` — matches bar-chart icon in pixel set.
 * - MCP Tools: `Plug` instead of `Cog` — matches the plug/connector icon in pixel set.
 *
 * TODO: replace with extracted pixel-art SVGs once designer provides individual
 * SVG files from image3.png. (Follow-up task per handoff.md §"What is out of scope".)
 */
const WORKSPACE_ITEMS: NavItem[] = [
  { view: "boards", label: "Boards", Icon: LayoutGrid },
  { view: "prompts", label: "Prompts", Icon: FileText },
  { view: "prompt-groups", label: "Prompt Groups", Icon: FolderTree },
  { view: "roles", label: "Roles", Icon: User },
  { view: "tags", label: "Tags", Icon: Tag },
  { view: "reports", label: "Reports", Icon: BarChart3 },
  { view: "skills", label: "Skills", Icon: Wrench },
  { view: "mcp-tools", label: "MCP Tools", Icon: Plug },
  { view: "settings", label: "Settings", Icon: Settings },
];

/** Maximum number of boards to show in the RECENT BOARDS section. */
const RECENT_BOARDS_LIMIT = 5;

// ---------------------------------------------------------------------------
// ThemeToggle — sidebar footer component
// ---------------------------------------------------------------------------

/**
 * Reads the current theme from `document.documentElement.dataset.theme`.
 * Defaults to "dark" when the attribute is absent (matching the design-token
 * file's default: `:root` maps to the light palette, but our UX default is
 * dark, so the toggle reads from the DOM attribute set at app init).
 */
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
      /* private mode or restricted environment — DOM attribute still updated */
    }
  }

  // Label + icon describe what will happen when pressed (the target state).
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
        <Sun size={14} aria-hidden={true} />
      ) : (
        <Moon size={14} aria-hidden={true} />
      )}
      <span>{nextLabel}</span>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// SpaceSwitcher — popover-based space selector inlined in SPACES section
// ---------------------------------------------------------------------------

/**
 * SpaceSwitcher — trigger + popover menu for switching the active space.
 *
 * Active space state is now held in `ActiveSpaceProvider` (global context)
 * so any part of the app can read the selection. The context also persists
 * to localStorage so the selection survives page reloads.
 */
interface SpaceSwitcherProps {
  spaces: Space[];
  activeSpaceId: string;
  onSelect: (id: string) => void;
  onNewSpace: () => void;
  onManageSpaces: () => void;
}

function SpaceSwitcher({
  spaces,
  activeSpaceId,
  onSelect,
  onNewSpace,
  onManageSpaces,
}: SpaceSwitcherProps): ReactElement {
  const active = spaces.find((s) => s.id === activeSpaceId) ?? spaces[0];

  return (
    <MenuTrigger>
      {/*
       * RAC MenuTrigger requires a RAC-aware pressable child.
       * We use AriaButton directly (not our Button wrapper) so we can
       * apply custom CSS without the wrapper's variant/size class logic.
       */}
      <AriaButton
        className={styles.spaceTrigger}
        aria-haspopup="menu"
        aria-label={`Active space: ${active.name}. Switch space`}
      >
        <span className={styles.spacePrefix}>{active.prefix}</span>
        <span className={styles.spaceName}>{active.name}</span>
        <ChevronDown size={12} aria-hidden={true} className={styles.spaceChevron} />
      </AriaButton>
      <Menu<Space>
        onAction={(key) => {
          const k = String(key);
          if (k === "__new__") { onNewSpace(); return; }
          if (k === "__manage__") { onManageSpaces(); return; }
          onSelect(k);
        }}
        placement="bottom start"
        aria-label="Switch space"
      >
        {spaces.map((space) => (
          <MenuItem
            id={space.id}
            key={space.id}
            aria-label={`${space.name}${space.isDefault ? " (default)" : ""}`}
          >
            <span className={styles.spaceMenuPrefix}>{space.prefix}</span>
            <span className={styles.spaceMenuName}>{space.name}</span>
            {space.isDefault ? (
              <span className={styles.spaceMenuDefault} aria-hidden="true">
                ★
              </span>
            ) : null}
          </MenuItem>
        ))}
        <Separator />
        <MenuItem
          id="__new__"
          aria-label="Новое пространство"
          className={styles.spaceMenuAction}
        >
          <Plus size={12} aria-hidden={true} />
          <span>+ Новое пространство</span>
        </MenuItem>
        <MenuItem
          id="__manage__"
          aria-label="Управление пространствами"
          className={styles.spaceMenuAction}
        >
          <Settings2 size={12} aria-hidden={true} />
          <span>Управление пространствами</span>
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

// ---------------------------------------------------------------------------
// NavRow — single row item (shared by WORKSPACE and RECENT BOARDS sections)
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
 * Left-rail navigation sidebar — Design System v1.
 *
 * Structure:
 *   Wordmark block
 *   ├─ Search button (Cmd+K)  [TODO: move to top bar — parallel agent scope]
 *   ├─ Section: SPACES
 *   │    └─ SpaceSwitcher (popover-based space rows)
 *   ├─ Section: RECENT BOARDS
 *   │    └─ top-5 boards by updatedAt desc
 *   └─ Section: WORKSPACE
 *        └─ 9 nav items (Boards / Prompts / Prompt Groups / Roles / Tags / Reports / Skills / MCP Tools / Settings)
 *   Footer: Mascot + theme toggle
 *
 * Active nav-item gets a 3 px red left strip (`--color-cta-bg`) + soft
 * background (`--color-accent-soft`) per DS v1 components.md § Sidebar.
 */
export function Sidebar({ activeView, onSelectView }: SidebarProps): ReactElement {
  const spacesQuery = useSpaces();
  const { activeSpaceId, setActiveSpaceId } = useActiveSpace();
  const [, setLocation] = useLocation();

  const boardsQuery = useBoards();

  const spaces = spacesQuery.data ?? [];
  const effectiveSpaceId = activeSpaceId;

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Cmd+K / Ctrl+K keybind — opens the palette from anywhere in the sidebar
  // subtree, skipping inputs/textareas/contenteditable.
  useGlobalSearchKeybind(useCallback(() => setIsSearchOpen(true), []));

  /**
   * Handle a result selected in the global search palette.
   *
   * - agentReport → navigates to `/reports` via the router.
   * - task        → navigates directly to `/tasks/:id` which opens TaskDialog
   *                 on top of BoardsList regardless of the current view.
   */
  function handleSearchResult(result: SearchResult): void {
    setIsSearchOpen(false);
    if (result.type === "agentReport") {
      setLocation(pathForView("reports"));
    } else {
      setLocation(taskPath(result.id));
    }
  }

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
          <AlertCircle
            size={14}
            aria-hidden={true}
            className={styles.spaceErrorIcon}
          />
          <span className={styles.spaceErrorText}>Spaces unavailable</span>
        </div>
      );
    }

    if (spaces.length === 0 || effectiveSpaceId === null) {
      return (
        <div className={styles.sectionEmpty}>
          <span className={styles.sectionEmptyText}>Нет пространств</span>
        </div>
      );
    }

    return (
      <div className={styles.spaceSwitcher}>
        <SpaceSwitcher
          spaces={spaces}
          activeSpaceId={effectiveSpaceId}
          onSelect={(id) => setActiveSpaceId(id)}
          onNewSpace={() => setCreateDialogOpen(true)}
          onManageSpaces={() => onSelectView("spaces")}
        />
      </div>
    );
  };

  // ── RECENT BOARDS section renderer ─────────────────────────────────────

  const renderRecentBoards = (): ReactElement => {
    if (boardsQuery.status !== "success" || boardsQuery.data.length === 0) {
      return <></>;
    }

    const recent = [...boardsQuery.data]
      .sort((a, b) => Number(b.updatedAt - a.updatedAt))
      .slice(0, RECENT_BOARDS_LIMIT);

    return (
      <ul className={styles.navList} role="list">
        {recent.map((board) => (
          <li key={board.id}>
            <NavRow
              isActive={false}
              onClick={() => setLocation(boardPath(board.id))}
            >
              <LayoutGrid size={16} aria-hidden={true} />
              <span className={styles.navLabel}>{board.name}</span>
            </NavRow>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <nav className={styles.sidebar} aria-label="Main navigation">

      {/* ── Wordmark block ───────────────────────────────────────────────── */}
      <div className={styles.wordmark}>
        {/* TODO: replace Heart glyph with extracted pixel-art cat SVG from
            image3.png once designer provides individual SVG files.
            See handoff.md §"What is out of scope" — pixel-art icon extraction. */}
        <Heart
          size={20}
          aria-hidden={true}
          className={styles.wordmarkIcon}
        />
        <div className={styles.wordmarkText}>
          <span className={styles.wordmarkTitle}>Catique HUB</span>
          <span className={styles.wordmarkSub}>Orchestrate. Build. Ship.</span>
        </div>
      </div>

      {/* ── Search button — TODO: move to top-bar widget (parallel agent scope)
          Kept here temporarily so search functionality is not broken.
          Coordinate with: top-bar agent / ctq-topbar ticket. ───────────────── */}
      <div className={styles.searchButtonWrap}>
        <button
          type="button"
          className={styles.searchButton}
          aria-label="Открыть поиск (Cmd+K)"
          onClick={() => setIsSearchOpen(true)}
          data-testid="sidebar-search-button"
        >
          <Search size={14} aria-hidden="true" />
          <span className={styles.searchButtonLabel}>Поиск</span>
          <span className={styles.searchButtonKbd} aria-hidden="true">⌘K</span>
        </button>
      </div>

      {/* ── SPACES ──────────────────────────────────────────────────────────── */}
      <div className={styles.sectionLabel} aria-label="Пространства">
        SPACES
      </div>
      {renderSpacesSection()}

      {/* ── RECENT BOARDS ───────────────────────────────────────────────────── */}
      {boardsQuery.status === "success" && boardsQuery.data.length > 0 && (
        <>
          <div className={styles.sectionLabel} aria-label="Недавние доски">
            RECENT BOARDS
          </div>
          {renderRecentBoards()}
        </>
      )}

      {/* ── WORKSPACE ───────────────────────────────────────────────────────── */}
      <div className={styles.sectionLabel} aria-label="Рабочее пространство">
        WORKSPACE
      </div>
      <ul className={styles.navList} role="list">
        {WORKSPACE_ITEMS.map(({ view, label, Icon }) => {
          const isActive = view === activeView;
          return (
            <li key={view}>
              <NavRow
                isActive={isActive}
                onClick={() => onSelectView(view)}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={16} aria-hidden={true} />
                <span className={styles.navLabel}>{label}</span>
              </NavRow>
            </li>
          );
        })}
      </ul>

      {/* ── Footer: Mascot + theme toggle ───────────────────────────────────── */}
      <div className={styles.sidebarFooter}>
        {/*
         * Mascot block — pixel-art cat placeholder.
         *
         * TODO: replace 🐱 emoji with extracted pixel-art cat SVG (32×32 px) from
         * image3.png row 1, position [0,0] once designer provides individual SVG
         * files. See handoff.md §"What is out of scope". The tagline text below is
         * per Maria's mockup spec.
         */}
        <div className={styles.mascot} aria-hidden="true">
          <span className={styles.mascotEmoji} role="img" aria-label="Кот-маскот">🐱</span>
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
      <GlobalSearch
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectResult={handleSearchResult}
      />
    </nav>
  );
}
