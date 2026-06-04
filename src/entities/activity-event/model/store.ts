import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  listRecentEvents,
  listRecentEventsByScope,
  type ActivityScopeKind,
} from "../api";
import type { ActivityEvent } from "@bindings/ActivityEvent";

export const activityEventsKeys = {
  all: ["activity-events"] as const,
  recent: (limit: number) =>
    [...activityEventsKeys.all, "recent", limit] as const,
  /**
   * Scope-keyed cache slice. `scopeId` is included in the key so
   * different entities of the same `scopeKind` don't collide; the
   * literal string `"__null__"` is used for global-scope events
   * (`scopeId === null`) to keep the tuple a stable shape.
   */
  byScope: (
    scopeKind: ActivityScopeKind,
    scopeId: string | null,
    limit: number,
  ) =>
    [
      ...activityEventsKeys.all,
      "byScope",
      scopeKind,
      scopeId ?? "__null__",
      limit,
    ] as const,
};

export function useRecentActivityEvents(
  limit = 20,
): UseQueryResult<ActivityEvent[], Error> {
  return useQuery({
    queryKey: activityEventsKeys.recent(limit),
    queryFn: () => listRecentEvents(limit),
    // D-D bumped retention to 90 days, but the activity feed is still
    // event-driven — refresh on a 30 s cadence to pick up the
    // standalone MCP binary's writes without spamming the IPC.
    refetchInterval: 30_000,
  });
}

/**
 * Per-scope activity feed. The SpaceDetailPage calls this with
 * `("space", spaceId)`; the future agent / board / task panes will
 * call it with their respective kinds.
 *
 * The query is disabled when `scopeId` is the empty string — that's
 * the SpaceDetailPage's "loading" sentinel before the URL param
 * resolves, and we don't want to invoke the IPC with an empty id.
 */
export function useRecentActivityEventsByScope(
  scopeKind: ActivityScopeKind,
  scopeId: string | null,
  limit = 20,
): UseQueryResult<ActivityEvent[], Error> {
  const isDisabled = scopeKind !== "global" && (scopeId ?? "").length === 0;
  return useQuery({
    queryKey: activityEventsKeys.byScope(scopeKind, scopeId, limit),
    queryFn: () => listRecentEventsByScope(scopeKind, scopeId, limit),
    refetchInterval: 30_000,
    enabled: !isDisabled,
  });
}
