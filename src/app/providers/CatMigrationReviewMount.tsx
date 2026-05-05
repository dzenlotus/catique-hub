/**
 * CatMigrationReviewMount — boot-time guard that conditionally renders
 * the one-shot post-migration review modal (ctq-82, P1-T4).
 *
 * Migration `004_cat_as_agent_phase1.sql` seeds
 * `settings.cat_migration_reviewed = 'false'`. This mount reads the
 * flag via `get_setting` once on boot (react-query cache, key
 * `["settings", "cat_migration_reviewed"]`) and renders
 * `<CatMigrationReviewModal>` while the value is `'false'`. The modal
 * itself owns the "Looks good" → `set_setting('…','true')` write; on
 * success we invalidate the same query key so this mount drops the
 * modal without a page refresh.
 *
 * Closing the modal via Esc / scrim / X does NOT set the flag — the
 * flag stays `'false'` and the modal re-opens on next boot. This
 * matches the spec: the user must explicitly confirm the review.
 *
 * Provider-stack placement (`AppProviders` in `./index.tsx`):
 *   QueryProvider > EventsProvider > ActiveSpaceProvider >
 *   ToastProvider > children
 *
 * This mount lives OUTSIDE the providers stack — it consumes
 * `useToast()` (via the modal) and `useQueryClient()` so it must sit
 * INSIDE all of them. Wired in `App.tsx` next to `<Toaster />` so the
 * tree topology matches the toast region.
 */

import { useState, type ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { invoke } from "@shared/api";
import {
  CatMigrationReviewModal,
  CAT_MIGRATION_REVIEWED_KEY,
} from "@widgets/cat-migration-review-modal";

/** React-query key for the migration-review flag. Local — only this
 *  mount and its companion modal touch it, so no entity-level surface
 *  is needed. */
const REVIEW_FLAG_KEY = ["settings", CAT_MIGRATION_REVIEWED_KEY] as const;

/**
 * `CatMigrationReviewMount` — renders nothing when the flag is missing,
 * `'true'`, or still loading; renders `<CatMigrationReviewModal>` when
 * the flag is `'false'`.
 */
export function CatMigrationReviewMount(): ReactElement | null {
  const queryClient = useQueryClient();
  // Local "user closed without confirming" latch. Resets every time the
  // component remounts (i.e. next app boot), so the modal still re-opens
  // on the following launch — the flag check upstream is what gates
  // whether to render at all.
  const [dismissed, setDismissed] = useState(false);

  const flagQuery = useQuery<string | null>({
    queryKey: REVIEW_FLAG_KEY,
    queryFn: async () => {
      // `get_setting` returns `Option<String>` from Rust → `string | null`
      // on the JS side. Treat absent keys as "not yet seeded" and skip
      // the modal — the migration that seeds the flag is the same one
      // that creates the auto-assignments, so a missing flag means
      // there's nothing to review.
      const raw = await invoke<string | null>("get_setting", {
        key: CAT_MIGRATION_REVIEWED_KEY,
      });
      return raw;
    },
    // Settings are write-rare; no need to refetch on focus or interval.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const shouldShow =
    flagQuery.status === "success" &&
    flagQuery.data === "false" &&
    !dismissed;

  if (!shouldShow) return null;

  return (
    <CatMigrationReviewModal
      isOpen
      onDismiss={() => {
        // User closed without confirming → keep the flag at `'false'`,
        // hide for this session, re-open on next boot when the
        // component remounts and `dismissed` resets.
        setDismissed(true);
      }}
      onConfirmed={() => {
        // Confirmation already wrote `'true'` to the backend; mirror it
        // into the cache so this mount tears the modal down without a
        // round-trip.
        queryClient.setQueryData<string | null>(REVIEW_FLAG_KEY, "true");
      }}
    />
  );
}
