import {
  Children,
  isValidElement,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./Dialog.module.css";

// ---------------------------------------------------------------------------
// `DialogFooter` slot
//
// Round-19c: lets the consumer mark a JSX block as "render OUTSIDE the
// scrollable body, pinned to the dialog's bottom edge". The previous
// `position: sticky; bottom: calc(-1 * var(--space-24))` trick pushed
// the footer 24 px BELOW the body's viewport — sticky cannot pull it
// back. Splitting the body and the footer into siblings of the dialog
// flex column is the correct contract.
// ---------------------------------------------------------------------------

const DIALOG_FOOTER_SYMBOL = Symbol.for("catique.DialogFooter");

export interface DialogFooterProps {
  children: ReactNode;
  /** Extra class merged onto the footer container. */
  className?: string;
  /** Stable test id for the footer element. */
  "data-testid"?: string;
}

/**
 * Marker component identifying the dialog footer. Place it as a
 * direct child of `<Dialog>`; everything else stays inside the
 * scrollable body. Only the first DialogFooter child is honoured —
 * the rest fall through into the body.
 */
export function DialogFooter({
  children,
  className,
  "data-testid": dataTestId,
}: DialogFooterProps): ReactElement {
  return (
    <div
      className={cn(styles.footer, className)}
      {...(dataTestId !== undefined ? { "data-testid": dataTestId } : {})}
    >
      {children}
    </div>
  );
}

// Tag the function component so Dialog can identify it after rendering
// (works across HMR / module reloads via Symbol.for).
(DialogFooter as unknown as { __TAG?: symbol }).__TAG = DIALOG_FOOTER_SYMBOL;

function isDialogFooter(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const type = node.type as unknown as { __TAG?: symbol } | undefined;
  return type?.__TAG === DIALOG_FOOTER_SYMBOL;
}

function splitFooter(
  rendered: ReactNode,
): { body: ReactNode; footer: ReactNode | null } {
  const arr = Children.toArray(rendered);
  let footer: ReactNode | null = null;
  const body: ReactNode[] = [];
  for (const child of arr) {
    if (footer === null && isDialogFooter(child)) {
      footer = child;
    } else {
      body.push(child);
    }
  }
  return { body, footer };
}

/**
 * Render-prop API for `<Dialog>`. RAC's underlying Dialog passes a `close`
 * function to children — we expose it through a typed render-prop so
 * call-sites can wire "Save", "Cancel", etc. without rolling their own
 * state-management.
 */
export type DialogChildrenRenderProp = (close: () => void) => ReactNode;

export interface DialogProps {
  /** Visible heading. Required for a11y (RAC wires aria-labelledby). */
  title: string;
  /**
   * Optional element rendered to the LEFT of the title — typically an
   * `<IconColorPicker>` so the appearance affordance reads as part of
   * the dialog header rather than its own labelled section. Mirrors
   * the pattern used by `<PromptEditorPanel>`.
   */
  titleLeading?: ReactNode;
  /**
   * Optional supporting copy under the title. Use sentence-case, ≤2
   * sentences. Internally bound to aria-describedby.
   */
  description?: string;
  /**
   * Whether clicking the scrim or pressing Escape closes the dialog.
   * @default true
   */
  isDismissable?: boolean;
  /** Controls modal visibility. Pair with `onOpenChange`. */
  isOpen?: boolean;
  /** Called when modal wants to close (Esc, scrim, programmatic). */
  onOpenChange?: (isOpen: boolean) => void;
  /** Optional class merged onto the inner Dialog content panel. */
  className?: string;
  /** Optional test identifier forwarded to the dialog panel element. */
  "data-testid"?: string;
  /**
   * Body. May be a ReactNode or a render-prop receiving `close`.
   * Render-prop is preferred when the dialog has a close-control inside.
   */
  children: ReactNode | DialogChildrenRenderProp;
}

/**
 * `Dialog` — modal wrapper around `react-aria-components`.
 *
 * Behaviour delivered by RAC:
 * - Focus is trapped inside the dialog while open.
 * - Esc closes when `isDismissable` (default true).
 * - Scrim click closes when `isDismissable`.
 * - Background scroll is locked.
 * - Focus restores to the trigger on close.
 * - Portaled to <body> automatically.
 *
 * WCAG: title is rendered as an `<h2>` and bound via aria-labelledby.
 * Description (if provided) is bound via aria-describedby. Token pair
 * for the panel: `--color-text-default` on `--color-surface-overlay`
 * (light: 16.5:1 → AAA; dark: 12.6:1 → AAA).
 */
export function Dialog({
  title,
  titleLeading,
  description,
  isDismissable = true,
  isOpen,
  onOpenChange,
  className,
  "data-testid": dataTestId,
  children,
}: DialogProps): ReactElement {
  return (
    <ModalOverlay
      className={styles.overlay}
      isDismissable={isDismissable}
      {...(isOpen !== undefined ? { isOpen } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <Modal className={styles.modal}>
        <AriaDialog
            className={cn(styles.dialog, className)}
            {...(dataTestId ? { "data-testid": dataTestId } : {})}
          >
          {({ close }) => (
            <>
              {titleLeading !== undefined ? (
                <div className={styles.titleRow}>
                  {titleLeading}
                  <Heading slot="title" className={styles.title}>
                    {title}
                  </Heading>
                </div>
              ) : (
                <Heading slot="title" className={styles.title}>
                  {title}
                </Heading>
              )}
              {description ? (
                <p className={styles.description}>{description}</p>
              ) : null}
              <DialogContent close={close}>{children}</DialogContent>
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

interface DialogContentProps {
  close: () => void;
  children: ReactNode | DialogChildrenRenderProp;
}

/**
 * Renders the content under the dialog title. Splits the rendered tree
 * so any `<DialogFooter>` siblings are pulled OUT of the scrollable
 * body and pinned beneath it as flex siblings of the body — making the
 * footer a fixed strip while only `<body-content>` scrolls.
 */
function DialogContent({
  close,
  children,
}: DialogContentProps): ReactElement {
  const lastContentRef = useRef<ReactNode>(null);
  const content =
    typeof children === "function"
      ? (children as DialogChildrenRenderProp)(close)
      : children;

  if (content !== null && content !== undefined && content !== false) {
    lastContentRef.current = content;
  }

  const stable = content ?? lastContentRef.current;
  const { body, footer } = splitFooter(stable);

  return (
    <>
      <div className={styles.body} data-testid="dialog-body">
        {body}
      </div>
      {footer}
    </>
  );
}

/**
 * `DialogTrigger` — RAC re-export for ergonomic open-on-press wiring.
 *
 * Usage:
 *   <DialogTrigger>
 *     <Button>Open</Button>
 *     <Dialog title="…">…</Dialog>
 *   </DialogTrigger>
 *
 * RAC matches the trigger and dialog by sibling-position, no IDs.
 */
export const DialogTrigger = AriaDialogTrigger;
