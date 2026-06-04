// ---------------------------------------------------------------------------
// Sidebar table of contents (round-19c). Each entry is matched 1:1 against
// the `id` attribute on the corresponding `<section>` so click → scroll.
// ---------------------------------------------------------------------------

export interface SettingsSection {
  id: string;
  label: string;
}

export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSection> = [
  { id: "settings-appearance", label: "Appearance" },
  { id: "settings-keyboard-shortcuts", label: "Keyboard shortcuts" },
  { id: "settings-tokens", label: "Tokens" },
  { id: "settings-data", label: "Data" },
  { id: "settings-mcp-sidecar", label: "MCP sidecar" },
  { id: "settings-about", label: "About" },
];

/**
 * Smooth-scroll the visible Settings page so the section anchored on
 * `id` is at the top of the viewport. Falls back to `scrollIntoView`
 * default behaviour when `prefers-reduced-motion` is set, which the
 * platform respects automatically.
 */
export function scrollToSection(id: string): void {
  if (typeof document === "undefined") return;
  const target = document.getElementById(id);
  if (target === null) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}
