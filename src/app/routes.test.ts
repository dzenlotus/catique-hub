import { describe, expect, it } from "vitest";

import { routes, boardPath, taskPath, pathForView, viewForPath } from "./routes";
import type { NavView } from "@widgets/main-sidebar";

// ---------------------------------------------------------------------------
// All nav views for round-trip coverage
// "roles" → "agent-roles", "mcp-tools" → "mcp-servers" (Round 4 rename)
// Audit-#20: "tags" and "reports" promoted back to first-class sidebar tabs.
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
  "tags",
  "reports",
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

  it("maps mcp-servers → /mcp-tools", () => {
    expect(pathForView("mcp-servers")).toBe("/mcp-tools");
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

  it("maps /mcp-tools → mcp-servers (renamed in Round 4)", () => {
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

  // Audit-#20: tags and reports are first-class sidebar tabs again.
  it("maps /tags → tags (audit-#20)", () => {
    expect(viewForPath("/tags")).toBe("tags");
  });

  it("maps /reports → reports (audit-#20)", () => {
    expect(viewForPath("/reports")).toBe("reports");
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
