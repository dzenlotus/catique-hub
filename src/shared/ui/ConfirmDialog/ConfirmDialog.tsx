/**
 * ConfirmDialog — modal yes/no prompt.
 *
 * Replacement for `window.confirm()`. Renders the message in the same
 * Dialog primitive every other modal uses so the visual language stays
 * uniform — no surprise native browser chrome on a polished pixel UI.
 *
 * Usage:
 *
 *   <ConfirmDialog
 *     isOpen={isOpen}
 *     onCancel={() => setIsOpen(false)}
 *     onConfirm={() => { fire(); setIsOpen(false); }}
 *     title="Delete board?"
 *     description="Tasks and columns under it will be removed too."
 *     confirmLabel="Delete"
 *     destructive
 *   />
 */

import type { ReactElement, ReactNode } from "react";

import { Button } from "@shared/ui/Button";
import { Dialog, DialogFooter } from "@shared/ui/Dialog";

export interface ConfirmDialogProps {
  isOpen: boolean;
  /** Heading shown in the dialog. Required for a11y. */
  title: string;
  /**
   * Body copy. Strings render as a single paragraph; pass a node when
   * the message wants emphasis or multiple paragraphs.
   */
  description?: ReactNode;
  /** Label on the affirmative button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label on the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * When true, the affirmative button gets the `secondary` variant
   * styled with status-danger semantics; the user is being asked to
   * approve a destructive operation. Default false.
   */
  destructive?: boolean;
  /** Called when the user picks "Confirm". */
  onConfirm: () => void;
  /** Called when the user picks "Cancel" or dismisses the dialog. */
  onCancel: () => void;
  /** Disable the confirm button (e.g. while a mutation is in flight). */
  isPending?: boolean;
  /** Optional test id for the modal panel. */
  "data-testid"?: string;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
  isPending = false,
  "data-testid": dataTestId = "confirm-dialog",
}: ConfirmDialogProps): ReactElement {
  return (
    <Dialog
      title={title}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      isDismissable
      data-testid={dataTestId}
    >
      {() => (
        <>
          {description !== undefined ? (
            typeof description === "string" ? (
              <p>{description}</p>
            ) : (
              description
            )
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              size="md"
              onPress={onCancel}
              data-testid={`${dataTestId}-cancel`}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? "secondary" : "primary"}
              size="md"
              onPress={onConfirm}
              isPending={isPending}
              data-testid={`${dataTestId}-confirm`}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
