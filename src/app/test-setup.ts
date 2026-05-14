// Vitest setup — runs before every test file.
// Imports custom DOM matchers (`toBeInTheDocument`, `toHaveTextContent`, etc.)
// from @testing-library/jest-dom.

import "@testing-library/jest-dom/vitest";

// jsdom polyfills required by @dnd-kit/react (which calls ResizeObserver
// from @dnd-kit/dom on import). jsdom does not implement these.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

// jsdom polyfill — `Document.getAnimations` + `Element.getAnimations`
// are required by @dnd-kit/dom's feedback layer when a sortable is
// mounted with a `data-draggable` attribute. jsdom doesn't ship them;
// we return an empty list so the animation-flush code path is a no-op.
if (
  typeof document !== "undefined" &&
  typeof (document as Document & { getAnimations?: () => Animation[] })
    .getAnimations !== "function"
) {
  (
    document as Document & { getAnimations: () => Animation[] }
  ).getAnimations = (): Animation[] => [];
}
if (
  typeof Element !== "undefined" &&
  typeof (Element.prototype as Element & { getAnimations?: () => Animation[] })
    .getAnimations !== "function"
) {
  (
    Element.prototype as Element & { getAnimations: () => Animation[] }
  ).getAnimations = (): Animation[] => [];
}

// jsdom polyfill — `window.matchMedia` is touched by @dnd-kit/dom's
// `prefersReducedMotion` lookup when a sortable mounts. jsdom doesn't
// implement matchMedia; we return a never-matching stub so the
// feedback layer treats the environment as motion-allowed.
if (
  typeof window !== "undefined" &&
  typeof window.matchMedia !== "function"
) {
  type MediaQueryListLike = {
    matches: boolean;
    media: string;
    onchange: null;
    addListener: () => void;
    removeListener: () => void;
    addEventListener: () => void;
    removeEventListener: () => void;
    dispatchEvent: () => boolean;
  };
  window.matchMedia = (query: string): MediaQueryList => {
    const stub: MediaQueryListLike = {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
    return stub as unknown as MediaQueryList;
  };
}
