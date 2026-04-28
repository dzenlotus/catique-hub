/**
 * QueryProvider — react-query client at the app root.
 *
 * Defaults:
 * - `staleTime: 30_000` (30 s). Data stays fresh for half a minute
 *   before a background refetch is allowed. Suits desktop/IPC where
 *   underlying state changes are user-initiated, not server-pushed.
 * - `gcTime: 300_000` (5 min). Idle queries linger in cache for 5
 *   minutes, then are garbage-collected. (Renamed from `cacheTime` in
 *   react-query v5.)
 * - `refetchOnWindowFocus: false`. Tauri windows always have focus —
 *   refetching every time the user clicks back is noise, not signal.
 * - `retry: 1`. One retry on transport failure; AppError-shaped
 *   rejections still bubble immediately because we re-throw a typed
 *   `AppErrorInstance` (not retried as that's a domain error, not
 *   a flake).
 *
 * The client is constructed via `useState(() => new QueryClient(...))`
 * so HMR doesn't recreate it on every render.
 */

import { useState } from "react";
import type { PropsWithChildren, ReactElement } from "react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";

import { AppErrorInstance } from "@entities/board";

export function QueryProvider({
  children,
}: PropsWithChildren): ReactElement {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 300_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Domain errors are deterministic — no retry.
              if (error instanceof AppErrorInstance) return false;
              return failureCount < 1;
            },
          },
          mutations: {
            // Mutations are user-initiated; don't auto-retry on failure.
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
