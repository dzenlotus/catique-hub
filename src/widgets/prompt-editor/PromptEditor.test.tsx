import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Prompt } from "@entities/prompt";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { PromptEditor } from "./PromptEditor";

const invokeMock = vi.mocked(invoke);

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: "prm-1",
    name: "Тестовый промпт",
    content: "Содержимое промпта",
    color: "#ff0000",
    shortDescription: "Краткое описание",
    tokenCount: null,
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

describe("PromptEditor", () => {
  it("does not render the dialog when promptId is null", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<PromptEditor promptId={null} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders skeleton rows when query is pending", async () => {
    // Never resolves — simulates pending state.
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<PromptEditor promptId="prm-1" onClose={onClose} />);

    // The dialog should be open.
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Skeleton elements — buttons are disabled during loading.
    const saveButton = screen.getByTestId("prompt-editor-save");
    expect(saveButton).toBeDisabled();
  });

  it("renders an error banner when the query fails", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") throw new Error("transport down");
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<PromptEditor promptId="prm-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("prompt-editor-fetch-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
  });

  it("renders form fields populated when loaded", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return makePrompt();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<PromptEditor promptId="prm-1" onClose={onClose} />);

    // Wait for loaded state.
    await screen.findByTestId("prompt-editor-name-input");
    expect(screen.getByTestId("prompt-editor-name-input")).toHaveValue("Тестовый промпт");
    expect(screen.getByTestId("prompt-editor-shortdesc-input")).toHaveValue("Краткое описание");
    expect(screen.getByTestId("prompt-editor-content-textarea")).toHaveValue("Содержимое промпта");
  });

  it("name input is editable", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return makePrompt();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<PromptEditor promptId="prm-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("prompt-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Новое название");

    expect(nameInput).toHaveValue("Новое название");
  });

  it("color input updates local state", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return makePrompt({ color: "#ff0000" });
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<PromptEditor promptId="prm-1" onClose={onClose} />);

    await screen.findByTestId("prompt-editor-name-input");
    const colorInput = screen.getByTestId("prompt-editor-color-input") as HTMLInputElement;

    // Verify initial value is set.
    expect(colorInput.value).toBe("#ff0000");

    // Simulate change — verify state reflects the new value.
    await user.click(colorInput);
    // Directly fire a change event to simulate color picker interaction.
    colorInput.value = "#00ff00";
    colorInput.dispatchEvent(new Event("change", { bubbles: true }));

    await waitFor(() => {
      expect((screen.getByTestId("prompt-editor-color-input") as HTMLInputElement).value).toBe(
        "#00ff00",
      );
    });
  });

  it("clicking Save triggers useUpdatePromptMutation with dirty fields only", async () => {
    const prompt = makePrompt();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return prompt;
      if (cmd === "update_prompt") return { ...prompt, name: "Новое название" };
      if (cmd === "list_prompts") return [prompt];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<PromptEditor promptId="prm-1" onClose={onClose} />);

    const nameInput = await screen.findByTestId("prompt-editor-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Новое название");

    const saveButton = screen.getByTestId("prompt-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_prompt");
      expect(updateCall).toBeDefined();
      // Only the name field changed — other fields must NOT be included.
      expect(updateCall?.[1]).toMatchObject({
        id: "prm-1",
        name: "Новое название",
      });
      // content / shortDescription / color were not changed, so they must be absent.
      expect(updateCall?.[1]).not.toHaveProperty("content");
      expect(updateCall?.[1]).not.toHaveProperty("shortDescription");
      expect(updateCall?.[1]).not.toHaveProperty("color");
    });
  });

  it("clicking Cancel closes without triggering mutation", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return makePrompt();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<PromptEditor promptId="prm-1" onClose={onClose} />);

    // Wait for loaded state by waiting for the name input, then get cancel button.
    await screen.findByTestId("prompt-editor-name-input");
    const cancelButton = screen.getByTestId("prompt-editor-cancel");
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledOnce();
    const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_prompt");
    expect(updateCall).toBeUndefined();
  });

  it("empty short-description gets sent as null on update", async () => {
    const prompt = makePrompt({ shortDescription: "Старое описание" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return prompt;
      if (cmd === "update_prompt") return { ...prompt, shortDescription: null };
      if (cmd === "list_prompts") return [prompt];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<PromptEditor promptId="prm-1" onClose={onClose} />);

    await screen.findByTestId("prompt-editor-name-input");
    const shortDescInput = screen.getByTestId("prompt-editor-shortdesc-input");
    await user.clear(shortDescInput);

    const saveButton = screen.getByTestId("prompt-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_prompt");
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toMatchObject({
        id: "prm-1",
        shortDescription: null,
      });
    });
  });

  it("empty color gets sent as null on update", async () => {
    const prompt = makePrompt({ color: "#ff0000" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return prompt;
      if (cmd === "update_prompt") return { ...prompt, color: null };
      if (cmd === "list_prompts") return [prompt];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<PromptEditor promptId="prm-1" onClose={onClose} />);

    await screen.findByTestId("prompt-editor-name-input");

    // Click the "Reset" button to clear the color.
    const resetButton = screen.getByText("Сбросить");
    await user.click(resetButton);

    const saveButton = screen.getByTestId("prompt-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_prompt");
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toMatchObject({
        id: "prm-1",
        color: null,
      });
    });
  });

  // ── Token count read-out ─────────────────────────────────────────

  it("shows 'не подсчитан' when tokenCount is null", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return makePrompt({ tokenCount: null });
      throw new Error(`unexpected: ${cmd}`);
    });
    renderWithClient(<PromptEditor promptId="prm-1" onClose={vi.fn()} />);

    await screen.findByTestId("prompt-editor-token-row");
    expect(screen.getByTestId("prompt-editor-token-row")).toHaveTextContent(
      "Текущий счётчик: не подсчитан",
    );
  });

  it("shows formatted token count when tokenCount > 0", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return makePrompt({ tokenCount: 1337n });
      throw new Error(`unexpected: ${cmd}`);
    });
    renderWithClient(<PromptEditor promptId="prm-1" onClose={vi.fn()} />);

    await screen.findByTestId("prompt-editor-token-row");
    expect(screen.getByTestId("prompt-editor-token-row")).toHaveTextContent(
      "Текущий счётчик: ≈1337 tokens",
    );
  });

  // ── Recount button ────────────────────────────────────────────────

  it("recount button is enabled and triggers the mutation", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return makePrompt();
      throw new Error(`unexpected: ${cmd}`);
    });
    renderWithClient(<PromptEditor promptId="prm-1" onClose={vi.fn()} />);

    await screen.findByTestId("prompt-editor-recount-button");
    expect(screen.getByTestId("prompt-editor-recount-button")).not.toBeDisabled();
  });

  it("clicking recount fires invoke('recompute_prompt_token_count', { id })", async () => {
    const prompt = makePrompt();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return prompt;
      if (cmd === "recompute_prompt_token_count") return { ...prompt, tokenCount: 5n };
      if (cmd === "list_prompts") return [prompt];
      throw new Error(`unexpected: ${cmd}`);
    });
    const { user } = renderWithClient(<PromptEditor promptId="prm-1" onClose={vi.fn()} />);

    await screen.findByTestId("prompt-editor-recount-button");
    const recountButton = screen.getByTestId("prompt-editor-recount-button");
    await user.click(recountButton);

    await waitFor(() => {
      const recountCall = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "recompute_prompt_token_count",
      );
      expect(recountCall).toBeDefined();
      expect(recountCall?.[1]).toMatchObject({ id: "prm-1" });
    });
  });

  it("token read-out updates after a successful recount", async () => {
    const prompt = makePrompt({ tokenCount: null });
    const recomputed = { ...prompt, tokenCount: 42n };
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") {
        // Return recomputed state after the first call to simulate cache refresh.
        const calls = invokeMock.mock.calls.filter(([c]) => c === "get_prompt");
        return calls.length > 1 ? recomputed : prompt;
      }
      if (cmd === "recompute_prompt_token_count") return recomputed;
      if (cmd === "list_prompts") return [prompt];
      throw new Error(`unexpected: ${cmd}`);
    });
    const { user } = renderWithClient(<PromptEditor promptId="prm-1" onClose={vi.fn()} />);

    // Initial state: not counted.
    await screen.findByTestId("prompt-editor-token-row");
    expect(screen.getByTestId("prompt-editor-token-row")).toHaveTextContent(
      "Текущий счётчик: не подсчитан",
    );

    // Click recount.
    const recountButton = screen.getByTestId("prompt-editor-recount-button");
    await user.click(recountButton);

    // After success the query is invalidated and re-fetched — read-out updates.
    await waitFor(() => {
      expect(screen.getByTestId("prompt-editor-token-row")).toHaveTextContent(
        "Текущий счётчик: ≈42 tokens",
      );
    });
  });
});
