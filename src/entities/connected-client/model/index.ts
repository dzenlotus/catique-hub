export {
  connectedClientsKeys,
  useConnectedClients,
  useDiscoverClientsMutation,
  useSetClientEnabledMutation,
  useClientInstructions,
  useWriteClientInstructionsMutation,
  useSyncedClientRoles,
  useSyncRolesToClientMutation,
  syncRolesToAllSupportingClients,
} from "./store";
export type { ConnectedClient } from "./types";
export type { WriteClientInstructionsArgs } from "./store";
