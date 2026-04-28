/**
 * SettingsTokensView — per-prompt token count management panel.
 *
 * Shows all prompts in a table with their current token count and a per-row
 * recount button. The bulk "Пересчитать всё" button iterates sequentially
 * (back-pressure friendly) and tracks progress via a simple state machine.
 */

import { useState, type ReactElement } from "react";
import { RefreshCw } from "lucide-react";
import { usePrompts, useRecomputePromptTokenCountMutation } from "@entities/prompt";
import type { Prompt } from "@entities/prompt";
import { Button } from "@shared/ui";
import { cn } from "@shared/lib";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./SettingsTokensView.module.css";

// ─── Bulk recount state machine ─────────────────────────────────────────────

type BulkState =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number };

// ─── Sub-components ──────────────────────────────────────────────────────────

function SkeletonRow(): ReactElement {
  return (
    <tr className={styles.row} aria-hidden="true">
      <td className={styles.cellName}>
        <span className={cn(styles.skeleton, styles.skeletonName)} />
      </td>
      <td className={styles.cellDesc}>
        <span className={cn(styles.skeleton, styles.skeletonDesc)} />
      </td>
      <td className={styles.cellTokens}>
        <span className={cn(styles.skeleton, styles.skeletonTokens)} />
      </td>
      <td className={styles.cellAction} />
    </tr>
  );
}

interface PromptRowProps {
  prompt: Prompt;
}

function PromptRow({ prompt }: PromptRowProps): ReactElement {
  const recount = useRecomputePromptTokenCountMutation();
  const isPending = recount.status === "pending";

  const tokenLabel =
    prompt.tokenCount !== null && prompt.tokenCount > 0n
      ? `≈${prompt.tokenCount.toString()} tokens`
      : "—";

  return (
    <tr
      className={styles.row}
      data-testid={`settings-tokens-view-row-${prompt.id}`}
    >
      <td className={styles.cellName}>{prompt.name}</td>
      <td className={styles.cellDesc}>
        {prompt.shortDescription ?? <span className={styles.noDesc}>—</span>}
      </td>
      <td className={styles.cellTokens}>{tokenLabel}</td>
      <td className={styles.cellAction}>
        <Button
          variant="ghost"
          size="sm"
          isPending={isPending}
          onPress={() => recount.mutate(prompt.id)}
          aria-label={`Пересчитать токены для «${prompt.name}»`}
          data-testid={`settings-tokens-view-row-${prompt.id}-recount`}
        >
          <RefreshCw size={13} aria-hidden="true" />
        </Button>
      </td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * `SettingsTokensView` — renders a table of all prompts with their token
 * counts and recount affordances.
 */
export function SettingsTokensView(): ReactElement {
  const query = usePrompts();
  const recount = useRecomputePromptTokenCountMutation();
  const { pushToast } = useToast();

  const [bulk, setBulk] = useState<BulkState>({ kind: "idle" });
  const [bulkError, setBulkError] = useState<string | null>(null);

  const handleBulkRecount = async (): Promise<void> => {
    if (query.status !== "success") return;
    const prompts = query.data;
    if (prompts.length === 0) return;

    setBulkError(null);
    setBulk({ kind: "running", done: 0, total: prompts.length });

    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      try {
        await recount.mutateAsync(prompt.id);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Неизвестная ошибка";
        setBulkError(
          `Ошибка при пересчёте «${prompt.name}»: ${msg}`,
        );
        setBulk({ kind: "idle" });
        return;
      }
      setBulk({ kind: "running", done: i + 1, total: prompts.length });
    }

    setBulk({ kind: "idle" });
    pushToast("info", `Пересчитано ${prompts.length} промптов`);
  };

  const isBulkRunning = bulk.kind === "running";

  const bulkLabel = isBulkRunning
    ? `Пересчитано ${bulk.done} из ${bulk.total}…`
    : "Пересчитать всё";

  // ── Pending ──────────────────────────────────────────────────────────────

  if (query.status === "pending") {
    return (
      <div
        className={styles.root}
        data-testid="settings-tokens-view"
      >
        <div className={styles.header}>
          <h4 className={styles.title}>Подсчёт токенов</h4>
          <Button variant="ghost" size="sm" isDisabled>
            <RefreshCw size={14} aria-hidden="true" />
            {bulkLabel}
          </Button>
        </div>
        <table className={styles.table} aria-label="Токены промптов">
          <colgroup>
            <col style={{ width: "40%" }} />
            <col style={{ width: "30%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "15%" }} />
          </colgroup>
          <thead>
            <tr className={styles.headerRow}>
              <th className={styles.th}>Название</th>
              <th className={styles.th}>Описание</th>
              <th className={styles.th}>Токены</th>
              <th className={styles.th} />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }, (_, i) => (
              <SkeletonRow key={i} />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────

  if (query.status === "error") {
    return (
      <div
        className={styles.root}
        data-testid="settings-tokens-view"
      >
        <div className={styles.header}>
          <h4 className={styles.title}>Подсчёт токенов</h4>
        </div>
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="settings-tokens-view-error"
        >
          <p className={styles.errorMessage}>
            Не удалось загрузить промпты: {query.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => void query.refetch()}
          >
            Повторить
          </Button>
        </div>
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────

  if (query.data.length === 0) {
    return (
      <div
        className={styles.root}
        data-testid="settings-tokens-view"
      >
        <div className={styles.header}>
          <h4 className={styles.title}>Подсчёт токенов</h4>
        </div>
        <p
          className={styles.empty}
          data-testid="settings-tokens-view-empty"
        >
          Промптов пока нет.
        </p>
      </div>
    );
  }

  // ── Loaded ───────────────────────────────────────────────────────────────

  return (
    <div
      className={styles.root}
      data-testid="settings-tokens-view"
    >
      <div className={styles.header}>
        <h4 className={styles.title}>Подсчёт токенов</h4>
        <Button
          variant="ghost"
          size="sm"
          isPending={isBulkRunning}
          onPress={() => void handleBulkRecount()}
          data-testid="settings-tokens-view-bulk-recount"
          aria-label="Пересчитать токены для всех промптов"
        >
          <RefreshCw size={14} aria-hidden="true" />
          {bulkLabel}
        </Button>
      </div>

      {bulkError !== null && (
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="settings-tokens-view-bulk-error"
        >
          <p className={styles.errorMessage}>{bulkError}</p>
        </div>
      )}

      <table className={styles.table} aria-label="Токены промптов">
        <colgroup>
          <col style={{ width: "40%" }} />
          <col style={{ width: "30%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "15%" }} />
        </colgroup>
        <thead>
          <tr className={styles.headerRow}>
            <th className={styles.th}>Название</th>
            <th className={styles.th}>Описание</th>
            <th className={styles.th}>Токены</th>
            <th className={styles.th} />
          </tr>
        </thead>
        <tbody>
          {query.data.map((prompt) => (
            <PromptRow key={prompt.id} prompt={prompt} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
