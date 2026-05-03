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
 * Provider order: QueryProvider > EventsProvider > ActiveSpaceProvider >
 * ToastProvider > children.
 */

import type { PropsWithChildren, ReactElement } from "react";

import { PortalProvider } from "@shared/ui";

import { ActiveSpaceProvider } from "./ActiveSpaceProvider";
import { EventsProvider } from "./EventsProvider";
import { QueryProvider } from "./QueryProvider";
import { ToastProvider } from "./ToastProvider";

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
        <EventsProvider>
          <ActiveSpaceProvider>
            <ToastProvider>{children}</ToastProvider>
          </ActiveSpaceProvider>
        </EventsProvider>
      </QueryProvider>
    </PortalProvider>
  );
}
