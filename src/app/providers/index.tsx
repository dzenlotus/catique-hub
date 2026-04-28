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
 * Provider order: QueryProvider > EventsProvider > ActiveSpaceProvider > children.
 */

import type { PropsWithChildren, ReactElement } from "react";

import { ActiveSpaceProvider } from "./ActiveSpaceProvider";
import { EventsProvider } from "./EventsProvider";
import { QueryProvider } from "./QueryProvider";

export function AppProviders({ children }: PropsWithChildren): ReactElement {
  return (
    <QueryProvider>
      <EventsProvider>
        <ActiveSpaceProvider>{children}</ActiveSpaceProvider>
      </EventsProvider>
    </QueryProvider>
  );
}
