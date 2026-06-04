/**
 * SkillExportButton — component tests (Stream J / v3 Wave 4).
 *
 * Verifies the dialog calls `export_skill_as_markdown` and renders the
 * canonical markdown returned by the Rust IPC. The fallback path is
 * also exercised: when the IPC rejects (Storybook / dev without
 * `pnpm tauri:dev`), the in-browser serialiser still produces a
 * non-empty body so the button stays useful in headless environments.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Skill } from "@entities/skill";
import type { SkillStep } from "@bindings/SkillStep";
import { ToastProvider } from "@shared/lib";

vi.mock("@shared/api", async () => {
  const actual = await vi.importActual<typeof import("@shared/api")>(
    "@shared/api",
  );
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
  };
});

import { invoke } from "@shared/api";
import { SkillExportButton } from "../SkillExportButton";

const invokeMock = vi.mocked(invoke);

function fakeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-1",
    name: "Rust",
    description: "Systems language",
    color: null,
    position: 0,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function fakeStep(overrides: Partial<SkillStep> = {}): SkillStep {
  return {
    id: "step-1",
    skillId: "skill-1",
    position: 1,
    title: "Install rustup",
    body: "Visit rustup.rs",
    expectedOutcome: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

function renderExport(): { user: ReturnType<typeof userEvent.setup> } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  // Seed the per-entity caches the dialog fallback path reads from.
  // Keys mirror `skillsKeys.detail` and `skillStepsKeys.byList`.
  client.setQueryData(["skills", "skill-1"], fakeSkill());
  client.setQueryData(
    ["skillSteps", "skill-1"],
    [fakeStep()] as SkillStep[],
  );
  const user = userEvent.setup();
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SkillExportButton skillId="skill-1" />
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

describe("SkillExportButton", () => {
  it("renders only the trigger when closed", () => {
    renderExport();
    expect(screen.getByTestId("skill-export-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-export-dialog-body")).toBeNull();
  });

  it("invokes export_skill_as_markdown and renders the returned body", async () => {
    invokeMock.mockResolvedValue("# Mock skill\n\nFrom IPC.");
    const { user } = renderExport();
    await user.click(screen.getByTestId("skill-export-trigger"));

    // Confirm the IPC was called with the canonical skillId arg.
    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "export_skill_as_markdown",
      );
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({ skillId: "skill-1" });
    });
    // Confirm the IPC-returned body is rendered inside the textarea.
    const body = await screen.findByTestId("skill-export-dialog-body");
    expect(body.querySelector("textarea")?.value).toContain("From IPC.");
  });

  it("falls back to the local serialiser when the IPC rejects", async () => {
    // Reject only the export call; the data-loading IPCs (`get_skill`,
    // `list_skill_steps`) must succeed so the fallback path has
    // something to serialise. The dialog's react-query consumers
    // (`useSkill`, `useSkillSteps`) also call invoke under the hood,
    // so a blanket `mockRejectedValue` would break them too.
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "export_skill_as_markdown") {
        throw new Error("ipc unavailable");
      }
      if (cmd === "get_skill") return fakeSkill();
      if (cmd === "list_skill_steps") return [fakeStep()];
      return null;
    });
    const { user } = renderExport();
    await user.click(screen.getByTestId("skill-export-trigger"));

    const body = await screen.findByTestId("skill-export-dialog-body");
    // The seeded skill + step land in the fallback path.
    await waitFor(() => {
      expect(body.querySelector("textarea")?.value).toContain("# Rust");
    });
    expect(body.querySelector("textarea")?.value).toContain(
      "## Step 1 — Install rustup",
    );
  });
});
