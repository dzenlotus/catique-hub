/**
 * `useSidecarStatus` — poll the MCP sidecar's lifecycle state.
 *
 * Mirrors the `SidecarStatus` enum from `crates/sidecar/src/lib.rs`. The
 * hook polls `sidecar_status` IPC on a 5-second cadence (matches the
 * cadence used historically inside the settings page).
 *
 * Returned shape is a discriminated union so callers narrow on `.state`
 * without conditional optionality.
 */
import { useEffect, useState } from "react";

import { invoke } from "@shared/api";

export type SidecarStatus =
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "running"; pid: number }
  | { state: "crashed"; exitCode: number | null };

const SIDECAR_POLL_MS = 5_000;

export function useSidecarStatus(): SidecarStatus {
  const [status, setStatus] = useState<SidecarStatus>({ state: "stopped" });

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const next = await invoke<SidecarStatus>("sidecar_status");
        if (!cancelled) setStatus(next);
      } catch {
        // Sidecar IPC unavailable (e.g. dev-only paths) — keep last
        // known state. Polling continues; transient failures are common.
      }
    }

    void poll();
    const handle = setInterval(() => {
      void poll();
    }, SIDECAR_POLL_MS);

    return (): void => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  return status;
}

/**
 * Manual refresh helper for callers that just performed an action
 * (start / stop / restart) and want the badge to update immediately
 * instead of waiting for the next poll tick.
 */
export async function refreshSidecarStatus(): Promise<SidecarStatus> {
  return invoke<SidecarStatus>("sidecar_status");
}
