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
import type { ClientInstructions } from "@bindings/ClientInstructions";
import type { ConnectedClient } from "@bindings/ConnectedClient";
import type { RoleSyncReport } from "@bindings/RoleSyncReport";
import type { SyncedRoleFile } from "@bindings/SyncedRoleFile";

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

/** `read_client_instructions` — read the global instructions file. */
export async function readClientInstructions(
  clientId: string,
): Promise<ClientInstructions> {
  return invokeWithAppError<ClientInstructions>("read_client_instructions", {
    clientId,
  });
}

/** `write_client_instructions` — write (overwrite) the global instructions file. */
export async function writeClientInstructions(
  clientId: string,
  content: string,
): Promise<ClientInstructions> {
  return invokeWithAppError<ClientInstructions>("write_client_instructions", {
    clientId,
    content,
  });
}

/**
 * `list_synced_client_roles` — list agent-definition files managed by
 * Catique Hub for this client.
 */
export async function listSyncedClientRoles(
  clientId: string,
): Promise<SyncedRoleFile[]> {
  return invokeWithAppError<SyncedRoleFile[]>("list_synced_client_roles", {
    clientId,
  });
}

/**
 * `sync_roles_to_client` — one-way sync of all Catique Hub roles to the
 * client's agent directory.
 */
export async function syncRolesToClient(
  clientId: string,
): Promise<RoleSyncReport> {
  return invokeWithAppError<RoleSyncReport>("sync_roles_to_client", {
    clientId,
  });
}
