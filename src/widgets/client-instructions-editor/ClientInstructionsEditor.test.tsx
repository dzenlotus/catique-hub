import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { ClientInstructions } from "@bindings/ClientInstructions";
import { ToastProvider } from "@app/providers/ToastProvider";

vi.mock("@shared/api", async () => {
  const actual = await vi.importActual<typeof import("@shared/api")>("@shared/api");
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
  };
});

import { invoke } from "@shared/api";
import { ClientInstructionsEditor } from "./ClientInstructionsEditor";

const invokeMock = vi.mocked(invoke);

function makeInstructions(
  overrides: Partial<ClientInstructions> = {},
): ClientInstructions {
  return {
    clientId: "claude-code",
    filePath: "/Users/alice/.claude/CLAUDE.md",
    content: "# Инструкции\n\nДелай правильно.",
    modifiedAt: 1_700_000_000_000n,
    exists: true,
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

describe("ClientInstructionsEditor", () => {
  it("does not render the dialog when clientId is null", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(
      <ClientInstructionsEditor
        clientId={null}
        displayName="Claude Code"
        onClose={onClose}
      />,
    );
    expect(
      screen.queryByTestId("client-instructions-editor"),
    ).not.toBeInTheDocument();
  });

  it("renders skeleton while loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(
      <ClientInstructionsEditor
        clientId="claude-code"
        displayName="Claude Code"
        onClose={onClose}
      />,
    );
    // Dialog should be open; save button should be disabled (skeleton state).
    expect(screen.getByTestId("client-instructions-editor")).toBeInTheDocument();
    expect(screen.getByTestId("client-instructions-editor-save")).toBeDisabled();
  });

  it("renders textarea with content after successful load", async () => {
    const instructions = makeInstructions();
    invokeMock.mockResolvedValue(instructions);
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <ClientInstructionsEditor
        clientId="claude-code"
        displayName="Claude Code"
        onClose={onClose}
      />,
    );
    // Round-19c: MarkdownField defaults to view mode — the testid
    // forwards to the preview button. Click to enter edit mode and
    // confirm the textarea hydrates with the loaded content.
    const surface = await screen.findByTestId(
      "client-instructions-editor-textarea",
    );
    await user.click(surface);
    const textarea = await screen.findByTestId(
      "client-instructions-editor-textarea",
    );
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveValue(instructions.content);
  });

  it("renders empty content surface for absent file (exists = false)", async () => {
    const instructions = makeInstructions({ content: "", exists: false });
    invokeMock.mockResolvedValue(instructions);
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <ClientInstructionsEditor
        clientId="claude-code"
        displayName="Claude Code"
        onClose={onClose}
      />,
    );
    // The testid is on the preview button while content is empty —
    // it does not have a `value` attribute, so we assert the element
    // exists and that clicking it surfaces an empty textarea.
    const surface = await screen.findByTestId(
      "client-instructions-editor-textarea",
    );
    expect(surface).toBeInTheDocument();
    await user.click(surface);
    const textarea = await screen.findByTestId(
      "client-instructions-editor-textarea",
    );
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveValue("");
  });

  it("renders error state when read fails", async () => {
    invokeMock.mockRejectedValue(new Error("FS error"));
    const onClose = vi.fn();
    renderWithClient(
      <ClientInstructionsEditor
        clientId="claude-code"
        displayName="Claude Code"
        onClose={onClose}
      />,
    );
    expect(
      await screen.findByTestId("client-instructions-editor-fetch-error"),
    ).toBeInTheDocument();
  });

  it("saves edited content via write mutation", async () => {
    const initial = makeInstructions();
    const after = makeInstructions({ content: "обновлено", modifiedAt: 1_700_000_001_000n });
    invokeMock
      .mockResolvedValueOnce(initial) // read_client_instructions
      .mockResolvedValueOnce(after);  // write_client_instructions
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <ClientInstructionsEditor
        clientId="claude-code"
        displayName="Claude Code"
        onClose={onClose}
      />,
    );
    // Click the view-mode preview surface to flip into edit mode,
    // then interact with the textarea that replaces it.
    await user.click(
      await screen.findByTestId("client-instructions-editor-textarea"),
    );
    const textarea = await screen.findByTestId(
      "client-instructions-editor-textarea",
    );
    await user.clear(textarea);
    await user.type(textarea, "обновлено");
    await user.click(screen.getByTestId("client-instructions-editor-save"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "write_client_instructions",
        expect.objectContaining({ content: "обновлено" }),
      );
    });
  });

  it("shows confirm dialog before discarding dirty changes on close", async () => {
    const instructions = makeInstructions();
    invokeMock.mockResolvedValue(instructions);
    const onClose = vi.fn();
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockReturnValue(false); // user cancels

    const { user } = renderWithClient(
      <ClientInstructionsEditor
        clientId="claude-code"
        displayName="Claude Code"
        onClose={onClose}
      />,
    );
    await user.click(
      await screen.findByTestId("client-instructions-editor-textarea"),
    );
    const textarea = await screen.findByTestId(
      "client-instructions-editor-textarea",
    );
    await user.type(textarea, " грязные изменения");
    await user.click(screen.getByTestId("client-instructions-editor-close"));
    expect(confirmSpy).toHaveBeenCalled();
    // User cancelled — onClose should NOT be called.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose without confirm when content is clean", async () => {
    const instructions = makeInstructions();
    invokeMock.mockResolvedValue(instructions);
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm");

    const { user } = renderWithClient(
      <ClientInstructionsEditor
        clientId="claude-code"
        displayName="Claude Code"
        onClose={onClose}
      />,
    );
    // Wait for content to load and for state to settle.
    await screen.findByTestId("client-instructions-editor-textarea");
    await user.click(screen.getByTestId("client-instructions-editor-close"));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("does NOT render an explicit Edit / Preview toggle (round-19c MarkdownField)", async () => {
    const instructions = makeInstructions();
    invokeMock.mockResolvedValue(instructions);
    const onClose = vi.fn();
    renderWithClient(
      <ClientInstructionsEditor
        clientId="claude-code"
        displayName="Claude Code"
        onClose={onClose}
      />,
    );
    await screen.findByTestId("client-instructions-editor-textarea");
    // The two-button toggle group is gone — view ⇄ edit is implicit
    // through `MarkdownField` (click / focus / blur).
    expect(
      screen.queryByTestId("client-instructions-editor-mode-edit"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("client-instructions-editor-mode-preview"),
    ).not.toBeInTheDocument();
  });
});
