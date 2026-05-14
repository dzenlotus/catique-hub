/**
 * EntityTree primitives — explicit composable rows + groups.
 *
 *   import { Row, Group, RailSection } from "@shared/ui";
 *
 * The consumer owns iteration: `<RailSection>` wraps the section
 * label + the `<ul>` scaffolding, and each item is mapped to a `<Row>`
 * (leaf) or `<Group>` (with nested `<Row>` / `<Group>` children) by
 * hand. Active / hover styling lives on the primitive; the consumer's
 * `renderContent` slot owns labels, kebabs, droppables, etc.
 */

export { Row } from "./Row";
export type { RowProps, RowRenderContentArgs } from "./Row";

export { Group } from "./Group";
export type { GroupProps } from "./Group";

export { RailSection } from "./RailSection";
export type { RailSectionProps } from "./RailSection";

export { RowLeading } from "./RowLeading";
export type { RowLeadingProps } from "./RowLeading";

export { RowLabelButton } from "./RowLabelButton";
export type { RowLabelButtonProps } from "./RowLabelButton";

export { EntityTreeChevron } from "./EntityTreeChevron";

export { useEntityTreeExpandedStorage } from "./useEntityTreeExpandedStorage";
export type { UseEntityTreeExpandedStorageResult } from "./useEntityTreeExpandedStorage";
