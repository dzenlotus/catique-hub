import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsView } from "./SettingsView";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(): void {
  render(<SettingsView />);
}

beforeEach(() => {
  // Reset data-theme before each test so tests are isolated.
  delete document.documentElement.dataset["theme"];
});

afterEach(() => {
  delete document.documentElement.dataset["theme"];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SettingsView", () => {
  it("renders all three section headings", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: /внешний вид/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /данные/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /о приложении/i }),
    ).toBeInTheDocument();
  });

  it("About section shows the app version string", () => {
    setup();
    const versionEl = screen.getByTestId("app-version");
    // Version should be a non-empty semver-like string.
    expect(versionEl.textContent).toMatch(/\d+\.\d+/);
  });

  it("Appearance section shows 'Тёмная' when data-theme is not set (default dark)", () => {
    // No data-theme set — readActiveTheme() returns "Тёмная".
    setup();
    const themeEl = screen.getByTestId("active-theme-name");
    expect(themeEl.textContent).toBe("Тёмная");
  });

  it("Appearance section shows 'Светлая' when data-theme='light'", () => {
    document.documentElement.dataset["theme"] = "light";
    setup();
    const themeEl = screen.getByTestId("active-theme-name");
    expect(themeEl.textContent).toBe("Светлая");
  });

  it("Appearance section shows 'Тёмная' when data-theme='dark'", () => {
    document.documentElement.dataset["theme"] = "dark";
    setup();
    const themeEl = screen.getByTestId("active-theme-name");
    expect(themeEl.textContent).toBe("Тёмная");
  });

  it("renders at least one disabled TODO button in the Data section", () => {
    setup();
    const disabledButtons = screen
      .getAllByRole("button")
      .filter((btn) => btn.hasAttribute("disabled") || btn.getAttribute("aria-disabled") === "true");
    expect(disabledButtons.length).toBeGreaterThanOrEqual(1);
    // At least one of them mentions TODO.
    const todoButton = disabledButtons.find((btn) =>
      /TODO/i.test(btn.textContent ?? ""),
    );
    expect(todoButton).toBeDefined();
  });

  it("Appearance section contains hint about the sidebar toggle", () => {
    setup();
    expect(screen.getByText(/боковой панели/i)).toBeInTheDocument();
  });

  it("About section mentions Elastic-2.0 license", () => {
    setup();
    expect(screen.getByText(/Elastic-2\.0/)).toBeInTheDocument();
  });
});
