/**
 * Quick-action registry for the Cmd+K palette.
 *
 * Triggered when the user types `>` as the first character of the
 * search query — palette switches from search-mode to command-mode and
 * filters actions by name+keyword.
 *
 * v3 Wave 2: actions are now route-aware. When the active route is
 * `/tasks/:taskId`, additional actions surface:
 *   - One "Attach prompt X to this task" per known prompt, ordered by
 *     prompt name, executed on Enter OR via `secondaryRun` so a
 *     Cmd+Enter shortcut from the search results can attach without
 *     leaving the palette.
 */

import { invoke } from "@shared/api";
import {
  routes,
  spacePath,
} from "@app/routes";

export interface QuickActionContext {
  /** Wraps `useLocationCompat()[1]` from `@shared/lib`. */
  navigate: (to: string) => void;
  /** Push a toast via the global ToastProvider. */
  toast: (level: "success" | "error" | "info", message: string) => void;
}

export interface QuickAction {
  /** Stable identifier; rendered as `data-testid="cmdk-action-<id>"`. */
  id: string;
  /** Display label. */
  title: string;
  /** Optional subtitle / hint shown on the right. */
  hint?: string;
  /** Extra strings the fuzzy filter matches against beyond `title`. */
  keywords: string[];
  /** Executed when the user picks the action (Enter). */
  run: (ctx: QuickActionContext) => void | Promise<void>;
}

const STATIC_ACTIONS: QuickAction[] = [
  {
    id: "go-spaces",
    title: "Go to Projects",
    keywords: ["spaces", "navigate", "projects"],
    run: ({ navigate }) => navigate(routes.spaces),
  },
  {
    id: "go-agents",
    title: "Go to Agents",
    keywords: ["agents", "roles", "navigate"],
    run: ({ navigate }) => navigate(routes.agents),
  },
  {
    id: "go-prompts",
    title: "Go to Prompts",
    keywords: ["prompts", "navigate", "library"],
    run: ({ navigate }) => navigate(routes.prompts),
  },
  {
    id: "go-skills",
    title: "Go to Skills",
    keywords: ["skills", "navigate", "library"],
    run: ({ navigate }) => navigate(routes.skills),
  },
  {
    id: "go-integrations",
    title: "Go to Integrations",
    keywords: ["integrations", "mcp", "tools", "navigate"],
    run: ({ navigate }) => navigate(routes.integrations),
  },
  {
    id: "go-settings",
    title: "Go to Settings",
    keywords: ["settings", "preferences", "config"],
    run: ({ navigate }) => navigate(routes.settings),
  },
  {
    id: "sidecar-restart",
    title: "Restart MCP sidecar",
    hint: "runtime",
    keywords: ["sidecar", "restart", "mcp", "runtime"],
    run: async ({ toast }) => {
      try {
        await invoke<void>("sidecar_restart");
        toast("success", "Sidecar restart requested");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast("error", `Failed to restart sidecar: ${message}`);
      }
    },
  },
];

export interface BuildActionsArgs {
  /** All known spaces — used to produce per-space "Go to" actions. */
  spaces: ReadonlyArray<{ id: string; name: string }>;
  /** Active task id (set when route matches `/tasks/:taskId`). */
  currentTaskId?: string;
  /** Known prompts — used to produce per-prompt attach actions. */
  prompts?: ReadonlyArray<{ id: string; name: string }>;
}

/**
 * Combine static actions with dynamic ones derived from runtime state.
 * Cheap to call on every keystroke — the result is plain data.
 */
export function buildActions(args: BuildActionsArgs): QuickAction[] {
  const dynamic: QuickAction[] = args.spaces.map((space) => ({
    id: `go-space-${space.id}`,
    title: `Go to space: ${space.name}`,
    keywords: ["space", "go to", space.name.toLowerCase()],
    run: ({ navigate }) => navigate(spacePath(space.id)),
  }));

  const contextual: QuickAction[] = [];
  if (
    args.currentTaskId !== undefined &&
    args.currentTaskId.length > 0
  ) {
    const taskId = args.currentTaskId;
    if (args.prompts !== undefined) {
      for (const prompt of args.prompts) {
        contextual.push({
          id: `attach-prompt-${prompt.id}`,
          title: `Attach prompt to this task: ${prompt.name}`,
          hint: "attach",
          keywords: ["attach", "prompt", "task", prompt.name.toLowerCase()],
          run: async ({ toast }) => {
            try {
              // Position = 0 places the new prompt at the head; the
              // backend re-indexes downstream rows. Existing
              // `add_task_prompt` IPC honours the contract.
              await invoke<void>("add_task_prompt", {
                taskId,
                promptId: prompt.id,
                position: 0,
              });
              toast("success", `Prompt "${prompt.name}" attached`);
            } catch (err) {
              const message =
                err instanceof Error ? err.message : "Unknown error";
              toast("error", `Failed to attach prompt: ${message}`);
            }
          },
        });
      }
    }
  }

  return [...STATIC_ACTIONS, ...contextual, ...dynamic];
}

/**
 * Match an action against the user's command-mode query.
 * Higher score = better match. 0 = no match.
 */
function scoreAction(action: QuickAction, query: string): number {
  if (query.length === 0) return 1;
  const haystack = [action.title, ...action.keywords].join(" ").toLowerCase();
  const needle = query.toLowerCase();
  if (haystack.includes(needle)) return 10 + (haystack.length - needle.length);
  const words = needle.split(/\s+/u).filter((w) => w.length > 0);
  if (words.every((w) => haystack.includes(w))) return 1;
  return 0;
}

export function filterActions(
  actions: ReadonlyArray<QuickAction>,
  query: string,
): QuickAction[] {
  const scored = actions
    .map((a) => ({ a, score: scoreAction(a, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map(({ a }) => a);
}
