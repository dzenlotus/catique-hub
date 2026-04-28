import { useState, type ReactElement } from "react";
import { Plus } from "lucide-react";

import { RoleCard, useRoles } from "@entities/role";
import { Button } from "@shared/ui";
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
 */
export function RolesList({ onSelectRole }: RolesListProps = {}): ReactElement {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const rolesQuery = useRoles();

  return (
    <section className={styles.root} aria-labelledby="roles-list-heading">
      <header className={styles.header}>
        <h2 id="roles-list-heading" className={styles.heading}>
          Роли
        </h2>
        <Button
          variant="primary"
          size="md"
          onPress={() => setIsCreateOpen(true)}
          data-testid="roles-list-create-button"
        >
          <span className={styles.btnLabel}>
            <Plus size={14} aria-hidden="true" />
            Создать роль
          </span>
        </Button>
      </header>

      {rolesQuery.status === "pending" ? (
        <div className={styles.grid} data-testid="roles-list-loading">
          <RoleCard isPending />
          <RoleCard isPending />
          <RoleCard isPending />
        </div>
      ) : rolesQuery.status === "error" ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            Не удалось загрузить роли: {rolesQuery.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              void rolesQuery.refetch();
            }}
          >
            Повторить
          </Button>
        </div>
      ) : rolesQuery.data.length === 0 ? (
        <div className={styles.empty} data-testid="roles-list-empty">
          <p className={styles.emptyTitle}>Нет ролей</p>
          <p className={styles.emptyHint}>
            Создайте первую роль, чтобы определить ответственности команды.
          </p>
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

      <RoleEditor
        roleId={selectedRoleId}
        onClose={() => setSelectedRoleId(null)}
      />

      <RoleCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
  );
}
