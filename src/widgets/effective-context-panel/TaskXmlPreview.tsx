/**
 * TaskXmlPreview — read-only XML rendering of a resolved task bundle.
 *
 * Mirrors the prompt-group inline view (`InlineGroupView.PromptsXmlPreview`):
 * a `.previewColumn` with a header label, a reactive token chip on the
 * trailing edge, and a `<pre>` body rendering the bundle as the agent
 * would receive it.
 *
 * Rendering rules:
 *   - `<prompts>` — every PromptWithOrigin is INLINED (content + worked
 *     examples), origin-tagged. These are the static instructions the
 *     agent always sees, so their tokens count toward the chip.
 *   - `<skills>`  — REFERENCES only (`<skill … />`). Skills are loaded
 *     dynamically on demand by the agent at runtime, so we never inline
 *     their bodies and never count their tokens.
 *   - `<mcp-tools>` — REFERENCES only, same reasoning as skills.
 *
 * The token chip sums ONLY the prompts' `tokenCount` (skills/tools are
 * dynamic references, not inlined). It updates reactively because the
 * page reads `useTaskBundle`, which `EventsProvider` invalidates on
 * `prompt:*` / `role:*` / override events.
 */
import type { ReactElement, ReactNode } from "react";

import type { PromptWithOrigin } from "@bindings/PromptWithOrigin";
import type { SkillWithOrigin } from "@bindings/SkillWithOrigin";
import type { McpToolWithOrigin } from "@bindings/McpToolWithOrigin";
import type { OriginRef } from "@bindings/OriginRef";
import { Scrollable } from "@shared/ui";

import styles from "./TaskXmlPreview.module.css";
import { highlightXml } from "./highlightXml";

export interface TaskXmlPreviewProps {
  /** The task's own title — rendered as the leading `<task>` block. */
  taskTitle?: string | undefined;
  /** The task's own description — rendered as `<description>` (omitted when empty). */
  taskDescription?: string | null | undefined;
  prompts: ReadonlyArray<PromptWithOrigin>;
  skills: ReadonlyArray<SkillWithOrigin>;
  mcpTools: ReadonlyArray<McpToolWithOrigin>;
}

export function TaskXmlPreview(props: TaskXmlPreviewProps): ReactElement {
  const { taskTitle, taskDescription, prompts, skills, mcpTools } = props;
  const hasTask = (taskTitle ?? "").trim().length > 0;
  const isEmpty =
    !hasTask &&
    prompts.length === 0 &&
    skills.length === 0 &&
    mcpTools.length === 0;

  const xml = renderBundleXml(
    taskTitle,
    taskDescription,
    prompts,
    skills,
    mcpTools,
  );

  return (
    <div className={styles.previewColumn} data-testid="task-xml-preview-column">
      <div className={styles.previewHeader}>
        <span>Task XML preview</span>
        <span
          className={styles.tokenChip}
          data-testid="task-xml-preview-total-tokens"
        >
          {sumPromptTokenCount(prompts)}
        </span>
      </div>
      <Scrollable axis="y" className={styles.previewBody}>
        <div className={styles.previewBodyInner}>
          {isEmpty ? (
            <p className={styles.previewEmpty}>
              Attach prompts, skills, or integrations to see how this task
              renders to an agent.
            </p>
          ) : (
            <pre
              className={styles.previewXml}
              data-testid="task-xml-preview-body"
            >
              {renderHighlighted(xml)}
            </pre>
          )}
        </div>
      </Scrollable>
    </div>
  );
}

/**
 * Render the XML string with syntax highlighting. The tokens carry the same
 * `.hljs-*` class names that `MarkdownPreview` uses, so the colour mapping
 * is shared (defined in `TaskXmlPreview.module.css`) and tracks the active
 * `[data-theme]` automatically. `textContent` of the rendered tree equals
 * the raw XML, so the `task-xml-preview-body` testid keeps matching on text.
 */
function renderHighlighted(xml: string): ReactNode {
  return highlightXml(xml).map((token, i) =>
    token.className === null ? (
      token.text
    ) : (
      <span key={i} className={token.className}>
        {token.text}
      </span>
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Token helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sum the per-prompt `tokenCount` across the inlined prompts only.
 * Prompts with `null` tokens are skipped (unknown, not zero); when no
 * prompt has a count we show "— tokens" so the header keeps a stable
 * trailing label. `tokenCount` can land as bigint or number depending
 * on the i64 value range Tauri serialises — normalise to bigint.
 */
export function sumPromptTokenCount(
  prompts: ReadonlyArray<PromptWithOrigin>,
): string {
  let total = 0n;
  let any = false;
  for (const { prompt } of prompts) {
    const count = prompt.tokenCount;
    if (count === null || count === undefined) continue;
    total += typeof count === "bigint" ? count : BigInt(count);
    any = true;
  }
  if (!any) return "— tokens";
  return `≈${total.toString()} tokens`;
}

// ─────────────────────────────────────────────────────────────────────────────
// XML rendering
// ─────────────────────────────────────────────────────────────────────────────

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Human label for the origin chain (`direct` → `task`, `role` → `agent`, …). */
function originLabel(origin: OriginRef): string {
  switch (origin.kind) {
    case "direct":
      return "task";
    case "role":
      return "agent";
    case "column":
      return "column";
    case "board":
      return "board";
    case "space":
      return "space";
    case "group":
      return "group";
  }
}

function indentLines(text: string, pad: string): string {
  return text
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
}

function renderBundleXml(
  taskTitle: string | undefined,
  taskDescription: string | null | undefined,
  prompts: ReadonlyArray<PromptWithOrigin>,
  skills: ReadonlyArray<SkillWithOrigin>,
  mcpTools: ReadonlyArray<McpToolWithOrigin>,
): string {
  const sections: string[] = [];

  // ── Task: the task itself leads the prompt (title + description) ──
  const title = (taskTitle ?? "").trim();
  if (title.length > 0) {
    const description = (taskDescription ?? "").trim();
    const open = `<task title="${escapeXml(title)}">`;
    if (description.length > 0) {
      const body = indentLines(description, "      ");
      sections.push(
        `${open}\n    <description>\n${body}\n    </description>\n  </task>`,
      );
    } else {
      sections.push(`${open}\n  </task>`);
    }
  }

  // ── Prompts: inlined ─────────────────────────────────────────────
  if (prompts.length > 0) {
    const blocks = prompts.map(({ prompt, origin }) => {
      const open =
        `  <prompt name="${escapeXml(prompt.name)}"` +
        ` origin="${escapeXml(originLabel(origin))}">`;
      const content = indentLines(prompt.content, "    ");
      const examples = prompt.examples.map((example, i) => {
        const body = indentLines(example, "      ");
        return `    <example index="${i}">\n${body}\n    </example>`;
      });
      return [open, content, ...examples, "  </prompt>"].join("\n");
    });
    sections.push(`<prompts>\n${blocks.join("\n")}\n</prompts>`);
  }

  // ── Skills: references only (loaded on demand at runtime) ─────────
  if (skills.length > 0) {
    const refs = skills.map(({ skill, origin }) =>
      `  <skill id="${escapeXml(skill.id)}" name="${escapeXml(skill.name)}"` +
      ` origin="${escapeXml(originLabel(origin))}" />`,
    );
    sections.push(`<skills>\n${refs.join("\n")}\n</skills>`);
  }

  // ── MCP tools: references only ────────────────────────────────────
  if (mcpTools.length > 0) {
    const refs = mcpTools.map(({ mcpTool, origin }) =>
      `  <mcp-tool id="${escapeXml(mcpTool.id)}" name="${escapeXml(mcpTool.name)}"` +
      ` origin="${escapeXml(originLabel(origin))}" />`,
    );
    sections.push(`<mcp-tools>\n${refs.join("\n")}\n</mcp-tools>`);
  }

  return sections.join("\n\n");
}
