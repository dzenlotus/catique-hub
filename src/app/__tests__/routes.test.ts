import { describe, expect, it } from "vitest";

import {
  routes,
  boardPath,
  taskPath,
  pathForView,
  viewForPath,
  mcpServerPath,
  mcpServerToolPath,
  matchBoardSurface,
  matchTaskSurface,
  matchSpaceSettings,
  matchBoardSettings,
  matchRoleSurface,
  matchSkillSurface,
  matchTagSurface,
  matchMcpServerSurface,
} from "../routes";
import type { NavView } from "@widgets/main-sidebar";

// ---------------------------------------------------------------------------
// All nav views for round-trip coverage
// "roles" → "agent-roles", "mcp-tools" → "mcp-servers" (Round 4 rename)
// "tags" and "reports" removed from sidebar nav but routes still exist
// ---------------------------------------------------------------------------

// Round-19e: "spaces" stays in the NavView union for deep-link
// resolution but no longer round-trips through pathForView/viewForPath
// — the standalone /spaces page was retired so /spaces resolves to
// "boards" (sidebar visible, BoardHome content). The list omits it
// from the round-trip table accordingly.
const ALL_VIEWS: NavView[] = [
  "boards",
  "prompts",
  "agent-roles",
  "skills",
  "mcp-servers",
  "settings",
];

// ---------------------------------------------------------------------------
// boardPath helper
// ---------------------------------------------------------------------------

describe("boardPath", () => {
  it("returns /boards/<id>", () => {
    expect(boardPath("abc-123")).toBe("/boards/abc-123");
  });

  it("handles arbitrary id strings", () => {
    expect(boardPath("my-board")).toBe("/boards/my-board");
  });
});

// ---------------------------------------------------------------------------
// taskPath helper
// ---------------------------------------------------------------------------

describe("taskPath", () => {
  it("returns /tasks/<id>", () => {
    expect(taskPath("tsk-1")).toBe("/tasks/tsk-1");
  });

  it("handles arbitrary id strings", () => {
    expect(taskPath("my-task-id")).toBe("/tasks/my-task-id");
  });

  it("route constant has :taskId placeholder", () => {
    expect(routes.task).toBe("/tasks/:taskId");
  });
});

// ---------------------------------------------------------------------------
// mcpServerPath / mcpServerToolPath — round-22 master-detail routes
// ---------------------------------------------------------------------------

describe("mcpServerPath", () => {
  it("returns /mcp-servers/<id>", () => {
    expect(mcpServerPath("srv-1")).toBe("/mcp-servers/srv-1");
  });

  it("route constant has :serverId placeholder", () => {
    expect(routes.mcpServer).toBe("/mcp-servers/:serverId");
  });
});

describe("mcpServerToolPath", () => {
  it("returns /mcp-servers/<serverId>/tools/<toolId>", () => {
    expect(mcpServerToolPath("srv-1", "tool-1")).toBe(
      "/mcp-servers/srv-1/tools/tool-1",
    );
  });

  it("route constant has :serverId and :toolId placeholders", () => {
    expect(routes.mcpServerTool).toBe(
      "/mcp-servers/:serverId/tools/:toolId",
    );
  });
});

// ---------------------------------------------------------------------------
// pathForView — each view has a distinct path
// ---------------------------------------------------------------------------

describe("pathForView", () => {
  it("maps boards → /", () => {
    expect(pathForView("boards")).toBe(routes.boards);
    expect(pathForView("boards")).toBe("/");
  });

  it("maps prompts → /prompts", () => {
    expect(pathForView("prompts")).toBe("/prompts");
  });

  it("maps agent-roles → /roles", () => {
    expect(pathForView("agent-roles")).toBe("/roles");
  });

  it("maps skills → /skills", () => {
    expect(pathForView("skills")).toBe("/skills");
  });

  // PROXY-S6: canonical path was renamed `/mcp-tools` → `/mcp-servers`.
  it("maps mcp-servers → /mcp-servers", () => {
    expect(pathForView("mcp-servers")).toBe("/mcp-servers");
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
// viewForPath — reverse lookup + round-trips
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

  // Round-19c: /prompt-groups was merged into /prompts. The legacy path
  // maps to the new "prompts" view so deep-links keep working.
  it("maps /prompt-groups → prompts (round-19c merge)", () => {
    expect(viewForPath("/prompt-groups")).toBe("prompts");
  });

  it("maps /roles → agent-roles (renamed in Round 4)", () => {
    expect(viewForPath("/roles")).toBe("agent-roles");
  });

  it("maps /skills → skills", () => {
    expect(viewForPath("/skills")).toBe("skills");
  });

  it("maps /mcp-servers → mcp-servers (PROXY-S6 canonical path)", () => {
    expect(viewForPath("/mcp-servers")).toBe("mcp-servers");
  });

  it("maps /mcp-tools → mcp-servers (PROXY-S6 legacy alias)", () => {
    expect(viewForPath("/mcp-tools")).toBe("mcp-servers");
  });

  it("maps /spaces → boards (round-19e: standalone listing retired)", () => {
    expect(viewForPath("/spaces")).toBe("boards");
  });

  it("maps /settings → settings", () => {
    expect(viewForPath("/settings")).toBe("settings");
  });

  it("falls back to boards for unknown paths", () => {
    expect(viewForPath("/unknown")).toBe("boards");
    expect(viewForPath("/some/deep/path")).toBe("boards");
  });

  it("maps /tasks/:id → boards (sidebar stays on boards for task deep-links)", () => {
    expect(viewForPath("/tasks/tsk-1")).toBe("boards");
    expect(viewForPath("/tasks/some-other-id")).toBe("boards");
  });

  // /tags and /reports are no longer in the sidebar but the routes still exist.
  // viewForPath falls back to "boards" for them (they are no longer NavView members).
  it("maps /tags → boards (removed from sidebar nav)", () => {
    expect(viewForPath("/tags")).toBe("boards");
  });

  it("maps /reports → boards (removed from sidebar nav)", () => {
    expect(viewForPath("/reports")).toBe("boards");
  });

  // Round-trip: pathForView(view) → viewForPath → same view
  it.each(ALL_VIEWS)(
    "round-trip: viewForPath(pathForView('%s')) === '%s'",
    (view) => {
      const path = pathForView(view);
      expect(viewForPath(path)).toBe(view);
    },
  );
});

// ---------------------------------------------------------------------------
// Path matchers — compiled from `routes.<x>` patterns
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

describe("matchRoleSurface", () => {
  it("extracts roleId from /roles/:id", () => {
    expect(matchRoleSurface("/roles/rol-1")).toEqual({ roleId: "rol-1" });
  });

  it("returns null for /roles list", () => {
    expect(matchRoleSurface("/roles")).toBeNull();
  });
});

describe("matchSkillSurface", () => {
  it("extracts skillId from /skills/:id", () => {
    expect(matchSkillSurface("/skills/skl-1")).toEqual({ skillId: "skl-1" });
  });

  it("returns null for /skills list", () => {
    expect(matchSkillSurface("/skills")).toBeNull();
  });
});

describe("matchTagSurface", () => {
  it("extracts tagId from /tags/:id", () => {
    expect(matchTagSurface("/tags/tag-1")).toEqual({ tagId: "tag-1" });
  });

  it("returns null for /tags list", () => {
    expect(matchTagSurface("/tags")).toBeNull();
  });
});

describe("matchMcpServerSurface", () => {
  it("extracts serverId from /mcp-servers/:id", () => {
    expect(matchMcpServerSurface("/mcp-servers/srv-1")).toEqual({
      serverId: "srv-1",
    });
  });

  it("extracts serverId from /mcp-servers/:id/tools/:toolId (sub-path)", () => {
    expect(matchMcpServerSurface("/mcp-servers/srv-1/tools/tool-1")).toEqual({
      serverId: "srv-1",
    });
  });

  it("returns null for /mcp-servers list", () => {
    expect(matchMcpServerSurface("/mcp-servers")).toBeNull();
  });
});
