/*
 * EditorShell — composition primitive for editor surfaces.
 *
 * Provides a flex-column shell with three optional slots — Header,
 * Body, Footer — composed via `EditorShell.Header` / `.Body` / `.Footer`
 * (NOT a props-bag). The shell guarantees that the footer stays pinned
 * to the bottom while the body scrolls, regardless of body height.
 *
 * Used by:
 *   - `widgets/role-editor/RoleEditor`
 *   - `widgets/prompt-editor/PromptEditor`
 *   - `widgets/task-dialog/TaskDialog`
 *   - `widgets/board-settings/BoardSettings`
 *
 * Dialog interop:
 *   `<EditorShell.Footer>` carries the same global symbol tag
 *   (`Symbol.for("catique.DialogFooter")`) that `<DialogFooter>` does, so
 *   when an EditorShell is rendered inside a `<Dialog>` the dialog's
 *   `splitFooter` helper lifts the footer out of the scrollable body and
 *   pins it as a flex sibling of the dialog's `.body`. In that case
 *   EditorShell itself stays a transparent header+body wrapper inside
 *   the dialog.
 */

import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "@shared/lib";

import styles from "./EditorShell.module.css";

// ---------------------------------------------------------------------------
// Symbols — used to identify Header / Body / Footer slots after rendering.
// `Symbol.for(...)` returns the same symbol globally for the same key, so
// the footer tag matches the one Dialog's `splitFooter` looks up.
// ---------------------------------------------------------------------------

const HEADER_SYMBOL = Symbol.for("catique.EditorShell.Header");
const BODY_SYMBOL = Symbol.for("catique.EditorShell.Body");
// Shared tag with `<DialogFooter>` — see Dialog.tsx (`DIALOG_FOOTER_SYMBOL`).
const FOOTER_SYMBOL = Symbol.for("catique.DialogFooter");

interface SlotChild {
  __TAG?: symbol;
}

function slotMatches(node: ReactNode, tag: symbol): boolean {
  if (!isValidElement(node)) return false;
  const type = node.type as unknown as SlotChild | undefined;
  return type?.__TAG === tag;
}

interface SlotElementProps {
  testId?: string;
  "data-testid"?: string;
  className?: string;
  children?: ReactNode;
}

// ---------------------------------------------------------------------------
// Header / Body / Footer — composition slots.
// ---------------------------------------------------------------------------

export interface EditorShellHeaderProps {
  /** Stable test id forwarded to the header element. */
  testId?: string;
  /** Extra class merged onto the header. */
  className?: string;
  /** Header content — typically the surface title + optional close icon. */
  children: ReactNode;
}

/**
 * Header slot — pinned at the top of the shell, fixed height, optional
 * bottom border. Renders nothing when omitted.
 */
function EditorShellHeader({
  testId,
  className,
  children,
}: EditorShellHeaderProps): ReactElement {
  return (
    <div
      className={cn(styles.header, className)}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
    >
      {children}
    </div>
  );
}
(EditorShellHeader as unknown as SlotChild).__TAG = HEADER_SYMBOL;

export interface EditorShellBodyProps {
  /** Stable test id forwarded to the body element. */
  testId?: string;
  /** Extra class merged onto the body. */
  className?: string;
  /** Scrollable content. */
  children: ReactNode;
}

/**
 * Body slot — scrollable region between the header and footer. Owns
 * vertical scroll via `overflow-y: auto`.
 */
function EditorShellBody({
  testId,
  className,
  children,
}: EditorShellBodyProps): ReactElement {
  return (
    <div
      className={cn(styles.body, className)}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
    >
      {children}
    </div>
  );
}
(EditorShellBody as unknown as SlotChild).__TAG = BODY_SYMBOL;

export interface EditorShellFooterProps {
  /** Stable test id forwarded to the footer element. */
  testId?: string;
  /** Extra class merged onto the footer. */
  className?: string;
  /** Footer content — typically Cancel / Save Changes buttons. */
  children: ReactNode;
}

/**
 * Footer slot — sticky-to-bottom via flex layout. Tagged with
 * `Symbol.for("catique.DialogFooter")` so when EditorShell is rendered
 * inside `<Dialog>`, the dialog's `splitFooter` pulls this out as a
 * flex sibling of the dialog body — keeping the footer pinned even
 * when the dialog owns scroll.
 */
function EditorShellFooter({
  testId,
  className,
  children,
}: EditorShellFooterProps): ReactElement {
  return (
    <div
      className={cn(styles.footer, className)}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
    >
      {children}
    </div>
  );
}
(EditorShellFooter as unknown as SlotChild).__TAG = FOOTER_SYMBOL;

// ---------------------------------------------------------------------------
// EditorShell — root container.
// ---------------------------------------------------------------------------

export interface EditorShellProps {
  /**
   * Stable test id assigned to the shell root. Slot children that omit
   * their own `testId` automatically receive `<testId>-header` /
   * `<testId>-body` / `<testId>-footer` so unit tests can assert on
   * each region without bespoke ids.
   */
  testId?: string;
  /** Extra class merged onto the shell root. */
  className?: string;
  /** Composition children — `EditorShell.Header` / `.Body` / `.Footer`. */
  children: ReactNode;
}

/**
 * `EditorShell` — flex-column shell with sticky header + footer and a
 * scrollable body. Compose via the static slot components:
 *
 *   <EditorShell testId="role-editor">
 *     <EditorShell.Header>...</EditorShell.Header>
 *     <EditorShell.Body>...</EditorShell.Body>
 *     <EditorShell.Footer>...</EditorShell.Footer>
 *   </EditorShell>
 *
 * Any slot may be omitted — the shell still renders the remaining
 * regions in `header → body → footer` order. Children that are NOT one
 * of the slot components are silently dropped (the shell exposes a
 * strict composition contract, NOT a free-form children prop).
 */
function EditorShellRoot({
  testId,
  className,
  children,
}: EditorShellProps): ReactElement {
  // Bucket children by slot tag. `Children.toArray` keys siblings so we
  // can safely re-render them without triggering React's "duplicate key"
  // warnings.
  let header: ReactElement | null = null;
  let body: ReactElement | null = null;
  let footer: ReactElement | null = null;

  for (const child of Children.toArray(children)) {
    if (slotMatches(child, HEADER_SYMBOL) && header === null) {
      header = decorateSlotTestId(
        child as ReactElement<SlotElementProps>,
        testId,
        "header",
      );
    } else if (slotMatches(child, BODY_SYMBOL) && body === null) {
      body = decorateSlotTestId(
        child as ReactElement<SlotElementProps>,
        testId,
        "body",
      );
    } else if (slotMatches(child, FOOTER_SYMBOL) && footer === null) {
      footer = decorateSlotTestId(
        child as ReactElement<SlotElementProps>,
        testId,
        "footer",
      );
    }
    // Non-slot children are intentionally dropped to keep the
    // composition contract strict.
  }

  return (
    <div
      className={cn(styles.root, className)}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
    >
      {header}
      {body}
      {footer}
    </div>
  );
}

/**
 * Forwards `<rootTestId>-<suffix>` to a slot child when the child
 * doesn't already carry an explicit `testId`. Lets consumers assert on
 * each region without naming three test ids per surface.
 */
function decorateSlotTestId(
  element: ReactElement<SlotElementProps>,
  rootTestId: string | undefined,
  suffix: "header" | "body" | "footer",
): ReactElement {
  if (rootTestId === undefined) return element;
  const props = element.props;
  if (props.testId !== undefined) return element;
  return cloneElement(element, { testId: `${rootTestId}-${suffix}` });
}

// ---------------------------------------------------------------------------
// Public composition surface.
// ---------------------------------------------------------------------------

type EditorShellComponent = typeof EditorShellRoot & {
  Header: typeof EditorShellHeader;
  Body: typeof EditorShellBody;
  Footer: typeof EditorShellFooter;
};

const EditorShellWithSlots = EditorShellRoot as EditorShellComponent;
EditorShellWithSlots.Header = EditorShellHeader;
EditorShellWithSlots.Body = EditorShellBody;
EditorShellWithSlots.Footer = EditorShellFooter;

export { EditorShellWithSlots as EditorShell };
