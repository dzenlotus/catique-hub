import { useState, type ReactElement } from "react";

import { RoleCard, useRoles } from "@entities/role";
import { Button, EmptyState, Scrollable } from "@shared/ui";
import { PixelBusinessProductsNetworkUser } from "@shared/ui/Icon";
import { RoleEditor } from "@widgets/role-editor";
import { RoleCreateDialog } from "@widgets/role-create-dialog";

import styles from "./RolesList.module.css";

export interface RolesListProps {
  /** Called when the user activates a role card. */
  onSelectRole?: (roleId: string) => void;
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
export function RolesList({ onSelectRole }: RolesListProps = {}): ReactElement {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
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
          <PixelBusinessProductsNetworkUser
            width={20}
            height={20}
            className={styles.headingIcon}
            aria-hidden={true}
          />
          <div className={styles.headingText}>
            <h2 id="roles-list-heading" className={styles.heading}>
              Agent roles
            </h2>
            <p className={styles.description}>
              Personas your AI agents adopt for a task.
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="primary"
            size="md"
            onPress={() => setIsCreateOpen(true)}
            data-testid="roles-list-create-button"
          >
            Create role
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
                icon={<PixelBusinessProductsNetworkUser width={64} height={64} />}
                title="No agent roles yet"
                description="Personas your AI agents adopt for tasks."
                action={
                  <Button
                    variant="primary"
                    size="md"
                    onPress={() => setIsCreateOpen(true)}
                  >
                    Create role
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
                  onSelect={(id) => {
                    setSelectedRoleId(id);
                    onSelectRole?.(id);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <RoleEditor
        roleId={selectedRoleId}
        onClose={() => setSelectedRoleId(null)}
      />

      <RoleCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
    </Scrollable>
  );
}
