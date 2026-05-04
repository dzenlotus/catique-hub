import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { McpTool } from "@entities/mcp-tool";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { McpToolEditor } from "./McpToolEditor";

const invokeMock = vi.mocked(invoke);

function makeTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    id: "tool-1",
    name: "Тестовый инструмент",
    description: "Описание инструмента",
    schemaJson: '{"type":"object"}',
    color: "#ff0000",
    position: 0,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client, user };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("McpToolEditor", () => {
  it("does not render the dialog when toolId is null", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<McpToolEditor toolId={null} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders skeleton rows when query is pending", async () => {
    // Never resolves — simulates pending state.
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<McpToolEditor toolId="tool-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Save button is disabled during loading.
    const saveButton = screen.getByTestId("mcp-tool-editor-save");
    expect(saveButton).toBeDisabled();
  });

  it("renders an error banner when the query fails", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_mcp_tool") throw new Error("transport down");
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<McpToolEditor toolId="tool-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("mcp-tool-editor-fetch-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
  });

  it("renders form fields populated when loaded", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_mcp_tool") return makeTool();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<McpToolEditor toolId="tool-1" onClose={onClose} />);

    await screen.findByTestId("mcp-tool-editor-name-input");
    expect(screen.getByTestId("mcp-tool-editor-name-input")).toHaveValue("Тестовый инструмент");
    expect(screen.getByTestId("mcp-tool-editor-description-input")).toHaveValue("Описание инструмента");
    expect(screen.getByTestId("mcp-tool-editor-schema-input")).toHaveValue('{"type":"object"}');
    expect((screen.getByTestId("mcp-tool-editor-color-input") as HTMLInputElement).value).toBe("#ff0000");
  });

  it("name input is editable", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_mcp_tool") return makeTool();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<McpToolEditor toolId="tool-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("mcp-tool-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Новое название");

    expect(nameInput).toHaveValue("Новое название");
  });

  it("shows inline error when schemaJson is invalid JSON on save", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_mcp_tool") return makeTool();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<McpToolEditor toolId="tool-1" onClose={onClose} />);

    const schemaInput = await screen.findByTestId("mcp-tool-editor-schema-input");
    await user.clear(schemaInput);
    await user.type(schemaInput, "not valid json");

    await user.click(screen.getByTestId("mcp-tool-editor-save"));

    await waitFor(() => {
      expect(screen.getByTestId("mcp-tool-editor-save-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/invalid json/i)).toBeInTheDocument();
  });

  it("clicking Save triggers useUpdateMcpToolMutation with dirty fields only", async () => {
    const tool = makeTool();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_mcp_tool") return tool;
      if (cmd === "update_mcp_tool") return { ...tool, name: "Новое название" };
      if (cmd === "list_mcp_tools") return [tool];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<McpToolEditor toolId="tool-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("mcp-tool-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Новое название");

    const saveButton = screen.getByTestId("mcp-tool-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_mcp_tool");
      expect(updateCall).toBeDefined();
      // Only the name field changed — other fields must NOT be included.
      expect(updateCall?.[1]).toMatchObject({
        id: "tool-1",
        name: "Новое название",
      });
      // description / schemaJson / color were not changed, so they must be absent.
      expect(updateCall?.[1]).not.toHaveProperty("description");
      expect(updateCall?.[1]).not.toHaveProperty("schemaJson");
      expect(updateCall?.[1]).not.toHaveProperty("color");
    });
  });

  it("clicking Cancel closes without triggering mutation", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_mcp_tool") return makeTool();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<McpToolEditor toolId="tool-1" onClose={onClose} />);

    await screen.findByTestId("mcp-tool-editor-name-input");
    const cancelButton = screen.getByTestId("mcp-tool-editor-cancel");
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledOnce();
    const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_mcp_tool");
    expect(updateCall).toBeUndefined();
  });

  it("empty color gets sent as null on update", async () => {
    const tool = makeTool({ color: "#ff0000" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_mcp_tool") return tool;
      if (cmd === "update_mcp_tool") return { ...tool, color: null };
      if (cmd === "list_mcp_tools") return [tool];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<McpToolEditor toolId="tool-1" onClose={onClose} />);

    await screen.findByTestId("mcp-tool-editor-name-input");

    // Click the "Reset" button to clear the color.
    const resetButton = screen.getByText("Reset");
    await user.click(resetButton);

    const saveButton = screen.getByTestId("mcp-tool-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_mcp_tool");
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toMatchObject({
        id: "tool-1",
        color: null,
      });
    });
  });

  it("empty description gets sent as null on update", async () => {
    const tool = makeTool({ description: "Старое описание" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_mcp_tool") return tool;
      if (cmd === "update_mcp_tool") return { ...tool, description: null };
      if (cmd === "list_mcp_tools") return [tool];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<McpToolEditor toolId="tool-1" onClose={onClose} />);

    const descriptionInput = await screen.findByTestId("mcp-tool-editor-description-input");
    await user.clear(descriptionInput);

    const saveButton = screen.getByTestId("mcp-tool-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_mcp_tool");
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toMatchObject({
        id: "tool-1",
        description: null,
      });
    });
  });

  it("shows inline save-error message when mutation fails", async () => {
    const tool = makeTool();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_mcp_tool") return tool;
      if (cmd === "update_mcp_tool") throw new Error("сервер недоступен");
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<McpToolEditor toolId="tool-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("mcp-tool-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Другое название");

    const saveButton = screen.getByTestId("mcp-tool-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByTestId("mcp-tool-editor-save-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/сервер недоступен/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
