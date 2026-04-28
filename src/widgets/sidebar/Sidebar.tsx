import { useState, useCallback, type ReactElement } from "react";
import {
  LayoutGrid,
  FileText,
  UserCircle2,
  Tag,
  FileBarChart,
  ChevronDown,
  AlertCircle,
  Settings,
  Sun,
  Moon,
  Plus,
  Settings2,
  Search,
  Wrench,
  Cog,
} from "lucide-react";
import { Button as AriaButton } from "react-aria-components";
import { cn } from "@shared/lib";
import { Button, Menu, MenuItem, MenuTrigger, Separator } from "@shared/ui";
import { useSpaces } from "@entities/space";
import type { Space } from "@entities/space";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { SpaceCreateDialog } from "@widgets/space-create-dialog";
import { GlobalSearch, useGlobalSearchKeybind } from "@widgets/global-search";
import type { SearchResult } from "@bindings/SearchResult";
import styles from "./Sidebar.module.css";

/** All navigable top-level views in the app shell. */
export type NavView =
  | "boards"
  | "prompts"
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

const NAV_ITEMS: NavItem[] = [
  { view: "boards", label: "Boards", Icon: LayoutGrid },
  { view: "prompts", label: "Prompts", Icon: FileText },
  { view: "roles", label: "Roles", Icon: UserCircle2 },
  { view: "tags", label: "Tags", Icon: Tag },
  { view: "reports", label: "Reports", Icon: FileBarChart },
  { view: "skills", label: "Skills", Icon: Wrench },
  { view: "mcp-tools", label: "MCP Tools", Icon: Cog },
  { view: "settings", label: "Settings", Icon: Settings },
];

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
    <div className={styles.sidebarFooter}>
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
    </div>
  );
}

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
    <div className={styles.spaceSwitcher}>
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
    </div>
  );
}

/**
 * Left-rail navigation sidebar.
 *
 * Renders a vertical list of nav items. The active item receives
 * `aria-current="page"` for screen readers and an accent treatment
 * via the `.active` CSS module class.
 *
 * The space switcher section above the nav list reflects the active space
 * (from global `ActiveSpaceProvider` context) but does NOT yet filter any
 * entity lists — that is a follow-up task.
 */
export function Sidebar({ activeView, onSelectView }: SidebarProps): ReactElement {
  const spacesQuery = useSpaces();
  const { activeSpaceId, setActiveSpaceId } = useActiveSpace();

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
   * - agentReport → navigates to the "reports" view via `onSelectView`.
   * - task        → full task-deep-linking is out of scope for this release.
   *                 The palette closes and a console.warn is emitted so the
   *                 user at least sees their result. Wire up route navigation
   *                 when the task-detail route is implemented (E5.x).
   */
  function handleSearchResult(result: SearchResult): void {
    setIsSearchOpen(false);
    if (result.type === "agentReport") {
      onSelectView("reports");
    } else {
      // TODO(E5.x): Navigate to the task's board/column once deep-linking is
      // implemented. For now we close the palette and surface the result id so
      // the developer can trace which task was selected.
      // eslint-disable-next-line no-console
      console.warn(
        "[global-search] Task navigation not yet implemented. Selected task id:",
        result.id,
        "boardId:",
        result.boardId,
      );
    }
  }

  const renderSwitcher = (): ReactElement | null => {
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
      // FirstLaunchGate handles the truly-empty state globally. Suppress
      // the switcher to avoid a broken partial UI.
      return null;
    }

    return (
      <SpaceSwitcher
        spaces={spaces}
        activeSpaceId={effectiveSpaceId}
        onSelect={(id) => setActiveSpaceId(id)}
        onNewSpace={() => setCreateDialogOpen(true)}
        onManageSpaces={() => onSelectView("spaces")}
      />
    );
  };

  return (
    <nav className={styles.sidebar} aria-label="Main navigation">
      {/* Search button — above the space switcher */}
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
      {renderSwitcher()}
      <ul className={styles.navList} role="list">
        {NAV_ITEMS.map(({ view, label, Icon }) => {
          const isActive = view === activeView;
          return (
            <li key={view}>
              <button
                type="button"
                className={cn(styles.navItem, isActive && styles.active)}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSelectView(view)}
              >
                <Icon size={16} aria-hidden={true} />
                <span className={styles.navLabel}>{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <ThemeToggle />
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
