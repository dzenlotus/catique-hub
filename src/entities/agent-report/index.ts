/**
 * `entities/agent-report` — public surface (FSD encapsulation).
 *
 * Internal modules under `./api`, `./model`, and `./ui` MUST NOT be
 * imported directly from outside this slice. Anything not re-exported
 * here is private to the entity.
 */

// API
export {
  listAgentReports,
  getAgentReport,
  createAgentReport,
  updateAgentReport,
  deleteAgentReport,
} from "./api";
export type { CreateAgentReportArgs, UpdateAgentReportArgs } from "./api";

// Model
export {
  agentReportsKeys,
  useAgentReports,
  useAgentReportsByTask,
  useAgentReport,
  useCreateAgentReportMutation,
  useUpdateAgentReportMutation,
  useDeleteAgentReportMutation,
} from "./model";
export type { AgentReport, DeleteAgentReportArgs } from "./model";

// UI
export { AgentReportCard } from "./ui";
export type { AgentReportCardProps } from "./ui";
