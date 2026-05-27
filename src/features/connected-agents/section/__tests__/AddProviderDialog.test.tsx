/**
 * AddProviderDialog — round-21 unit tests.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

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
import { AddProviderDialog } from "../AddProviderDialog";

const invokeMock = vi.mocked(invoke);

function renderDialog(props: {
  isOpen: boolean;
  onClose: () => void;
}): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <AddProviderDialog {...props} />
    </QueryClientProvider>
  );
  render(ui);
}

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AddProviderDialog", () => {
  it("does not render content when closed", () => {
    invokeMock.mockResolvedValue([]);
    renderDialog({ isOpen: false, onClose: () => undefined });
    expect(screen.queryByTestId("add-provider-dialog")).not.toBeInTheDocument();
  });

  it("renders the supported list when open", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_supported_providers") {
        return Promise.resolve([
          { id: "claude-code", displayName: "Claude Code" },
          { id: "cursor", displayName: "Cursor" },
        ]);
      }
      if (cmd === "list_connected_providers") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    renderDialog({ isOpen: true, onClose: () => undefined });
    await waitFor(() => {
      expect(
        screen.getByTestId("add-provider-dialog-listbox"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("add-provider-dialog-option-claude-code"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("add-provider-dialog-option-cursor"),
    ).toBeInTheDocument();
  });

  it("filters out providers that are already connected", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_supported_providers") {
        return Promise.resolve([
          { id: "claude-code", displayName: "Claude Code" },
          { id: "cursor", displayName: "Cursor" },
        ]);
      }
      if (cmd === "list_connected_providers") {
        return Promise.resolve([
          {
            id: "claude-code",
            displayName: "Claude Code",
            configDir: "/x",
            signatureFile: "/x",
            installed: true,
            enabled: true,
            lastSeenAt: 0n,
            supportsRoleSync: true,
          },
        ]);
      }
      return Promise.resolve(undefined);
    });
    renderDialog({ isOpen: true, onClose: () => undefined });
    await waitFor(() => {
      expect(
        screen.getByTestId("add-provider-dialog-option-cursor"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("add-provider-dialog-option-claude-code"),
    ).not.toBeInTheDocument();
  });

  it("disables Add until a provider is selected", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_supported_providers") {
        return Promise.resolve([{ id: "cursor", displayName: "Cursor" }]);
      }
      if (cmd === "list_connected_providers") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    renderDialog({ isOpen: true, onClose: () => undefined });
    const confirm = await screen.findByTestId("add-provider-dialog-confirm");
    expect(confirm).toBeDisabled();
  });

  it("calls add_provider with the selected id and closes on success", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_supported_providers") {
        return Promise.resolve([{ id: "cursor", displayName: "Cursor" }]);
      }
      if (cmd === "list_connected_providers") return Promise.resolve([]);
      if (cmd === "add_provider") {
        return Promise.resolve({
          id: "cursor",
          displayName: "Cursor",
          configDir: "/x",
          signatureFile: "/x",
          installed: true,
          enabled: true,
          lastSeenAt: 0n,
          supportsRoleSync: true,
        });
      }
      return Promise.resolve(undefined);
    });
    const onClose = vi.fn();
    renderDialog({ isOpen: true, onClose });
    const option = await screen.findByTestId(
      "add-provider-dialog-option-cursor",
    );
    await userEvent.click(option);
    const confirm = screen.getByTestId("add-provider-dialog-confirm");
    expect(confirm).not.toBeDisabled();
    await userEvent.click(confirm);
    await waitFor(() => {
      const calls = invokeMock.mock.calls.filter(
        ([cmd]) => cmd === "add_provider",
      );
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]?.[1]).toMatchObject({ providerId: "cursor" });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("Cancel closes without calling add_provider", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_supported_providers") {
        return Promise.resolve([{ id: "cursor", displayName: "Cursor" }]);
      }
      if (cmd === "list_connected_providers") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const onClose = vi.fn();
    renderDialog({ isOpen: true, onClose });
    const cancel = await screen.findByTestId("add-provider-dialog-cancel");
    // RAC's `Button.onPress` listens to PointerEvents in jsdom. fireEvent
    // dispatches a synthetic click that lands inside RAC's press handler
    // chain — `userEvent.click` was occasionally swallowed by the modal's
    // focus scope guard.
    fireEvent.click(cancel);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    const addCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "add_provider",
    );
    expect(addCalls).toHaveLength(0);
  });

  it("shows the all-connected message when supported list is exhausted", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_supported_providers") {
        return Promise.resolve([
          { id: "claude-code", displayName: "Claude Code" },
        ]);
      }
      if (cmd === "list_connected_providers") {
        return Promise.resolve([
          {
            id: "claude-code",
            displayName: "Claude Code",
            configDir: "/x",
            signatureFile: "/x",
            installed: true,
            enabled: true,
            lastSeenAt: 0n,
            supportsRoleSync: true,
          },
        ]);
      }
      return Promise.resolve(undefined);
    });
    renderDialog({ isOpen: true, onClose: () => undefined });
    await waitFor(() => {
      expect(
        screen.getByTestId("add-provider-dialog-all-connected"),
      ).toBeInTheDocument();
    });
  });
});
