import { type ReactElement } from "react";

import { PixelInterfaceEssentialSettingCog } from "@shared/ui/Icon";

import styles from "./PromptsSettingsButton.module.css";

export interface PromptsSettingsButtonProps {
  /**
   * Fires when the user picks the cog. The parent (PromptsPage)
   * swaps its right-pane content for the inline `<PromptsSettings>`
   * surface — round-19e: the Prompts shell stays visible so the rule
   * "edit/settings is a routed page with Back, never a modal" reads
   * inside the existing sidebar layout instead of navigating away.
   */
  onPress: () => void;
}

export function PromptsSettingsButton({
  onPress,
}: PromptsSettingsButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={styles.trigger}
      onClick={onPress}
      aria-label="Prompts settings"
      data-testid="prompts-sidebar-settings-trigger"
    >
      <PixelInterfaceEssentialSettingCog
        width={12}
        height={12}
        aria-hidden={true}
      />
    </button>
  );
}
