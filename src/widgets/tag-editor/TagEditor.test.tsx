import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Tag } from "@entities/tag";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { TagEditor } from "./TagEditor";

const invokeMock = vi.mocked(invoke);

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: "tag-1",
    name: "Тестовый тег",
    color: "#ff0000",
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

describe("TagEditor", () => {
  it("does not render the dialog when tagId is null", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<TagEditor tagId={null} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders skeleton rows when query is pending", async () => {
    // Never resolves — simulates pending state.
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<TagEditor tagId="tag-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Save button is disabled during loading.
    const saveButton = screen.getByTestId("tag-editor-save");
    expect(saveButton).toBeDisabled();
  });

  it("renders an error banner when the query fails", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_tag") throw new Error("transport down");
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<TagEditor tagId="tag-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("tag-editor-fetch-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
  });

  it("renders form fields populated when loaded", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_tag") return makeTag();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<TagEditor tagId="tag-1" onClose={onClose} />);

    await screen.findByTestId("tag-editor-name-input");
    expect(screen.getByTestId("tag-editor-name-input")).toHaveValue("Тестовый тег");
    expect((screen.getByTestId("tag-editor-color-input") as HTMLInputElement).value).toBe("#ff0000");
  });

  it("name input is editable", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_tag") return makeTag();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TagEditor tagId="tag-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("tag-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Новый тег");

    expect(nameInput).toHaveValue("Новый тег");
  });

  it("clicking Save triggers useUpdateTagMutation with dirty fields only", async () => {
    const tag = makeTag();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_tag") return tag;
      if (cmd === "update_tag") return { ...tag, name: "Новый тег" };
      if (cmd === "list_tags") return [tag];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TagEditor tagId="tag-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("tag-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Новый тег");

    const saveButton = screen.getByTestId("tag-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_tag");
      expect(updateCall).toBeDefined();
      // Only the name field changed — color must NOT be included.
      expect(updateCall?.[1]).toMatchObject({
        id: "tag-1",
        name: "Новый тег",
      });
      expect(updateCall?.[1]).not.toHaveProperty("color");
    });
  });

  it("clicking Cancel closes without triggering mutation", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_tag") return makeTag();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TagEditor tagId="tag-1" onClose={onClose} />);

    await screen.findByTestId("tag-editor-name-input");
    const cancelButton = screen.getByTestId("tag-editor-cancel");
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledOnce();
    const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_tag");
    expect(updateCall).toBeUndefined();
  });

  it("empty color gets sent as null on update", async () => {
    const tag = makeTag({ color: "#ff0000" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_tag") return tag;
      if (cmd === "update_tag") return { ...tag, color: null };
      if (cmd === "list_tags") return [tag];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TagEditor tagId="tag-1" onClose={onClose} />);

    await screen.findByTestId("tag-editor-name-input");

    // Click the "Сбросить" button to clear the color.
    const resetButton = screen.getByText("Сбросить");
    await user.click(resetButton);

    const saveButton = screen.getByTestId("tag-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_tag");
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toMatchObject({
        id: "tag-1",
        color: null,
      });
    });
  });

  it("shows inline save-error message when mutation fails", async () => {
    const tag = makeTag();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_tag") return tag;
      if (cmd === "update_tag") throw new Error("сервер недоступен");
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<TagEditor tagId="tag-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("tag-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Другой тег");

    const saveButton = screen.getByTestId("tag-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByTestId("tag-editor-save-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/сервер недоступен/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
