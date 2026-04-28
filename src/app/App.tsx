import { Button, Dialog, DialogTrigger } from "@shared/ui";

import styles from "./App.module.css";

/**
 * Root layout shell.
 *
 * E1: validation page that exercises every primitive shipped in
 * `shared/ui` (Button × 3 variants + Dialog). E2 will replace this with
 * the real app router and home page.
 */
export default function App() {
  return (
    <main className={styles.main}>
      <h1 className={styles.heading}>Catique HUB</h1>
      <p className={styles.subhead}>
        Desktop app for AI agent orchestration. Scaffold E1.
      </p>
      <div className={styles.row}>
        <Button variant="primary">Hello</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <DialogTrigger>
          <Button variant="primary">Open dialog</Button>
          <Dialog
            title="Hello from Catique"
            description="Focus is trapped here, Esc closes, scrim click closes."
          >
            {(close) => (
              <div className={styles.dialogActions}>
                <Button variant="ghost" onPress={close}>
                  Cancel
                </Button>
                <Button variant="primary" onPress={close}>
                  Done
                </Button>
              </div>
            )}
          </Dialog>
        </DialogTrigger>
      </div>
    </main>
  );
}
