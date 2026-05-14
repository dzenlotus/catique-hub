/**
 * SkillStepsSection — component tests (SKILL-V2-B).
 *
 * Mocks the IPC layer via `@shared/api` so each test can assert the
 * call shape the section forwards to Rust. Drag-reorder is exercised
 * via direct mutation invocation rather than synthetic dnd-kit events
 * — the hook contract (`reorder_skill_steps` payload) is the
 * observable surface that needs coverage; jsdom's missing pointer-event
 * support makes a true drag simulation brittle.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { SkillStep } from "@bindings/SkillStep";
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

import { invokeWithAppError } from "@shared/api";
import { SkillStepsSection } from "./SkillStepsSection";
import { reorderSkillSteps } from "@entities/skill";

const invokeMock = vi.mocked(invokeWithAppError);

function makeStep(overrides: Partial<SkillStep> = {}): SkillStep {
  return {
    id: "step-1",
    skillId: "skill-1",
    position: 0,
    title: "Validate input",
    body: "Check the request body is non-empty.",
    expectedOutcome: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function renderSection(steps: SkillStep[] = []): {
  user: ReturnType<typeof userEvent.setup>;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  // Seed `useSkillSteps` directly so the initial render shows the
  // ordered list synchronously — sidesteps the dnd-kit pointer poly-
  // fills we don't actually need for the data-layer assertions.
  client.setQueryData(["skillSteps", "skill-1"], steps);

  const user = userEvent.setup();
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SkillStepsSection skillId="skill-1" />
      </ToastProvider>
    </QueryClientProvider>
  );
  render(ui);
  return { user };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SkillStepsSection", () => {
  it("renders empty-state copy when no steps exist", () => {
    invokeMock.mockResolvedValue([]);
    renderSection([]);
    expect(screen.getByTestId("skill-steps-empty")).toBeInTheDocument();
  });

  it("renders the steps list when data is present", () => {
    invokeMock.mockResolvedValue([]);
    const steps = [
      makeStep({ id: "s1", position: 0, title: "First" }),
      makeStep({ id: "s2", position: 1, title: "Second" }),
    ];
    renderSection(steps);

    expect(screen.getByTestId("skill-steps-list")).toBeInTheDocument();
    expect(screen.getByTestId("skill-step-card-s1")).toBeInTheDocument();
    expect(screen.getByTestId("skill-step-card-s2")).toBeInTheDocument();
    expect(screen.getByTestId("skill-step-title-s1")).toHaveTextContent("First");
    expect(screen.getByTestId("skill-step-title-s2")).toHaveTextContent("Second");
  });

  it("'+ Add step' reveals the form and submitting calls add_skill_step", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_skill_steps") return [];
      if (cmd === "add_skill_step") return makeStep({ id: "s-new", title: "Run command" });
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderSection([]);

    await user.click(screen.getByTestId("skill-steps-add-btn"));
    await screen.findByTestId("skill-step-add-form");

    await user.type(
      screen.getByTestId("skill-step-add-form-title-input"),
      "Run command",
    );
    await user.type(
      screen.getByTestId("skill-step-add-form-body-input"),
      "bash run.sh",
    );
    await user.click(screen.getByTestId("skill-step-add-form-submit"));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "add_skill_step",
      );
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({
        skillId: "skill-1",
        title: "Run command",
        body: "bash run.sh",
        expectedOutcome: null,
      });
    });
  });

  it("submitting the add form without a title surfaces validation error", async () => {
    invokeMock.mockResolvedValue([]);
    const { user } = renderSection([]);

    await user.click(screen.getByTestId("skill-steps-add-btn"));
    await user.click(screen.getByTestId("skill-step-add-form-submit"));

    expect(
      await screen.findByTestId("skill-step-add-form-error"),
    ).toBeInTheDocument();
    // No IPC call should fire.
    expect(
      invokeMock.mock.calls.find(([cmd]) => cmd === "add_skill_step"),
    ).toBeUndefined();
  });

  it("clicking edit swaps the card into an inline form; submit calls update_skill_step", async () => {
    const step = makeStep({ id: "s1", title: "Original" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_skill_steps") return [step];
      if (cmd === "update_skill_step") return { ...step, title: "Renamed" };
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderSection([step]);

    await user.click(screen.getByTestId("skill-step-edit-s1"));
    const titleInput = await screen.findByTestId(
      "skill-step-s1-form-title-input",
    );
    await user.clear(titleInput);
    await user.type(titleInput, "Renamed");
    await user.click(screen.getByTestId("skill-step-s1-form-submit"));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "update_skill_step",
      );
      expect(call?.[1]).toMatchObject({ id: "s1", title: "Renamed" });
    });
  });

  it("clicking delete calls delete_skill_step with the step id", async () => {
    const step = makeStep({ id: "s1" });
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_skill_steps") return [step];
      if (cmd === "delete_skill_step") return undefined;
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderSection([step]);

    await user.click(screen.getByTestId("skill-step-delete-s1"));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "delete_skill_step",
      );
      expect(call?.[1]).toEqual({ id: "s1" });
    });
  });

  it("toggling the chevron reveals body + expected outcome when set", async () => {
    const step = makeStep({
      id: "s1",
      title: "Step",
      body: "do the thing",
      expectedOutcome: "thing was done",
    });
    invokeMock.mockResolvedValue([step]);
    const { user } = renderSection([step]);

    // Body collapsed by default — must be revealed by chevron.
    expect(screen.queryByTestId("skill-step-body-s1")).toBeNull();

    await user.click(screen.getByTestId("skill-step-toggle-s1"));

    expect(screen.getByTestId("skill-step-body-s1")).toBeInTheDocument();
    expect(screen.getByTestId("skill-step-outcome-s1")).toBeInTheDocument();
  });

  it("hides the expected-outcome block when the field is empty", async () => {
    const step = makeStep({ id: "s1", expectedOutcome: null });
    invokeMock.mockResolvedValue([step]);
    const { user } = renderSection([step]);

    await user.click(screen.getByTestId("skill-step-toggle-s1"));

    expect(screen.getByTestId("skill-step-body-s1")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-step-outcome-s1")).toBeNull();
  });

  it("reorderSkillSteps API passes through to the IPC layer (drag-end contract)", async () => {
    // Drag simulation in jsdom is unreliable (dnd-kit relies on
    // pointer events + ResizeObserver); cover the data-layer contract
    // directly so the IPC payload remains observable.
    invokeMock.mockResolvedValue(undefined);
    await reorderSkillSteps({
      skillId: "skill-1",
      stepIds: ["s2", "s1"],
    });
    expect(invokeMock).toHaveBeenCalledWith("reorder_skill_steps", {
      skillId: "skill-1",
      stepIds: ["s2", "s1"],
    });
  });
});
