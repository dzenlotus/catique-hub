/**
 * Tests for the skill steps IPC wrappers (SKILL-V2-B).
 *
 * Mocks `@shared/api`'s `invokeWithAppError` and asserts that each
 * wrapper forwards the right command name + payload shape to the Rust
 * side. Tauri converts camelCase JS keys to snake_case server-side, so
 * we only need to check the JS-facing payload.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  addSkillStep,
  deleteSkillStep,
  listSkillSteps,
  reorderSkillSteps,
  updateSkillStep,
} from "./skillStepsApi";
import type { SkillStep } from "@bindings/SkillStep";

const invokeMock = vi.mocked(invokeWithAppError);

function fakeStep(overrides: Partial<SkillStep> = {}): SkillStep {
  return {
    id: "step-1",
    skillId: "sk-1",
    position: 0,
    title: "Validate input",
    body: "Check the request body is non-empty.",
    expectedOutcome: null,
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

describe("skillStepsApi", () => {
  it("listSkillSteps forwards skillId verbatim", async () => {
    invokeMock.mockResolvedValue([]);
    await listSkillSteps("sk-1");
    expect(invokeMock).toHaveBeenCalledWith("list_skill_steps", {
      skillId: "sk-1",
    });
  });

  it("addSkillStep omits optional keys when absent", async () => {
    invokeMock.mockResolvedValue(fakeStep());
    await addSkillStep({
      skillId: "sk-1",
      title: "Validate input",
      body: "Check the request body is non-empty.",
    });
    const call = invokeMock.mock.calls.find(([cmd]) => cmd === "add_skill_step");
    expect(call).toBeDefined();
    expect(call?.[1]).toEqual({
      skillId: "sk-1",
      title: "Validate input",
      body: "Check the request body is non-empty.",
    });
  });

  it("addSkillStep forwards expectedOutcome + position when set", async () => {
    invokeMock.mockResolvedValue(fakeStep({ expectedOutcome: "ok", position: 5 }));
    await addSkillStep({
      skillId: "sk-1",
      title: "Validate input",
      body: "body",
      expectedOutcome: "ok",
      position: 5,
    });
    expect(invokeMock).toHaveBeenCalledWith("add_skill_step", {
      skillId: "sk-1",
      title: "Validate input",
      body: "body",
      expectedOutcome: "ok",
      position: 5,
    });
  });

  it("addSkillStep forwards explicit null for expectedOutcome", async () => {
    invokeMock.mockResolvedValue(fakeStep());
    await addSkillStep({
      skillId: "sk-1",
      title: "t",
      body: "b",
      expectedOutcome: null,
    });
    const payload = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "add_skill_step",
    )?.[1] as Record<string, unknown>;
    expect(payload).toHaveProperty("expectedOutcome", null);
  });

  it("updateSkillStep only forwards keys that were provided", async () => {
    invokeMock.mockResolvedValue(fakeStep({ title: "Renamed" }));
    await updateSkillStep({ id: "step-1", title: "Renamed" });
    const call = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "update_skill_step",
    );
    expect(call?.[1]).toEqual({ id: "step-1", title: "Renamed" });
    expect(call?.[1]).not.toHaveProperty("body");
    expect(call?.[1]).not.toHaveProperty("position");
    expect(call?.[1]).not.toHaveProperty("expectedOutcome");
  });

  it("updateSkillStep clears expectedOutcome with explicit null", async () => {
    invokeMock.mockResolvedValue(fakeStep({ expectedOutcome: null }));
    await updateSkillStep({ id: "step-1", expectedOutcome: null });
    const payload = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "update_skill_step",
    )?.[1] as Record<string, unknown>;
    expect(payload).toEqual({ id: "step-1", expectedOutcome: null });
  });

  it("deleteSkillStep forwards id only", async () => {
    invokeMock.mockResolvedValue(undefined);
    await deleteSkillStep("step-9");
    expect(invokeMock).toHaveBeenCalledWith("delete_skill_step", {
      id: "step-9",
    });
  });

  it("reorderSkillSteps forwards skillId + stepIds verbatim", async () => {
    invokeMock.mockResolvedValue(undefined);
    await reorderSkillSteps({
      skillId: "sk-1",
      stepIds: ["s3", "s1", "s2"],
    });
    expect(invokeMock).toHaveBeenCalledWith("reorder_skill_steps", {
      skillId: "sk-1",
      stepIds: ["s3", "s1", "s2"],
    });
  });
});
