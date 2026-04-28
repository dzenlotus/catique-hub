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
  readClientInstructions,
  writeClientInstructions,
} from "./api";
export type { SetClientEnabledArgs } from "./api";

// Model
export {
  connectedClientsKeys,
  useConnectedClients,
  useDiscoverClientsMutation,
  useSetClientEnabledMutation,
  useClientInstructions,
  useWriteClientInstructionsMutation,
} from "./model";
export type { ConnectedClient, WriteClientInstructionsArgs } from "./model";

// UI
export { ConnectedClientCard } from "./ui";
export type { ConnectedClientCardProps } from "./ui";
