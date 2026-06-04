import { useCallback, useEffect, useState } from "react";

import { invoke } from "@shared/api";

// ---------------------------------------------------------------------------
// MCP Sidecar types — mirrors crates/sidecar/src/lib.rs SidecarStatus enum.
// PoC for ctq-56 ADR-0002 spike. Real TS bindings generated via ts-rs in E5.
// ---------------------------------------------------------------------------

export type SidecarStatus =
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "running"; pid: number }
  | { state: "crashed"; exitCode: number | null };

const SIDECAR_POLL_MS = 5_000;

export interface UseSidecarStatusResult {
  status: SidecarStatus;
  latencyMs: number | null;
  isRestarting: boolean;
  restart: () => Promise<void>;
}

/**
 * Polls the MCP sidecar status + ping latency on a fixed interval and exposes
 * a restart action. PoC for ctq-56 ADR-0002 spike; backend may be unavailable
 * (test / storybook) in which case status stays "stopped" and latency "—".
 */
export function useSidecarStatus(): UseSidecarStatusResult {
  const [status, setStatus] = useState<SidecarStatus>({ state: "stopped" });
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function pollStatus(): Promise<void> {
      try {
        const next = await invoke<SidecarStatus>("sidecar_status");
        if (!cancelled) setStatus(next);
      } catch {
        // Backend not available in test / storybook — stay Stopped.
      }
    }

    async function pollLatency(): Promise<void> {
      try {
        const latencyUs = await invoke<number>("sidecar_ping");
        if (!cancelled) setLatencyMs(latencyUs / 1000);
      } catch {
        if (!cancelled) setLatencyMs(null);
      }
    }

    void pollStatus();

    const intervalId = setInterval(() => {
      void pollStatus();
      void pollLatency();
    }, SIDECAR_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  const restart = useCallback(async (): Promise<void> => {
    setIsRestarting(true);
    try {
      await invoke<void>("sidecar_restart");
      // Give it a moment to transition to Running.
      setTimeout(() => {
        void invoke<SidecarStatus>("sidecar_status").then((s) => setStatus(s));
        setIsRestarting(false);
      }, 800);
    } catch {
      setIsRestarting(false);
    }
  }, []);

  return { status, latencyMs, isRestarting, restart };
}
