/**
 * Router test utilities.
 *
 * Two flavours:
 *
 * 1. `<TestRouter>` — a no-router shim. Pins `window.location.pathname`
 *    to a chosen path so the `routerCompat.ts` hooks (which fall back
 *    to `window.location` when no `<RouterProvider>` is mounted) read
 *    a known URL. Use for widgets that *read* the pathname but do
 *    not rely on typed route params.
 *
 * 2. `<TestParamsRouter>` — mounts a real `RouterProvider` with a
 *    single route pattern, so `useParams()` resolves to the
 *    expected values. Use for components that read params from
 *    the URL (e.g. `BoardSettings` → `useParams<{ boardId: string }>()`).
 */
import {
  useEffect,
  useImperativeHandle,
  type PropsWithChildren,
  type ReactElement,
  type Ref,
} from "react";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface TestRouterControls {
  navigate: (to: string) => void;
}

// ---------------------------------------------------------------------------
// Flavour 1 — window.history-only shim
// ---------------------------------------------------------------------------

export interface TestRouterProps {
  /** Initial pathname to pin `window.location` at. Default `/`. */
  path?: string;
  /** Optional imperative-navigation handle for tests. */
  controlRef?: Ref<TestRouterControls>;
}

function setWindowPath(path: string): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", path);
}

export function TestRouter({
  children,
  path = "/",
  controlRef,
}: PropsWithChildren<TestRouterProps>): ReactElement {
  setWindowPath(path);

  useEffect(() => {
    setWindowPath(path);
  }, [path]);

  useImperativeHandle(
    controlRef,
    () => ({
      navigate: (to: string) => {
        setWindowPath(to);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      },
    }),
    [],
  );

  return <>{children}</>;
}

