import type { ReactElement } from "react";
import { useCallback, useState } from "react";

import { Button } from "@shared/ui";
import { invoke } from "@shared/api";
import { useToast } from "@shared/lib";

import { useSeedPrompts } from "../useSeedPrompts";
import styles from "../SettingsView.module.css";

/**
 * Open the native "save" dialog for a database snapshot. Dynamically
 * imports the dialog plugin so vitest / browser-preview runtimes (no
 * Tauri IPC) don't crash — returns `null` there, same as a cancel.
 */
async function pickExportPath(): Promise<string | null> {
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const selected = await save({
      title: "Export Catique data",
      defaultPath: "catique-export.sqlite",
      filters: [{ name: "SQLite database", extensions: ["sqlite", "db"] }],
    });
    return typeof selected === "string" ? selected : null;
  } catch {
    return null;
  }
}

/** Open the native "open" dialog to choose a database file to import. */
async function pickImportPath(): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      title: "Import Catique data",
      multiple: false,
      directory: false,
      filters: [{ name: "SQLite database", extensions: ["sqlite", "db"] }],
    });
    return typeof selected === "string" ? selected : null;
  } catch {
    return null;
  }
}

export function DataCard(): ReactElement {
  const { isSeeding, seedPrompts } = useSeedPrompts();
  const { pushToast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleSeedPress = useCallback(() => {
    void seedPrompts();
  }, [seedPrompts]);

  const handleExportPress = useCallback(() => {
    void (async () => {
      const destPath = await pickExportPath();
      if (destPath === null) return;
      setIsExporting(true);
      try {
        await invoke<void>("export_database", { destPath });
        pushToast("success", "Data exported");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pushToast("error", `Export failed: ${message}`);
      } finally {
        setIsExporting(false);
      }
    })();
  }, [pushToast]);

  const handleImportPress = useCallback(() => {
    void (async () => {
      const srcPath = await pickImportPath();
      if (srcPath === null) return;
      setIsImporting(true);
      try {
        await invoke<void>("import_database", { srcPath });
        pushToast(
          "success",
          "Import staged — restart Catique HUB to apply it.",
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pushToast("error", `Import failed: ${message}`);
      } finally {
        setIsImporting(false);
      }
    })();
  }, [pushToast]);

  return (
    <section className={styles.card} aria-labelledby="settings-data">
      <h3 id="settings-data" className={styles.cardHeading}>
        Data
      </h3>
      <div className={styles.cardBody}>
        <dl className={styles.dl}>
          <dt className={styles.dt}>Export</dt>
          <dd className={styles.dd}>
            Save a complete snapshot of your database (spaces, projects,
            agents, prompts — everything) to a <code className={styles.code}>.sqlite</code> file.
          </dd>

          <dt className={styles.dt}>Import</dt>
          <dd className={styles.dd}>
            Replace the current database with a previously exported file.
            The current data is backed up first; the swap takes effect
            after a restart.
          </dd>

          <dt className={styles.dt}>Database location (SQLite)</dt>
          <dd className={styles.dd}>
            <code className={styles.code}>$APPLOCALDATA/catique/db.sqlite</code>
          </dd>
        </dl>

        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            isPending={isExporting}
            onPress={handleExportPress}
            data-testid="settings-data-export"
          >
            Export data
          </Button>
          <Button
            variant="secondary"
            size="sm"
            isPending={isImporting}
            onPress={handleImportPress}
            data-testid="settings-data-import"
          >
            Import data
          </Button>
          <Button
            variant="secondary"
            size="sm"
            isPending={isSeeding}
            onPress={handleSeedPress}
            data-testid="settings-data-seed-prompts"
          >
            Seed test prompts
          </Button>
        </div>
      </div>
    </section>
  );
}
