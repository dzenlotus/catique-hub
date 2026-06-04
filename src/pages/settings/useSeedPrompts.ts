import { useCallback, useState } from "react";

import { useCreatePromptMutation } from "@entities/prompt";
import { useToast } from "@shared/lib";

import { SEED_PROMPTS } from "./seedPrompts";

export interface UseSeedPromptsResult {
  isSeeding: boolean;
  seedPrompts: () => Promise<void>;
}

/**
 * Seeds the `SEED_PROMPTS` test fixtures sequentially via the prompt-create
 * mutation, surfacing success / failure through the toast channel. Guards
 * against concurrent runs while a seed is in flight.
 */
export function useSeedPrompts(): UseSeedPromptsResult {
  const createPromptMutation = useCreatePromptMutation();
  const { pushToast } = useToast();
  const [isSeeding, setIsSeeding] = useState(false);

  const seedPrompts = useCallback(async (): Promise<void> => {
    if (isSeeding) return;
    setIsSeeding(true);
    try {
      for (const seed of SEED_PROMPTS) {
        await createPromptMutation.mutateAsync(seed);
      }
      pushToast("success", `Seeded ${SEED_PROMPTS.length} test prompts`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast("error", `Failed to seed prompts: ${message}`);
    } finally {
      setIsSeeding(false);
    }
  }, [isSeeding, createPromptMutation, pushToast]);

  return { isSeeding, seedPrompts };
}
