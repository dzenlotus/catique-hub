/**
 * Root providers stack.
 *
 * E1: empty pass-through. Reserved for E2 (QueryClientProvider, ThemeProvider,
 * RouterProvider, I18nProvider, etc.). Wrapping App in <AppProviders> from
 * day one means we add new providers in one place — no churn at the
 * <App/> mount-site.
 */

import type { PropsWithChildren, ReactElement } from "react";

export function AppProviders({ children }: PropsWithChildren): ReactElement {
  return <>{children}</>;
}
