/**
 * `pickFolder` — open the OS-native folder picker (Finder on macOS,
 * Explorer on Windows, GTK / KDE on Linux) and return the chosen
 * absolute path.
 *
 * Wraps `@tauri-apps/plugin-dialog` so callers don't have to know about
 * the underlying IPC. The plugin is imported dynamically so non-Tauri
 * runtimes (vitest / jsdom, vite dev preview in a browser tab) don't
 * pay the import cost and don't crash when the IPC bridge is missing.
 *
 * Returns `null` when the user cancels OR when the dialog isn't
 * available (e.g. during unit tests). Errors are swallowed and
 * surfaced as `null` — the picker is a convenience affordance and a
 * missing path is recoverable: the user can still type the path
 * manually into the input.
 *
 * Requires `dialog:allow-open` in the Tauri capability manifest.
 */
export interface PickFolderOptions {
  /** Native dialog title. Falls back to the OS default when omitted. */
  title?: string;
  /** Pre-selected directory the picker opens at. */
  defaultPath?: string;
}

export async function pickFolder(
  options: PickFolderOptions = {},
): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      ...(options.title !== undefined ? { title: options.title } : {}),
      ...(options.defaultPath !== undefined
        ? { defaultPath: options.defaultPath }
        : {}),
    });
    if (typeof selected === "string") return selected;
    return null;
  } catch {
    return null;
  }
}
