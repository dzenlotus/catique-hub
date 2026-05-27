/**
 * Thin TanStack-Router adapter that mimics wouter's `useLocation`
 * signature (`[pathname, setLocation]`). Used to keep the wouter →
 * TanStack Router migration diff small — callers that previously
 * destructured `const [location, setLocation] = useLocation()` can
 * switch their import to `@shared/lib` and keep the same shape.
 *
 * Long-term: prefer the native TanStack hooks (`useNavigate`,
 * `useRouterState`, `useParams`) so we don't carry the wouter idiom
 * forever.
 *
 * The hooks also work *outside* a TanStack `<RouterProvider>` — they
 * fall back to `window.location.pathname` and `window.history` so
 * Storybook / test renderers that don't mount the router don't crash.
 * This mirrors wouter's permissive behaviour and is the reason the
 * legacy unit-test suite stayed green after the migration.
 */
import { useCallback, useSyncExternalStore } from "react";
import {
  useNavigate,
  useParams,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";

export type LocationCompat = [string, (to: string) => void];

function getWindowPathname(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname;
}

function subscribeWindowLocation(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

function useSafeRouter(): ReturnType<typeof useRouter> | null {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

function useSafePathname(): string {
  const router = useSafeRouter();
  // Always subscribe to window.popstate so the no-router fallback
  // re-renders when callers push history state imperatively. The
  // selector is `getWindowPathname` either way; when a router is
  // present the value below overrides it via `useRouterState`.
  const windowPath = useSyncExternalStore(
    subscribeWindowLocation,
    getWindowPathname,
    getWindowPathname,
  );
  if (router === null) return windowPath;
  // Hooks order: the `router === null` branch is exclusive within a
  // render tree (the parent provider stack does not flip mid-life-
  // cycle), so this inline call is safe.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useRouterState({
    router,
    select: (state) => state.location.pathname,
  });
}

export function useLocationCompat(): LocationCompat {
  const router = useSafeRouter();
  const pathname = useSafePathname();
  const navigate = useNavigate();
  const setLocation = useCallback(
    (to: string) => {
      if (router === null) {
        if (typeof window !== "undefined") {
          window.history.pushState(null, "", to);
          // pushState does not fire popstate by spec; emit one so
          // `useSafePathname` (subscribed to popstate via
          // `useSyncExternalStore`) re-runs and consumers re-render.
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
        return;
      }
      void navigate({ to });
    },
    [navigate, router],
  );
  return [pathname, setLocation];
}

/**
 * wouter `useParams()` returned `Record<string, string>` without
 * specifying which route owned the params. TanStack Router's
 * `useParams({ strict: false })` mirrors that shape, but TS narrows
 * each value to `string | undefined` because it can't statically know
 * the route. This compat layer casts to the wouter shape so existing
 * call sites that destructure `params.boardId` stay green; long-term
 * each call site should switch to a typed `<routeId>.useParams()`.
 */
export function useParamsCompat<T = Record<string, string>>(): T {
  const router = useSafeRouter();
  if (router === null) return {} as T;
  return useParams({ strict: false }) as unknown as T;
}

/**
 * Path-pattern matcher mirroring wouter's `useRoute(pattern)` return
 * shape (`[true, params] | [false, null]`). Patterns use the wouter
 * `:param` style (e.g. `/roles/:roleId`); colon-prefixed segments are
 * captured into the returned params object.
 */
export function useRouteCompat<T = Record<string, string>>(
  pattern: string,
): [boolean, T | null] {
  const pathname = useSafePathname();
  const params = matchPattern(pattern, pathname) as T | null;
  return params === null ? [false, null] : [true, params];
}

function matchPattern(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const patternSegments = stripLeading(pattern).split("/");
  const pathSegments = stripLeading(pathname).split("/");
  if (patternSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i += 1) {
    const p = patternSegments[i] ?? "";
    const v = pathSegments[i] ?? "";
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(v);
    } else if (p !== v) {
      return null;
    }
  }
  return params;
}

function stripLeading(s: string): string {
  return s.startsWith("/") ? s.slice(1) : s;
}
