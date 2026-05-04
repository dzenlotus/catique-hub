import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import type { SearchResult } from "@bindings/SearchResult";

// Mock IPC at the shared/api boundary.
vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { GlobalSearch } from "./GlobalSearch";
import { useGlobalSearchKeybind } from "./useGlobalSearchKeybind";

const invokeMock = vi.mocked(invoke);

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

  it("search input has aria-label", () => {
    invokeMock.mockResolvedValue([]);
    renderOpen();
    const input = screen.getByRole("searchbox");
    expect(input).toHaveAttribute("aria-label");
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
