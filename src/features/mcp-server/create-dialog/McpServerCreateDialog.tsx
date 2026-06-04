/**
 * McpServerCreateDialog — modal for registering an upstream MCP server.
 *
 * PROXY-S6 / ADR-0008 (ctq-133). Replaces the ADR-0007 single-tool
 * dialog with a server-create flow: the user types name + transport +
 * address; the Rust backend introspects on commit and persists the
 * resulting tool inventory. The status dot in the parent page reflects
 * whether introspection succeeded.
 *
 * Fields:
 *   - Name           — free text, required.
 *   - Transport      — stdio / http / sse (radio group).
 *   - URL            — required when transport ∈ {http, sse}.
 *   - Command        — required when transport === 'stdio'.
 *   - Auth           — NOT shown this round; payload always sends
 *                      `authJson: null`. PROXY-S3 round 2 wires
 *                      keychain entries. See the TODO comment.
 *
 * On submit:
 *   1. `create_mcp_server` commits the row (introspect-on-create runs
 *      best-effort server-side).
 *   2. After ~1 s, fetches `get_mcp_server_status` once so the parent
 *      page can show whether introspection actually reached the
 *      upstream — the dialog reports the outcome via a toast
 *      (success vs. unreachable) and `onCreated`.
 */

import {
  useCallback,
  useState,
  type ReactElement,
} from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  RadioGroup as AriaRadioGroup,
  Radio as AriaRadio,
  Label as AriaLabel,
} from "react-aria-components";

import {
  useCreateMcpServerMutation,
  getMcpServerStatus,
  type McpServer,
  type McpServerStatus,
  type Transport,
} from "@entities/mcp-server";
import { useToast } from "@shared/lib";
import { AppErrorInstance } from "@shared/api";
import { Button, Dialog, DialogFooter, Input } from "@shared/ui";

import styles from "./McpServerCreateDialog.module.css";

/** Delay before polling `get_mcp_server_status` once after create. */
const STATUS_POLL_DELAY_MS = 1_000;

// react-hook-form schema — name + address required after trim. `address`
// is the unified text field: a stdio command or an http/sse URL depending
// on the selected transport (transport itself is RAC-radio local state).
const mcpServerFormSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
  address: z.string().trim().min(1, "Address is required."),
});

type McpServerFormValues = z.infer<typeof mcpServerFormSchema>;

const TRANSPORT_OPTIONS: ReadonlyArray<{
  id: Transport;
  label: string;
  description: string;
}> = [
  { id: "stdio", label: "stdio", description: "Subprocess (CLI command)" },
  { id: "http", label: "http", description: "HTTP endpoint URL" },
  { id: "sse", label: "sse", description: "Server-Sent Events URL" },
];

export interface McpServerCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called with the freshly-created server. The component runs a
   * one-shot status poll before invoking this callback so the caller
   * already knows whether the upstream is reachable.
   */
  onCreated?: (server: McpServer) => void;
}

/** `McpServerCreateDialog` — modal wrapper. */
export function McpServerCreateDialog({
  isOpen,
  onClose,
  onCreated,
}: McpServerCreateDialogProps): ReactElement {
  return (
    <Dialog
      title="Create MCP server"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="mcp-server-create-dialog"
    >
      {() => (
        <McpServerCreateDialogContent
          onClose={onClose}
          {...(onCreated !== undefined ? { onCreated } : {})}
        />
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface McpServerCreateDialogContentProps {
  onClose: () => void;
  onCreated?: (server: McpServer) => void;
}

function McpServerCreateDialogContent({
  onClose,
  onCreated,
}: McpServerCreateDialogContentProps): ReactElement {
  const createMutation = useCreateMcpServerMutation();
  const { pushToast } = useToast();

  // Transport is RAC-radio local state, not a validated text field.
  const [transport, setTransport] = useState<Transport>("stdio");

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<McpServerFormValues>({
    resolver: zodResolver(mcpServerFormSchema),
    defaultValues: { name: "", address: "" },
    mode: "onChange",
  });

  const onValid = handleSubmit(async (values) => {
    // TODO(proxy-s3-r2): auth fields. PROXY-S3 round 2 wires keychain
    // entries; for now every newly-registered server is unauthenticated
    // and `authJson` ships as null.
    try {
      const server = await createMutation.mutateAsync({
        name: values.name,
        transport,
        url: transport === "stdio" ? null : values.address,
        command: transport === "stdio" ? values.address : null,
        authJson: null,
        enabled: true,
      });
      // One-shot status poll after a short delay so the introspect-
      // on-create best-effort path has time to complete. The poll
      // result decides which toast we surface.
      window.setTimeout(() => {
        void runPostCreatePoll(server, pushToast);
        onCreated?.(server);
      }, STATUS_POLL_DELAY_MS);
      onClose();
    } catch (err) {
      if (err instanceof AppErrorInstance && err.kind === "conflict") {
        setError("root.serverError", { message: "Name already taken." });
      } else {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError("root.serverError", {
          message: `Failed to create: ${message}`,
        });
      }
    }
  });

  const handleSubmitPress = useCallback((): void => {
    void onValid();
  }, [onValid]);

  const serverError = errors.root?.serverError?.message;

  return (
    <>
      {/* Name */}
      <div className={styles.section}>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <Input
              label="Name"
              value={field.value}
              onChange={field.onChange}
              placeholder="Server name"
              autoFocus
              className={styles.fullWidthInput}
              data-testid="mcp-server-create-dialog-name-input"
            />
          )}
        />
      </div>

      {/* Transport radio group */}
      <div className={styles.section}>
        <AriaRadioGroup
          value={transport}
          onChange={(v) => setTransport(v as Transport)}
          className={styles.radioGroup}
          aria-label="Transport"
          data-testid="mcp-server-create-dialog-transport-group"
        >
          <AriaLabel className={styles.sectionLabel}>Transport</AriaLabel>
          <div className={styles.radioRow}>
            {TRANSPORT_OPTIONS.map((opt) => (
              <AriaRadio
                key={opt.id}
                value={opt.id}
                className={styles.radio}
                data-testid={`mcp-server-create-dialog-transport-${opt.id}`}
              >
                <span className={styles.radioDot} aria-hidden="true" />
                {opt.label}
              </AriaRadio>
            ))}
          </div>
        </AriaRadioGroup>
        <p className={styles.hint}>
          {TRANSPORT_OPTIONS.find((opt) => opt.id === transport)?.description}
        </p>
      </div>

      {/* Address — URL for http/sse, Command for stdio. One form field
          (`address`) rendered with the transport-specific label/testid. */}
      <div className={styles.section}>
        <Controller
          control={control}
          name="address"
          render={({ field }) =>
            transport === "stdio" ? (
              <Input
                label="Command"
                value={field.value}
                onChange={field.onChange}
                placeholder="/usr/local/bin/my-mcp-server --flag"
                className={styles.fullWidthInput}
                data-testid="mcp-server-create-dialog-command-input"
              />
            ) : (
              <Input
                label="URL"
                value={field.value}
                onChange={field.onChange}
                placeholder="https://example.com/mcp"
                type="url"
                className={styles.fullWidthInput}
                data-testid="mcp-server-create-dialog-url-input"
              />
            )
          }
        />
      </div>

      {/* TODO(proxy-s3-r2): auth fields — keychain reference flow
          ships in PROXY-S3 round 2. For now the dialog always sends
          `authJson: null` and servers register unauthenticated. */}

      <DialogFooter>
        {serverError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="mcp-server-create-dialog-error"
          >
            {serverError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={onClose}
          data-testid="mcp-server-create-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={isSubmitting}
          isDisabled={!isValid}
          onPress={handleSubmitPress}
          data-testid="mcp-server-create-dialog-save"
        >
          Create
        </Button>
      </DialogFooter>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-shot status read after create. Surfaces the outcome via a toast:
 *   - Reachable upstream (`healthy` / `degraded`)  → success with
 *     tool count.
 *   - Unreachable                                  → info-level toast
 *     prompting a manual refresh.
 *
 * Errors during the status fetch itself fall through as a generic info
 * toast so the create flow never appears to silently succeed.
 */
async function runPostCreatePoll(
  server: McpServer,
  pushToast: (kind: "success" | "error" | "info", message: string) => void,
): Promise<void> {
  let status: McpServerStatus | null = null;
  try {
    status = await getMcpServerStatus(server.id);
  } catch {
    pushToast(
      "info",
      `${server.name} created — status could not be read; click Refresh to retry.`,
    );
    return;
  }

  if (status.state === "unreachable") {
    pushToast(
      "info",
      `${server.name} created but unreachable — click Refresh to retry.`,
    );
    return;
  }

  // `toolCount` is a bigint on the wire (ts-rs maps i64 → bigint).
  const toolCount = Number(status.toolCount);
  pushToast(
    "success",
    `Connected to ${server.name}: ${toolCount} ${toolCount === 1 ? "tool" : "tools"}.`,
  );
}
