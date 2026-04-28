/**
 * `cn` — className composition helper.
 *
 * Thin re-export of clsx so call-sites import from `@shared/lib` and
 * stay framework-agnostic. If we adopt Tailwind later, this is where
 * `tailwind-merge` would slot in to dedupe conflicting utilities.
 *
 * Usage:
 *   import { cn } from "@shared/lib/cn";
 *   <div className={cn(styles.button, isActive && styles.active)} />
 */

export { clsx as cn } from "clsx";
export type { ClassValue } from "clsx";
