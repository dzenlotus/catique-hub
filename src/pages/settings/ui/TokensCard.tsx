import type { ReactElement } from "react";

import { SettingsTokensView } from "../_tokens-view";
import styles from "../SettingsView.module.css";

export function TokensCard(): ReactElement {
  return (
    <section className={styles.card} aria-labelledby="settings-tokens">
      <h3 id="settings-tokens" className={styles.cardHeading}>
        Tokens
      </h3>
      <div className={styles.cardBody} data-testid="settings-tokens-section">
        <SettingsTokensView />
      </div>
    </section>
  );
}
