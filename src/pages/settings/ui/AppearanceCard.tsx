import type { ReactElement } from "react";
import { useCallback } from "react";

import { GroupButton } from "@shared/ui";

import type { Theme } from "../theme";
import styles from "../SettingsView.module.css";

interface AppearanceCardProps {
  activeTheme: Theme;
  onThemeChange: (next: Theme) => void;
}

export function AppearanceCard({
  activeTheme,
  onThemeChange,
}: AppearanceCardProps): ReactElement {
  const handleSelectionChange = useCallback(
    (key: React.Key) => {
      onThemeChange(key as Theme);
    },
    [onThemeChange],
  );

  return (
    <section className={styles.card} aria-labelledby="settings-appearance">
      <h3 id="settings-appearance" className={styles.cardHeading}>
        Appearance
      </h3>
      <div className={styles.cardBody}>
        <div className={styles.themePicker}>
          <span className={styles.themePickerLabel}>Theme</span>
          <GroupButton
            selectionMode="single"
            selectedKey={activeTheme}
            onSelectionChange={handleSelectionChange}
            orientation="horizontal"
            size="sm"
            ariaLabel="Theme"
            testId="settings-theme-group"
          >
            <GroupButton.Item id="light" testId="settings-theme-button-light">
              Light
            </GroupButton.Item>
            <GroupButton.Item id="dark" testId="settings-theme-button-dark">
              Dark
            </GroupButton.Item>
          </GroupButton>
          <span
            className={styles.hint}
            data-testid="active-theme-name"
            aria-live="polite"
          >
            {activeTheme === "light" ? "Light" : "Dark"}
          </span>
        </div>
      </div>
    </section>
  );
}
