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
import { Button, EmptyState } from "@shared/ui";
import { PixelPetAnimalsCat } from "@shared/ui/Icon";
import { Plus } from "lucide-react";
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
        <div className={styles.headingGroup}>
          <PixelPetAnimalsCat
            width={20}
            height={20}
            className={styles.headingIcon}
            aria-hidden={true}
          />
          <div className={styles.headingText}>
            <h2 id="spaces-list-heading" className={styles.heading}>
              Spaces
            </h2>
            <p className={styles.description}>
              Top-level workspaces. Each space has its own prefix and boards.
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="primary"
            size="md"
            onPress={() => setCreateDialogOpen(true)}
            data-testid="spaces-list-create-button"
          >
            <span className={styles.btnLabel}>
              <Plus size={14} aria-hidden="true" />
              + Create space
            </span>
          </Button>
        </div>
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
          <EmptyState
            icon={<PixelPetAnimalsCat width={64} height={64} />}
            title="No spaces yet"
            description="Top-level workspaces for your boards."
            action={
              <Button
                variant="primary"
                size="md"
                onPress={() => setCreateDialogOpen(true)}
              >
                <span className={styles.btnLabel}>
                  <Plus size={14} aria-hidden="true" />
                  + Create space
                </span>
              </Button>
            }
          />
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
