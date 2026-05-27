import type { ReactElement } from "react";
import { RouterProvider } from "@tanstack/react-router";

import { router } from "./router";

/**
 * App root — hands the entire UI off to TanStack Router.
 *
 * The route tree, layout shell, sidebars and toast region all live in
 * `router.tsx` and `RootLayout.tsx`. This file exists only to give
 * `index.tsx` a single named entry point.
 */
export default function App(): ReactElement {
  return <RouterProvider router={router} />;
}
