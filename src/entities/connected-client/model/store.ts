/**
 * Connected-clients query-cache layer (ctq-67).
 *
 * Built on `@tanstack/react-query`. Query key root: `["connected_clients"]`.
 * Also used by `EventsProvider` which invalidates on `client:discovered`,
 * `client:updated`, and `client:removed` events.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  discoverClients,
  listConnectedClients,
  setClientEnabled,
  type SetClientEnabledArgs,
} from "../api";
import type { ConnectedClient } from "./types";

/** Query-key factory. */
export const connectedClientsKeys = {
  all: ["connected_clients"] as const,
  list: () => [...connectedClientsKeys.all] as const,
};

/**
 * `useConnectedClients` — list persisted clients without rescanning.
 *
 * Returns the standard react-query result object.
 */
export function useConnectedClients(): UseQueryResult<
  ConnectedClient[],
  Error
> {
  return useQuery({
    queryKey: connectedClientsKeys.list(),
    queryFn: listConnectedClients,
  });
}

/**
 * `useDiscoverClientsMutation` — trigger a filesystem rescan. Invalidates
 * the client list on success so any mounted `useConnectedClients()` view
 * refreshes immediately.
 */
export function useDiscoverClientsMutation(): UseMutationResult<
  ConnectedClient[],
  Error,
  void
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: discoverClients,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: connectedClientsKeys.list(),
      });
    },
  });
}

/**
 * `useSetClientEnabledMutation` — toggle the `enabled` flag. Invalidates
 * the list on success so the Settings UI reflects the change immediately.
 */
export function useSetClientEnabledMutation(): UseMutationResult<
  ConnectedClient,
  Error,
  SetClientEnabledArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setClientEnabled,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: connectedClientsKeys.list(),
      });
    },
  });
}
