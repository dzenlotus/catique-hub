import { type ReactElement } from "react";

import { RoleCard, useRoles } from "@entities/role";
import { Button, EmptyState, Scrollable } from "@shared/ui";
import { PixelPetAnimalsCat } from "@shared/ui/Icon";

import styles from "./RolesList.module.css";

export interface RolesListProps {
  /** Called when the user activates a role card. */
  onSelectRole?: (roleId: string) => void;
  /** Called when the user clicks the header "Create role" button. */
  onCreate?: () => void;
}

/**
 * `RolesList` — widget that renders all roles.
 *
 * Async-UI states:
 *   1. loading — three skeleton cards.
 *   2. error — inline error panel + retry.
 *   3. empty — friendly headline + CTA.
 *   4. populated — CSS-grid of `RoleCard`s.
 *
 * Prompt-attach DnD was removed when the widget was migrated off
 * `@dnd-kit/core`.
 */
export function RolesList({
  onSelectRole,
  onCreate,
}: RolesListProps = {}): ReactElement {
  const rolesQuery = useRoles();

  return (
    <Scrollable
      axis="y"
      className={styles.scrollHost}
      data-testid="roles-list-scroll"
    >
    <section className={styles.root} aria-labelledby="roles-list-heading">
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <PixelPetAnimalsCat
            width={20}
            height={20}
            className={styles.headingIcon}
            aria-hidden={true}
          />
          <div className={styles.headingText}>
            <h2 id="roles-list-heading" className={styles.heading}>
              Cats
            </h2>
            <p className={styles.description}>
              The cats — personas your AI agents adopt for a task.
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="primary"
            size="md"
            onPress={() => onCreate?.()}
            data-testid="roles-list-create-button"
          >
            Create cat
          </Button>
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.rolesArea}>
          {rolesQuery.status === "pending" ? (
            <div className={styles.grid} data-testid="roles-list-loading">
              <RoleCard isPending />
              <RoleCard isPending />
              <RoleCard isPending />
            </div>
          ) : rolesQuery.status === "error" ? (
            <div className={styles.error} role="alert">
              <p className={styles.errorMessage}>
                Failed to load roles: {rolesQuery.error.message}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => {
                  void rolesQuery.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          ) : rolesQuery.data.length === 0 ? (
            <div className={styles.empty} data-testid="roles-list-empty">
              <EmptyState
                icon={<PixelPetAnimalsCat width={64} height={64} />}
                title="No cats yet"
                description="The cats your AI agents adopt for tasks."
                action={
                  <Button
                    variant="primary"
                    size="md"
                    onPress={() => onCreate?.()}
                  >
                    Create cat
                  </Button>
                }
              />
            </div>
          ) : (
            <div className={styles.grid} data-testid="roles-list-grid">
              {rolesQuery.data.map((role) => (
                <RoleCard
                  key={role.id}
                  role={role}
                  onSelect={(id) => onSelectRole?.(id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

    </section>
    </Scrollable>
  );
}
