import type { ReactElement } from "react";
import { useCallback } from "react";

import { Button } from "@shared/ui";

import { useSeedPrompts } from "../useSeedPrompts";
import styles from "../SettingsView.module.css";

export function DataCard(): ReactElement {
  const { isSeeding, seedPrompts } = useSeedPrompts();

  const handleSeedPress = useCallback(() => {
    void seedPrompts();
  }, [seedPrompts]);

  return (
    <section className={styles.card} aria-labelledby="settings-data">
      <h3 id="settings-data" className={styles.cardHeading}>
        Data
      </h3>
      <div className={styles.cardBody}>
        <dl className={styles.dl}>
          <dt className={styles.dt}>Import from Promptery</dt>
          <dd className={styles.dd}>
            Use the import wizard in the application menu.
          </dd>

          <dt className={styles.dt}>Database location (SQLite)</dt>
          <dd className={styles.dd}>
            <code className={styles.code}>
              $APPLOCALDATA/catique/db.sqlite
            </code>
          </dd>

          <dt className={styles.dt}>Backups</dt>
          <dd className={styles.dd}>TBD</dd>
        </dl>

        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            isPending={isSeeding}
            onPress={handleSeedPress}
            data-testid="settings-data-seed-prompts"
          >
            Seed test prompts
          </Button>
          <Button variant="secondary" size="sm" isDisabled>
            Export data (TODO)
          </Button>
          <Button variant="secondary" size="sm" isDisabled>
            Clear data (TODO)
          </Button>
        </div>
      </div>
    </section>
  );
}
