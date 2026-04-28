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
  readClientInstructions,
  setClientEnabled,
  writeClientInstructions,
  type SetClientEnabledArgs,
} from "../api";
import type { ClientInstructions } from "@bindings/ClientInstructions";
import type { ConnectedClient } from "./types";

/** Query-key factory. */
export const connectedClientsKeys = {
  all: ["connected_clients"] as const,
  list: () => [...connectedClientsKeys.all] as const,
  instructions: (clientId: string) =>
    [...connectedClientsKeys.all, "instructions", clientId] as const,
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

/**
 * `useClientInstructions` — load the global instructions file for a client.
 *
 * Disabled when `clientId` is an empty string (dialog closed state).
 */
export function useClientInstructions(
  clientId: string,
): UseQueryResult<ClientInstructions, Error> {
  return useQuery({
    queryKey: connectedClientsKeys.instructions(clientId),
    queryFn: () => readClientInstructions(clientId),
    enabled: clientId.length > 0,
  });
}

export interface WriteClientInstructionsArgs {
  clientId: string;
  content: string;
}

/**
 * `useWriteClientInstructionsMutation` — write (overwrite) the instructions
 * file. Invalidates the per-client instructions query and the client list
 * on success.
 */
export function useWriteClientInstructionsMutation(): UseMutationResult<
  ClientInstructions,
  Error,
  WriteClientInstructionsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, content }: WriteClientInstructionsArgs) =>
      writeClientInstructions(clientId, content),
    onSuccess: (_data, { clientId }) => {
      void queryClient.invalidateQueries({
        queryKey: connectedClientsKeys.instructions(clientId),
      });
      void queryClient.invalidateQueries({
        queryKey: connectedClientsKeys.list(),
      });
    },
  });
}
