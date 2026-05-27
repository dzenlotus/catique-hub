/**
 * RolesPage — two-pane shell wrapping the existing `<RolesList>`.
 *
 * Sidebar uses the unified `<EntityTree/>` with the default row body
 * (label + icon + colour). Selection state lives in the URL — the
 * editor mounts on `/roles/:roleId`.
 */

import { useMemo, useState, type ReactElement } from "react";
import { useLocationCompat as useLocation, useRouteCompat as useRoute } from "@shared/lib";

import { useRoles } from "@entities/role";
import {
  EntityTree,
  type EntityTreeNode,
  RowLabelButton,
  Scrollable,
  SidebarShell,
} from "@shared/ui";
import { SidebarSectionAddTrigger } from "@shared/ui/SidebarShell";
import { RoleCreateDialog } from "@features/role/create-dialog";
import { RoleEditorPanel } from "@features/role/editor";
import { entityPageShellStyles as shellStyles } from "@widgets/entity-page-shell";
import { RolesList, type Role } from "@entities/role";
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

  const treeData = useMemo<EntityTreeNode<Role>[]>(
    () =>
      roles.map((role) => ({
        id: role.id,
        label: role.name,
        data: role,
      })),
    [roles],
  );

  return (
    <section className={shellStyles.root} data-testid="roles-page-root">
      <div className={shellStyles.sidebarSlot}>
        <SidebarShell
          ariaLabel="Roles navigation"
          testId="roles-sidebar-root-shell"
        >
          <EntityTree<Role>
            testIdPrefix="roles-sidebar"
            title="ROLES"
            titleAriaLabel="Roles navigation"
            titleTrailingNode={
              rolesQuery.status === "success" ? (
                <SidebarSectionAddTrigger
                  ariaLabel="Add role"
                  onPress={() => setIsCreateOpen(true)}
                  testId="roles-sidebar-add"
                />
              ) : null
            }
            emptyText="No roles yet."
            isLoading={rolesQuery.status === "pending"}
            errorMessage={
              rolesQuery.status === "error"
                ? `Failed to load roles: ${rolesQuery.error.message}`
                : null
            }
            data={treeData}
            rowConfig={(node) => ({
              isActive: node.id === selectedId,
              onClick: () => handleSelect(node.id),
            })}
            renderRow={({ node }) => {
              const role = node.data;
              return (
                <RowLabelButton
                  label={node.label}
                  icon={role?.icon ?? null}
                  color={role?.color ?? null}
                  onClick={() => handleSelect(node.id)}
                  testId={`roles-sidebar-row-${node.id}`}
                />
              );
            }}
          />
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
