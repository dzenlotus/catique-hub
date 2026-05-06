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
import { SkillCreateDialog } from "./SkillCreateDialog";

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

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-1",
    name: "TypeScript",
    description: null,
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

describe("SkillCreateDialog", () => {
  it("renders form fields when open", () => {
    renderWithClient(<SkillCreateDialog isOpen onClose={() => undefined} />);
    expect(
      screen.getByTestId("skill-create-dialog-name-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("skill-create-dialog-description-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("skill-create-dialog-color-input"),
    ).toBeInTheDocument();
  });

  it("Save button is disabled when name is empty", () => {
    renderWithClient(<SkillCreateDialog isOpen onClose={() => undefined} />);
    expect(screen.getByTestId("skill-create-dialog-save")).toBeDisabled();
  });

  it("Save button becomes enabled once name is filled", async () => {
    const { user } = renderWithClient(
      <SkillCreateDialog isOpen onClose={() => undefined} />,
    );
    await user.type(
      screen.getByTestId("skill-create-dialog-name-input"),
      "React",
    );
    expect(screen.getByTestId("skill-create-dialog-save")).not.toBeDisabled();
  });

  it("calls create_skill with correct payload on submit", async () => {
    const newSkill = makeSkill({ id: "skill-new", name: "Go" });
    invokeMock.mockResolvedValue(newSkill);

    const onCreated = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <SkillCreateDialog isOpen onClose={onClose} onCreated={onCreated} />,
    );

    await user.type(
      screen.getByTestId("skill-create-dialog-name-input"),
      "Go",
    );
    await user.click(screen.getByTestId("skill-create-dialog-save"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onCreated).toHaveBeenCalledWith(newSkill);

    const createCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "create_skill",
    );
    // `position` is required by the Rust handler; its exact value is a
    // `Date.now()` snapshot, so just assert the shape.
    expect(createCall?.[1]).toMatchObject({ name: "Go" });
    const payload = createCall?.[1] as Record<string, unknown>;
    expect(typeof payload.position).toBe("number");
    expect(payload.position).toBeGreaterThan(0);
  });

  it("sends `position` (number) on create_skill — Rust handler requires it (audit F-01)", async () => {
    const newSkill = makeSkill();
    invokeMock.mockResolvedValue(newSkill);

    const { user } = renderWithClient(
      <SkillCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("skill-create-dialog-name-input"),
      "Elixir",
    );
    await user.click(screen.getByTestId("skill-create-dialog-save"));

    await waitFor(() => {
      const createCall = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "create_skill",
      );
      const payload = createCall?.[1] as Record<string, unknown>;
      expect(typeof payload.position).toBe("number");
    });
  });

  it("includes description in payload when filled", async () => {
    const newSkill = makeSkill();
    invokeMock.mockResolvedValue(newSkill);

    const { user } = renderWithClient(
      <SkillCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("skill-create-dialog-name-input"),
      "Rust",
    );
    await user.type(
      screen.getByTestId("skill-create-dialog-description-input"),
      "Системное программирование",
    );
    await user.click(screen.getByTestId("skill-create-dialog-save"));

    await waitFor(() => {
      const createCall = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "create_skill",
      );
      expect(createCall?.[1]).toMatchObject({
        description: "Системное программирование",
      });
    });
  });

  it("shows inline error on mutation failure", async () => {
    invokeMock.mockRejectedValue(new Error("сбой"));

    const { user } = renderWithClient(
      <SkillCreateDialog isOpen onClose={() => undefined} />,
    );

    await user.type(
      screen.getByTestId("skill-create-dialog-name-input"),
      "Kotlin",
    );
    await user.click(screen.getByTestId("skill-create-dialog-save"));

    await waitFor(() => {
      expect(screen.getByTestId("skill-create-dialog-error")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("Cancel closes without calling the mutation", async () => {
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <SkillCreateDialog isOpen onClose={onClose} />,
    );

    await user.click(screen.getByTestId("skill-create-dialog-cancel"));

    expect(onClose).toHaveBeenCalled();
    const createCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "create_skill",
    );
    expect(createCalls).toHaveLength(0);
  });

  it("does not render content when isOpen is false", () => {
    renderWithClient(
      <SkillCreateDialog isOpen={false} onClose={() => undefined} />,
    );
    expect(
      screen.queryByTestId("skill-create-dialog-name-input"),
    ).toBeNull();
  });
});
