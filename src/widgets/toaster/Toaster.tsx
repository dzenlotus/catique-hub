/**
 * Toaster — renders the active toast stack in a fixed bottom-right container.
 *
 * Reads from `useToast()`. Each toast is a horizontal pill with a kind-specific
 * icon (lucide), the message, and a manual dismiss button.
 *
 * Accessibility:
 *   - Container has `aria-live="polite"`.
 *   - Each success/info toast has `role="status"`; error toasts use `role="alert"`.
 *   - Slide-in animation is guarded by `prefers-reduced-motion`.
 */

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { ReactElement } from "react";

import { useToast } from "@app/providers/ToastProvider";
import type { Toast, ToastKind } from "@app/providers/ToastProvider";
import { cn } from "@shared/lib";

import styles from "./Toaster.module.css";

// ─── Icon map ─────────────────────────────────────────────────────────────────

function ToastIcon({ kind }: { kind: ToastKind }): ReactElement {
  switch (kind) {
    case "success":
      return <CheckCircle2 size={16} aria-hidden="true" className={styles.icon} />;
    case "error":
      return <XCircle size={16} aria-hidden="true" className={styles.icon} />;
    case "info":
      return <Info size={16} aria-hidden="true" className={styles.icon} />;
  }
}

// ─── Single toast pill ────────────────────────────────────────────────────────

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps): ReactElement {
  const role = toast.kind === "error" ? "alert" : "status";

  return (
    <div
      role={role}
      className={cn(styles.toast, styles[toast.kind])}
      data-testid={`toast-${toast.id}`}
    >
      <ToastIcon kind={toast.kind} />
      <span className={styles.message}>{toast.message}</span>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => onDismiss(toast.id)}
        aria-label="Закрыть уведомление"
        data-testid={`toast-dismiss-${toast.id}`}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

// ─── Container ────────────────────────────────────────────────────────────────

/**
 * `Toaster` — mount once in `App.tsx`.
 */
export function Toaster(): ReactElement {
  const { toasts, dismissToast } = useToast();

  return (
    <div
      className={styles.container}
      aria-live="polite"
      aria-label="Уведомления"
      data-testid="toaster"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
