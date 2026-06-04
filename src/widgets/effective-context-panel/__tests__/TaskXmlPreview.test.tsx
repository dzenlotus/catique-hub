/**
 * TaskXmlPreview — XML rendering + reactive token chip tests (Task B7).
 *
 * Coverage:
 *   1. Prompts are INLINED (content + examples) inside `<prompts>`.
 *   2. Skills + MCP tools are rendered as REFERENCES only (self-closing
 *      tags, no body) inside `<skills>` / `<mcp-tools>`.
 *   3. The token chip sums ONLY the prompts' tokenCount (skills/tools
 *      excluded) and tolerates both bigint and number inputs.
 *   4. "— tokens" is shown when no prompt carries a count.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PromptWithOrigin } from "@bindings/PromptWithOrigin";
import type { SkillWithOrigin } from "@bindings/SkillWithOrigin";
import type { McpToolWithOrigin } from "@bindings/McpToolWithOrigin";

import { TaskXmlPreview, sumPromptTokenCount } from "../TaskXmlPreview";

function promptRow(
  id: string,
  name: string,
  tokenCount: bigint | number | null,
  origin: PromptWithOrigin["origin"] = { kind: "direct" },
): PromptWithOrigin {
  return {
    prompt: {
      id,
      name,
      content: `Body of ${name}`,
      color: null,
      shortDescription: null,
      icon: null,
      examples: [`Example for ${name}`],
      // The component must tolerate number even though the binding type
      // is bigint | null (Tauri can land i64 as a JS number).
      tokenCount: tokenCount as bigint | null,
      createdAt: 0n,
      updatedAt: 0n,
    },
    origin,
    overridden: false,
  };
}

function skillRow(id: string, name: string): SkillWithOrigin {
  return {
    skill: {
      id,
      name,
      description: null,
      color: null,
      position: 0,
      createdAt: 0n,
      updatedAt: 0n,
    },
    origin: { kind: "role", id: "rol-1" },
    overridden: false,
  };
}

function toolRow(id: string, name: string): McpToolWithOrigin {
  return {
    mcpTool: {
      id,
      name,
      description: null,
      schemaJson: "{}",
      color: null,
      position: 0,
      serverId: null,
      upstreamName: null,
      source: "manual",
      lastSyncedAt: null,
      createdAt: 0n,
      updatedAt: 0n,
    },
    origin: { kind: "board", id: "brd-1" },
    overridden: false,
  };
}

describe("TaskXmlPreview", () => {
  it("inlines prompt content + examples and references skills/tools", () => {
    render(
      <TaskXmlPreview
        prompts={[promptRow("prm-1", "Greeter", 10n)]}
        skills={[skillRow("skl-1", "Researcher")]}
        mcpTools={[toolRow("tool-1", "Fetcher")]}
      />,
    );

    const body = screen.getByTestId("task-xml-preview-body");
    const xml = body.textContent ?? "";

    // Prompt is inlined.
    expect(xml).toContain("<prompts>");
    expect(xml).toContain('<prompt name="Greeter"');
    expect(xml).toContain("Body of Greeter");
    expect(xml).toContain("<example index=\"0\">");
    expect(xml).toContain("Example for Greeter");

    // Skills are references only — no body, no description text.
    expect(xml).toContain("<skills>");
    expect(xml).toContain('<skill id="skl-1" name="Researcher"');
    expect(xml).toContain("/>");

    // MCP tools are references only.
    expect(xml).toContain("<mcp-tools>");
    expect(xml).toContain('<mcp-tool id="tool-1" name="Fetcher"');
  });

  it("sums only the prompts' tokenCount in the chip (bigint + number)", () => {
    render(
      <TaskXmlPreview
        prompts={[
          promptRow("prm-1", "A", 10n),
          // number form — must be normalised to bigint.
          promptRow("prm-2", "B", 5),
        ]}
        skills={[skillRow("skl-1", "S")]}
        mcpTools={[toolRow("tool-1", "T")]}
      />,
    );

    expect(
      screen.getByTestId("task-xml-preview-total-tokens").textContent,
    ).toContain("15");
  });

  it("shows an em-dash when no prompt carries a token count", () => {
    render(
      <TaskXmlPreview
        prompts={[promptRow("prm-1", "A", null)]}
        skills={[]}
        mcpTools={[]}
      />,
    );

    expect(
      screen.getByTestId("task-xml-preview-total-tokens").textContent,
    ).toBe("— tokens");
  });

  it("sumPromptTokenCount returns '— tokens' for an empty list", () => {
    expect(sumPromptTokenCount([])).toBe("— tokens");
  });

  it("renders an empty hint when the bundle is empty", () => {
    render(<TaskXmlPreview prompts={[]} skills={[]} mcpTools={[]} />);
    expect(
      screen.queryByTestId("task-xml-preview-body"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("task-xml-preview-column")).toBeInTheDocument();
  });

  // ── <task> block (the task itself leads the prompt) ────────────────

  it("renders a leading <task> block with title + description", () => {
    render(
      <TaskXmlPreview
        taskTitle="Ship the preview"
        taskDescription="Wire the **draft** store"
        prompts={[promptRow("prm-1", "Greeter", 10n)]}
        skills={[]}
        mcpTools={[]}
      />,
    );

    const xml = screen.getByTestId("task-xml-preview-body").textContent ?? "";
    expect(xml).toContain('<task title="Ship the preview">');
    expect(xml).toContain("<description>");
    expect(xml).toContain("Wire the **draft** store");
    // The task block leads the prompt block.
    expect(xml.indexOf("<task")).toBeLessThan(xml.indexOf("<prompts>"));
  });

  it("omits <description> when the task description is empty", () => {
    render(
      <TaskXmlPreview
        taskTitle="Title only"
        taskDescription=""
        prompts={[]}
        skills={[]}
        mcpTools={[]}
      />,
    );

    const xml = screen.getByTestId("task-xml-preview-body").textContent ?? "";
    expect(xml).toContain('<task title="Title only">');
    expect(xml).not.toContain("<description>");
  });

  it("xml-escapes the task title", () => {
    render(
      <TaskXmlPreview
        taskTitle={'A & B "q" <x>'}
        taskDescription={null}
        prompts={[]}
        skills={[]}
        mcpTools={[]}
      />,
    );

    // textContent un-escapes entities, so assert the raw attribute via HTML.
    const html = screen.getByTestId("task-xml-preview-body").innerHTML;
    expect(html).toContain("A &amp;amp; B &amp;quot;q&amp;quot; &amp;lt;x&amp;gt;");
  });

  it("renders only the <task> block when no context is attached", () => {
    render(
      <TaskXmlPreview
        taskTitle="Solo task"
        prompts={[]}
        skills={[]}
        mcpTools={[]}
      />,
    );

    // Not the empty hint — the task itself is content.
    expect(screen.getByTestId("task-xml-preview-body")).toBeInTheDocument();
    const xml = screen.getByTestId("task-xml-preview-body").textContent ?? "";
    expect(xml).toContain('<task title="Solo task">');
  });

  // ── Syntax highlighting ────────────────────────────────────────────

  it("wraps tag names + attributes in highlight.js token classes", () => {
    render(
      <TaskXmlPreview
        taskTitle="Hi"
        prompts={[]}
        skills={[]}
        mcpTools={[]}
      />,
    );

    const body = screen.getByTestId("task-xml-preview-body");
    // Element name is themed as `.hljs-name`, attribute as `.hljs-attr`.
    expect(body.querySelector(".hljs-name")?.textContent).toBe("task");
    expect(body.querySelector(".hljs-attr")?.textContent).toBe("title");
    // The rendered textContent still equals the raw XML (testid + copy
    // behaviour preserved).
    expect(body.textContent).toContain('<task title="Hi">');
  });
});
