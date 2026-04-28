export { cn } from "./cn";
export type { ClassValue } from "./cn";
// `spacesKeys` is owned by `@entities/space` — re-exported here so
// existing consumers of `@shared/lib` continue to resolve it without
// a breaking import-path change.
export { spacesKeys } from "@entities/space";
