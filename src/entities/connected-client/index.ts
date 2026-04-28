/**
 * `entities/connected-client` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api`, `./model`, and `./ui` MUST NOT be
 * imported directly from outside this slice.
 */

// API
export {
  listConnectedClients,
  discoverClients,
  setClientEnabled,
} from "./api";
export type { SetClientEnabledArgs } from "./api";

// Model
export {
  connectedClientsKeys,
  useConnectedClients,
  useDiscoverClientsMutation,
  useSetClientEnabledMutation,
} from "./model";
export type { ConnectedClient } from "./model";

// UI
export { ConnectedClientCard } from "./ui";
export type { ConnectedClientCardProps } from "./ui";
