import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { ToastProvider } from "@app/providers/ToastProvider";

// SettingsTokensView (rendered inside SettingsView) calls usePrompts(), which
// issues IPC via @shared/api. Mock at that boundary so the test suite doesn't
// require a live Tauri backend.
vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { SettingsView } from "./SettingsView";

const invokeMock = vi.mocked(invoke);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SettingsView />
      </ToastProvider>
    </QueryClientProvider>
  );
  render(ui);
}

/** Default invoke mock: list_prompts never resolves; sidecar_status returns Stopped. */
function setupDefaultInvokeMock(): void {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "sidecar_status") return { state: "stopped" };
    // All other commands (list_prompts etc.) never resolve — keeps those
    // sections in loading state without affecting sidecar tests.
    return new Promise(() => {});
  });
}

beforeEach(() => {
  // Reset data-theme before each test so tests are isolated.
  delete document.documentElement.dataset["theme"];
  invokeMock.mockReset();
  setupDefaultInvokeMock();
});

afterEach(() => {
  delete document.documentElement.dataset["theme"];
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SettingsView", () => {
  it("renders all four section headings", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: /^appearance$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /^tokens$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /^data$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /^about$/i }),
    ).toBeInTheDocument();
  });

  it("Tokens section is rendered (stable testid)", () => {
    setup();
    expect(screen.getByTestId("settings-tokens-section")).toBeInTheDocument();
  });

  it("About section shows the app version string", () => {
    setup();
    const versionEl = screen.getByTestId("app-version");
    // Version should be a non-empty semver-like string.
    expect(versionEl.textContent).toMatch(/\d+\.\d+/);
  });

  it("Appearance section shows 'Dark' when data-theme is not set (default dark)", () => {
    // No data-theme set — readActiveTheme() returns "Dark".
    setup();
    const themeEl = screen.getByTestId("active-theme-name");
    expect(themeEl.textContent).toBe("Dark");
  });

  it("Appearance section shows 'Light' when data-theme='light'", () => {
    document.documentElement.dataset["theme"] = "light";
    setup();
    const themeEl = screen.getByTestId("active-theme-name");
    expect(themeEl.textContent).toBe("Light");
  });

  it("Appearance section shows 'Dark' when data-theme='dark'", () => {
    document.documentElement.dataset["theme"] = "dark";
    setup();
    const themeEl = screen.getByTestId("active-theme-name");
    expect(themeEl.textContent).toBe("Dark");
  });

  it("renders at least one disabled TODO button in the Data section", () => {
    setup();
    const disabledButtons = screen
      .getAllByRole("button")
      .filter(
        (btn) =>
          btn.hasAttribute("disabled") ||
          btn.getAttribute("aria-disabled") === "true",
      );
    expect(disabledButtons.length).toBeGreaterThanOrEqual(1);
    // At least one of them mentions TODO.
    const todoButton = disabledButtons.find((btn) =>
      /TODO/i.test(btn.textContent ?? ""),
    );
    expect(todoButton).toBeDefined();
  });

  it("Appearance section contains hint about the sidebar toggle", () => {
    setup();
    expect(screen.getByText(/sidebar/i)).toBeInTheDocument();
  });

  it("About section mentions Elastic-2.0 license", () => {
    setup();
    expect(screen.getByText(/Elastic-2\.0/)).toBeInTheDocument();
  });

  // ── Profile section ────────────────────────────────────────────────

  it("Profile section renders with the heading 'Profile'", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: /^profile$/i }),
    ).toBeInTheDocument();
  });

  it("Profile avatar shows the initial 'M'", () => {
    setup();
    const avatar = screen.getByTestId("settings-view-profile-avatar");
    expect(avatar.textContent).toBe("M");
  });

  it("Profile name input has the value 'Maintainer' and is disabled", () => {
    setup();
    const nameInput = screen.getByTestId("settings-view-profile-name-input");
    expect(nameInput).toHaveValue("Maintainer");
    expect(nameInput).toBeDisabled();
  });

  // ── MCP Sidecar section (ADR-0002 spike ctq-56) ───────────────────────

  it("MCP Sidecar section renders with heading", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: /mcp sidecar/i }),
    ).toBeInTheDocument();
  });

  it("shows Stopped pill when sidecar_status returns stopped", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "sidecar_status") return { state: "stopped" };
      return new Promise(() => {});
    });
    setup();
    await waitFor(() => {
      expect(screen.getByTestId("sidecar-status-pill")).toHaveTextContent(/stopped/i);
    });
  });

  it("shows Running pill with pid when sidecar_status returns running", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "sidecar_status") return { state: "running", pid: 42 };
      return new Promise(() => {});
    });
    setup();
    await waitFor(() => {
      expect(screen.getByTestId("sidecar-status-pill")).toHaveTextContent(/running/i);
      expect(screen.getByTestId("sidecar-status-pill")).toHaveTextContent("42");
    });
  });

  it("shows Starting pill when sidecar_status returns starting", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "sidecar_status") return { state: "starting" };
      return new Promise(() => {});
    });
    setup();
    await waitFor(() => {
      expect(screen.getByTestId("sidecar-status-pill")).toHaveTextContent(/starting/i);
    });
  });

  it("shows Crashed pill with exit code when sidecar_status returns crashed", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "sidecar_status") return { state: "crashed", exitCode: 1 };
      return new Promise(() => {});
    });
    setup();
    await waitFor(() => {
      expect(screen.getByTestId("sidecar-status-pill")).toHaveTextContent(/crashed/i);
      expect(screen.getByTestId("sidecar-status-pill")).toHaveTextContent("1");
    });
  });

  it("restart button calls sidecar_restart IPC", async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "sidecar_status") return { state: "stopped" };
      if (command === "sidecar_restart") return undefined;
      return new Promise(() => {});
    });
    setup();
    const btn = screen.getByTestId("sidecar-restart-button");
    await user.click(btn);
    expect(invokeMock).toHaveBeenCalledWith("sidecar_restart");
  });
});
