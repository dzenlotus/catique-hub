import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { ToastProvider } from "@shared/lib";

// Cards inside SettingsView issue IPC via @shared/api. Mock at that
// boundary so the test suite doesn't require a live Tauri backend.
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
import { SettingsView } from "../SettingsView";

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

beforeEach(() => {
  // Reset data-theme before each test so tests are isolated.
  delete document.documentElement.dataset["theme"];
  invokeMock.mockReset();
  // Default: every command stays pending so async sections render in
  // their loading state without resolving against a backend.
  invokeMock.mockImplementation(async () => new Promise(() => {}));
});

afterEach(() => {
  delete document.documentElement.dataset["theme"];
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SettingsView", () => {
  it("renders the section headings", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: /^appearance$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /^data$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /^about$/i }),
    ).toBeInTheDocument();
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

  it("Appearance section exposes Light + Dark theme buttons", () => {
    setup();
    expect(
      screen.getByTestId("settings-theme-button-light"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("settings-theme-button-dark"),
    ).toBeInTheDocument();
  });

  it("About section mentions Elastic-2.0 license", () => {
    setup();
    expect(screen.getByText(/Elastic-2\.0/)).toBeInTheDocument();
  });
});
