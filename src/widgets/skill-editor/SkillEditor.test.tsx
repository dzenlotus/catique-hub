import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Skill } from "@entities/skill";

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
import { SkillEditor } from "./SkillEditor";

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
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client, user };
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

  it("renders form fields populated when loaded", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return makeSkill();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    renderWithClient(<SkillEditor skillId="skill-1" onClose={onClose} />);

    await screen.findByTestId("skill-editor-name-input");
    expect(screen.getByTestId("skill-editor-name-input")).toHaveValue("TypeScript");
    expect(screen.getByTestId("skill-editor-description-input")).toHaveValue(
      "Строгая типизация для JS",
    );
    expect(
      (screen.getByTestId("skill-editor-color-input") as HTMLInputElement).value,
    ).toBe("#3b82f6");
  });

  it("name input is editable", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return makeSkill();
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <SkillEditor skillId="skill-1" onClose={onClose} />,
    );

    const nameInput = await screen.findByTestId("skill-editor-name-input");
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
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <SkillEditor skillId="skill-1" onClose={onClose} />,
    );

    const nameInput = await screen.findByTestId("skill-editor-name-input");
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
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <SkillEditor skillId="skill-1" onClose={onClose} />,
    );

    await screen.findByTestId("skill-editor-name-input");
    const cancelButton = screen.getByTestId("skill-editor-cancel");
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalledOnce();
    const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_skill");
    expect(updateCall).toBeUndefined();
  });

  it("empty color gets sent as null on update", async () => {
    const skill = makeSkill({ color: "#3b82f6" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return skill;
      if (cmd === "update_skill") return { ...skill, color: null };
      if (cmd === "list_skills") return [skill];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <SkillEditor skillId="skill-1" onClose={onClose} />,
    );

    await screen.findByTestId("skill-editor-name-input");

    // Click the "Reset" button to clear the color.
    const resetButton = screen.getByText("Reset");
    await user.click(resetButton);

    const saveButton = screen.getByTestId("skill-editor-save");
    await user.click(saveButton);

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find(([cmd]) => cmd === "update_skill");
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toMatchObject({
        id: "skill-1",
        color: null,
      });
    });
  });

  it("empty description gets sent as null on update", async () => {
    const skill = makeSkill({ description: "Описание" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "get_skill") return skill;
      if (cmd === "update_skill") return { ...skill, description: null };
      if (cmd === "list_skills") return [skill];
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <SkillEditor skillId="skill-1" onClose={onClose} />,
    );

    const descInput = await screen.findByTestId("skill-editor-description-input");
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
      throw new Error(`unexpected: ${cmd}`);
    });
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <SkillEditor skillId="skill-1" onClose={onClose} />,
    );

    const nameInput = await screen.findByTestId("skill-editor-name-input");
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
