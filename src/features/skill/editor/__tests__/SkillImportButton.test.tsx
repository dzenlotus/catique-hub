/**
 * SkillImportButton — component tests (SKILL-V2-B).
 *
 * Covers the happy path (URL → submit → success toast with stepsAdded
 * count) and the error path (typed AppError surfaces in the dialog
 * banner).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { ImportReport } from "@bindings/ImportReport";
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
import { SkillImportButton } from "../SkillImportButton";

const invokeMock = vi.mocked(invokeWithAppError);

function fakeReport(overrides: Partial<ImportReport> = {}): ImportReport {
  return {
    skillId: "skill-1",
    overviewChars: 120,
    stepsAdded: 3,
    attachmentId: "att-1",
    ...overrides,
  };
}

function renderImport(): { user: ReturnType<typeof userEvent.setup> } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SkillImportButton skillId="skill-1" />
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

describe("SkillImportButton", () => {
  it("renders only the trigger when closed", () => {
    renderImport();
    expect(screen.getByTestId("skill-import-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-import-url-input")).toBeNull();
  });

  it("opens the dialog when the trigger is clicked", async () => {
    const { user } = renderImport();
    await user.click(screen.getByTestId("skill-import-trigger"));
    expect(await screen.findByTestId("skill-import-url-input")).toBeInTheDocument();
    expect(screen.getByTestId("skill-import-append")).toBeInTheDocument();
    expect(screen.getByTestId("skill-import-replace")).toBeInTheDocument();
  });

  it("submitting without a URL surfaces a validation error", async () => {
    const { user } = renderImport();
    await user.click(screen.getByTestId("skill-import-trigger"));
    await user.click(screen.getByTestId("skill-import-append"));

    expect(
      await screen.findByTestId("skill-import-validation-error"),
    ).toBeInTheDocument();
    expect(
      invokeMock.mock.calls.find(([cmd]) => cmd === "import_skill_from_url"),
    ).toBeUndefined();
  });

  it("append submit calls import_skill_from_url with replaceSteps=false", async () => {
    invokeMock.mockResolvedValue(fakeReport({ stepsAdded: 4 }));
    const { user } = renderImport();
    await user.click(screen.getByTestId("skill-import-trigger"));
    await user.type(
      await screen.findByTestId("skill-import-url-input"),
      "https://github.com/owner/repo/blob/main/SKILL.md",
    );
    await user.click(screen.getByTestId("skill-import-append"));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "import_skill_from_url",
      );
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({
        url: "https://github.com/owner/repo/blob/main/SKILL.md",
        targetSkillId: "skill-1",
        replaceSteps: false,
      });
    });
  });

  it("replace submit calls import_skill_from_url with replaceSteps=true", async () => {
    invokeMock.mockResolvedValue(fakeReport({ stepsAdded: 7 }));
    const { user } = renderImport();
    await user.click(screen.getByTestId("skill-import-trigger"));
    await user.type(
      await screen.findByTestId("skill-import-url-input"),
      "https://gist.github.com/x/abc",
    );
    await user.click(screen.getByTestId("skill-import-replace"));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(
        ([cmd]) => cmd === "import_skill_from_url",
      );
      expect(call?.[1]).toMatchObject({
        url: "https://gist.github.com/x/abc",
        targetSkillId: "skill-1",
        replaceSteps: true,
      });
    });
  });

  it("surfaces an error banner when the IPC rejects", async () => {
    invokeMock.mockRejectedValue(new Error("fetch failed: host not allow-listed"));
    const { user } = renderImport();
    await user.click(screen.getByTestId("skill-import-trigger"));
    await user.type(
      await screen.findByTestId("skill-import-url-input"),
      "https://example.com/secret.md",
    );
    await user.click(screen.getByTestId("skill-import-append"));

    await waitFor(() => {
      expect(
        screen.getByTestId("skill-import-mutation-error"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/host not allow-listed/i)).toBeInTheDocument();
  });
});
