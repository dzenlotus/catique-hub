import { describe, expect, it } from "vitest";

import { routes, boardPath, pathForView, viewForPath } from "./routes";
import type { NavView } from "@widgets/sidebar";

// ---------------------------------------------------------------------------
// All nav views for round-trip coverage
// ---------------------------------------------------------------------------

const ALL_VIEWS: NavView[] = [
  "boards",
  "prompts",
  "prompt-groups",
  "roles",
  "tags",
  "reports",
  "skills",
  "mcp-tools",
  "spaces",
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

  it("maps prompt-groups → /prompt-groups", () => {
    expect(pathForView("prompt-groups")).toBe("/prompt-groups");
  });

  it("maps roles → /roles", () => {
    expect(pathForView("roles")).toBe("/roles");
  });

  it("maps tags → /tags", () => {
    expect(pathForView("tags")).toBe("/tags");
  });

  it("maps reports → /reports", () => {
    expect(pathForView("reports")).toBe("/reports");
  });

  it("maps skills → /skills", () => {
    expect(pathForView("skills")).toBe("/skills");
  });

  it("maps mcp-tools → /mcp-tools", () => {
    expect(pathForView("mcp-tools")).toBe("/mcp-tools");
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

  it("maps /prompt-groups → prompt-groups", () => {
    expect(viewForPath("/prompt-groups")).toBe("prompt-groups");
  });

  it("maps /roles → roles", () => {
    expect(viewForPath("/roles")).toBe("roles");
  });

  it("maps /tags → tags", () => {
    expect(viewForPath("/tags")).toBe("tags");
  });

  it("maps /reports → reports", () => {
    expect(viewForPath("/reports")).toBe("reports");
  });

  it("maps /skills → skills", () => {
    expect(viewForPath("/skills")).toBe("skills");
  });

  it("maps /mcp-tools → mcp-tools", () => {
    expect(viewForPath("/mcp-tools")).toBe("mcp-tools");
  });

  it("maps /spaces → spaces", () => {
    expect(viewForPath("/spaces")).toBe("spaces");
  });

  it("maps /settings → settings", () => {
    expect(viewForPath("/settings")).toBe("settings");
  });

  it("falls back to boards for unknown paths", () => {
    expect(viewForPath("/unknown")).toBe("boards");
    expect(viewForPath("/some/deep/path")).toBe("boards");
  });

  // Round-trip: pathForView(view) → viewForPath → same view (excluding board detail which maps back to boards)
  it.each(ALL_VIEWS)(
    "round-trip: viewForPath(pathForView('%s')) === '%s'",
    (view) => {
      const path = pathForView(view);
      expect(viewForPath(path)).toBe(view);
    },
  );
});
