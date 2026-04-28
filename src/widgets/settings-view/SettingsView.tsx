import type { ReactElement } from "react";
import { Button } from "@shared/ui";
import pkgJson from "../../../package.json";
import styles from "./SettingsView.module.css";

// resolveJsonModule is enabled in tsconfig.json, so direct import is fine.
const APP_VERSION: string = pkgJson.version;

function readActiveTheme(): string {
  const attr = document.documentElement.dataset["theme"];
  if (attr === "light") return "Светлая";
  return "Тёмная";
}

/**
 * Settings — top-level settings container.
 *
 * Three sub-sections: Appearance, Data, About.
 * No interactive controls in this slice except disabled affordances in Data.
 * Theme switching is handled by the ThemeToggle in the sidebar footer.
 */
export function SettingsView(): ReactElement {
  const activeTheme = readActiveTheme();

  return (
    <div className={styles.root}>
      <h2 className={styles.pageTitle}>Настройки</h2>

      {/* ── Appearance ─────────────────────────────────────────────── */}
      <section className={styles.card} aria-labelledby="settings-appearance">
        <h3 id="settings-appearance" className={styles.cardHeading}>
          Внешний вид
        </h3>
        <div className={styles.cardBody}>
          <p className={styles.hint}>
            Активная тема:{" "}
            <strong data-testid="active-theme-name">{activeTheme}</strong>
          </p>
          <p className={styles.hint}>
            (используйте переключатель в нижней части боковой панели)
          </p>
        </div>
      </section>

      {/* ── Data ────────────────────────────────────────────────────── */}
      <section className={styles.card} aria-labelledby="settings-data">
        <h3 id="settings-data" className={styles.cardHeading}>
          Данные
        </h3>
        <div className={styles.cardBody}>
          <dl className={styles.dl}>
            <dt className={styles.dt}>Импорт из Promptery</dt>
            <dd className={styles.dd}>
              Используйте мастер импорта из меню приложения.
            </dd>

            <dt className={styles.dt}>Расположение базы данных (SQLite)</dt>
            <dd className={styles.dd}>
              <code className={styles.code}>$APPLOCALDATA/catique/db.sqlite</code>
            </dd>

            <dt className={styles.dt}>Резервные копии</dt>
            <dd className={styles.dd}>TBD</dd>
          </dl>

          <div className={styles.actions}>
            <Button variant="secondary" size="sm" isDisabled>
              Экспортировать данные (TODO)
            </Button>
            <Button variant="secondary" size="sm" isDisabled>
              Очистить данные (TODO)
            </Button>
          </div>
        </div>
      </section>

      {/* ── About ───────────────────────────────────────────────────── */}
      <section className={styles.card} aria-labelledby="settings-about">
        <h3 id="settings-about" className={styles.cardHeading}>
          О приложении
        </h3>
        <div className={styles.cardBody}>
          <dl className={styles.dl}>
            <dt className={styles.dt}>Версия</dt>
            <dd className={styles.dd} data-testid="app-version">
              {APP_VERSION}
            </dd>

            <dt className={styles.dt}>Лицензия</dt>
            <dd className={styles.dd}>Elastic-2.0</dd>

            <dt className={styles.dt}>Исходный код</dt>
            <dd className={styles.dd}>GitHub / catique-hub (ссылка TBD)</dd>
          </dl>
        </div>
      </section>
    </div>
  );
}
