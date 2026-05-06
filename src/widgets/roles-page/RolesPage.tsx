/**
 * RolesPage — two-pane shell wrapping the existing `<RolesList>`.
 *
 * Round-19f: every routed surface ships a list-rail sidebar.
 * audit-#9 (wave-3): the editor is now a routed PAGE on `/roles/:roleId`
 * (previously a modal Dialog mounted in this page). Selecting a role
 * navigates the URL; the page renders `<RoleEditorPanel>` in the content
 * slot when a role id is in the URL, otherwise shows the master grid.
 */

import { useState, type ReactElement } from "react";
import { useLocation, useRoute } from "wouter";

import { useRoles } from "@entities/role";
import { Scrollable } from "@shared/ui";
import { RoleCreateDialog } from "@widgets/role-create-dialog";
import { RoleEditorPanel } from "@widgets/role-editor";
import { EntityListSidebar } from "@widgets/entity-list-sidebar";
import { RolesList } from "@widgets/roles-list";
import { rolePath, routes } from "@app/routes";

import shellStyles from "@widgets/entity-list-sidebar/EntityPageShell.module.css";

export function RolesPage(): ReactElement {
  const rolesQuery = useRoles();
  const [, setLocation] = useLocation();
  const [match, params] = useRoute<{ roleId: string }>(routes.role);
  const selectedId = match ? params?.roleId ?? null : null;
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const items = (rolesQuery.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
  }));

  const handleSelect = (id: string | null): void => {
    setLocation(id ? rolePath(id) : routes.roles);
  };

  return (
    <section className={shellStyles.root} data-testid="roles-page-root">
      <div className={shellStyles.sidebarSlot}>
        <EntityListSidebar
          title="ROLES"
          ariaLabel="Roles navigation"
          items={items}
          selectedId={selectedId}
          onSelect={(id) => handleSelect(id)}
          addLabel="Add role"
          onAdd={() => setIsCreateOpen(true)}
          emptyText="No roles yet."
          testIdPrefix="roles-sidebar"
          isLoading={rolesQuery.status === "pending"}
          errorMessage={
            rolesQuery.status === "error"
              ? `Failed to load roles: ${rolesQuery.error.message}`
              : null
          }
        />
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
