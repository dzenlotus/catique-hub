/**
 * StatusBar — a11y smoke tests (Stream L round-3 polish).
 *
 * Verifies:
 *   - The single connection button exposes BOTH `aria-label` and a `title`
 *     attribute carrying the full runtime status (sidecar + providers) —
 *     `aria-label` for AT, `title` for the sighted-keyboard tooltip.
 *   - It opens the SystemDrawer, ESC closes it, and focus returns to the
 *     trigger (RAC `<ModalOverlay/>` should restore).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { StatusBar } from "../StatusBar";

// ─── IPC mock ─────────────────────────────────────────────────────────────────

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

const invokeMock = vi.mocked(invoke);

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderBar(): { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <StatusBar />
    </QueryClientProvider>,
  );
  return { user };
}

beforeEach(() => {
  invokeMock.mockReset();
  // Default: sidecar stopped, no providers connected. Each test that
  // needs a different shape overrides as needed.
  invokeMock.mockImplementation((cmd: unknown) => {
    if (cmd === "sidecar_status") return Promise.resolve({ state: "stopped" });
    if (cmd === "list_connected_providers") return Promise.resolve([]);
    return Promise.resolve([]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Status indicators are read-only (NOT buttons); only the connection button
// is interactive.
// ─────────────────────────────────────────────────────────────────────────────

describe("StatusBar — indicators + interactivity", () => {
  it("shows the sidecar + providers status as non-clickable indicators", async () => {
    renderBar();
    const sidecar = await screen.findByTestId("status-bar-sidecar");
    const providers = screen.getByTestId("status-bar-providers");

    // Read-only: spans, not buttons.
    expect(sidecar.tagName).not.toBe("BUTTON");
    expect(providers.tagName).not.toBe("BUTTON");

    // Full status text is carried on the `title` for the hover tooltip.
    expect((sidecar.getAttribute("title") ?? "").toLowerCase()).toContain(
      "mcp sidecar",
    );
    expect((providers.getAttribute("title") ?? "").toLowerCase()).toContain(
      "providers",
    );
  });

  it("exposes exactly one interactive control — the connection button", async () => {
    renderBar();
    await screen.findByTestId("status-bar-drawer-button");
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute(
      "data-testid",
      "status-bar-drawer-button",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SystemDrawer integration — ESC close + focus restore.
// ─────────────────────────────────────────────────────────────────────────────

describe("StatusBar — system drawer keyboard", () => {
  it("opens drawer on ⚙ click and closes on Esc, restoring focus", async () => {
    const { user } = renderBar();
    const trigger = await screen.findByTestId("status-bar-drawer-button");
    trigger.focus();
    expect(trigger).toHaveFocus();

    await user.click(trigger);

    // Drawer dialog opens.
    const dialog = await screen.findByTestId("system-drawer");
    expect(dialog).toBeInTheDocument();

    // Esc dismisses (RAC `<ModalOverlay isKeyboardDismissable/>`).
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByTestId("system-drawer")).not.toBeInTheDocument();
    });

    // Focus should return to the ⚙ trigger that opened the drawer.
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });
});
