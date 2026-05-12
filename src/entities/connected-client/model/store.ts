/**
 * Connected-providers query-cache layer (round-21 refactor).
 *
 * Built on `@tanstack/react-query`. Query-key root: `["connected_clients"]`
 * (kept unchanged so existing `EventsProvider` invalidation paths stay
 * intact while the IPC surface migrates to the round-21 names).
 *
 * What changed in round-21:
 *   - dropped `useDiscoverClientsMutation`, `useSetClientEnabledMutation`,
 *     `useSyncRolesToClientMutation`, `useSyncedClientRoles`,
 *     `useClientInstructions`, `useWriteClientInstructionsMutation`,
 *     and `syncRolesToAllSupportingClients` — manual-rescan, per-card
 *     enable, manual sync, instructions, and frontend role-sync fanout
 *     are no longer part of the product.
 *   - added `useSupportedProviders`, `useAddProviderMutation`,
 *     `useRemoveProviderMutation`, `useSyncStatus`. Sync now happens
 *     server-side on every save that touches agents; the topbar
 *     indicator reads `useSyncStatus`, which is invalidated by the
 *     `sync:status_changed` event in `EventsProvider`.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  addProvider,
  getSyncStatus,
  listConnectedProviders,
  listSupportedProviders,
  removeProvider,
  type SupportedProvider,
  type SyncStatus,
} from "../api";
import type { ConnectedClient } from "./types";

// TODO(round-21-backend): drop client-instructions IPC
// (`read_client_instructions` / `write_client_instructions`) and the
// `client:instructions_changed` event — the frontend deleted the
// editor widget and the corresponding hooks
// (`useClientInstructions`, `useWriteClientInstructionsMutation`)
// in round-21. Same applies to the manual role-sync IPC
// (`sync_roles_to_client`, `list_synced_client_roles`) and the
// `client:roles_synced` event — sync now runs server-side on every
// agent-touching save and reports through `sync:status_changed`.

/** Query-key factory. */
export const connectedClientsKeys = {
  all: ["connected_clients"] as const,
  list: () => [...connectedClientsKeys.all] as const,
  supported: () => [...connectedClientsKeys.all, "supported"] as const,
  syncStatus: () => [...connectedClientsKeys.all, "sync_status"] as const,
};

/**
 * `useConnectedClients` — list connected providers (post-detection / post-Add).
 *
 * Returns the standard react-query result object. Renamed surface keeps
 * the existing hook name so call-sites that already import it from
 * `@entities/connected-client` keep working.
 */
export function useConnectedClients(): UseQueryResult<
  ConnectedClient[],
  Error
> {
  return useQuery({
    queryKey: connectedClientsKeys.list(),
    queryFn: listConnectedProviders,
  });
}

/**
 * `useSupportedProviders` — catalog for the Add-provider modal. Static
 * per-app-version, but we fetch through react-query for consistency
 * with the rest of the IPC layer.
 */
export function useSupportedProviders(): UseQueryResult<
  SupportedProvider[],
  Error
> {
  return useQuery({
    queryKey: connectedClientsKeys.supported(),
    queryFn: listSupportedProviders,
  });
}

/**
 * `useAddProviderMutation` — connect a provider by id, then invalidate
 * the connected list so the Settings row appears immediately.
 */
export function useAddProviderMutation(): UseMutationResult<
  ConnectedClient,
  Error,
  string // providerId
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addProvider,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: connectedClientsKeys.list(),
      });
    },
  });
}

/**
 * `useRemoveProviderMutation` — disconnect a provider. Backend cleans
 * Catique-owned agent files and drops the `catique-hub` MCP entry from
 * the provider's config; we only invalidate the list.
 */
export function useRemoveProviderMutation(): UseMutationResult<
  void,
  Error,
  string // providerId
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeProvider,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: connectedClientsKeys.list(),
      });
    },
  });
}

/**
 * `useSyncStatus` — global sync state for the topbar indicator.
 *
 * Real-time updates arrive via the `sync:status_changed` Tauri event,
 * wired in `EventsProvider`. The query itself just owns the cache slot
 * — invalidation triggers a re-fetch of `get_sync_status`. The query
 * stays mounted as long as the topbar is visible (i.e. always), so
 * `gcTime` defaults are fine.
 */
export function useSyncStatus(): UseQueryResult<SyncStatus, Error> {
  return useQuery({
    queryKey: connectedClientsKeys.syncStatus(),
    queryFn: getSyncStatus,
  });
}
