/**
 * TaskView — live draft wiring (refactor: reactive XML preview).
 *
 * Verifies the end-to-end loop: typing in the left-hand task description
 * (held as local state in `TaskDialogContent`, NOT autosaved) updates the
 * right-hand `TaskXmlPreview` immediately via the per-task draft store —
 * without a Save round-trip or a bundle refetch.
 *
 * Unlike `TaskView.test.tsx` (which stubs the form + preview), this spec
 * renders the REAL `TaskDialogContent` + `TaskXmlPreview` against mocked
 * IPC so the draft store is exercised for real.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";

import type { Task } from "@entities/task";
import type { TaskBundle } from "@bindings/TaskBundle";

vi.mock("@shared/lib", async () => {
  const actual =
    await vi.importActual<typeof import("@shared/lib")>("@shared/lib");
  return {
    ...actual,
    useParamsCompat: vi.fn(() => ({ taskId: "tsk-1" })),
    useLocationCompat: vi.fn(() => ["/tasks/tsk-1", vi.fn()]),
  };
});

vi.mock("@shared/api", async () => {
  const actual =
    await vi.importActual<typeof import("@shared/api")>("@shared/api");
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
    on: vi.fn(() => Promise.resolve(() => {})),
  };
});

import { invoke } from "@shared/api";
import { ToastProvider } from "@shared/lib";
import { resetTaskDrafts } from "@entities/task";
import { TaskView } from "../TaskView";

const invokeMock = vi.mocked(invoke);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "tsk-1",
    boardId: "brd-1",
    columnId: "col-1",
    slug: "tsk-abc",
    title: "Original title",
    description: "Saved description",
    position: 1,
    roleId: null,
    kind: "blank",
    stepLog: "",
    createdAt: 0n,
    updatedAt: 0n,
    effectivePromptCount: 0n,
    effectiveSkillCount: 0n,
    effectiveToolCount: 0n,
    ...overrides,
  };
}

function makeBundle(task: Task): TaskBundle {
  return {
    task,
    role: null,
    prompts: [],
    skills: [],
    mcpTools: [],
    suppressedPrompts: [],
    suppressedSkills: [],
    suppressedMcpTools: [],
  };
}

function renderTaskView(task: Task): ReturnType<typeof userEvent.setup> {
  const bundle = makeBundle(task);
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "get_task") return task;
    if (cmd === "get_task_bundle") return bundle;
    if (cmd === "list_attachments") return [];
    if (cmd === "list_agent_reports") return [];
    if (cmd === "list_task_prompts") return [];
    if (cmd === "list_prompts") return [];
    if (cmd === "list_skills") return [];
    if (cmd === "list_mcp_tools") return [];
    if (cmd === "list_boards") return [];
    if (cmd === "list_columns") return [];
    if (cmd === "list_roles") return [];
    if (cmd === "list_spaces") return [];
    if (cmd === "resolve_task_context") return bundle;
    // Effective-context panel / overrides — tolerate anything else as empty.
    return [];
  });

  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }

  const user = userEvent.setup();
  render(
    <Wrapper>
      <TaskView />
    </Wrapper>,
  );
  return user;
}

afterEach(() => {
  resetTaskDrafts();
  vi.restoreAllMocks();
});

describe("TaskView — live draft → XML preview", () => {
  it("shows the saved description in the <task> block before any edit", async () => {
    renderTaskView(makeTask());

    await waitFor(() => {
      const body = screen.getByTestId("task-xml-preview-body");
      expect(body.textContent).toContain('<task title="Original title">');
      expect(body.textContent).toContain("Saved description");
    });
  });

  it("updates the preview XML live as the description is typed (no Save)", async () => {
    const user = renderTaskView(makeTask());

    // The description starts in view mode (MarkdownField) — click to edit.
    const field = await screen.findByTestId(
      "task-dialog-description-textarea",
    );
    await user.click(field);
    const textarea = screen.getByTestId("task-dialog-description-textarea");
    await user.clear(textarea);
    await user.type(textarea, "Live unsaved edit");

    await waitFor(() => {
      const body = screen.getByTestId("task-xml-preview-body");
      expect(body.textContent).toContain("Live unsaved edit");
      // The old saved text is gone from the preview.
      expect(body.textContent).not.toContain("Saved description");
    });

    // No update_task IPC was fired — the edit is purely local/draft.
    const saved = invokeMock.mock.calls.find(([cmd]) => cmd === "update_task");
    expect(saved).toBeUndefined();
  });

  it("reflects live title edits in the <task title=…> attribute", async () => {
    const user = renderTaskView(makeTask());

    const titleInput = await screen.findByTestId("task-dialog-title-input");
    await user.clear(titleInput);
    await user.type(titleInput, "Renamed live");

    await waitFor(() => {
      const body = screen.getByTestId("task-xml-preview-body");
      expect(body.textContent).toContain('<task title="Renamed live">');
    });
  });
});
