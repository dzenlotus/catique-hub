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
