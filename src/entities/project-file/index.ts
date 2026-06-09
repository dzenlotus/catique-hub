/**
 * `entities/project-file` — public surface (FSD encapsulation, catique-2).
 *
 * Disk-backed agent instruction files (AGENTS.md / CLAUDE.md) in a
 * project's folder. Internal modules under `./api` and `./model` MUST NOT
 * be imported directly from outside this slice.
 */

// API
export {
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
  deleteProjectFile,
} from "./api";
export type { WriteProjectFileArgs, DeleteProjectFileArgs } from "./api";

// Model
export {
  projectFilesKeys,
  useProjectFiles,
  useWriteProjectFileMutation,
  useDeleteProjectFileMutation,
} from "./model";
export type { ProjectFile } from "./model";
