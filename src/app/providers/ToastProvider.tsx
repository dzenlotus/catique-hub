/**
 * ToastProvider — global context for ephemeral toast notifications.
 *
 * Holds a list of active toasts, auto-dismisses them after 4 seconds,
 * and enforces a max-5 stack cap (oldest toast is dropped when the cap
 * is exceeded).
 *
 * Consumers read/write via `useToast()`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;
}

export interface ToastContextValue {
  toasts: Toast[];
  pushToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: string) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 4_000;
const STACK_CAP = 5;

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * `useToast` — consume the global toast context.
 *
 * Must be called inside `<ToastProvider>`.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * `ToastProvider` — mounts the toast context.
 *
 * Provider order: QueryProvider > EventsProvider > ActiveSpaceProvider >
 * ToastProvider > children.
 */
export function ToastProvider({ children }: PropsWithChildren): ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Track timer IDs so we can clear them on unmount.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (kind: ToastKind, message: string): void => {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const newToast: Toast = { id, kind, message, createdAt };

      setToasts((prev) => {
        const next = [...prev, newToast];
        // Enforce stack cap — drop oldest first.
        return next.length > STACK_CAP ? next.slice(next.length - STACK_CAP) : next;
      });

      // Auto-dismiss after 4 seconds.
      const timer = setTimeout(() => {
        dismissToast(id);
      }, AUTO_DISMISS_MS);

      timers.current.set(id, timer);
    },
    [dismissToast],
  );

  // Clear all timers on unmount.
  useEffect(() => {
    const currentTimers = timers.current;
    return () => {
      for (const timer of currentTimers.values()) {
        clearTimeout(timer);
      }
      currentTimers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, pushToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}
