import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { McpTool } from "@entities/mcp-tool";

vi.mock("@shared/api", async () => {
  const actual = await vi.importActual<typeof import("@shared/api")>("@shared/api");
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
  };
});

import { AppErrorInstance, invoke } from "@shared/api";
import { McpToolCreateDialog } from "./McpToolCreateDialog";

const invokeMock = vi.mocked(invoke);

function renderWithClient(
  ui: ReactElement,
): { user: ReturnType<typeof userEvent.setup> } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { user };
}

/** Helper — set a textarea/input value directly, bypassing userEvent key parsing. */
function setInputValue(element: HTMLElement, value: string): void {
  fireEvent.change(element, { target: { value } });
}

function makeTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    id: "tool-1",
    name: "Search Tool",
    description: null,
    schemaJson: "{}",
    color: null,
    position: 0,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("McpToolCreateDialog", () => {
  it("renders form fields when open", () => {
    renderWithClient(<McpToolCreateDialog isOpen onClose={() => undefined} />);
    expect(
      screen.getByTestId("mcp-tool-create-dialog-name-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("mcp-tool-create-dialog-schema-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("mcp-tool-create-dialog-color-input"),
    ).toBeInTheDocument();
  });

  it("Save button is disabled when name is empty", () => {
    renderWithClient(<McpToolCreateDialog isOpen onClose={() => undefined} />);
    expect(screen.getByTestId("mcp-tool-create-dialog-save")).toBeDisabled();
  });

  it("Save button is disabled when schemaJson is empty even if name is filled", async () => {
    const { user } = renderWithClient(
      <McpToolCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(
      screen.getByTestId("mcp-tool-create-dialog-name-input"),
      "Моё имя",
    );
    expect(screen.getByTestId("mcp-tool-create-dialog-save")).toBeDisabled();
  });

  it("Save button becomes enabled once name and schemaJson are filled", async () => {
    const { user } = renderWithClient(
      <McpToolCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(
      screen.getByTestId("mcp-tool-create-dialog-name-input"),
      "My Tool",
    );
    setInputValue(screen.getByTestId("mcp-tool-create-dialog-schema-input"), "{}");
    expect(screen.getByTestId("mcp-tool-create-dialog-save")).not.toBeDisabled();
  });

  it("shows inline error when schemaJson is invalid JSON on submit", async () => {
    const { user } = renderWithClient(
      <McpToolCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(
      screen.getByTestId("mcp-tool-create-dialog-name-input"),
      "My Tool",
    );
    setInputValue(
      screen.getByTestId("mcp-tool-create-dialog-schema-input"),
      "not json",
    );
    await user.click(screen.getByTestId("mcp-tool-create-dialog-save"));
    await waitFor(() => {
      expect(
        screen.getByTestId("mcp-tool-create-dialog-error"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/invalid json/i)).toBeInTheDocument();
  });

  it("calls create_mcp_tool with correct payload on submit", async () => {
    const newTool = makeTool({ id: "tool-new", name: "Аналитик" });
    invokeMock.mockResolvedValue(newTool);

    const onCreated = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <McpToolCreateDialog isOpen onClose={onClose} onCreated={onCreated} />,
    );

    await user.type(
      screen.getByTestId("mcp-tool-create-dialog-name-input"),
      "Аналитик",
    );
    setInputValue(screen.getByTestId("mcp-tool-create-dialog-schema-input"), "{}");
    await user.click(screen.getByTestId("mcp-tool-create-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onCreated).toHaveBeenCalledWith(newTool);

    const createCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "create_mcp_tool",
    );
    // `position` is required by the Rust handler; its exact value is a
    // `Date.now()` snapshot, so just assert the shape.
    expect(createCall?.[1]).toMatchObject({ name: "Аналитик", schemaJson: "{}" });
    const payload = createCall?.[1] as Record<string, unknown>;
    expect(typeof payload.position).toBe("number");
    expect(payload.position).toBeGreaterThan(0);
  });

  it("sends `position` (number) on create_mcp_tool — Rust handler requires it (audit F-02)", async () => {
    const newTool = makeTool();
    invokeMock.mockResolvedValue(newTool);

    const { user } = renderWithClient(
      <McpToolCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("mcp-tool-create-dialog-name-input"),
      "Search",
    );
    setInputValue(screen.getByTestId("mcp-tool-create-dialog-schema-input"), "{}");
    await user.click(screen.getByTestId("mcp-tool-create-dialog-save"));

    await waitFor(() => {
      const createCall = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "create_mcp_tool",
      );
      const payload = createCall?.[1] as Record<string, unknown>;
      expect(typeof payload.position).toBe("number");
    });
  });

  it("includes description in payload when filled", async () => {
    const newTool = makeTool();
    invokeMock.mockResolvedValue(newTool);

    const { user } = renderWithClient(
      <McpToolCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("mcp-tool-create-dialog-name-input"),
      "Название",
    );
    await user.type(
      screen.getByTestId("mcp-tool-create-dialog-description-input"),
      "Описание инструмента",
    );
    setInputValue(screen.getByTestId("mcp-tool-create-dialog-schema-input"), "{}");
    await user.click(screen.getByTestId("mcp-tool-create-dialog-save"));

    await waitFor(() => {
      const createCall = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "create_mcp_tool",
      );
      expect(createCall?.[1]).toMatchObject({ description: "Описание инструмента" });
    });
  });

  it("shows 'Name already taken' on conflict error from backend", async () => {
    // The dialog discriminates on `instanceof AppErrorInstance`. Since
    // the test mocks the wrapper itself, hand it a real instance so the
    // production code's narrowing branch runs (audit-#17 unified the
    // wrapper but kept the discriminator class on the call-site).
    invokeMock.mockRejectedValue(
      new AppErrorInstance({
        kind: "conflict",
        data: { entity: "mcp_tool", reason: "name already exists" },
      }),
    );

    const { user } = renderWithClient(
      <McpToolCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("mcp-tool-create-dialog-name-input"),
      "Название",
    );
    setInputValue(screen.getByTestId("mcp-tool-create-dialog-schema-input"), "{}");
    await user.click(screen.getByTestId("mcp-tool-create-dialog-save"));

    await waitFor(() => {
      expect(screen.getByTestId("mcp-tool-create-dialog-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/name already taken/i)).toBeInTheDocument();
  });

  it("shows inline error on mutation failure", async () => {
    invokeMock.mockRejectedValue(new Error("сбой"));

    const { user } = renderWithClient(
      <McpToolCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("mcp-tool-create-dialog-name-input"),
      "Название",
    );
    setInputValue(screen.getByTestId("mcp-tool-create-dialog-schema-input"), "{}");
    await user.click(screen.getByTestId("mcp-tool-create-dialog-save"));

    await waitFor(() => {
      expect(screen.getByTestId("mcp-tool-create-dialog-error")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("Cancel closes without calling the mutation", async () => {
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <McpToolCreateDialog isOpen onClose={onClose} />,
    );

    await user.click(screen.getByTestId("mcp-tool-create-dialog-cancel"));

    expect(onClose).toHaveBeenCalled();
    const createCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "create_mcp_tool",
    );
    expect(createCalls).toHaveLength(0);
  });

  it("does not render content when isOpen is false", () => {
    renderWithClient(
      <McpToolCreateDialog isOpen={false} onClose={() => undefined} />,
    );
    expect(
      screen.queryByTestId("mcp-tool-create-dialog-name-input"),
    ).toBeNull();
  });
});
