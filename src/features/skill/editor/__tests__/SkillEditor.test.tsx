import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Skill, SkillAttachment } from "@entities/skill";
import { ToastProvider } from "@shared/lib";

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
import { SkillEditor, SkillEditorPanel } from "../SkillEditor";

const invokeMock = vi.mocked(invoke);

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-1",
    name: "TypeScript",
    description: "Строгая типизация для JS",
    color: "#3b82f6",
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
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
  return { client, user };
}

function makeAttachment(
  overrides: Partial<SkillAttachment> = {},
): SkillAttachment {
  return {
    id: "att-1",
    skillId: "skill-1",
    kind: "file",
    filename: "report.py",
    mimeType: "text/x-python",
    sizeBytes: 12n,
    storagePath: "/skills/skill-1/report.py",
    gitUrl: null,
    gitRef: null,
    gitPath: null,
    createdAt: 0n,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SkillEditor", () => {
  it("does not render the dialog when skillId is null", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<SkillEditor skillId={null} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders skeleton rows when query is pending", async () => {
    // Never resolves — simulates pending state.
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    renderWithClient(<SkillEditor skillId="skill-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Save button is disabled during loading.
    const saveButton = screen.getByTestId("skill-editor-save");
    expect(saveButton).toBeDisabled();
  });

  it("renders an error banner when the query fails", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") throw new Error("transport down");
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<SkillEditor skillId="skill-1" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId("skill-editor-fetch-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
  });

  // Helper: enter inline rename mode on the skill name and return the input.
  async function openNameEditor(user: ReturnType<typeof userEvent.setup>) {
    const trigger = await screen.findByTestId("skill-editor-name-input-trigger");
    await user.click(trigger);
    return screen.getByTestId("skill-editor-name-input") as HTMLInputElement;
  }

  it("renders form fields populated when loaded", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return makeSkill();
      if (cmd === "list_skill_attachments") return [];
      if (cmd === "list_skill_steps") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<SkillEditor skillId="skill-1" onClose={onClose} />);

    await screen.findByTestId("skill-editor-name-input-trigger");
    expect(
      screen.getByRole("button", { name: /rename typescript/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("skill-editor-overview-input")).toHaveValue(
      "Строгая типизация для JS",
    );
    // Round-21: colour affordance dropped — Skill has no `icon` field,
    // so the IconColorPicker popover read as confused UI.
    expect(screen.queryByTestId("skill-editor-color-input")).toBeNull();
  });

  // SKILL-V2-B: Overview replaces the single-line "Description" input
  // with a multi-line textarea. Asserting the tag name keeps the
  // contract observable from the outside.
  it("Overview field is a multi-line textarea (no longer single-line input)", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return makeSkill();
      if (cmd === "list_skill_attachments") return [];
      if (cmd === "list_skill_steps") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<SkillEditor skillId="skill-1" onClose={onClose} />);

    const overviewField = await screen.findByTestId(
      "skill-editor-overview-input",
    );
    expect(overviewField.tagName).toBe("TEXTAREA");
  });

  it("name input is editable", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return makeSkill();
      if (cmd === "list_skill_attachments") return [];
      if (cmd === "list_skill_steps") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <SkillEditor skillId="skill-1" onClose={onClose} />,
    );

    const nameInput = await openNameEditor(user);
    await user.clear(nameInput);
    await user.type(nameInput, "JavaScript");

    expect(nameInput).toHaveValue("JavaScript");
  });

  it("clicking Save triggers useUpdateSkillMutation with dirty fields only", async () => {
    const skill = makeSkill();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return skill;
      if (cmd === "update_skill") return { ...skill, name: "TSX" };
      if (cmd === "list_skills") return [skill];
      if (cmd === "list_skill_attachments") return [];
      if (cmd === "list_skill_steps") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <SkillEditor skillId="skill-1" onClose={onClose} />,
    );

    const nameInput = await openNameEditor(user);
    await user.clear(nameInput);
    await user.type(nameInput, "TSX");

    const saveButton = screen.getByTestId("skill-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_skill");
      expect(updateCall).toBeDefined();
      // Only the name field changed — other fields must NOT be included.
      expect(updateCall?.[1]).toMatchObject({
        id: "skill-1",
        name: "TSX",
      });
      // description / color were not changed, so they must be absent.
      expect(updateCall?.[1]).not.toHaveProperty("description");
      expect(updateCall?.[1]).not.toHaveProperty("color");
    });
  });

  it("clicking Cancel closes without triggering mutation", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return makeSkill();
      if (cmd === "list_skill_attachments") return [];
      if (cmd === "list_skill_steps") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <SkillEditor skillId="skill-1" onClose={onClose} />,
    );

    await screen.findByTestId("skill-editor-name-input-trigger");
    const cancelButton = screen.getByTestId("skill-editor-cancel");
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledOnce();
    const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_skill");
    expect(updateCall).toBeUndefined();
  });

  // Round-21: the colour affordance was removed from SkillEditor — the
  // legacy "empty color gets sent as null" test no longer applies.

  it("empty description gets sent as null on update", async () => {
    const skill = makeSkill({ description: "Описание" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return skill;
      if (cmd === "update_skill") return { ...skill, description: null };
      if (cmd === "list_skills") return [skill];
      if (cmd === "list_skill_attachments") return [];
      if (cmd === "list_skill_steps") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <SkillEditor skillId="skill-1" onClose={onClose} />,
    );

    const descInput = await screen.findByTestId("skill-editor-overview-input");
    await user.clear(descInput);

    const saveButton = screen.getByTestId("skill-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_skill");
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toMatchObject({
        id: "skill-1",
        description: null,
      });
    });
  });

  it("shows inline save-error message when mutation fails", async () => {
    const skill = makeSkill();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return skill;
      if (cmd === "update_skill") throw new Error("сервер недоступен");
      if (cmd === "list_skill_attachments") return [];
      if (cmd === "list_skill_steps") return [];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <SkillEditor skillId="skill-1" onClose={onClose} />,
    );

    const nameInput = await openNameEditor(user);
    await user.clear(nameInput);
    await user.type(nameInput, "Другое название");

    const saveButton = screen.getByTestId("skill-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByTestId("skill-editor-save-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/сервер недоступен/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SKILL-S12: attachments section
// ─────────────────────────────────────────────────────────────────────────────

describe("SkillEditorPanel · attachments", () => {
  it("renders the empty state when zero attachments are returned", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return makeSkill();
      if (cmd === "list_skill_attachments") return [];
      if (cmd === "list_skill_steps") return [];
      throw new Error(`unexpected: ${cmd}`);
    });

    renderWithClient(
      <SkillEditorPanel skillId="skill-1" onClose={() => undefined} />,
    );

    await screen.findByTestId("skill-attachments-section");
    await waitFor(() => {
      expect(screen.getByTestId("skill-attachments-empty")).toBeInTheDocument();
    });
  });

  it("renders file rows + git rows from the attachments list", async () => {
    const fileAttachment = makeAttachment({
      id: "att-file",
      filename: "report.py",
      kind: "file",
    });
    const gitAttachment = makeAttachment({
      id: "att-git",
      kind: "git",
      filename: null,
      mimeType: null,
      sizeBytes: null,
      storagePath: null,
      gitUrl: "https://github.com/owner/repo.git",
      gitRef: "main",
      gitPath: "scripts/run.sh",
    });

    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return makeSkill();
      if (cmd === "list_skill_attachments") return [fileAttachment, gitAttachment];
      if (cmd === "list_skill_steps") return [];
      throw new Error(`unexpected: ${cmd}`);
    });

    renderWithClient(
      <SkillEditorPanel skillId="skill-1" onClose={() => undefined} />,
    );

    await screen.findByTestId(`skill-attachment-row-${fileAttachment.id}`);
    expect(
      screen.getByTestId(`skill-attachment-row-${gitAttachment.id}`),
    ).toBeInTheDocument();
    expect(screen.getByText("report.py")).toBeInTheDocument();
    expect(screen.getByText(/github\.com\/owner\/repo/i)).toBeInTheDocument();
    expect(screen.getByText("scripts/run.sh")).toBeInTheDocument();
  });

  it("submitting a git URL calls add_skill_git_attachment with trimmed args", async () => {
    const gitAttachment = makeAttachment({
      id: "att-git",
      kind: "git",
      filename: null,
      mimeType: null,
      sizeBytes: null,
      storagePath: null,
      gitUrl: "https://github.com/owner/repo.git",
      gitRef: null,
      gitPath: null,
    });

    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "get_skill") return makeSkill();
      if (cmd === "list_skill_attachments") return [];
      if (cmd === "list_skill_steps") return [];
      if (cmd === "add_skill_git_attachment") return gitAttachment;
      throw new Error(`unexpected: ${cmd} ${JSON.stringify(args)}`);
    });

    const { user } = renderWithClient(
      <SkillEditorPanel skillId="skill-1" onClose={() => undefined} />,
    );

    await screen.findByTestId("skill-attachments-empty");
    await user.click(screen.getByTestId("skill-attachments-add-git-btn"));

    const urlInput = await screen.findByTestId(
      "skill-attachments-git-url-input",
    );
    // Use one extra space to verify the trim path.
    await user.type(urlInput, "  https://github.com/owner/repo.git  ");
    await user.click(screen.getByTestId("skill-attachments-git-submit"));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "add_skill_git_attachment",
      );
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({
        skillId: "skill-1",
        gitUrl: "https://github.com/owner/repo.git",
        gitRef: null,
        gitPath: null,
      });
    });
  });

  it("submitting a git URL without an URL shows a validation error", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return makeSkill();
      if (cmd === "list_skill_attachments") return [];
      if (cmd === "list_skill_steps") return [];
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderWithClient(
      <SkillEditorPanel skillId="skill-1" onClose={() => undefined} />,
    );

    await screen.findByTestId("skill-attachments-empty");
    await user.click(screen.getByTestId("skill-attachments-add-git-btn"));
    await user.click(screen.getByTestId("skill-attachments-git-submit"));

    expect(
      await screen.findByTestId("skill-attachments-git-form-error"),
    ).toBeInTheDocument();
    // No IPC call should fire.
    expect(
      invokeMock.mock.calls.find(([cmd]) => cmd === "add_skill_git_attachment"),
    ).toBeUndefined();
  });

  it("clicking remove on a row calls remove_skill_attachment", async () => {
    const fileAttachment = makeAttachment({
      id: "att-file",
      filename: "report.py",
    });
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "get_skill") return makeSkill();
      if (cmd === "list_skill_attachments") return [fileAttachment];
      if (cmd === "list_skill_steps") return [];
      if (cmd === "remove_skill_attachment") return undefined;
      throw new Error(`unexpected: ${cmd} ${JSON.stringify(args)}`);
    });

    const { user } = renderWithClient(
      <SkillEditorPanel skillId="skill-1" onClose={() => undefined} />,
    );

    const removeBtn = await screen.findByTestId(
      `skill-attachment-remove-${fileAttachment.id}`,
    );
    await user.click(removeBtn);

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "remove_skill_attachment",
      );
      expect(call).toBeDefined();
      expect(call?.[1]).toEqual({ attachmentId: "att-file" });
    });
  });

  it("uploading a file calls add_skill_file_attachment with base64 payload", async () => {
    const fileAttachment = makeAttachment({
      id: "att-upload",
      filename: "hello.txt",
      mimeType: "text/plain",
    });

    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return makeSkill();
      if (cmd === "list_skill_attachments") return [];
      if (cmd === "list_skill_steps") return [];
      if (cmd === "add_skill_file_attachment") return fileAttachment;
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderWithClient(
      <SkillEditorPanel skillId="skill-1" onClose={() => undefined} />,
    );

    await screen.findByTestId("skill-attachments-empty");
    const hiddenInput = screen.getByTestId(
      "skill-attachments-file-input",
    ) as HTMLInputElement;

    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    await user.upload(hiddenInput, file);

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "add_skill_file_attachment",
      );
      expect(call).toBeDefined();
      const payload = call?.[1] as Record<string, unknown>;
      expect(payload.skillId).toBe("skill-1");
      expect(payload.filename).toBe("hello.txt");
      expect(payload.mimeType).toBe("text/plain");
      // "hello" → base64 is "aGVsbG8="
      expect(payload.base64Bytes).toBe("aGVsbG8=");
    });
  });
});
