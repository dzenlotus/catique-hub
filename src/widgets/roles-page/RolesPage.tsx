/**
 * RolesPage — two-pane shell wrapping the existing `<RolesList>`.
 *
 * Round-23 (entity-tree unification): the secondary rail now renders
 * the shared `<EntityTree>` primitive, replacing the per-page
 * `<EntityListSidebar>`. Every other entity page uses the same
 * primitive so row spacing, indent, chevron handling, and active-row
 * visuals stay identical across surfaces.
 *
 * audit-#9 (wave-3): the editor is a routed PAGE on `/roles/:roleId`
 * (previously a modal Dialog mounted in this page). Selecting a role
 * navigates the URL; the page renders `<RoleEditorPanel>` in the content
 * slot when a role id is in the URL, otherwise shows the master grid.
 */

import { useMemo, useState, type ReactElement } from "react";
import { useLocation, useRoute } from "wouter";

import { useRoles } from "@entities/role";
import { EntityTree, Scrollable } from "@shared/ui";
import type { EntityTreeNode } from "@shared/ui";
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

  const nodes = useMemo<ReadonlyArray<EntityTreeNode>>(
    () =>
      (rolesQuery.data ?? []).map((r) => ({
        id: r.id,
        label: r.name,
        ...(r.icon != null ? { leadingIcon: r.icon } : {}),
        ...(r.color != null ? { leadingColor: r.color } : {}),
      })),
    [rolesQuery.data],
  );

  const handleSelect = (id: string | null): void => {
    setLocation(id ? rolePath(id) : routes.roles);
  };

  return (
    <section className={shellStyles.root} data-testid="roles-page-root">
      <div className={shellStyles.sidebarSlot}>
        <EntityTree
          title="ROLES"
          ariaLabel="Roles navigation"
          nodes={nodes}
          selectedId={selectedId}
          expandedIds={[]}
          onToggleExpand={() => {}}
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
