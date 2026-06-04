/**
 * `useOptionalToast` — safe accessor for the toast context.
 *
 * `useToast()` throws when called outside `<ToastProvider>`. The
 * GlobalSearch widget is rendered by Storybook stories and unit tests
 * that don't mount the provider, so we shield the consumer with a
 * no-op fallback. Behaviour in app code is unchanged.
 */
import { useContext } from "react";

import { ToastContext } from "@shared/lib";

type PushToast = (
  level: "success" | "error" | "info",
  message: string,
) => void;

const NOOP: PushToast = () => {
  /* silently drop the toast — caller is rendered outside ToastProvider */
};

export function useOptionalToast(): PushToast {
  const ctx = useContext(ToastContext);
  if (ctx === undefined || ctx === null) return NOOP;
  return (level, message) => ctx.pushToast(level, message);
}
