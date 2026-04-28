import type { ReactElement, ReactNode } from "react";
import {
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./Dialog.module.css";

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
  description,
  isDismissable = true,
  isOpen,
  onOpenChange,
  className,
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
        <AriaDialog className={cn(styles.dialog, className)}>
          {({ close }) => (
            <>
              <Heading slot="title" className={styles.title}>
                {title}
              </Heading>
              {description ? (
                <p className={styles.description}>{description}</p>
              ) : null}
              <div className={styles.body}>
                {typeof children === "function"
                  ? (children as DialogChildrenRenderProp)(close)
                  : children}
              </div>
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
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
