import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Prompt } from "@entities/prompt";
import { ToastProvider } from "@app/providers/ToastProvider";

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
    icon: null,
    examples: [],
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
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
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
    // Round-19c: content is rendered through MarkdownField in view mode
    // by default — assert the visible text instead of a textarea `value`.
    expect(screen.getByTestId("prompt-editor-content-textarea")).toHaveTextContent("Содержимое промпта");
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

  it("renders the unified appearance picker (icon + color)", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return makePrompt({ color: "#ff0000" });
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<PromptEditor promptId="prm-1" onClose={onClose} />);

    await screen.findByTestId("prompt-editor-name-input");
    // Round-19d: the standalone color input was replaced with a
    // combined `<IconColorPicker>`. The trigger is rendered on the
    // form; the actual color input lives inside the popover.
    expect(
      screen.getByTestId("prompt-editor-appearance-picker"),
    ).toBeInTheDocument();
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

  // Round-19d: the standalone color reset moved into the
  // `<IconColorPicker>` popover. Exercising it through jsdom requires
  // the RAC popover to mount, which is out of scope for this widget
  // suite — the picker primitive owns that contract.

  // ── Token count read-out ─────────────────────────────────────────

  it("shows 'not computed' when tokenCount is null", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return makePrompt({ tokenCount: null });
      throw new Error(`unexpected: ${cmd}`);
    });
    renderWithClient(<PromptEditor promptId="prm-1" onClose={vi.fn()} />);

    await screen.findByTestId("prompt-editor-token-row");
    expect(screen.getByTestId("prompt-editor-token-row")).toHaveTextContent(
      "Current count: not computed",
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
      "Current count: ≈1337 tokens",
    );
  });

  // ── Recount button removed (round-19d) ───────────────────────────

  it("does not render a manual Recount button — auto-recount on save", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return makePrompt();
      throw new Error(`unexpected: ${cmd}`);
    });
    renderWithClient(<PromptEditor promptId="prm-1" onClose={vi.fn()} />);

    await screen.findByTestId("prompt-editor-token-row");
    expect(
      screen.queryByTestId("prompt-editor-recount-button"),
    ).not.toBeInTheDocument();
  });

  // ── Implicit view ⇄ edit (MarkdownField, ctq-76 #11) ───────────────

  it("does NOT render an explicit mode toggle (round-19c MarkdownField)", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return makePrompt();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<PromptEditor promptId="prm-1" onClose={onClose} />);

    await screen.findByTestId("prompt-editor-name-input");

    // The explicit Edit / Preview toggle group is gone. The single
    // MarkdownField forwards its testid to whichever sub-element is
    // active — preview by default.
    expect(screen.queryByTestId("prompt-editor-content-mode-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("prompt-editor-content-textarea")).toBeInTheDocument();
  });

  it("renders MarkdownPreview content by default and flips to textarea on click", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_prompt") return makePrompt({ content: "## Заголовок\n\nАбзац" });
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(<PromptEditor promptId="prm-1" onClose={onClose} />);

    await screen.findByTestId("prompt-editor-name-input");

    // Default mode is "view" — heading rendered through MarkdownPreview.
    expect(
      screen.getByRole("heading", { level: 2, name: "Заголовок" }),
    ).toBeInTheDocument();

    // Click the view surface; the same testid now points to a textarea.
    await user.click(screen.getByTestId("prompt-editor-content-textarea"));
    const textarea = screen.getByTestId("prompt-editor-content-textarea");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveValue("## Заголовок\n\nАбзац");
  });

});
