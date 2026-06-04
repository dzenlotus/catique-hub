/**
 * Page: `/spaces/:spaceId` — v3 space day-screen.
 *
 * Sections (top → bottom):
 *   1. Header — name + icon + project-folder + settings cog.
 *   2. Resume panel — last-opened board / quick links to recent work.
 *   3. Agents in this space — one card per role that owns a board here,
 *      with the boards listed underneath.
 *   4. Project-level configuration — placeholder summary, full editor on
 *      `/spaces/:id/settings` (Phase 4 brings inline editing here).
 *   5. Activity log — collapsible stub; populated when D-D ships.
 *
 * Keeps `ActiveSpace` synced with the URL so deep-links work and the
 * SpacesSidebar highlight aligns.
 */
import {
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { useNavigate } from "@tanstack/react-router";

import { useActiveSpace } from "@shared/lib";
import {
  spaceBoardPath,
  spaceSettingsPath,
} from "@app/routes";
import { useBoards } from "@entities/board";
import type { Board } from "@entities/board";
import { useRoles } from "@entities/role";
import type { Role } from "@entities/role";
import { useSpace } from "@entities/space";
import { useRecentActivityEventsByScope } from "@entities/activity-event";
import type { ActivityEvent } from "@bindings/ActivityEvent";
import { Button, EntityTitle, Scrollable } from "@shared/ui";
import { useParamsCompat as useParams } from "@shared/lib";
import {
  lastBoardStore,
  writeLastActiveSpaceId,
} from "@shared/storage";

import styles from "./SpaceDetailPage.module.css";

interface SpaceDetailParams {
  spaceId?: string;
}

interface AgentGroup {
  role: Role;
  boards: Board[];
}

function groupBoardsByRole(boards: Board[], roles: Role[]): AgentGroup[] {
  const byId = new Map(roles.map((r) => [r.id, r] as const));
  const groups = new Map<string, AgentGroup>();

  for (const board of boards) {
    if (board.roleId === null) continue;
    const role = byId.get(board.roleId);
    if (role === undefined) continue;

    let group = groups.get(role.id);
    if (group === undefined) {
      group = { role, boards: [] };
      groups.set(role.id, group);
    }
    group.boards.push(board);
  }

  return [...groups.values()].sort((a, b) =>
    a.role.name.localeCompare(b.role.name),
  );
}

export function SpaceDetailPage(): ReactElement {
  const params = useParams<SpaceDetailParams>();
  const spaceId = params.spaceId ?? "";
  const navigate = useNavigate();
  const { activeSpaceId, setActiveSpaceId } = useActiveSpace();
  const spaceQuery = useSpace(spaceId);
  const boardsQuery = useBoards();
  const rolesQuery = useRoles();

  useEffect(() => {
    if (spaceId.length > 0 && spaceId !== activeSpaceId) {
      setActiveSpaceId(spaceId);
    }
    if (spaceId.length > 0) {
      writeLastActiveSpaceId(spaceId);
    }
  }, [spaceId, activeSpaceId, setActiveSpaceId]);

  const boardsInSpace = useMemo(() => {
    if (boardsQuery.status !== "success") return [];
    return boardsQuery.data.filter((b) => b.spaceId === spaceId);
  }, [boardsQuery.status, boardsQuery.data, spaceId]);

  const agentGroups = useMemo(() => {
    if (rolesQuery.status !== "success") return [];
    return groupBoardsByRole(boardsInSpace, rolesQuery.data);
  }, [boardsInSpace, rolesQuery.status, rolesQuery.data]);

  const lastBoard = useMemo<Board | null>(() => {
    if (spaceId.length === 0) return null;
    const stored = lastBoardStore(spaceId).get();
    if (stored === null) return null;
    return boardsInSpace.find((b) => b.id === stored) ?? null;
  }, [spaceId, boardsInSpace]);

  if (spaceId.length === 0 || spaceQuery.status === "pending") {
    return (
      <Shell>
        <div className={styles.statusPanel} role="status">
          Loading space…
        </div>
      </Shell>
    );
  }

  if (spaceQuery.status === "error") {
    return (
      <Shell>
        <div className={styles.statusPanel} role="alert">
          Failed to load space: {spaceQuery.error.message}
        </div>
      </Shell>
    );
  }

  const space = spaceQuery.data;

  function handleOpenSettings(): void {
    void navigate({ to: spaceSettingsPath(space.id) });
  }

  function handleOpenBoard(boardId: string): void {
    void navigate({ to: spaceBoardPath(space.id, boardId) });
  }

  return (
    <Shell>
      <Scrollable axis="y" className={styles.scrollHost}>
        <div className={styles.root} data-testid="space-detail">
          <header className={styles.header}>
            <EntityTitle
              name={space.name}
              size="lg"
              value={{ icon: space.icon ?? null, color: space.color ?? null }}
              defaultIcon="PixelDesignDrawingBoard"
              actions={
                <div className={styles.headerActions}>
                  {space.projectFolderPath !== null &&
                  space.projectFolderPath.length > 0 ? (
                    <span
                      className={styles.folderHint}
                      title={space.projectFolderPath}
                      data-testid="space-detail-folder"
                    >
                      📁 {space.projectFolderPath}
                    </span>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    onPress={handleOpenSettings}
                    data-testid="space-detail-settings"
                  >
                    Space settings
                  </Button>
                </div>
              }
            />
            <p className={styles.prefix}>Prefix: {space.prefix}</p>
          </header>

          <section
            className={styles.section}
            aria-labelledby="space-detail-resume"
            data-testid="space-detail-resume-section"
          >
            <h3 id="space-detail-resume" className={styles.sectionTitle}>
              Resume where you left off
            </h3>
            {lastBoard === null ? (
              <p className={styles.empty}>
                No recent board. Pick one below to get started.
              </p>
            ) : (
              <button
                type="button"
                className={styles.resumeCard}
                onClick={() => handleOpenBoard(lastBoard.id)}
                data-testid="space-detail-resume-card"
              >
                <span className={styles.resumeLabel}>Last opened board</span>
                <span className={styles.resumeTitle}>{lastBoard.name}</span>
              </button>
            )}
          </section>

          <section
            className={styles.section}
            aria-labelledby="space-detail-agents"
            data-testid="space-detail-agents-section"
          >
            <h3 id="space-detail-agents" className={styles.sectionTitle}>
              Agents in this space
            </h3>
            {agentGroups.length === 0 ? (
              <p className={styles.empty}>
                No agents own a board here yet. Add one from the space
                settings page.
              </p>
            ) : (
              <ul className={styles.agentList}>
                {agentGroups.map((group) => (
                  <li key={group.role.id} className={styles.agentCard}>
                    <h4 className={styles.agentName}>{group.role.name}</h4>
                    <ul className={styles.boardList}>
                      {group.boards.map((board) => (
                        <li key={board.id}>
                          <button
                            type="button"
                            className={styles.boardLink}
                            onClick={() => handleOpenBoard(board.id)}
                            data-testid={`space-detail-board-${board.id}`}
                          >
                            {board.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            className={styles.section}
            aria-labelledby="space-detail-config"
            data-testid="space-detail-config-section"
          >
            <h3 id="space-detail-config" className={styles.sectionTitle}>
              Project-level configuration
            </h3>
            <p className={styles.empty}>
              Manage space-level prompts, skills, and integrations from{" "}
              <button
                type="button"
                className={styles.inlineLink}
                onClick={handleOpenSettings}
              >
                Space settings
              </button>
              . Inline editing ships in Phase 4.
            </p>
          </section>

          <ActivityLogSection spaceId={space.id} />
        </div>
      </Scrollable>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity log — collapsible, per-space feed (refactor-v3 D-D).
//
// The query is scoped to `scope_kind = "space"` so the section only
// surfaces events written against this space. The global all-activity
// feed lives at `useRecentActivityEvents()` and powers a debug view.
//
// Round 4 / Stream P adds a chip-strip type filter above the list. The
// filter is purely client-side over the existing query result — no new
// IPC. "Edits" is a virtual chip matching the Tier-3 compacted events
// (any name ending in `:updated`).
// ─────────────────────────────────────────────────────────────────────────────

type ActivityFilter = "all" | "tasks" | "boards" | "prompts" | "edits";

interface ChipDef {
  readonly id: ActivityFilter;
  readonly label: string;
}

const ACTIVITY_CHIPS: readonly ChipDef[] = [
  { id: "all", label: "All" },
  { id: "tasks", label: "Tasks" },
  { id: "boards", label: "Boards" },
  { id: "prompts", label: "Prompts" },
  { id: "edits", label: "Edits" },
] as const;

function matchesFilter(event: ActivityEvent, filter: ActivityFilter): boolean {
  if (filter === "all") return true;
  if (filter === "tasks") return event.name.startsWith("task:");
  if (filter === "boards") return event.name.startsWith("board:");
  if (filter === "prompts") return event.name.startsWith("prompt:");
  if (filter === "edits") return event.name.endsWith(":updated");
  return true;
}

function ActivityLogSection({ spaceId }: { spaceId: string }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const eventsQuery = useRecentActivityEventsByScope("space", spaceId, 20);

  const events = eventsQuery.status === "success" ? eventsQuery.data : [];
  const filteredEvents = useMemo(
    () => events.filter((e) => matchesFilter(e, filter)),
    [events, filter],
  );

  return (
    <section
      className={styles.section}
      aria-labelledby="space-detail-activity"
      data-testid="space-detail-activity-section"
    >
      <button
        type="button"
        className={styles.collapseHeader}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span id="space-detail-activity" className={styles.sectionTitle}>
          Activity log
        </span>
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded ? (
        <>
          <div
            role="tablist"
            aria-label="Filter activity by type"
            className={styles.chipStrip}
            data-testid="space-detail-activity-chips"
          >
            {ACTIVITY_CHIPS.map((chip) => {
              const selected = filter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="space-detail-activity-list"
                  className={styles.chip}
                  data-active={selected ? "true" : undefined}
                  data-testid={`space-detail-activity-chip-${chip.id}`}
                  onClick={() => setFilter(chip.id)}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
          {eventsQuery.status === "pending" ? (
            <p className={styles.empty}>Loading…</p>
          ) : eventsQuery.status === "error" ? (
            <p className={styles.empty} role="alert">
              Activity log unavailable: {eventsQuery.error.message}
            </p>
          ) : events.length === 0 ? (
            <p className={styles.empty}>
              No recent activity in this space yet. Events show up here
              as soon as something changes (last 20 entries, retained for
              90 days).
            </p>
          ) : filteredEvents.length === 0 ? (
            <p className={styles.empty} data-testid="space-detail-activity-empty">
              No matching events.
            </p>
          ) : (
            <ul
              id="space-detail-activity-list"
              className={styles.eventList}
              data-testid="space-detail-activity-list"
            >
              {filteredEvents.map((event) => (
                <li
                  key={String(event.seq)}
                  className={styles.eventRow}
                  data-testid={`space-detail-activity-${String(event.seq)}`}
                >
                  <strong className={styles.eventName}>{event.name}</strong>
                  {event.count > 1n ? (
                    <span
                      className={styles.eventCount}
                      data-testid={`space-detail-activity-count-${String(event.seq)}`}
                    >
                      × {String(event.count)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell — RootLayout provides the sidebar; pages just emit their content.
// ─────────────────────────────────────────────────────────────────────────────

function Shell({ children }: { children: ReactElement }): ReactElement {
  return (
    <section className={styles.shell} data-testid="space-detail-root">
      {children}
    </section>
  );
}
