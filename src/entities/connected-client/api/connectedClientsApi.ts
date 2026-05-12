/**
 * Connected-providers IPC client (round-21).
 *
 * Provider lifecycle (replaces ctq-67/68/69 client/adapter shape):
 *   - `list_connected_providers`  — connected providers (post-detection).
 *   - `list_supported_providers`  — pickable catalog for the Add modal.
 *   - `add_provider`              — connect a supported provider id.
 *   - `remove_provider`           — disconnect + clean Catique-owned
 *     agent files + drop the `catique-hub` MCP entry from the provider's
 *     config.
 *   - `get_sync_status`           — current global sync state for the
 *     topbar indicator. Pushes via the `sync:status_changed` event.
 *
 * Detection runs once on first launch; afterwards the user manages
 * providers manually via the Settings UI.
 *
 * Error handling mirrors `entities/role/api/rolesApi.ts`.
 */

import { invokeWithAppError } from "@shared/api";
import type { ConnectedClient } from "@bindings/ConnectedClient";

/**
 * `list_connected_providers` — return persisted providers that the user
 * has actively connected (post-detection or post-Add).
 *
 * NOTE: backend command is named `list_connected_providers` in round-21;
 * the `ConnectedClient` binding is the existing ts-rs shape (rename will
 * happen when the backend agent regenerates bindings).
 */
export async function listConnectedProviders(): Promise<ConnectedClient[]> {
  return invokeWithAppError<ConnectedClient[]>("list_connected_providers");
}

/**
 * Catalog entry for {@link listSupportedProviders} / `add_provider`. Once
 * the backend ships round-21 bindings this gets replaced by
 * `@bindings/SupportedProvider`.
 *
 * TODO(round-21-backend): replace local type with
 * `import type { SupportedProvider } from "@bindings/SupportedProvider"`.
 */
export interface SupportedProvider {
  /** Stable id, e.g. `claude-code`, `cursor`. */
  id: string;
  /** Human-readable display name shown in the Add-provider modal. */
  displayName: string;
}

/** `list_supported_providers` — pickable catalog. */
export async function listSupportedProviders(): Promise<SupportedProvider[]> {
  return invokeWithAppError<SupportedProvider[]>("list_supported_providers");
}

/** `add_provider` — connect the given supported-provider id. */
export async function addProvider(
  providerId: string,
): Promise<ConnectedClient> {
  return invokeWithAppError<ConnectedClient>("add_provider", { providerId });
}

/**
 * `remove_provider` — disconnect a provider.
 *
 * Deletes Catique-owned agent files and drops the `catique-hub` MCP
 * entry from the provider's config. Backend handles the side effects;
 * the frontend only wires the IPC.
 */
export async function removeProvider(providerId: string): Promise<void> {
  return invokeWithAppError<void>("remove_provider", { providerId });
}

/**
 * Sync-status payload exposed through {@link getSyncStatus} and the
 * `sync:status_changed` push event.
 *
 * TODO(round-21-backend): replace local type with
 * `import type { SyncStatus } from "@bindings/SyncStatus"` once the
 * Rust binding lands.
 */
export interface SyncStatus {
  state: "idle" | "syncing" | "error";
  /** Provider ids that failed during the latest fanout (when state === "error"). */
  failingProviders?: string[];
}

/** `get_sync_status` — current global sync state. */
export async function getSyncStatus(): Promise<SyncStatus> {
  return invokeWithAppError<SyncStatus>("get_sync_status");
}
