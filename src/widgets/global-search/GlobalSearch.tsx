import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ReactElement,
  type KeyboardEvent,
} from "react";
import { PixelInterfaceEssentialSearch1 } from "@shared/ui/Icon";
import { Input } from "@shared/ui";
import {
  Dialog as AriaDialog,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import type { SearchResult } from "@bindings/SearchResult";

import { invoke } from "@shared/api";
import { cn, useLocationCompat } from "@shared/lib";
import { matchTaskSurface } from "@app/routes";

import { useOptionalToast } from "./useOptionalToast";
import { useOptionalSpaces } from "./useOptionalSpaces";
import { useOptionalPrompts } from "./useOptionalPrompts";
import { useGlobalSearchQuery, type PromptResult } from "./useGlobalSearchQuery";
import { useListKeyboardNav } from "./useListKeyboardNav";
import { SearchResultsList } from "./SearchResultsList";
import { ActionsList } from "./ActionsList";
import { buildActions, filterActions, type QuickAction } from "./actions";

import styles from "./GlobalSearch.module.css";

export interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectResult?: (result: SearchResult) => void;
}

/**
 * `GlobalSearch` — Cmd+K palette.
 *
 * Opens as a modal overlay with a search input that fires `search_all`
 * IPC after a 200 ms debounce. Results are grouped by type (prompts /
 * tasks / agent reports) with full keyboard navigation (Arrow Up/Down,
 * Enter, Esc). A `>` prefix flips the palette into command mode, where
 * results become filtered `QuickAction`s.
 *
 * The search state machine lives in `useGlobalSearchQuery`; the
 * arrow/enter handling in `useListKeyboardNav`; the rendered lists in
 * `SearchResultsList` / `ActionsList`. This component owns the input,
 * the modal shell, and the activation routing between those pieces.
 */
export function GlobalSearch({
  isOpen,
  onClose,
  onSelectResult,
}: GlobalSearchProps): ReactElement {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [location, setLocation] = useLocationCompat();
  const pushToast = useOptionalToast();
  const spaces = useOptionalSpaces();
  const prompts = useOptionalPrompts();

  // Route-derived context for action surfacing — flips on /tasks/:id.
  const currentTaskId = matchTaskSurface(location)?.taskId ?? undefined;

  // ── Command mode (`>` prefix) ──────────────────────────────────────
  const isCommandMode = query.trimStart().startsWith(">");
  const commandQuery = isCommandMode
    ? query.trimStart().slice(1).trimStart()
    : "";

  const allActions = useMemo<QuickAction[]>(
    () =>
      buildActions({
        spaces: spaces.map((s) => ({ id: s.id, name: s.name })),
        ...(currentTaskId !== undefined ? { currentTaskId } : {}),
        prompts: prompts.map((p) => ({ id: p.id, name: p.name })),
      }),
    [spaces, prompts, currentTaskId],
  );

  const visibleActions = useMemo<QuickAction[]>(
    () => (isCommandMode ? filterActions(allActions, commandQuery) : []),
    [isCommandMode, commandQuery, allActions],
  );

  // ── Search state machine ───────────────────────────────────────────
  const { state, debouncedQuery, matchingPrompts, flatResults } =
    useGlobalSearchQuery({ query, isOpen, isCommandMode, prompts });

  // ── Activation handlers ────────────────────────────────────────────
  const runAction = useCallback(
    (action: QuickAction) => {
      void Promise.resolve(
        action.run({
          navigate: (to) => setLocation(to),
          toast: (level, message) => pushToast(level, message),
        }),
      );
      onClose();
    },
    [setLocation, pushToast, onClose],
  );

  const handleSelectResult = useCallback(
    (result: SearchResult) => {
      onSelectResult?.(result);
      onClose();
    },
    [onSelectResult, onClose],
  );

  /**
   * Attach a prompt to the currently-open task. The palette stays open so
   * the user can chain attachments — the Round-4 "Find prompt X →
   * Cmd+Enter → attach" verb.
   */
  const attachPromptToCurrentTask = useCallback(
    async (promptId: string, promptName: string): Promise<void> => {
      if (currentTaskId === undefined) return;
      try {
        await invoke<void>("add_task_prompt", {
          taskId: currentTaskId,
          promptId,
          position: 0,
        });
        pushToast("success", `Prompt "${promptName}" attached`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        pushToast("error", `Failed to attach prompt: ${message}`);
      }
    },
    [currentTaskId, pushToast],
  );

  const navigateToPrompt = useCallback(
    (promptId: string): void => {
      setLocation(`/prompts/${promptId}`);
      onClose();
    },
    [setLocation, onClose],
  );

  // Plain click on a prompt row: attach when a task is open, else open it.
  const handleSelectPrompt = useCallback(
    (result: PromptResult) => {
      if (currentTaskId !== undefined) {
        void attachPromptToCurrentTask(result.id, result.name);
      } else {
        navigateToPrompt(result.id);
      }
    },
    [currentTaskId, attachPromptToCurrentTask, navigateToPrompt],
  );

  // ── Keyboard navigation ────────────────────────────────────────────
  const itemCount = isCommandMode ? visibleActions.length : flatResults.length;

  const handleActivate = useCallback(
    (index: number, e: KeyboardEvent<HTMLElement>): void => {
      if (isCommandMode) {
        const action = visibleActions[index];
        if (action !== undefined) {
          e.preventDefault();
          runAction(action);
        }
        return;
      }
      const result = flatResults[index];
      if (result === undefined) return;
      e.preventDefault();
      if (result.localKind === "prompt") {
        // Cmd+Enter on a prompt while a task is open → attach in place,
        // keep palette open. Otherwise → navigate to the prompt editor.
        const isCmdEnter = e.metaKey || e.ctrlKey;
        if (isCmdEnter && currentTaskId !== undefined) {
          void attachPromptToCurrentTask(result.id, result.name);
          return;
        }
        navigateToPrompt(result.id);
        return;
      }
      // task / agentReport: Cmd+Enter == Enter (no special semantics).
      handleSelectResult(result.data);
    },
    [
      isCommandMode,
      visibleActions,
      flatResults,
      currentTaskId,
      runAction,
      attachPromptToCurrentTask,
      navigateToPrompt,
      handleSelectResult,
    ],
  );

  const { focusedIndex, setFocusedIndex, reset, handleKeyDown } =
    useListKeyboardNav(itemCount, handleActivate);

  // Auto-focus the input when the palette opens; reset state on close.
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    reset();
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [isOpen, reset]);

  // Reset focus whenever the user's intent changes — a new query or a
  // mode flip. We intentionally do NOT reset on async `state.status`
  // transitions: results landing after the user has already arrow-keyed
  // into the list must not wipe their focus (the keyboard handler's
  // bounds check keeps a stale index harmless).
  useEffect(() => {
    reset();
  }, [debouncedQuery, isCommandMode, reset]);

  // ── Render body ────────────────────────────────────────────────────
  function renderBody(): ReactElement {
    if (isCommandMode) {
      if (visibleActions.length === 0) {
        return (
          <div className={styles.empty} data-testid="global-search-no-actions">
            No matching action.
          </div>
        );
      }
      return (
        <ActionsList
          actions={visibleActions}
          focusedIndex={focusedIndex}
          onFocusIndex={setFocusedIndex}
          onSelect={runAction}
        />
      );
    }

    if (query.trim() === "") {
      return (
        <div className={styles.hint} data-testid="global-search-empty">
          Start typing to find tasks or reports — or press &ldquo;&gt;&rdquo; for actions
        </div>
      );
    }

    if (state.status === "loading") {
      return (
        <div className={styles.loadingWrap} data-testid="global-search-loading">
          <span>Searching…</span>
        </div>
      );
    }

    if (state.status === "error") {
      return (
        <div className={styles.error} role="alert" data-testid="global-search-error">
          Search error: {state.message}
        </div>
      );
    }

    const hasSearchResults = state.status === "ok" && state.results.length > 0;
    const hasPromptResults = matchingPrompts.length > 0;

    if (state.status === "ok" && !hasSearchResults && !hasPromptResults) {
      return (
        <div className={styles.empty} data-testid="global-search-empty">
          No results for &ldquo;{debouncedQuery}&rdquo;
        </div>
      );
    }

    if (flatResults.length > 0) {
      return (
        <SearchResultsList
          flatResults={flatResults}
          focusedIndex={focusedIndex}
          onFocusIndex={setFocusedIndex}
          onSelectPrompt={handleSelectPrompt}
          onSelectResult={handleSelectResult}
        />
      );
    }

    return <></>;
  }

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.overlay}
    >
      <Modal className={styles.modal}>
        <AriaDialog
          className={cn(styles.panel)}
          aria-label="Global search"
          data-testid="global-search"
        >
          {/* Keyboard nav wrapper — arrow keys / enter move between rows */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div onKeyDown={handleKeyDown}>
            {/* ── Search input ── */}
            <div className={styles.inputWrap}>
              <PixelInterfaceEssentialSearch1
                width={16}
                height={16}
                className={styles.searchIcon}
                aria-hidden="true"
              />
              <Input
                ref={inputRef}
                type="search"
                label="Search tasks and reports"
                labelHidden
                placeholder="Search tasks, reports… (type > for actions)"
                value={query}
                onChange={setQuery}
                className={styles.searchField}
                data-testid="global-search-input"
                autoComplete="off"
              />
            </div>

            {/* ── Results body ── */}
            <div className={styles.body}>{renderBody()}</div>

            {/* ── Footer cheatsheet ──
                Keyboard hint strip pinned to the bottom of the palette.
                The ⌘+Enter affordance only appears on a task surface —
                otherwise it would be misleading (no task to attach to). */}
            <div
              className={styles.footerHint}
              data-testid="global-search-cheatsheet"
              aria-hidden="true"
            >
              <span className={styles.cheatItem}>
                <kbd className={styles.kbd}>Enter</kbd>
                <span>open</span>
              </span>
              {currentTaskId !== undefined ? (
                <>
                  <span className={styles.cheatSep} aria-hidden="true">
                    ·
                  </span>
                  <span className={styles.cheatItem}>
                    <kbd className={styles.kbd}>⌘</kbd>
                    <kbd className={styles.kbd}>Enter</kbd>
                    <span>attach prompt to this task</span>
                  </span>
                </>
              ) : null}
              <span className={styles.cheatSep} aria-hidden="true">
                ·
              </span>
              <span className={styles.cheatItem}>
                <kbd className={styles.kbd}>Esc</kbd>
                <span>close</span>
              </span>
            </div>
          </div>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
