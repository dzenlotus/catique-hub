/**
 * Root providers stack.
 *
 * E2.3 (Anna): adds `QueryProvider` (TanStack Query). Future providers
 * (Theme, Router, I18n, Toast region) slot in here so the App mount-site
 * never grows beyond `<AppProviders><App /></AppProviders>`.
 */

import type { PropsWithChildren, ReactElement } from "react";

import { QueryProvider } from "./QueryProvider";

export function AppProviders({ children }: PropsWithChildren): ReactElement {
  return <QueryProvider>{children}</QueryProvider>;
}
