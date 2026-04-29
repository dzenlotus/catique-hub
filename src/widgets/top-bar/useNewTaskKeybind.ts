import { useEffect } from "react";

/**
 * `useNewTaskKeybind` — wires a global Cmd+N (macOS) / Ctrl+N
 * (Windows / Linux) keydown listener to open the "New task" dialog.
 *
 * Platform detection mirrors `useGlobalSearchKeybind`: `e.metaKey` for
 * macOS Command, `e.ctrlKey` for all other platforms.
 *
 * The listener is skipped when the active element is an `<input>`,
 * `<textarea>`, or any element with `contenteditable` to avoid hijacking
 * browser-native text editing shortcuts. We also call `e.preventDefault()`
 * to suppress the browser's native "new window / new tab" behaviour.
 */
export function useNewTaskKeybind(onActivate: () => void): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const modifier = e.metaKey || e.ctrlKey;
      if (!modifier || e.key !== "n") return;

      const active = document.activeElement;
      if (active instanceof HTMLInputElement) return;
      if (active instanceof HTMLTextAreaElement) return;
      if (active instanceof HTMLElement && active.isContentEditable) return;

      e.preventDefault();
      onActivate();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onActivate]);
}
