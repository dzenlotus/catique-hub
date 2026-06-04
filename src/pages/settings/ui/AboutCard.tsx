import type { ReactElement } from "react";

import pkgJson from "../../../../package.json";
import styles from "../SettingsView.module.css";

// resolveJsonModule is enabled in tsconfig.json, so direct import is fine.
const APP_VERSION: string = pkgJson.version;

export function AboutCard(): ReactElement {
  return (
    <section className={styles.card} aria-labelledby="settings-about">
      <h3 id="settings-about" className={styles.cardHeading}>
        About
      </h3>
      <div className={styles.cardBody}>
        <dl className={styles.dl}>
          <dt className={styles.dt}>Version</dt>
          <dd className={styles.dd} data-testid="app-version">
            {APP_VERSION}
          </dd>

          <dt className={styles.dt}>License</dt>
          <dd className={styles.dd}>Elastic-2.0</dd>

          <dt className={styles.dt}>Source code</dt>
          <dd className={styles.dd}>GitHub / catique-hub (link TBD)</dd>
        </dl>
      </div>
    </section>
  );
}
