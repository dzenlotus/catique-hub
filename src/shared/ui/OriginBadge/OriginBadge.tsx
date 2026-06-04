/**
 * OriginBadge — visual chip indicating where an attached entity was
 * inherited from on the four-level inheritance chain (space → board →
 * column → role) plus `direct` for task-attached items.
 *
 * Used by the Effective Context Panel (task detail) and by any
 * MultiSelect that surfaces inherited items (board settings, agent
 * detail, prompt-in-group). Driven by the `OriginRef` discriminated
 * union emitted by ts-rs from `crates/domain/src/task_bundle.rs`.
 *
 * Visual contract:
 *   - `direct`  — neutral; "task" word.
 *   - `role`    — purple-ish accent (D-020 role-anchored).
 *   - `column`  — secondary.
 *   - `board`   — secondary.
 *   - `space`   — muted; furthest scope.
 *   - `group`   — UI-only; "via group" — the prompt is shown here
 *                 because it belongs to a prompt group (Stream R,
 *                 v3 Round 4). The inheritance resolver never emits
 *                 this kind; frontend constructs it directly in
 *                 `InlineGroupView` so the same prompt surfaced under
 *                 multiple groups stays disambiguated.
 *   - override  — gold star prefix when `overridden` flag is set.
 */
import type { ReactElement } from "react";

import { cn } from "@shared/lib";
import { PixelContentFilesFolderOpen } from "@shared/ui/Icon";

import styles from "./OriginBadge.module.css";

/** Mirrors `bindings/OriginRef.ts`. */
export type OriginRef =
  | { kind: "direct" }
  | { kind: "role"; id: string }
  | { kind: "column"; id: string }
  | { kind: "board"; id: string }
  | { kind: "space"; id: string }
  | { kind: "group"; id: string };

export interface OriginBadgeProps {
  origin: OriginRef;
  /** Render a `★ override` prefix when the bundle marked the row as overridden. */
  overridden?: boolean;
  /** Render the row with strikethrough to show suppressed inheritance. */
  suppressed?: boolean;
  /** Optional class merged onto the root chip. */
  className?: string;
  /** Optional test-id. */
  "data-testid"?: string;
}

function labelFor(origin: OriginRef): string {
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
      return "via group";
  }
}

/**
 * The `group` variant carries a small folder pixel-art glyph to
 * disambiguate it from the inheritance origins at a glance. The 5
 * inheritance variants stay icon-less so the chip stays compact in
 * dense surfaces (Effective Context Panel, board settings).
 */
function aria(origin: OriginRef): string {
  if (origin.kind === "group") return "Member of prompt group";
  return `Inherited from ${labelFor(origin)}`;
}

export function OriginBadge(props: OriginBadgeProps): ReactElement {
  const { origin, overridden, suppressed, className } = props;
  const testId = props["data-testid"];
  const accessibleLabel = aria(origin);

  return (
    <span
      className={cn(styles.root, className)}
      data-origin={origin.kind}
      data-overridden={overridden ? "true" : undefined}
      data-suppressed={suppressed ? "true" : undefined}
      role="img"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
    >
      {overridden ? <span aria-hidden="true">★</span> : null}
      {origin.kind === "group" ? (
        <PixelContentFilesFolderOpen
          className={styles.icon}
          aria-hidden="true"
          focusable="false"
        />
      ) : null}
      <span className={styles.label}>{labelFor(origin)}</span>
    </span>
  );
}
