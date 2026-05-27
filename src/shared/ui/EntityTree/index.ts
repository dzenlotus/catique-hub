/**
 * EntityTree — single data-driven sidebar list/tree component.
 *
 *   import { EntityTree } from "@shared/ui";
 *
 *   <EntityTree
 *     testIdPrefix="roles-sidebar"
 *     title="ROLES"
 *     titleTrailingNode={<AddRoleButton />}
 *     data={roles.map((r) => ({ id: r.id, label: r.name, data: r }))}
 *     rowConfig={(n) => ({ isActive: n.id === selectedId, onClick: () => select(n.id) })}
 *   />
 *
 * Without `renderRow` the tree shows a plain `<span>{label}</span>`.
 * Supply `renderRow` for richer bodies (label-button + icon + kebab,
 * droppable wrappers, etc.). For the common label+icon+colour body
 * use the `<RowLabelButton/>` helper from this module.
 *
 * Lower-level primitives (Row / Group / RailSection / RowLeading /
 * EntityTreeChevron) stay un-exported — `EntityTree` composes them so
 * consumers don't reach into the internals.
 */

export { EntityTree } from "./EntityTree";
export type {
  EntityTreeProps,
  EntityTreeNode,
  EntityTreeDraggable,
  EntityTreeDroppable,
  EntityTreeRowConfig,
  EntityTreeRenderRowArgs,
} from "./EntityTree";

export { useEntityTreeExpandedStorage } from "./useEntityTreeExpandedStorage";
export type { UseEntityTreeExpandedStorageResult } from "./useEntityTreeExpandedStorage";

// Helpers — exported so consumers building custom `renderRow` bodies
// can reuse the canonical label / icon / swatch geometry without
// re-implementing it.
export { RowLabelButton } from "./RowLabelButton";
export type { RowLabelButtonProps } from "./RowLabelButton";

export { RowLeading } from "./RowLeading";
export type { RowLeadingProps } from "./RowLeading";
