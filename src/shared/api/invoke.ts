/**
 * Tauri `invoke` wrapper — placeholder.
 *
 * Real implementation lands in E2 when the Rust command surface is
 * locked (see roadmap §8). The signature is reserved here so call-sites
 * in widgets/* can be drafted against a stable import path
 * (`@shared/api`) without churn when E2 fills in the body.
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * Type-narrowed wrapper around Tauri's `invoke`.
 *
 * @param command  Rust command name registered in `src-tauri/src/lib.rs`.
 * @param args     Optional argument record. Tauri serialises this to JSON.
 * @returns        Resolves to whatever the Rust handler returns; caller
 *                 supplies `T` because Tauri loses type-info at the FFI
 *                 boundary.
 */
export async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return tauriInvoke<T>(command, args);
}
