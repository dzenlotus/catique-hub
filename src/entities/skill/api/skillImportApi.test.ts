/**
 * Tests for the `import_skill_from_url` IPC wrapper (SKILL-V2-B).
 *
 * Mocks `@shared/api`'s `invokeWithAppError` so the assertions stay
 * local to the JS-side payload shape.
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
import { importSkillFromUrl } from "./skillImportApi";
import type { ImportReport } from "@bindings/ImportReport";

const invokeMock = vi.mocked(invokeWithAppError);

function fakeReport(overrides: Partial<ImportReport> = {}): ImportReport {
  return {
    skillId: "sk-1",
    overviewChars: 240,
    stepsAdded: 3,
    attachmentId: null,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("skillImportApi", () => {
  it("forwards URL only when target + replace flag are absent", async () => {
    invokeMock.mockResolvedValue(fakeReport());
    await importSkillFromUrl({
      url: "https://github.com/owner/repo/blob/main/SKILL.md",
    });
    expect(invokeMock).toHaveBeenCalledWith("import_skill_from_url", {
      url: "https://github.com/owner/repo/blob/main/SKILL.md",
    });
  });

  it("forwards targetSkillId + replaceSteps when provided", async () => {
    invokeMock.mockResolvedValue(fakeReport({ stepsAdded: 5 }));
    await importSkillFromUrl({
      url: "https://gist.github.com/u/abc",
      targetSkillId: "sk-1",
      replaceSteps: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("import_skill_from_url", {
      url: "https://gist.github.com/u/abc",
      targetSkillId: "sk-1",
      replaceSteps: true,
    });
  });

  it("returns the ImportReport from the IPC verbatim", async () => {
    const report = fakeReport({
      skillId: "sk-1",
      overviewChars: 512,
      stepsAdded: 4,
      attachmentId: "att-1",
    });
    invokeMock.mockResolvedValue(report);
    const result = await importSkillFromUrl({
      url: "https://github.com/o/r",
      targetSkillId: "sk-1",
      replaceSteps: false,
    });
    expect(result).toEqual(report);
  });
});
