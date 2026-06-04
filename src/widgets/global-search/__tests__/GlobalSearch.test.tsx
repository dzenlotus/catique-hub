import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import type { Prompt } from "@bindings/Prompt";
import type { SearchResult } from "@bindings/SearchResult";

// Mock IPC at the shared/api boundary.
vi.mock("@shared/api", async () => {
  const actual = await vi.importActual<typeof import("@shared/api")>("@shared/api");
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
  };
});

// `useOptionalPrompts` is normally backed by TanStack Query — return an
// empty list by default and let individual tests override via
// `optionalPromptsMock.mockReturnValue(...)`. The default mirrors the
// "no QueryClientProvider mounted" path so legacy tests stay green.
const optionalPromptsMock = vi.fn<() => Prompt[]>(() => []);
vi.mock("../useOptionalPrompts", () => ({
  useOptionalPrompts: () => optionalPromptsMock(),
}));

import { invoke } from "@shared/api";
import { GlobalSearch } from "../GlobalSearch";
import { useGlobalSearchKeybind } from "../useGlobalSearchKeybind";

const invokeMock = vi.mocked(invoke);

// Helper — build a minimally-valid Prompt for the cache. `usePrompts()`
// returns `Prompt[]`, see `bindings/Prompt.ts` for the canonical shape.
function makePrompt(partial: Partial<Prompt> & { id: string; name: string }): Prompt {
  return {
    content: "default content",
    color: null,
    shortDescription: null,
    icon: null,
    examples: [],
    tokenCount: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const TASK_RESULT: SearchResult = {
  type: "task",
  id: "task-1",
  boardId: "board-1",
  columnId: "col-1",
  title: "Fix login bug",
  snippet: "Users cannot log in with Google OAuth",
};

const REPORT_RESULT: SearchResult = {
  type: "agentReport",
  id: "report-1",
  taskId: "task-1",
  title: "Investigation report",
  kind: "investigation",
  snippet: "The token refresh flow has a race condition",
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

interface SetupResult {
  user: ReturnType<typeof userEvent.setup>;
  onClose: ReturnType<typeof vi.fn>;
  onSelectResult: ReturnType<typeof vi.fn>;
}

function setup(isOpen = true): SetupResult {
  const onClose = vi.fn();
  const onSelectResult = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(
    <GlobalSearch
      isOpen={isOpen}
      onClose={onClose}
      onSelectResult={onSelectResult}
    />,
  );
  return { user, onClose, onSelectResult };
}

function renderOpen(): SetupResult {
  return setup(true);
}

beforeEach(() => {
  invokeMock.mockReset();
  optionalPromptsMock.mockReset();
  optionalPromptsMock.mockReturnValue([]);
  // Reset the URL so `useLocationCompat`'s window fallback resolves to "/".
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

describe("GlobalSearch — visibility", () => {
  it("renders the palette when isOpen=true", () => {
    invokeMock.mockResolvedValue([]);
    renderOpen();
    expect(screen.getByTestId("global-search")).toBeInTheDocument();
  });

  it("does not render when isOpen=false", () => {
    setup(false);
    expect(screen.queryByTestId("global-search")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

describe("GlobalSearch — input", () => {
  it("renders the search input", () => {
    invokeMock.mockResolvedValue([]);
    renderOpen();
    expect(screen.getByTestId("global-search-input")).toBeInTheDocument();
  });

  it("search input has role=searchbox", () => {
    invokeMock.mockResolvedValue([]);
    renderOpen();
    const input = screen.getByRole("searchbox");
    expect(input).toBeInTheDocument();
  });

  it("search input has an accessible name", () => {
    invokeMock.mockResolvedValue([]);
    renderOpen();
    // The shared <Input> labels the field via an associated (visually
    // hidden) <label> rather than a literal aria-label attribute, so we
    // assert the resolved accessible name instead.
    const input = screen.getByRole("searchbox", {
      name: /search tasks and reports/i,
    });
    expect(input).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Idle / hint state
// ---------------------------------------------------------------------------

describe("GlobalSearch — idle hint", () => {
  it("shows the hint when no query has been entered", () => {
    invokeMock.mockResolvedValue([]);
    renderOpen();
    expect(screen.getByTestId("global-search-empty")).toBeInTheDocument();
    expect(screen.getByText(/start typing to find/i)).toBeInTheDocument();
  });

  it("does not fire IPC when query is empty", async () => {
    invokeMock.mockResolvedValue([]);
    renderOpen();
    // Wait a debounce period — no invoke should be called.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe("GlobalSearch — loading", () => {
  it("shows loading state while IPC is pending", async () => {
    // Never resolves
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const { user } = renderOpen();
    const input = screen.getByTestId("global-search-input");
    await user.type(input, "fix");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-loading")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe("GlobalSearch — error", () => {
  it("shows error state when IPC rejects", async () => {
    invokeMock.mockRejectedValue(new Error("db busy"));
    const { user } = renderOpen();
    const input = screen.getByTestId("global-search-input");
    await user.type(input, "query");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/db busy/i)).toBeInTheDocument();
  });

  it("handles AppErrorInstance-shaped rejections gracefully", async () => {
    invokeMock.mockRejectedValue({ kind: "dbBusy", message: "Database is busy" });
    const { user } = renderOpen();
    const input = screen.getByTestId("global-search-input");
    await user.type(input, "test");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-error")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Empty results
// ---------------------------------------------------------------------------

describe("GlobalSearch — empty results", () => {
  it("shows empty state when search returns no results", async () => {
    invokeMock.mockResolvedValue([]);
    const { user } = renderOpen();
    const input = screen.getByTestId("global-search-input");
    await user.type(input, "noresults");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/no results for/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Results rendering
// ---------------------------------------------------------------------------

describe("GlobalSearch — results rendering", () => {
  it("renders task results under a 'Tasks' group header", async () => {
    invokeMock.mockResolvedValue([TASK_RESULT]);
    const { user } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "fix");

    await waitFor(() => {
      expect(screen.getByText("Tasks")).toBeInTheDocument();
    });
    expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    expect(screen.getByText("Users cannot log in with Google OAuth")).toBeInTheDocument();
  });

  it("renders agentReport results under an 'Agent reports' group header", async () => {
    invokeMock.mockResolvedValue([REPORT_RESULT]);
    const { user } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "report");

    await waitFor(() => {
      expect(screen.getByText("Agent reports")).toBeInTheDocument();
    });
    expect(screen.getByText("Investigation report")).toBeInTheDocument();
  });

  it("groups mixed results — tasks first, then reports", async () => {
    invokeMock.mockResolvedValue([REPORT_RESULT, TASK_RESULT]);
    const { user } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "q");

    await waitFor(() => {
      expect(screen.getByText("Tasks")).toBeInTheDocument();
      expect(screen.getByText("Agent reports")).toBeInTheDocument();
    });

    const items = screen.getAllByRole("option");
    // Task comes before agentReport
    expect(items[0]).toHaveTextContent("Fix login bug");
    expect(items[1]).toHaveTextContent("Investigation report");
  });

  it("result rows have role=option and data-testid", async () => {
    invokeMock.mockResolvedValue([TASK_RESULT]);
    const { user } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "fix");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-result-0")).toBeInTheDocument();
    });
    expect(screen.getByTestId("global-search-result-0")).toHaveAttribute(
      "role",
      "option",
    );
  });

  it("results list container has role=listbox", async () => {
    invokeMock.mockResolvedValue([TASK_RESULT]);
    const { user } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "fix");

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe("GlobalSearch — selection", () => {
  it("calls onSelectResult and onClose when a row is clicked", async () => {
    invokeMock.mockResolvedValue([TASK_RESULT]);
    const { user, onSelectResult, onClose } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "fix");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-result-0")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("global-search-result-0"));
    expect(onSelectResult).toHaveBeenCalledWith(TASK_RESULT);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onSelectResult and onClose when Enter is pressed on focused row", async () => {
    invokeMock.mockResolvedValue([TASK_RESULT]);
    const { user, onSelectResult, onClose } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "fix");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-result-0")).toBeInTheDocument();
    });

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onSelectResult).toHaveBeenCalledWith(TASK_RESULT);
    expect(onClose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

describe("GlobalSearch — keyboard navigation", () => {
  it("ArrowDown sets aria-selected on the first result", async () => {
    invokeMock.mockResolvedValue([TASK_RESULT, REPORT_RESULT]);
    const { user } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "q");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-result-0")).toBeInTheDocument();
    });

    await user.keyboard("{ArrowDown}");
    expect(screen.getByTestId("global-search-result-0")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("ArrowDown then ArrowDown moves focus to second result", async () => {
    invokeMock.mockResolvedValue([TASK_RESULT, REPORT_RESULT]);
    const { user } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "q");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-result-1")).toBeInTheDocument();
    });

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByTestId("global-search-result-1")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("global-search-result-0")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("ArrowUp does not go below index 0", async () => {
    invokeMock.mockResolvedValue([TASK_RESULT]);
    const { user } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "q");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-result-0")).toBeInTheDocument();
    });

    // ArrowDown to focus index 0, then ArrowUp — should stay at 0
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByTestId("global-search-result-0")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

// ---------------------------------------------------------------------------
// Cmd+Enter shortcut + footer cheatsheet
// ---------------------------------------------------------------------------

describe("GlobalSearch — Cmd+Enter shortcut", () => {
  it("renders the keyboard cheatsheet footer with Enter + Esc by default", () => {
    invokeMock.mockResolvedValue([]);
    renderOpen();
    const footer = screen.getByTestId("global-search-cheatsheet");
    expect(footer).toBeInTheDocument();
    expect(footer).toHaveTextContent(/Enter/);
    expect(footer).toHaveTextContent(/Esc/);
    // No task surface in the URL → the "attach" affordance is hidden.
    expect(footer).not.toHaveTextContent(/attach prompt to this task/i);
  });

  it("footer surfaces the ⌘+Enter attach affordance on /tasks/:id", () => {
    invokeMock.mockResolvedValue([]);
    window.history.replaceState(null, "", "/tasks/tsk-1");
    renderOpen();
    const footer = screen.getByTestId("global-search-cheatsheet");
    expect(footer).toHaveTextContent(/attach prompt to this task/i);
  });

  it("Cmd+Enter on a focused task result navigates (same as Enter)", async () => {
    invokeMock.mockResolvedValue([TASK_RESULT]);
    const { user, onSelectResult, onClose } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "fix");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-result-0")).toBeInTheDocument();
    });

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(onSelectResult).toHaveBeenCalledWith(TASK_RESULT);
    expect(onClose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Client-side prompt search + Cmd+Enter attach
// ---------------------------------------------------------------------------

describe("GlobalSearch — prompts in search results", () => {
  const CONCISE_PROMPT = makePrompt({
    id: "prm-1",
    name: "Concise",
    content: "Reply concisely.",
  });

  it("surfaces a prompt result when the query substring-matches a prompt name", async () => {
    invokeMock.mockResolvedValue([]); // search_all returns no tasks/reports
    optionalPromptsMock.mockReturnValue([CONCISE_PROMPT]);
    const { user } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "Concise");

    await waitFor(() => {
      expect(screen.getByText("Prompts")).toBeInTheDocument();
    });
    expect(screen.getByText("Concise")).toBeInTheDocument();
    // The first row (index 0) is the prompt — prompts render above tasks.
    expect(screen.getByTestId("global-search-result-0")).toHaveAttribute(
      "data-result-kind",
      "prompt",
    );
  });

  it("Cmd+Enter on a focused prompt while on /tasks/:id attaches and keeps the palette open", async () => {
    // First call → search_all empty; subsequent calls → add_task_prompt resolves.
    invokeMock.mockResolvedValue([]);
    optionalPromptsMock.mockReturnValue([CONCISE_PROMPT]);
    window.history.replaceState(null, "", "/tasks/tsk-1");

    const { user, onClose } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "Concise");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-result-0")).toBeInTheDocument();
    });

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("add_task_prompt", {
        taskId: "tsk-1",
        promptId: "prm-1",
        position: 0,
      });
    });
    // Palette stays open — user can chain attachments.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cmd+Enter on a focused prompt while NOT on a task navigates to /prompts/<id>", async () => {
    invokeMock.mockResolvedValue([]);
    optionalPromptsMock.mockReturnValue([CONCISE_PROMPT]);
    // Default URL is "/" (set by beforeEach) — no task surface.

    const { user, onClose } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "Concise");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-result-0")).toBeInTheDocument();
    });

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(window.location.pathname).toBe("/prompts/prm-1");
    // No attach IPC should fire when there's no current task.
    expect(invokeMock).not.toHaveBeenCalledWith(
      "add_task_prompt",
      expect.anything(),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("plain Enter on a focused prompt navigates to /prompts/<id> even when a task is open", async () => {
    invokeMock.mockResolvedValue([]);
    optionalPromptsMock.mockReturnValue([CONCISE_PROMPT]);
    window.history.replaceState(null, "", "/tasks/tsk-1");

    const { user } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "Concise");

    await waitFor(() => {
      expect(screen.getByTestId("global-search-result-0")).toBeInTheDocument();
    });

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(window.location.pathname).toBe("/prompts/prm-1");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "add_task_prompt",
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// IPC call arguments
// ---------------------------------------------------------------------------

describe("GlobalSearch — IPC", () => {
  it("calls search_all with the typed query and limitPerKind=50", async () => {
    invokeMock.mockResolvedValue([]);
    const { user } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "hello");

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("search_all", {
        query: "hello",
        limitPerKind: 50,
      });
    });
  });

  it("does not fire IPC for whitespace-only query", async () => {
    invokeMock.mockResolvedValue([]);
    const { user } = renderOpen();
    await user.type(screen.getByTestId("global-search-input"), "   ");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useGlobalSearchKeybind
// ---------------------------------------------------------------------------

describe("useGlobalSearchKeybind", () => {
  function HookHarness({ onActivate }: { onActivate: () => void }): ReactElement {
    useGlobalSearchKeybind(onActivate);
    return <div />;
  }

  it("calls onActivate on Cmd+K", () => {
    const onActivate = vi.fn();
    render(<HookHarness onActivate={onActivate} />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
    );
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("calls onActivate on Ctrl+K", () => {
    const onActivate = vi.fn();
    render(<HookHarness onActivate={onActivate} />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
    );
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onActivate when active element is an input", () => {
    const onActivate = vi.fn();
    render(
      <>
        <HookHarness onActivate={onActivate} />
        <input data-testid="some-input" />
      </>,
    );
    const input = screen.getByTestId("some-input");
    input.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
    );
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("does NOT call onActivate when active element is a textarea", () => {
    const onActivate = vi.fn();
    render(
      <>
        <HookHarness onActivate={onActivate} />
        <textarea data-testid="some-textarea" />
      </>,
    );
    const ta = screen.getByTestId("some-textarea");
    ta.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
    );
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("does NOT fire for plain 'k' without modifier", () => {
    const onActivate = vi.fn();
    render(<HookHarness onActivate={onActivate} />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", bubbles: true }),
    );
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("cleans up the listener on unmount", () => {
    const onActivate = vi.fn();
    const { unmount } = render(<HookHarness onActivate={onActivate} />);
    unmount();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
    );
    expect(onActivate).not.toHaveBeenCalled();
  });
});
