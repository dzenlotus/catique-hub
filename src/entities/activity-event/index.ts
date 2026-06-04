/**
 * `entities/activity-event` — read model over the `change_events`
 * table introduced in migration 028 and extended in refactor-v3 D-D
 * (migration 035). Powers the global activity log and the per-scope
 * feed on the v3 space day-screen / agent / board surfaces.
 */
export {
  listRecentEvents,
  listRecentEventsByScope,
  type ActivityScopeKind,
} from "./api";
export {
  useRecentActivityEvents,
  useRecentActivityEventsByScope,
  activityEventsKeys,
} from "./model";
export type { ActivityEvent } from "@bindings/ActivityEvent";
