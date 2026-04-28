import { useEffect } from "react";

/**
 * `useGlobalSearchKeybind` — wires a global Cmd+K (macOS) / Ctrl+K
 * (Windows / Linux) keydown listener.
 *
 * Platform detection: `e.metaKey` is true on macOS when the Command key is
 * held; `e.ctrlKey` is used on all other platforms. Both paths require
 * `e.key === "k"` (case-insensitive not needed — browsers normalise to "k").
 *
 * The listener is skipped when the active element is an `<input>`,
 * `<textarea>`, or any element with `contenteditable`, to avoid hijacking
 * editing shortcuts.
 */
export function useGlobalSearchKeybind(onActivate: () => void): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const modifier = e.metaKey || e.ctrlKey;
      if (!modifier || e.key !== "k") return;

      const active = document.activeElement;
      if (active instanceof HTMLInputElement) return;
      if (active instanceof HTMLTextAreaElement) return;
      if (
        active instanceof HTMLElement &&
        active.isContentEditable
      )
        return;

      e.preventDefault();
      onActivate();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onActivate]);
}
