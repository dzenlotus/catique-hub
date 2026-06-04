/**
 * McpToolGroupCreateDialog — modal for creating a new MCP tool group.
 * Mirror of `PromptGroupCreateDialog`. Fields: name (required) + color.
 */

import { useCallback, useState, type ReactElement } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import {
  useCreateMcpToolGroupMutation,
  type McpToolGroup,
} from "@entities/mcp-tool-group";
import { Dialog, Button, IconColorPicker, Input } from "@shared/ui";

import styles from "./McpToolGroupCreateDialog.module.css";

const formSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
});

type FormValues = z.infer<typeof formSchema>;

export interface McpToolGroupCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (group: McpToolGroup) => void;
}

export function McpToolGroupCreateDialog({
  isOpen,
  onClose,
  onCreated,
}: McpToolGroupCreateDialogProps): ReactElement {
  return (
    <Dialog
      title="Create MCP tool group"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="mcp-tool-group-create-dialog"
    >
      {() => (
        <DialogContent
          onClose={onClose}
          {...(onCreated !== undefined ? { onCreated } : {})}
        />
      )}
    </Dialog>
  );
}

interface DialogContentProps {
  onClose: () => void;
  onCreated?: (group: McpToolGroup) => void;
}

function DialogContent({ onClose, onCreated }: DialogContentProps): ReactElement {
  const createMutation = useCreateMcpToolGroupMutation();
  const [color, setColor] = useState("");

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "" },
    mode: "onChange",
  });

  const onValid = handleSubmit(async (values) => {
    type MutationArgs = Parameters<typeof createMutation.mutateAsync>[0];
    const args: MutationArgs = { name: values.name };
    if (color !== "") args.color = color;
    try {
      const group = await createMutation.mutateAsync(args);
      onCreated?.(group);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError("root.serverError", { message: `Failed to create: ${message}` });
    }
  });

  const handleSubmitPress = useCallback((): void => {
    void onValid();
  }, [onValid]);

  const serverError = errors.root?.serverError?.message;

  return (
    <>
      <div
        className={styles.identityRow}
        data-testid="mcp-tool-group-create-dialog-identity-row"
      >
        <div className={styles.identityPicker}>
          <IconColorPicker
            value={{ icon: null, color: color === "" ? null : color }}
            onChange={(next) => setColor(next.color ?? "")}
            ariaLabel="Group color"
            data-testid="mcp-tool-group-create-dialog-color-input"
          />
        </div>
        <div className={styles.identityFields}>
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <Input
                label="Name"
                value={field.value}
                onChange={field.onChange}
                placeholder="Group name"
                autoFocus
                className={styles.fullWidthInput}
                data-testid="mcp-tool-group-create-dialog-name-input"
              />
            )}
          />
        </div>
      </div>

      <div className={styles.footer}>
        {serverError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="mcp-tool-group-create-dialog-error"
          >
            {serverError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={onClose}
          data-testid="mcp-tool-group-create-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={isSubmitting}
          isDisabled={!isValid}
          onPress={handleSubmitPress}
          data-testid="mcp-tool-group-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
