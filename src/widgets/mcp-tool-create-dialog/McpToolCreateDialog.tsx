/**
 * McpToolCreateDialog — modal for creating a new MCP tool.
 *
 * Props:
 *   - `isOpen`    — controls dialog visibility.
 *   - `onClose`   — called on Cancel, successful Save, or Esc.
 *   - `onCreated` — optional callback with the newly-created McpTool.
 *
 * Fields: name (required), description (optional single-line),
 * schemaJson (required textarea, client-side JSON validated),
 * color (optional with reset).
 */

import { useState, type ReactElement } from "react";

import { useCreateMcpToolMutation } from "@entities/mcp-tool";
import type { McpTool } from "@entities/mcp-tool";
import { AppErrorInstance } from "@entities/board";
import { Dialog, Button, Input } from "@shared/ui";

import styles from "./McpToolCreateDialog.module.css";

export interface McpToolCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (tool: McpTool) => void;
}

/**
 * `McpToolCreateDialog` — modal dialog for creating a new MCP tool.
 */
export function McpToolCreateDialog({
  isOpen,
  onClose,
  onCreated,
}: McpToolCreateDialogProps): ReactElement {
  return (
    <Dialog
      title="Создать MCP-инструмент"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="mcp-tool-create-dialog"
    >
      {() => (
        <McpToolCreateDialogContent
          onClose={onClose}
          {...(onCreated !== undefined ? { onCreated } : {})}
        />
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface McpToolCreateDialogContentProps {
  onClose: () => void;
  onCreated?: (tool: McpTool) => void;
}

function McpToolCreateDialogContent({
  onClose,
  onCreated,
}: McpToolCreateDialogContentProps): ReactElement {
  const createMutation = useCreateMcpToolMutation();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [schemaJson, setSchemaJson] = useState("");
  const [color, setColor] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && schemaJson.trim().length > 0;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSaveError("Название не может быть пустым.");
      return;
    }

    const trimmedSchema = schemaJson.trim();
    if (!trimmedSchema) {
      setSaveError("JSON-схема обязательна.");
      return;
    }

    // Client-side JSON validation before sending to backend.
    try {
      JSON.parse(trimmedSchema);
    } catch {
      setSaveError("Невалидный JSON. Проверьте синтаксис JSON-схемы.");
      return;
    }

    type MutationArgs = Parameters<typeof createMutation.mutate>[0];
    const args: MutationArgs = { name: trimmedName, schemaJson: trimmedSchema };
    if (description !== "") args.description = description;
    if (color !== "") args.color = color;

    createMutation.mutate(args, {
      onSuccess: (tool) => {
        onCreated?.(tool);
        onClose();
      },
      onError: (err) => {
        if (
          err instanceof AppErrorInstance &&
          err.kind === "conflict"
        ) {
          setSaveError("Имя уже занято.");
        } else {
          setSaveError(`Не удалось создать: ${err.message}`);
        }
      },
    });
  };

  const handleCancel = (): void => {
    onClose();
  };

  return (
    <>
      {/* Name */}
      <div className={styles.section}>
        <Input
          label="Название"
          value={name}
          onChange={setName}
          placeholder="Название инструмента"
          autoFocus
          className={styles.fullWidthInput}
          data-testid="mcp-tool-create-dialog-name-input"
        />
      </div>

      {/* Description */}
      <div className={styles.section}>
        <Input
          label="Описание"
          value={description}
          onChange={setDescription}
          placeholder="Краткое описание (необязательно)"
          className={styles.fullWidthInput}
          data-testid="mcp-tool-create-dialog-description-input"
        />
      </div>

      {/* Color */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Цвет</p>
        <div className={styles.colorRow}>
          {color !== "" && (
            <span
              className={styles.colorSwatch}
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
          )}
          <input
            type="color"
            className={styles.colorInput}
            value={color === "" ? "#000000" : color}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Цвет инструмента"
            data-testid="mcp-tool-create-dialog-color-input"
          />
          {color !== "" && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setColor("")}
              data-testid="mcp-tool-create-dialog-color-reset"
            >
              Сбросить
            </Button>
          )}
        </div>
      </div>

      {/* Schema JSON */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>JSON-схема</p>
        <textarea
          className={styles.schemaTextarea}
          value={schemaJson}
          onChange={(e) => setSchemaJson(e.target.value)}
          placeholder="{}"
          data-testid="mcp-tool-create-dialog-schema-input"
          aria-label="JSON-схема"
        />
        <p className={styles.schemaHint}>
          JSON-схема. Должен быть валидный JSON.
        </p>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="mcp-tool-create-dialog-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="mcp-tool-create-dialog-cancel"
        >
          Отмена
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={createMutation.status === "pending"}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="mcp-tool-create-dialog-save"
        >
          Создать
        </Button>
      </div>
    </>
  );
}
