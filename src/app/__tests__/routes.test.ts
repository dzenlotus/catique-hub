import { describe, expect, it } from "vitest";

import {
  routes,
  boardPath,
  spaceBoardPath,
  spaceBoardSettingsPath,
  spacePath,
  agentPath,
  integrationPath,
  integrationToolPath,
  taskPath,
  pathForView,
  viewForPath,
  mcpServerPath,
  mcpServerToolPath,
  matchBoardSurface,
  matchTaskSurface,
  matchSpaceSurface,
  matchSpaceSettings,
  matchSpaceBoardSurface,
  matchSpaceBoardSettings,
  matchBoardSettings,
  matchAgentSurface,
  matchRoleSurface,
  matchSkillSurface,
  matchTagSurface,
  matchIntegrationSurface,
  matchMcpServerSurface,
} from "../routes";
import type { NavView } from "@widgets/main-sidebar";

// ---------------------------------------------------------------------------
// All nav views for round-trip coverage.
// v3 rename: pathForView("agent-roles") → "/agents",
//            pathForView("mcp-servers") → "/integrations".
// Internal NavView identifiers stay as-is; only the URL surface migrated.
// ---------------------------------------------------------------------------

const ALL_VIEWS: NavView[] = [
  "boards",
  "prompts",
  "agent-roles",
  "skills",
  "mcp-servers",
  "settings",
];

// ---------------------------------------------------------------------------
// boardPath helper (legacy)
// ---------------------------------------------------------------------------

describe("boardPath (legacy)", () => {
  it("returns /boards/<id>", () => {
    expect(boardPath("abc-123")).toBe("/boards/abc-123");
  });
});

// ---------------------------------------------------------------------------
// spaceBoardPath helper (v3 canonical)
// ---------------------------------------------------------------------------

describe("spaceBoardPath", () => {
  it("returns /spaces/<spaceId>/boards/<boardId>", () => {
    expect(spaceBoardPath("sp-1", "brd-1")).toBe("/spaces/sp-1/boards/brd-1");
  });

  it("returns settings sub-path via spaceBoardSettingsPath", () => {
    expect(spaceBoardSettingsPath("sp-1", "brd-1")).toBe(
      "/spaces/sp-1/boards/brd-1/settings",
    );
  });
});

// ---------------------------------------------------------------------------
// spacePath helper (v3 day-screen)
// ---------------------------------------------------------------------------

describe("spacePath", () => {
  it("returns /spaces/<spaceId>", () => {
    expect(spacePath("sp-1")).toBe("/spaces/sp-1");
  });

  it("route constant has :spaceId placeholder", () => {
    expect(routes.space).toBe("/spaces/:spaceId");
  });
});

// ---------------------------------------------------------------------------
// agentPath / integrationPath — v3 canonical helpers
// ---------------------------------------------------------------------------

describe("agentPath", () => {
  it("returns /agents/<id>", () => {
    expect(agentPath("a-1")).toBe("/agents/a-1");
  });

  it("route constant has :agentId placeholder", () => {
    expect(routes.agent).toBe("/agents/:agentId");
  });
});

describe("integrationPath / integrationToolPath", () => {
  it("returns /integrations/<id>", () => {
    expect(integrationPath("srv-1")).toBe("/integrations/srv-1");
  });

  it("returns /integrations/<srv>/tools/<tool>", () => {
    expect(integrationToolPath("srv-1", "tool-1")).toBe(
      "/integrations/srv-1/tools/tool-1",
    );
  });
});

// ---------------------------------------------------------------------------
// taskPath helper
// ---------------------------------------------------------------------------

describe("taskPath", () => {
  it("returns /tasks/<id>", () => {
    expect(taskPath("tsk-1")).toBe("/tasks/tsk-1");
  });

  it("route constant has :taskId placeholder", () => {
    expect(routes.task).toBe("/tasks/:taskId");
  });
});

// ---------------------------------------------------------------------------
// mcpServerPath / mcpServerToolPath — legacy helpers (still callable)
// ---------------------------------------------------------------------------

describe("mcpServerPath (legacy)", () => {
  it("returns /mcp-servers/<id>", () => {
    expect(mcpServerPath("srv-1")).toBe("/mcp-servers/srv-1");
  });

  it("route constant has :serverId placeholder", () => {
    expect(routes.mcpServer).toBe("/mcp-servers/:serverId");
  });
});

describe("mcpServerToolPath (legacy)", () => {
  it("returns /mcp-servers/<serverId>/tools/<toolId>", () => {
    expect(mcpServerToolPath("srv-1", "tool-1")).toBe(
      "/mcp-servers/srv-1/tools/tool-1",
    );
  });
});

// ---------------------------------------------------------------------------
// pathForView — each view has a distinct canonical (v3) path
// ---------------------------------------------------------------------------

describe("pathForView", () => {
  it("maps boards → /", () => {
    expect(pathForView("boards")).toBe(routes.boards);
    expect(pathForView("boards")).toBe("/");
  });

  it("maps prompts → /prompts", () => {
    expect(pathForView("prompts")).toBe("/prompts");
  });

  it("maps agent-roles → /agents (v3 canonical)", () => {
    expect(pathForView("agent-roles")).toBe("/agents");
  });

  it("maps skills → /skills", () => {
    expect(pathForView("skills")).toBe("/skills");
  });

  it("maps mcp-servers → /integrations (v3 canonical)", () => {
    expect(pathForView("mcp-servers")).toBe("/integrations");
  });

  it("maps spaces → /spaces", () => {
    expect(pathForView("spaces")).toBe("/spaces");
  });

  it("maps settings → /settings", () => {
    expect(pathForView("settings")).toBe("/settings");
  });

  it("all views produce unique paths", () => {
    const paths = ALL_VIEWS.map(pathForView);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });
});

// ---------------------------------------------------------------------------
// viewForPath — reverse lookup + round-trips (legacy paths still resolve)
// ---------------------------------------------------------------------------

describe("viewForPath", () => {
  it("maps / → boards", () => {
    expect(viewForPath("/")).toBe("boards");
  });

  it("maps empty string → boards", () => {
    expect(viewForPath("")).toBe("boards");
  });

  it("maps /boards/:id → boards (sidebar highlight)", () => {
    expect(viewForPath("/boards/some-id")).toBe("boards");
  });

  it("maps /prompts → prompts", () => {
    expect(viewForPath("/prompts")).toBe("prompts");
  });

  it("maps /prompt-groups → prompts (round-19c merge)", () => {
    expect(viewForPath("/prompt-groups")).toBe("prompts");
  });

  it("maps /agents → agent-roles (v3 canonical)", () => {
    expect(viewForPath("/agents")).toBe("agent-roles");
  });

  it("maps /agents/:id → agent-roles", () => {
    expect(viewForPath("/agents/a-1")).toBe("agent-roles");
  });

  it("maps /roles → agent-roles (legacy alias still resolves)", () => {
    expect(viewForPath("/roles")).toBe("agent-roles");
  });

  it("maps /skills → skills", () => {
    expect(viewForPath("/skills")).toBe("skills");
  });

  it("maps /integrations → mcp-servers (v3 canonical)", () => {
    expect(viewForPath("/integrations")).toBe("mcp-servers");
  });

  it("maps /integrations/:id → mcp-servers", () => {
    expect(viewForPath("/integrations/srv-1")).toBe("mcp-servers");
  });

  it("maps /mcp-servers → mcp-servers (legacy alias)", () => {
    expect(viewForPath("/mcp-servers")).toBe("mcp-servers");
  });

  it("maps /mcp-tools → mcp-servers (legacy alias)", () => {
    expect(viewForPath("/mcp-tools")).toBe("mcp-servers");
  });

  it("maps /spaces → boards", () => {
    expect(viewForPath("/spaces")).toBe("boards");
  });

  it("maps /spaces/:id → boards (v3 day-screen surfaces under boards)", () => {
    expect(viewForPath("/spaces/sp-1")).toBe("boards");
  });

  it("maps /spaces/:id/boards/:bid → boards (v3 canonical board URL)", () => {
    expect(viewForPath("/spaces/sp-1/boards/brd-1")).toBe("boards");
  });

  it("maps /settings → settings", () => {
    expect(viewForPath("/settings")).toBe("settings");
  });

  it("falls back to boards for unknown paths", () => {
    expect(viewForPath("/unknown")).toBe("boards");
    expect(viewForPath("/some/deep/path")).toBe("boards");
  });

  it("maps /tasks/:id → boards (sidebar stays on boards)", () => {
    expect(viewForPath("/tasks/tsk-1")).toBe("boards");
  });

  it("maps /tags → boards", () => {
    expect(viewForPath("/tags")).toBe("boards");
  });

  it("maps /reports → boards", () => {
    expect(viewForPath("/reports")).toBe("boards");
  });

  it.each(ALL_VIEWS)(
    "round-trip: viewForPath(pathForView('%s')) === '%s'",
    (view) => {
      const path = pathForView(view);
      expect(viewForPath(path)).toBe(view);
    },
  );
});

// ---------------------------------------------------------------------------
// Path matchers
// ---------------------------------------------------------------------------

describe("matchBoardSurface", () => {
  it("extracts boardId from /boards/:id", () => {
    expect(matchBoardSurface("/boards/brd-1")).toEqual({ boardId: "brd-1" });
  });

  it("extracts boardId from /boards/:id/settings (sub-path)", () => {
    expect(matchBoardSurface("/boards/brd-1/settings")).toEqual({
      boardId: "brd-1",
    });
  });

  it("returns null on a miss", () => {
    expect(matchBoardSurface("/prompts")).toBeNull();
    expect(matchBoardSurface("/")).toBeNull();
    expect(matchBoardSurface("")).toBeNull();
  });
});

describe("matchTaskSurface", () => {
  it("extracts taskId from /tasks/:id", () => {
    expect(matchTaskSurface("/tasks/tsk-1")).toEqual({ taskId: "tsk-1" });
  });

  it("returns null on a miss", () => {
    expect(matchTaskSurface("/boards/brd-1")).toBeNull();
  });
});

describe("matchSpaceSurface", () => {
  it("extracts spaceId from /spaces/:id", () => {
    expect(matchSpaceSurface("/spaces/sp-1")).toEqual({ spaceId: "sp-1" });
  });

  it("extracts spaceId from /spaces/:id/boards/... (sub-path)", () => {
    expect(matchSpaceSurface("/spaces/sp-1/boards/brd-1")).toEqual({
      spaceId: "sp-1",
    });
  });

  it("returns null for /spaces (no id)", () => {
    expect(matchSpaceSurface("/spaces")).toBeNull();
  });
});

describe("matchSpaceSettings", () => {
  it("extracts spaceId from /spaces/:id/settings", () => {
    expect(matchSpaceSettings("/spaces/spc-1/settings")).toEqual({
      spaceId: "spc-1",
    });
  });

  it("does not match /spaces (list view)", () => {
    expect(matchSpaceSettings("/spaces")).toBeNull();
  });
});

describe("matchSpaceBoardSurface", () => {
  it("extracts both ids from /spaces/:id/boards/:bid", () => {
    expect(matchSpaceBoardSurface("/spaces/sp-1/boards/brd-1")).toEqual({
      spaceId: "sp-1",
      boardId: "brd-1",
    });
  });

  it("extracts ids from the settings sub-path too", () => {
    expect(
      matchSpaceBoardSurface("/spaces/sp-1/boards/brd-1/settings"),
    ).toEqual({ spaceId: "sp-1", boardId: "brd-1" });
  });

  it("returns null for /spaces/:id alone", () => {
    expect(matchSpaceBoardSurface("/spaces/sp-1")).toBeNull();
  });
});

describe("matchSpaceBoardSettings", () => {
  it("extracts both ids from .../boards/:bid/settings", () => {
    expect(
      matchSpaceBoardSettings("/spaces/sp-1/boards/brd-1/settings"),
    ).toEqual({ spaceId: "sp-1", boardId: "brd-1" });
  });

  it("does not match the bare board URL", () => {
    expect(matchSpaceBoardSettings("/spaces/sp-1/boards/brd-1")).toBeNull();
  });
});

describe("matchBoardSettings", () => {
  it("extracts boardId from /boards/:id/settings", () => {
    expect(matchBoardSettings("/boards/brd-1/settings")).toEqual({
      boardId: "brd-1",
    });
  });

  it("does not match /boards/:id (no settings suffix)", () => {
    expect(matchBoardSettings("/boards/brd-1")).toBeNull();
  });
});

describe("matchAgentSurface", () => {
  it("extracts agentId from /agents/:id", () => {
    expect(matchAgentSurface("/agents/a-1")).toEqual({ agentId: "a-1" });
  });

  it("returns null for /agents list", () => {
    expect(matchAgentSurface("/agents")).toBeNull();
  });
});

describe("matchRoleSurface (legacy)", () => {
  it("extracts roleId from /roles/:id", () => {
    expect(matchRoleSurface("/roles/rol-1")).toEqual({ roleId: "rol-1" });
  });
});

describe("matchSkillSurface", () => {
  it("extracts skillId from /skills/:id", () => {
    expect(matchSkillSurface("/skills/skl-1")).toEqual({ skillId: "skl-1" });
  });
});

describe("matchTagSurface", () => {
  it("extracts tagId from /tags/:id", () => {
    expect(matchTagSurface("/tags/tag-1")).toEqual({ tagId: "tag-1" });
  });
});

describe("matchIntegrationSurface", () => {
  it("extracts serverId from /integrations/:id", () => {
    expect(matchIntegrationSurface("/integrations/srv-1")).toEqual({
      serverId: "srv-1",
    });
  });

  it("extracts serverId from /integrations/:id/tools/:toolId", () => {
    expect(
      matchIntegrationSurface("/integrations/srv-1/tools/tool-1"),
    ).toEqual({ serverId: "srv-1" });
  });

  it("returns null for /integrations list", () => {
    expect(matchIntegrationSurface("/integrations")).toBeNull();
  });
});

describe("matchMcpServerSurface (legacy)", () => {
  it("extracts serverId from /mcp-servers/:id", () => {
    expect(matchMcpServerSurface("/mcp-servers/srv-1")).toEqual({
      serverId: "srv-1",
    });
  });

  it("returns null for /mcp-servers list", () => {
    expect(matchMcpServerSurface("/mcp-servers")).toBeNull();
  });
});
