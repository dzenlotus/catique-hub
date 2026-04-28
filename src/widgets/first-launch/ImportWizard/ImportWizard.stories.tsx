/**
 * Storybook — ImportWizard stages.
 *
 * The host wizard ties stage transitions to live IPC, which would
 * mean spinning up a Tauri runtime in the preview. Since stories
 * must be static, we preview each stage component in isolation
 * with hand-crafted props. The stage modules are stateless enough
 * to render this way (RunningStage owns its own IPC subscription —
 * we provide a shim story below that renders an indeterminate
 * progress bar with no listeners by mounting it under a stub
 * `@shared/api` module path… actually, simpler: we just render
 * the visual subset of RunningStage by leveraging the
 * indeterminate progress bar and a static phase label.
 *
 * This decision keeps stories stable across CI and avoids reaching
 * for `vi.mock` outside the test runner.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";

import type { ImportReport } from "@bindings/ImportReport";
import type { PreflightResults } from "@bindings/PreflightResults";
import type { PrompteryDbInfo } from "@bindings/PrompteryDbInfo";

import { DetectionStage } from "./stages/DetectionStage";
import { CompletedStage } from "./stages/CompletedStage";
import { FailedStage } from "./stages/FailedStage";

const sampleInfo: PrompteryDbInfo = {
  path: "/Users/anna/.promptery/db.sqlite",
  sizeBytes: 4_096_000n,
  schemaHash: "deadbeefcafebeef",
  tasksCount: 142n,
  lastModifiedMs: BigInt(Date.now() - 7 * 24 * 60 * 60 * 1000),
};

const passingPreflight: PreflightResults = {
  pf1SourceExists: true,
  pf2IntegrityOk: true,
  pf3QuickCheckOk: true,
  pf4SchemaHashOk: true,
  pf5TargetWritable: true,
  pf6DiskSpaceOk: true,
  pf7SourceLockOk: true,
  pf8ForeignKeysOn: true,
  pf9TargetEmptyOrOverwrite: true,
  pf10AttachmentsReadable: true,
  messages: {},
};

const failingPreflight: PreflightResults = {
  ...passingPreflight,
  pf6DiskSpaceOk: false,
  messages: {
    "PF-6": "Need 8.0 MB, only 2.1 MB available",
  },
};

const sampleReport: ImportReport = {
  startedAtMs: 1_700_000_000_000n,
  finishedAtMs: 1_700_000_002_300n,
  durationMs: 2_300n,
  sourcePath: "/Users/anna/.promptery/db.sqlite",
  sourceSizeBytes: 4_096_000n,
  sourceSchemaHash: "deadbeefcafebeef",
  targetSchemaHash: "deadbeefcafebeef",
  schemaMatch: true,
  preflight: passingPreflight,
  rowsImported: {
    spaces: 3n,
    boards: 8n,
    tasks: 142n,
    prompts: 27n,
    roles: 5n,
    tags: 14n,
  },
  ftsRowsRebuilt: { tasks_fts: 142n, agent_reports_fts: 38n },
  attachmentsCopied: 12n,
  attachmentsTotalBytes: 1_048_576n,
  dryRun: false,
  commitPath: "/Users/anna/Library/Application Support/catique/db.sqlite.20260428T143000.bak",
  error: null,
};

// ── Stories per stage ──────────────────────────────────────────────

const meta = {
  title: "widgets/first-launch/ImportWizard",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const DetectionOk: Story = {
  render: () => (
    <div style={{ width: 640 }}>
      <DetectionStage
        info={sampleInfo}
        schemaMatch
        onContinue={() => undefined}
        onSkip={() => undefined}
      />
    </div>
  ),
};

export const DetectionDrift: Story = {
  render: () => (
    <div style={{ width: 640 }}>
      <DetectionStage
        info={{ ...sampleInfo, schemaHash: "" }}
        schemaMatch={false}
        onContinue={() => undefined}
        onSkip={() => undefined}
      />
    </div>
  ),
};

export const Completed: Story = {
  render: () => (
    <div style={{ width: 640 }}>
      <CompletedStage report={sampleReport} onOpenKanban={() => undefined} />
    </div>
  ),
};

export const Failed: Story = {
  render: () => (
    <div style={{ width: 640 }}>
      <FailedStage
        kind="transactionRolledBack"
        message="preflight PF-6 failed: insufficient disk space"
        preflight={failingPreflight}
        onRetry={() => undefined}
        onSkip={() => undefined}
      />
    </div>
  ),
};
