/**
 * RolesPage — two-pane shell wrapping the existing `<RolesList>`.
 *
 * Round-19f: every routed surface now ships a list-rail sidebar. This
 * page mounts `<EntityListSidebar>` on the left (listing all roles)
 * and the existing `<RolesList>` grid on the right. Clicking a row
 * in the sidebar opens the same in-grid `<RoleEditor>` modal the
 * card-click path uses today.
 */

import { useState, type ReactElement } from "react";

import { useRoles } from "@entities/role";
import { Scrollable } from "@shared/ui";
import { RoleCreateDialog } from "@widgets/role-create-dialog";
import { RoleEditor } from "@widgets/role-editor";
import { EntityListSidebar } from "@widgets/entity-list-sidebar";
import { RolesList } from "@widgets/roles-list";

import shellStyles from "@widgets/entity-list-sidebar/EntityPageShell.module.css";

export function RolesPage(): ReactElement {
  const rolesQuery = useRoles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const items = (rolesQuery.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
  }));

  return (
    <section className={shellStyles.root} data-testid="roles-page-root">
      <div className={shellStyles.sidebarSlot}>
        <EntityListSidebar
          title="AGENT ROLES"
          ariaLabel="Agent roles navigation"
          items={items}
          selectedId={selectedId}
          onSelect={setSelectedId}
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
        <RolesList
          onSelectRole={setSelectedId}
          onCreate={() => setIsCreateOpen(true)}
        />
      </Scrollable>

      <RoleEditor
        roleId={selectedId}
        onClose={() => setSelectedId(null)}
      />
      <RoleCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
  );
}
