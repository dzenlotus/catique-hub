/**
 * RolesPage — two-pane shell wrapping the existing `<RolesList>`.
 *
 * Round-26 (Row/Group split): the secondary rail composes
 * `<RailSection>` + `<Row>` explicitly instead of feeding a `nodes`
 * array into the old `<EntityTree>`. Visual parity preserved — `<Row>`
 * owns the active strip + hover overlay; this page just iterates roles
 * and supplies a label-button via `<RowLabelButton>`.
 *
 * audit-#9 (wave-3): the editor is a routed PAGE on `/roles/:roleId`
 * (previously a modal Dialog mounted in this page). Selecting a role
 * navigates the URL; the page renders `<RoleEditorPanel>` in the
 * content slot when a role id is in the URL, otherwise shows the
 * master grid.
 */

import { useState, type ReactElement } from "react";
import { useLocation, useRoute } from "wouter";

import { useRoles } from "@entities/role";
import {
  RailSection,
  Row,
  RowLabelButton,
  Scrollable,
  SidebarShell,
} from "@shared/ui";
import { RoleCreateDialog } from "@widgets/role-create-dialog";
import { RoleEditorPanel } from "@widgets/role-editor";
import { entityPageShellStyles as shellStyles } from "@widgets/entity-page-shell";
import { RolesList } from "@widgets/roles-list";
import { rolePath, routes } from "@app/routes";

export function RolesPage(): ReactElement {
  const rolesQuery = useRoles();
  const [, setLocation] = useLocation();
  const [match, params] = useRoute<{ roleId: string }>(routes.role);
  const selectedId = match ? params?.roleId ?? null : null;
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const roles = rolesQuery.data ?? [];

  const handleSelect = (id: string | null): void => {
    setLocation(id ? rolePath(id) : routes.roles);
  };

  return (
    <section className={shellStyles.root} data-testid="roles-page-root">
      <div className={shellStyles.sidebarSlot}>
        <SidebarShell
          ariaLabel="Roles navigation"
          testId="roles-sidebar-root-shell"
        >
          <RailSection
            title="ROLES"
            titleAriaLabel="Roles navigation"
            testIdPrefix="roles-sidebar"
            addLabel="Add role"
            onAdd={() => setIsCreateOpen(true)}
            emptyText="No roles yet."
            isLoading={rolesQuery.status === "pending"}
            errorMessage={
              rolesQuery.status === "error"
                ? `Failed to load roles: ${rolesQuery.error.message}`
                : null
            }
            isEmpty={roles.length === 0}
          >
            {roles.map((role) => (
              <Row
                key={role.id}
                testId={`roles-sidebar-item-${role.id}`}
                isActive={role.id === selectedId}
                onClick={() => handleSelect(role.id)}
                renderContent={() => (
                  <RowLabelButton
                    label={role.name}
                    icon={role.icon}
                    color={role.color}
                    onClick={() => handleSelect(role.id)}
                    testId={`roles-sidebar-row-${role.id}`}
                  />
                )}
              />
            ))}
          </RailSection>
        </SidebarShell>
      </div>

      <Scrollable
        axis="y"
        className={shellStyles.contentSlot}
        data-testid="roles-page-content-scroll"
      >
        {selectedId ? (
          <RoleEditorPanel
            roleId={selectedId}
            onClose={() => handleSelect(null)}
          />
        ) : (
          <RolesList
            onSelectRole={(id) => handleSelect(id)}
            onCreate={() => setIsCreateOpen(true)}
          />
        )}
      </Scrollable>

      <RoleCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
  );
}
