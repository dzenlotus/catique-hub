/**
 * Connected-clients IPC client (ctq-67).
 *
 * Wraps the three Tauri commands exposed by
 * `crates/api/src/handlers/clients.rs`. Error handling mirrors
 * `entities/role/api/rolesApi.ts`.
 */

import { invoke } from "@shared/api";
import { AppErrorInstance } from "@entities/board";
import type { AppError } from "@bindings/AppError";
import type { ConnectedClient } from "@bindings/ConnectedClient";

function isAppErrorShape(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== "string") return false;
  return (
    kind === "validation" ||
    kind === "transactionRolledBack" ||
    kind === "dbBusy" ||
    kind === "lockTimeout" ||
    kind === "internalPanic" ||
    kind === "notFound" ||
    kind === "conflict" ||
    kind === "secretAccessDenied"
  );
}

async function invokeWithAppError<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    if (isAppErrorShape(raw)) {
      throw new AppErrorInstance(raw);
    }
    throw raw;
  }
}

/** `list_connected_clients` — return the persisted client list. */
export async function listConnectedClients(): Promise<ConnectedClient[]> {
  return invokeWithAppError<ConnectedClient[]>("list_connected_clients");
}

/** `discover_clients` — rescan the filesystem and return the updated list. */
export async function discoverClients(): Promise<ConnectedClient[]> {
  return invokeWithAppError<ConnectedClient[]>("discover_clients");
}

export interface SetClientEnabledArgs {
  id: string;
  enabled: boolean;
}

/** `set_client_enabled` — toggle the `enabled` flag for a single client. */
export async function setClientEnabled(
  args: SetClientEnabledArgs,
): Promise<ConnectedClient> {
  return invokeWithAppError<ConnectedClient>("set_client_enabled", {
    id: args.id,
    enabled: args.enabled,
  });
}
