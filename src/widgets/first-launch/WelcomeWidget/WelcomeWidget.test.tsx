/**
 * WelcomeWidget — render + dialog flows.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
  on: vi.fn(async () => () => undefined),
}));

import { invoke } from "@shared/api";
import { WelcomeWidget } from "./WelcomeWidget";

const invokeMock = vi.mocked(invoke);

function renderWithClient(ui: ReactElement): {
  user: ReturnType<typeof userEvent.setup>;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { user };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("WelcomeWidget", () => {
  it("renders the title, subtitle, and two CTAs", () => {
    renderWithClient(<WelcomeWidget />);
    expect(
      screen.getByRole("heading", { name: /Welcome to Catique HUB/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("welcome-create-space"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("welcome-locate-promptery"),
    ).toBeInTheDocument();
  });

  it("creates a space via the create-space dialog and fires onCreatedSpace", async () => {
    const onCreatedSpace = vi.fn();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "create_space") {
        return { id: "spc-new", name: "Команда A" };
      }
      throw new Error(`unexpected: ${cmd}`);
    });

    const { user } = renderWithClient(
      <WelcomeWidget onCreatedSpace={onCreatedSpace} />,
    );

    await user.click(screen.getByTestId("welcome-create-space"));

    // Dialog is open — fill name + prefix and submit.
    const name = await screen.findByLabelText(/Имя пространства/);
    await user.type(name, "Команда A");
    await user.type(screen.getByLabelText(/Префикс/), "abc");
    await user.click(screen.getByRole("button", { name: /Создать/ }));

    await waitFor(() => {
      expect(onCreatedSpace).toHaveBeenCalledTimes(1);
    });

    const createCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "create_space",
    );
    expect(createCall?.[1]).toEqual({
      name: "Команда A",
      prefix: "abc",
      description: null,
      isDefault: true,
    });
  });

  it("validates the prefix length before calling create_space", async () => {
    const { user } = renderWithClient(<WelcomeWidget />);
    await user.click(screen.getByTestId("welcome-create-space"));

    await user.type(await screen.findByLabelText(/Имя пространства/), "X");
    await user.type(screen.getByLabelText(/Префикс/), "ab"); // too short
    await user.click(screen.getByRole("button", { name: /Создать/ }));

    expect(screen.getByText(/Префикс — ровно 3 буквы/)).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("locate-Promptery dialog reports the picked path through onLocatedPromptery", async () => {
    const onLocated = vi.fn();
    const { user } = renderWithClient(
      <WelcomeWidget onLocatedPromptery={onLocated} />,
    );

    await user.click(screen.getByTestId("welcome-locate-promptery"));

    const pathInput = await screen.findByLabelText(/Путь к Promptery DB/);
    await user.type(pathInput, "/tmp/custom.sqlite");
    await user.click(
      screen.getByRole("button", { name: /Открыть мастер импорта/ }),
    );

    expect(onLocated).toHaveBeenCalledExactlyOnceWith("/tmp/custom.sqlite");
  });
});
