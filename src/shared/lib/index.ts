export { cn } from "./cn";
export type { ClassValue } from "./cn";
export { pickFolder } from "./pickFolder";
export type { PickFolderOptions } from "./pickFolder";
export {
  useLocationCompat,
  useParamsCompat,
  useRouteCompat,
} from "./routerCompat";
export { TestRouter } from "./testRouter";
export type { TestRouterProps, TestRouterControls } from "./testRouter";
export { useSidecarStatus, refreshSidecarStatus } from "./useSidecarStatus";
export type { SidecarStatus } from "./useSidecarStatus";
export { ToastContext, ToastProvider, useToast } from "./toast";
export type { Toast, ToastKind, ToastContextValue } from "./toast";
export { ActiveSpaceContext, useActiveSpace } from "./active-space";
export type { ActiveSpaceContextValue } from "./active-space";
export {
  readPromptTagFilter,
  setPromptTagFilter,
  clearPromptTagFilter,
  subscribePromptTagFilter,
  usePromptTagFilter,
} from "./prompt-tag-filter";
export type { UsePromptTagFilterResult } from "./prompt-tag-filter";
// `spacesKeys` is owned by `@entities/space` — re-exported here so
// existing consumers of `@shared/lib` continue to resolve it without
// a breaking import-path change.
export { spacesKeys } from "@entities/space";
