/**
 * SpacesList — widget that renders all spaces as a list of `<SpaceCard>`s.
 *
 * Reachable only via the space-switcher "Manage spaces" menu item in the
 * Sidebar — there is no top-level nav button for this view.
 *
 * Clicking a SpaceCard sets the active space (via `useActiveSpace`) and
 * navigates back to "boards" so the user immediately sees their boards.
 */

import { useState, type ReactElement } from "react";

import { SpaceCard, useSpaces } from "@entities/space";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { Button } from "@shared/ui";
import { SpaceCreateDialog } from "@widgets/space-create-dialog";

import styles from "./SpacesList.module.css";

export interface SpacesListProps {
  /** Called to navigate back to the boards view after selecting a space. */
  onSelectView: (view: "boards") => void;
}

export function SpacesList({ onSelectView }: SpacesListProps): ReactElement {
  const spacesQuery = useSpaces();
  const { setActiveSpaceId } = useActiveSpace();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  function handleSelectSpace(id: string): void {
    setActiveSpaceId(id);
    onSelectView("boards");
  }

  return (
    <section
      className={styles.root}
      aria-labelledby="spaces-list-heading"
    >
      <header className={styles.header}>
        <h2 id="spaces-list-heading" className={styles.heading}>
          Пространства
        </h2>
        <Button
          variant="primary"
          size="sm"
          onPress={() => setCreateDialogOpen(true)}
          data-testid="spaces-list-create-button"
        >
          + Новое пространство
        </Button>
      </header>

      {spacesQuery.status === "pending" ? (
        <div className={styles.list} data-testid="spaces-list-loading">
          <SpaceCard isPending />
          <SpaceCard isPending />
          <SpaceCard isPending />
        </div>
      ) : spacesQuery.status === "error" ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            Не удалось загрузить пространства: {spacesQuery.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              void spacesQuery.refetch();
            }}
          >
            Повторить
          </Button>
        </div>
      ) : spacesQuery.data.length === 0 ? (
        <div className={styles.empty} data-testid="spaces-list-empty">
          <p className={styles.emptyTitle}>Пространств пока нет</p>
          <p className={styles.emptyHint}>
            Создайте первое пространство, чтобы начать работу.
          </p>
        </div>
      ) : (
        <div className={styles.list} data-testid="spaces-list-grid">
          {spacesQuery.data.map((space) => (
            <SpaceCard
              key={space.id}
              space={space}
              onSelect={handleSelectSpace}
            />
          ))}
        </div>
      )}

      <SpaceCreateDialog
        isOpen={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={(space) => {
          setActiveSpaceId(space.id);
          onSelectView("boards");
        }}
      />
    </section>
  );
}
