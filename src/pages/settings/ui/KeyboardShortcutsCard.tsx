import type { ReactElement } from "react";

import styles from "../SettingsView.module.css";

export function KeyboardShortcutsCard(): ReactElement {
  return (
    <section
      className={styles.card}
      aria-labelledby="settings-keyboard-shortcuts"
      data-testid="settings-keyboard-shortcuts-section"
    >
      <h3 id="settings-keyboard-shortcuts" className={styles.cardHeading}>
        Keyboard shortcuts
      </h3>
      <div className={styles.cardBody}>
        <p className={styles.hint}>
          Quick reference for the available shortcuts.
        </p>
        <div className={styles.shortcutsGrid}>
          <kbd className={styles.kbd}>⌘K</kbd>
          <span className={styles.shortcutDesc}>Open global search</span>

          <kbd className={styles.kbd}>⌘N</kbd>
          <span className={styles.shortcutDesc}>New task</span>

          <kbd className={styles.kbd}>Esc</kbd>
          <span className={styles.shortcutDesc}>Close dialog / palette</span>

          <kbd className={styles.kbd}>Enter</kbd>
          <span className={styles.shortcutDesc}>Activate focused item</span>

          <kbd className={styles.kbd}>Tab / Shift+Tab</kbd>
          <span className={styles.shortcutDesc}>Move focus</span>
        </div>
      </div>
    </section>
  );
}
