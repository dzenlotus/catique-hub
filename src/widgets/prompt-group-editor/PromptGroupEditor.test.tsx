import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { PromptGroup } from "@entities/prompt-group";
import type { Prompt } from "@entities/prompt";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { PromptGroupEditor } from "./PromptGroupEditor";

const invokeMock = vi.mocked(invoke);

function makeGroup(overrides: Partial<PromptGroup> = {}): PromptGroup {
  return {
    id: "group-1",
    name: "Тестовая группа",
    color: "#ff0000",
    icon: null,
    position: 1n,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: "prompt-1",
    name: "Тестовый промпт",
    content: "",
    shortDescription: null,
    color: null,
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
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client, user };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PromptGroupEditor", () => {
  it("does not render the dialog when groupId is null", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<PromptGroupEditor groupId={null} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders skeleton rows when query is pending", async () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<PromptGroupEditor groupId="group-1" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Save button is disabled during loading.
    expect(screen.getByTestId("prompt-group-editor-save")).toBeDisabled();
  });

  it("renders an error banner when the query fails", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_prompt_group") throw new Error("transport down");
      return [];
    });
    renderWithClient(<PromptGroupEditor groupId="group-1" onClose={() => {}} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("prompt-group-editor-fetch-error"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
  });

  it("renders form fields populated when loaded", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_prompt_group") return makeGroup();
      if (cmd === "list_prompt_group_members") return [];
      if (cmd === "list_prompts") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    renderWithClient(<PromptGroupEditor groupId="group-1" onClose={() => {}} />);

    await screen.findByTestId("prompt-group-editor-name-input");
    expect(screen.getByTestId("prompt-group-editor-name-input")).toHaveValue(
      "Тестовая группа",
    );
    expect(
      (
        screen.getByTestId(
          "prompt-group-editor-color-input",
        ) as HTMLInputElement
      ).value,
    ).toBe("#ff0000");
    // audit-#12: position field is no longer exposed in the form.
    expect(
      screen.queryByTestId("prompt-group-editor-position-input"),
    ).not.toBeInTheDocument();
  });

  it("name input is editable", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_prompt_group") return makeGroup();
      if (cmd === "list_prompt_group_members") return [];
      if (cmd === "list_prompts") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const { user } = renderWithClient(
      <PromptGroupEditor groupId="group-1" onClose={() => {}} />,
    );

    const nameInput = await screen.findByTestId(
      "prompt-group-editor-name-input",
    );
    await user.clear(nameInput);
    await user.type(nameInput, "Новое название");

    expect(nameInput).toHaveValue("Новое название");
  });

  it("clicking Save triggers useUpdatePromptGroupMutation with dirty fields only", async () => {
    const group = makeGroup();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_prompt_group") return group;
      if (cmd === "list_prompt_group_members") return [];
      if (cmd === "list_prompts") return [];
      if (cmd === "update_prompt_group")
        return { ...group, name: "Новое название" };
      if (cmd === "list_prompt_groups") return [group];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <PromptGroupEditor groupId="group-1" onClose={onClose} />,
    );

    const nameInput = await screen.findByTestId(
      "prompt-group-editor-name-input",
    );
    await user.clear(nameInput);
    await user.type(nameInput, "Новое название");

    await user.click(screen.getByTestId("prompt-group-editor-save"));

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "update_prompt_group",
      );
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toMatchObject({
        id: "group-1",
        name: "Новое название",
      });
      // color/position not changed — must not be sent.
      expect(updateCall?.[1]).not.toHaveProperty("color");
    });
  });

  it("clicking Cancel closes without triggering mutation", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_prompt_group") return makeGroup();
      if (cmd === "list_prompt_group_members") return [];
      if (cmd === "list_prompts") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <PromptGroupEditor groupId="group-1" onClose={onClose} />,
    );

    await screen.findByTestId("prompt-group-editor-name-input");
    await user.click(screen.getByTestId("prompt-group-editor-cancel"));

    expect(onClose).toHaveBeenCalledOnce();
    const updateCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "update_prompt_group",
    );
    expect(updateCall).toBeUndefined();
  });

  it("renders members when provided", async () => {
    const prompt = makePrompt({ id: "pid-1", name: "Alpha" });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_prompt_group") return makeGroup();
      if (cmd === "list_prompt_group_members") return ["pid-1"];
      if (cmd === "get_prompt") return prompt;
      if (cmd === "list_prompts") return [prompt];
      throw new Error(`unexpected: ${cmd}`);
    });

    renderWithClient(<PromptGroupEditor groupId="group-1" onClose={() => {}} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("prompt-group-editor-member-pid-1"),
      ).toBeInTheDocument();
    });
  });

  it("remove button fires remove_prompt_group_member", async () => {
    const prompt = makePrompt({ id: "pid-1", name: "Alpha" });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_prompt_group") return makeGroup();
      if (cmd === "list_prompt_group_members") return ["pid-1"];
      if (cmd === "get_prompt") return prompt;
      if (cmd === "list_prompts") return [prompt];
      if (cmd === "remove_prompt_group_member") return undefined;
      return [];
    });

    const { user } = renderWithClient(
      <PromptGroupEditor groupId="group-1" onClose={() => {}} />,
    );

    const removeBtn = await screen.findByTestId(
      "prompt-group-editor-remove-member-pid-1",
    );
    await user.click(removeBtn);

    await waitFor(() => {
      const removeCall = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "remove_prompt_group_member",
      );
      expect(removeCall).toBeDefined();
      expect(removeCall?.[1]).toMatchObject({
        groupId: "group-1",
        promptId: "pid-1",
      });
    });
  });

  it("shows save error on mutation failure", async () => {
    const group = makeGroup();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_prompt_group") return group;
      if (cmd === "list_prompt_group_members") return [];
      if (cmd === "list_prompts") return [];
      if (cmd === "update_prompt_group") throw new Error("сервер недоступен");
      throw new Error(`unexpected: ${cmd}`);
    });
    const { user } = renderWithClient(
      <PromptGroupEditor groupId="group-1" onClose={() => {}} />,
    );

    const nameInput = await screen.findByTestId(
      "prompt-group-editor-name-input",
    );
    await user.clear(nameInput);
    await user.type(nameInput, "Другое название");

    await user.click(screen.getByTestId("prompt-group-editor-save"));

    await waitFor(() => {
      expect(
        screen.getByTestId("prompt-group-editor-save-error"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/сервер недоступен/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DnD reordering tests

describe("PromptGroupEditor — drag-and-drop reordering", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders members in initial server order", async () => {
    const prompts = [
      makePrompt({ id: "pid-A", name: "Alpha" }),
      makePrompt({ id: "pid-B", name: "Beta" }),
      makePrompt({ id: "pid-C", name: "Gamma" }),
    ];
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_prompt_group") return makeGroup();
      if (cmd === "list_prompt_group_members") return ["pid-A", "pid-B", "pid-C"];
      if (cmd === "get_prompt") return prompts[0];
      if (cmd === "list_prompts") return prompts;
      throw new Error(`unexpected: ${cmd}`);
    });

    renderWithClient(<PromptGroupEditor groupId="group-1" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("prompt-group-editor-member-pid-A")).toBeInTheDocument();
      expect(screen.getByTestId("prompt-group-editor-member-pid-B")).toBeInTheDocument();
      expect(screen.getByTestId("prompt-group-editor-member-pid-C")).toBeInTheDocument();
    });

    const items = screen.getAllByRole("listitem");
    const ids = items.map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual([
      "prompt-group-editor-member-pid-A",
      "prompt-group-editor-member-pid-B",
      "prompt-group-editor-member-pid-C",
    ]);
  });

  // Drag-handle / member reorder tests removed — drag-and-drop was
  // dropped from PromptGroupEditor when the project moved off
  // @dnd-kit/core. Members render as a static list; ordering is set
  // implicitly by add order on the backend.
});
