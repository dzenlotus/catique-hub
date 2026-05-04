import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import type { Skill } from "@entities/skill";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import { SkillsList } from "./SkillsList";

const invokeMock = vi.mocked(invoke);

function renderWithClient(ui: ReactElement): {
  client: QueryClient;
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
  return { client, user };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-1",
    name: "TypeScript",
    description: null,
    color: null,
    position: 0,
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

describe("SkillsList", () => {
  it("renders 3 skeleton cards while loading", () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    renderWithClient(<SkillsList />);
    const skeletons = screen.getAllByTestId("skill-card-skeleton");
    expect(skeletons).toHaveLength(3);
  });

  it("shows the create header button always (loading state)", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<SkillsList />);
    expect(screen.getByTestId("skills-list-create-button")).toBeInTheDocument();
  });

  it("renders the loading grid container while pending", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<SkillsList />);
    expect(screen.getByTestId("skills-list-loading")).toBeInTheDocument();
  });

  it("shows the empty state when the list is empty", async () => {
    invokeMock.mockResolvedValue([] satisfies Skill[]);
    renderWithClient(<SkillsList />);
    await waitFor(() => {
      expect(screen.getByTestId("skills-list-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/no skills yet/i)).toBeInTheDocument();
  });

  it("renders one SkillCard per skill when populated", async () => {
    invokeMock.mockResolvedValue([
      makeSkill({ id: "skill-1", name: "TypeScript" }),
      makeSkill({ id: "skill-2", name: "React" }),
      makeSkill({ id: "skill-3", name: "Rust" }),
    ] satisfies Skill[]);
    renderWithClient(<SkillsList />);
    await waitFor(() => {
      expect(screen.getByTestId("skills-list-grid")).toBeInTheDocument();
    });
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("Rust")).toBeInTheDocument();
  });

  it("shows an inline error with retry when the query fails", async () => {
    invokeMock.mockRejectedValue(new Error("transport down"));
    renderWithClient(<SkillsList />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/transport down/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("calls onSelectSkill with the skill id when a card is activated", async () => {
    invokeMock.mockResolvedValue([
      makeSkill({ id: "skill-pick", name: "Pick me" }),
    ] satisfies Skill[]);
    const onSelectSkill = vi.fn();
    const { user } = renderWithClient(
      <SkillsList onSelectSkill={onSelectSkill} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("skills-list-grid")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Pick me"));
    expect(onSelectSkill).toHaveBeenCalledWith("skill-pick");
  });

  it("opens SkillCreateDialog when the create button is clicked", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_skills") return [];
      return new Promise(() => {});
    });
    const { user } = renderWithClient(<SkillsList />);
    await waitFor(() => {
      expect(screen.getByTestId("skills-list-empty")).toBeInTheDocument();
    });
    const createBtn = screen.getByTestId("skills-list-create-button");
    await user.click(createBtn);
    // Dialog should open (the name input appears in the DOM)
    await waitFor(() => {
      expect(
        screen.getByTestId("skill-create-dialog-name-input"),
      ).toBeInTheDocument();
    });
  });

  it("clicking a card opens SkillEditor", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_skills")
        return [makeSkill({ id: "skill-editor-test", name: "Go" })];
      if (cmd === "get_skill") return makeSkill({ id: "skill-editor-test", name: "Go" });
      return new Promise(() => {});
    });
    const { user } = renderWithClient(<SkillsList />);
    await waitFor(() => {
      expect(screen.getByTestId("skills-list-grid")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Go"));
    await waitFor(() => {
      expect(screen.getByTestId("skill-editor")).toBeInTheDocument();
    });
  });
});
