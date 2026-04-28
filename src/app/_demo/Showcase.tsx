/**
 * `_demo/Showcase` — historical E1.3 primitive validation page.
 *
 * Kept off the main entry path (E2.3 wires `BoardsList` instead). Lives
 * here so future contributors can quickly eyeball Button + Dialog
 * variants without spinning up Storybook (which is deferred to E2.7;
 * see `src/shared/ui/README.md`).
 *
 * Not exported from `@app` — import the file directly when needed:
 *   import Showcase from "@app/_demo/Showcase";
 */

import { Button, Dialog, DialogTrigger } from "@shared/ui";

import styles from "../App.module.css";

export default function Showcase() {
  return (
    <main className={styles.main}>
      <h1 className={styles.heading}>Catique HUB — primitives showcase</h1>
      <p className={styles.subhead}>
        Validation page from E1.3. Exercises every primitive shipped in
        `shared/ui` (Button × 3 variants + Dialog).
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
