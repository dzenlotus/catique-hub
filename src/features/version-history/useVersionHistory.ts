/**
 * `useVersionHistory` — thin facade that resolves the right entity-slice
 * hooks for the active `kind` ("role" | "prompt").
 *
 * The dialog body itself does not care which slice it's reading from —
 * it consumes the shared `VersionHistoryRow` shape returned here. Both
 * role and prompt version bindings already share the same field set
 * (id, content, createdAt, authorNote); we normalise `roleId` /
 * `promptId` → `sourceId` so the body can stay generic.
 *
 * Rule-of-hooks: both role and prompt query hooks are called
 * unconditionally in stable order. The unused branch passes an empty
 * id, which disables the underlying `useQuery` (see entity stores).
 */

import { useCallback } from "react";

import {
  useRoleVersions,
  useRoleVersion,
  useRevertRoleToVersionMutation,
} from "@entities/role";
import {
  usePromptVersions,
  usePromptVersion,
  useRevertPromptToVersionMutation,
} from "@entities/prompt";
import type { RoleContentVersionView } from "@bindings/RoleContentVersionView";
import type { PromptContentVersionView } from "@bindings/PromptContentVersionView";

export type HistoryKind = "role" | "prompt";

export interface VersionHistoryRow {
  id: string;
  sourceId: string;
  content: string;
  createdAt: bigint;
  authorNote: string | null;
}

export interface VersionHistoryListState {
  status: "pending" | "error" | "success";
  data: VersionHistoryRow[] | undefined;
  error: Error | null;
}

export interface VersionDetailState {
  status: "pending" | "error" | "success" | "idle";
  data: VersionHistoryRow | undefined;
  error: Error | null;
}

export interface RevertControl {
  /** Fire the revert IPC for `versionId`. */
  trigger: (versionId: string) => void;
  isPending: boolean;
}

export interface VersionHistoryAccess {
  list: VersionHistoryListState;
  useDetail: (versionId: string) => VersionDetailState;
  revert: RevertControl;
}

function fromRole(v: RoleContentVersionView): VersionHistoryRow {
  return {
    id: v.id,
    sourceId: v.roleId,
    content: v.content,
    createdAt: v.createdAt,
    authorNote: v.authorNote,
  };
}

function fromPrompt(v: PromptContentVersionView): VersionHistoryRow {
  return {
    id: v.id,
    sourceId: v.promptId,
    content: v.content,
    createdAt: v.createdAt,
    authorNote: v.authorNote,
  };
}

/** See module docstring. `sourceId === ""` skips the underlying IPC. */
export function useVersionHistoryList(
  kind: HistoryKind,
  sourceId: string,
): VersionHistoryListState {
  const roleList = useRoleVersions(kind === "role" ? sourceId : "");
  const promptList = usePromptVersions(kind === "prompt" ? sourceId : "");
  const active = kind === "role" ? roleList : promptList;
  if (active.status === "success") {
    const rows =
      kind === "role"
        ? (active.data as RoleContentVersionView[]).map(fromRole)
        : (active.data as PromptContentVersionView[]).map(fromPrompt);
    return { status: "success", data: rows, error: null };
  }
  if (active.status === "error") {
    return { status: "error", data: undefined, error: active.error };
  }
  return { status: "pending", data: undefined, error: null };
}

/** Resolves a single version row by id for the right pane. */
export function useVersionHistoryDetail(
  kind: HistoryKind,
  versionId: string,
): VersionDetailState {
  const roleDetail = useRoleVersion(kind === "role" ? versionId : "");
  const promptDetail = usePromptVersion(kind === "prompt" ? versionId : "");
  const active = kind === "role" ? roleDetail : promptDetail;
  if (versionId === "") {
    return { status: "idle", data: undefined, error: null };
  }
  if (active.status === "success") {
    const row =
      kind === "role"
        ? fromRole(active.data as RoleContentVersionView)
        : fromPrompt(active.data as PromptContentVersionView);
    return { status: "success", data: row, error: null };
  }
  if (active.status === "error") {
    return { status: "error", data: undefined, error: active.error };
  }
  return { status: "pending", data: undefined, error: null };
}

/**
 * Returns a stable revert trigger bound to (kind, sourceId). The trigger
 * fires the matching mutation and on settle the dialog can react via the
 * mutation's existing onSuccess / onError (passed in via the bound
 * options below).
 */
export function useRevertVersion(
  kind: HistoryKind,
  sourceId: string,
  options: { onSuccess: () => void; onError: (err: Error) => void },
): RevertControl {
  const roleMutation = useRevertRoleToVersionMutation();
  const promptMutation = useRevertPromptToVersionMutation();
  const { onSuccess, onError } = options;
  const trigger = useCallback(
    (versionId: string) => {
      if (kind === "role") {
        roleMutation.mutate(
          { versionId, roleId: sourceId },
          { onSuccess, onError },
        );
      } else {
        promptMutation.mutate(
          { versionId, promptId: sourceId },
          { onSuccess, onError },
        );
      }
    },
    [kind, sourceId, roleMutation, promptMutation, onSuccess, onError],
  );
  return {
    trigger,
    isPending:
      (kind === "role" ? roleMutation.status : promptMutation.status) ===
      "pending",
  };
}
