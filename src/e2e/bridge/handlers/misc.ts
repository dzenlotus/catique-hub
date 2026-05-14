/**
 * Misc command stubs.
 *
 * Cover every command registered by the Rust handler list that the
 * frontend may *touch* but the iteration-1 scenarios do not exercise:
 *   - tasks / agent reports / attachments
 *   - role notes
 *   - settings / sidecar / clients / search
 *
 * Every command returns an empty list or `null` so the React-Query
 * queries resolve to "loaded but empty" instead of throwing.
 */

import type { SyncStatus } from "@bindings/SyncStatus";

import { store } from "../store";

const EMPTY_SYNC_STATUS: SyncStatus = {
  state: "idle",
  failingProviders: [],
};

/** Handler catch-all. Returns `undefined` when the command isn't known. */
export function handleMisc(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    // -------------- tasks --------------
    // Core CRUD (`list_tasks`, `create_task`, `update_task`,
    // `delete_task`, `move_task`, `get_task`) lives in `handlers/tasks.ts`
    // so iteration-2 kanban scenarios can round-trip state. The aux
    // surfaces below remain stubbed because no spec exercises them yet.
    case "list_task_prompts":
    case "list_task_skills":
    case "list_task_mcp_tools":
      return [];
    case "get_task_bundle":
    case "get_task_rating":
      return null;
    case "log_step":
    case "get_step_log":
    case "rate_task":
    case "route_task_to_board":
    case "add_task_prompt":
    case "remove_task_prompt":
    case "set_task_prompt_override":
    case "clear_task_prompt_override":
      return null;

    // -------------- agent reports --------------
    case "list_agent_reports":
      return [];
    case "get_agent_report":
      return null;
    case "create_agent_report":
    case "update_agent_report":
    case "delete_agent_report":
      return null;

    // -------------- attachments --------------
    case "list_attachments":
      return [];
    case "get_attachment":
      return null;
    case "create_attachment":
    case "update_attachment":
    case "delete_attachment":
    case "upload_attachment":
    case "upload_attachment_blob":
      return null;

    // -------------- role notes --------------
    case "list_role_notes":
    case "list_role_note_tags":
    case "recall_role_notes":
      return [];
    case "get_role_note":
      return null;
    case "add_role_note":
    case "update_role_note":
    case "delete_role_note":
      return null;

    // -------------- search --------------
    case "search_tasks":
    case "search_agent_reports":
    case "search_all":
    case "search_tasks_by_cat_and_space":
      return { tasks: [], agentReports: [], roles: [], prompts: [] };

    // -------------- settings --------------
    case "ping":
      return "pong";
    case "get_setting": {
      const key = String(args["key"]);
      return store.settings.get(key) ?? null;
    }
    case "set_setting": {
      const key = String(args["key"]);
      const value = String(args["value"] ?? "");
      store.settings.set(key, value);
      return null;
    }

    // -------------- sidecar --------------
    case "sidecar_status":
      return { state: "stopped" };
    case "sidecar_ping":
    case "sidecar_restart":
      return null;

    // -------------- connected clients --------------
    case "list_connected_providers":
      return [];
    case "list_supported_providers":
      return [];
    case "add_provider":
      return null;
    case "remove_provider":
      return null;
    case "get_sync_status":
      return EMPTY_SYNC_STATUS;

    default:
      return undefined;
  }
}
