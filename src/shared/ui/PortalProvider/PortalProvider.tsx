import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import {
  ModalContext,
  PopoverContext,
  Provider as RACProvider,
  TooltipContext,
} from "react-aria-components";

/**
 * Stable DOM id of the singleton portal container mounted by `PortalProvider`.
 * Exposed for tests / DevTools sanity checks ("there should be exactly one
 * `#catique-portal-root` at the bottom of `<body>`").
 */
export const PORTAL_ROOT_ID = "catique-portal-root";

/** Module-level handle so all `PortalProvider` consumers share one node. */
let portalRoot: HTMLDivElement | null = null;

function getOrCreatePortalRoot(): HTMLDivElement {
  if (portalRoot && portalRoot.isConnected) return portalRoot;
  const existing = document.getElementById(PORTAL_ROOT_ID);
  if (existing instanceof HTMLDivElement) {
    portalRoot = existing;
    return existing;
  }
  const created = document.createElement("div");
  created.id = PORTAL_ROOT_ID;
  // Themed surface inheritance: portal root lives outside `#root` so it
  // does NOT inherit the React tree's CSS-Module hash classes, but it does
  // inherit `data-theme` from `<html>` (set in `app/index.tsx` before mount).
  document.body.appendChild(created);
  portalRoot = created;
  return created;
}

export interface PortalProviderProps {
  children: ReactNode;
}

/**
 * `PortalProvider` — funnels every RAC overlay (Modal, Popover, Tooltip,
 * Menu, Select, ComboBox popover, …) into a single sibling of `#root`.
 *
 * Why not the official `UNSAFE_PortalProvider` from `react-aria`? RAC
 * v1.17.0 does not re-export it (it lives in the `react-aria` package,
 * which is a transitive dependency we cannot promote without a new
 * direct install). Until we adopt RAC's PortalProvider directly, we
 * achieve the same effect by setting the (still-supported, deprecated
 * in v1.17) `UNSTABLE_portalContainer` slot on `ModalContext`,
 * `PopoverContext`, and `TooltipContext` via RAC's `<Provider>`. When
 * the library bumps the official Portal provider into the public
 * surface, the migration is local to this file.
 *
 * The container is a `<div id="catique-portal-root">` mounted as a
 * sibling of `<div id="root">` — chosen over a ref-tracked element on
 * `<App>` because the portal must survive App-level re-renders / route
 * transitions and because a top-level sibling keeps DevTools sanity
 * trivial: open the inspector and confirm exactly one `#catique-portal-root`
 * at the bottom of `<body>`.
 */
export function PortalProvider({
  children,
}: PortalProviderProps): ReactElement {
  // We resolve the container in a layout-effect-equivalent flow so SSR
  // does not access `document`. `useState` ensures we do the work once.
  const [container, setContainer] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : getOrCreatePortalRoot(),
  );

  useEffect(() => {
    if (container) return;
    setContainer(getOrCreatePortalRoot());
  }, [container]);

  if (!container) {
    // First SSR pass — render children without overlay redirection. RAC
    // overlays would not render server-side anyway (they require a state
    // transition), so this is safe.
    return <>{children}</>;
  }

  return (
    <RACProvider
      values={[
        [ModalContext, { UNSTABLE_portalContainer: container }],
        [PopoverContext, { UNSTABLE_portalContainer: container }],
        [TooltipContext, { UNSTABLE_portalContainer: container }],
      ]}
    >
      {children}
    </RACProvider>
  );
}
