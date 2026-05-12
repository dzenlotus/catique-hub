/**
 * `entities/connected-client` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api` and `./model` MUST NOT be imported
 * directly from outside this slice.
 *
 * Round-21: surface narrowed — `discoverClients`, `setClientEnabled`,
 * the instructions IPCs, and the manual role-sync IPC were removed.
 * The presentational `ConnectedClientCard` was retired alongside the
 * settings rewrite (its toggle/instructions/sync controls no longer
 * exist in the product).
 */

// API
export {
  listConnectedProviders,
  listSupportedProviders,
  addProvider,
  removeProvider,
  getSyncStatus,
} from "./api";
export type { SupportedProvider, SyncStatus } from "./api";

// Model
export {
  connectedClientsKeys,
  useConnectedClients,
  useSupportedProviders,
  useAddProviderMutation,
  useRemoveProviderMutation,
  useSyncStatus,
} from "./model";
export type { ConnectedClient } from "./model";
