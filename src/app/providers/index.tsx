/**
 * Root providers stack.
 *
 * E2.3 (Anna): adds `QueryProvider` (TanStack Query). Future providers
 * (Theme, Router, I18n, Toast region) slot in here so the App mount-site
 * never grows beyond `<AppProviders><App /></AppProviders>`.
 *
 * E2.5 (Katya): adds `EventsProvider` *inside* `QueryProvider` so the
 * realtime listener bridge can call `useQueryClient()`. The order
 * matters — react-query's client must be in scope when EventsProvider
 * mounts.
 *
 * E4.x: adds `ActiveSpaceProvider` inside `EventsProvider` so it can
 * consume `useSpaces()` which depends on the query client.
 *
 * E4.x (toast): adds `ToastProvider` inside `ActiveSpaceProvider` so
 * all widgets can call `useToast()` and push ephemeral notifications.
 *
 * Stream J / v3 Wave 4: hoists `ToastProvider` above `EventsProvider`
 * so the realtime `task:run:failed` listener can surface a typed
 * error toast directly from the bridge. Nothing else depends on the
 * old "ToastProvider is innermost" invariant — `useToast()` traverses
 * the React tree upward and finds the context regardless of where it
 * sits inside the stack, as long as it wraps the consuming subtree.
 *
 * Provider order: QueryProvider > ToastProvider > EventsProvider >
 * ActiveSpaceProvider > ExpandedSpacesProvider > children.
 */

import type { PropsWithChildren, ReactElement } from "react";

import { ToastProvider } from "@shared/lib";
import { PortalProvider } from "@shared/ui";

import { ActiveSpaceProvider } from "./ActiveSpaceProvider";
import { EventsProvider } from "./EventsProvider";
import { ExpandedSpacesProvider } from "./ExpandedSpacesProvider";
import { MigrateLegacyPrefsProvider } from "./MigrateLegacyPrefsProvider";
import { QueryProvider } from "./QueryProvider";

// `ActiveSpaceProvider` is the only provider component that lives in `app`
// (it resolves the default space via `useSpaces()` — an entity dep `shared`
// may not take). Tests/stories across other layers compose it through this
// barrel rather than the named subpath, so the named-subpath FSD boundary
// stays clean. Production code consumes `useActiveSpace` from `@shared/lib`.
export { ActiveSpaceProvider } from "./ActiveSpaceProvider";

/**
 * `PortalProvider` is the outermost layer so every RAC overlay rendered
 * anywhere in the tree (modals, popovers, tooltips, menus, selects)
 * portals into a single `<div id="catique-portal-root">` mounted as a
 * sibling of `#root`. This keeps DevTools tidy, gives one anchor point
 * for theming/Tauri-window-chrome insets, and contains all overlay DOM
 * outside the App's CSS-Module-scoped subtree.
 */
export function AppProviders({ children }: PropsWithChildren): ReactElement {
  return (
    <PortalProvider>
      <QueryProvider>
        <ToastProvider>
          <EventsProvider>
            <ActiveSpaceProvider>
              <ExpandedSpacesProvider>
                <MigrateLegacyPrefsProvider>{children}</MigrateLegacyPrefsProvider>
              </ExpandedSpacesProvider>
            </ActiveSpaceProvider>
          </EventsProvider>
        </ToastProvider>
      </QueryProvider>
    </PortalProvider>
  );
}
