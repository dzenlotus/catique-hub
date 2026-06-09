/**
 * Project files IPC client (catique-2, disk-backed).
 *
 * Agent instruction markdown files (AGENTS.md / CLAUDE.md) living in a
 * project's on-disk folder. Files are addressed by `(spaceId, name)` —
 * there is no surrogate id, the filename is the key. camelCase JS args;
 * `invokeWithAppError` rethrows the Rust `AppError` as a typed instance.
 */

import { invokeWithAppError } from "@shared/api";
import type { ProjectFile } from "@bindings/ProjectFile";

/** `list_project_files` — provider-expected names + on-disk markdown. */
export async function listProjectFiles(
  spaceId: string,
): Promise<ProjectFile[]> {
  return invokeWithAppError<ProjectFile[]>("list_project_files", { spaceId });
}

/** `read_project_file` — one file by name. */
export async function readProjectFile(
  spaceId: string,
  name: string,
): Promise<ProjectFile> {
  return invokeWithAppError<ProjectFile>("read_project_file", {
    spaceId,
    name,
  });
}

export interface WriteProjectFileArgs {
  spaceId: string;
  name: string;
  content?: string;
}

/** `write_project_file` — create or overwrite a file on disk (atomic). */
export async function writeProjectFile(
  args: WriteProjectFileArgs,
): Promise<ProjectFile> {
  return invokeWithAppError<ProjectFile>("write_project_file", {
    spaceId: args.spaceId,
    name: args.name,
    content: args.content ?? "",
  });
}

export interface DeleteProjectFileArgs {
  spaceId: string;
  name: string;
}

/** `delete_project_file` — remove a file by name. */
export async function deleteProjectFile(
  args: DeleteProjectFileArgs,
): Promise<void> {
  return invokeWithAppError<void>("delete_project_file", {
    spaceId: args.spaceId,
    name: args.name,
  });
}
