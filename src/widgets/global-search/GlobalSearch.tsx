import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactElement,
  type KeyboardEvent,
} from "react";
import { Search } from "lucide-react";
import {
  Dialog as AriaDialog,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import type { SearchResult } from "@bindings/SearchResult";
import { invoke } from "@shared/api";
import { cn } from "@shared/lib";

import styles from "./GlobalSearch.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; results: SearchResult[] }
  | { status: "error"; message: string };

export interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectResult?: (result: SearchResult) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal inline debounce — avoids adding a dependency. */
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Group SearchResults by `type`, preserving insertion order within groups. */
function groupResults(results: SearchResult[]): {
  tasks: SearchResult[];
  agentReports: SearchResult[];
} {
  const tasks: SearchResult[] = [];
  const agentReports: SearchResult[] = [];
  for (const r of results) {
    if (r.type === "task") {
      tasks.push(r);
    } else {
      agentReports.push(r);
    }
  }
  return { tasks, agentReports };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * `GlobalSearch` — Cmd+K palette.
 *
 * Opens as a modal overlay with a search input that fires `search_all` IPC
 * after a 200ms debounce. Results are grouped by type (tasks / agent reports)
 * with full keyboard navigation (Arrow Up/Down, Enter, Esc).
 */
export function GlobalSearch({
  isOpen,
  onClose,
  onSelectResult,
}: GlobalSearchProps): ReactElement {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(query.trim(), 200);

  // Auto-focus the input when the palette opens; reset state on close.
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setState({ status: "idle" });
      setFocusedIndex(-1);
      // RAF to let RAC finish mounting the modal before focusing
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [isOpen]);

  // Fire IPC when debounced query changes.
  useEffect(() => {
    if (!isOpen) return;
    if (debouncedQuery === "") {
      setState({ status: "idle" });
      setFocusedIndex(-1);
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    invoke<SearchResult[]>("search_all", {
      query: debouncedQuery,
      limitPerKind: 50,
    })
      .then((results) => {
        if (!cancelled) {
          setState({ status: "ok", results });
          setFocusedIndex(-1);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : typeof err === "object" && err !== null && "message" in err
                ? String((err as { message: unknown }).message)
                : "Неизвестная ошибка";
          setState({ status: "error", message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, isOpen]);

  // Flat ordered list of results (tasks first, then reports) for keyboard nav.
  const flatResults: SearchResult[] =
    state.status === "ok"
      ? (() => {
          const { tasks, agentReports } = groupResults(state.results);
          return [...tasks, ...agentReports];
        })()
      : [];

  const handleSelect = useCallback(
    (result: SearchResult) => {
      onSelectResult?.(result);
      onClose();
    },
    [onSelectResult, onClose],
  );

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) =>
        flatResults.length === 0 ? -1 : Math.min(prev + 1, flatResults.length - 1),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      if (focusedIndex >= 0 && focusedIndex < flatResults.length) {
        e.preventDefault();
        const result = flatResults[focusedIndex];
        if (result !== undefined) handleSelect(result);
      }
    }
    // Esc is handled by RAC ModalOverlay (isDismissable)
  }

  // Render the results list content
  function renderBody(): ReactElement {
    if (query.trim() === "") {
      return (
        <div className={styles.hint} data-testid="global-search-empty">
          Начните вводить, чтобы найти задачи или отчёты
        </div>
      );
    }

    if (state.status === "loading") {
      return (
        <div className={styles.loadingWrap} data-testid="global-search-loading">
          <span>Поиск…</span>
        </div>
      );
    }

    if (state.status === "error") {
      return (
        <div
          className={styles.error}
          role="alert"
          data-testid="global-search-error"
        >
          Ошибка поиска: {state.message}
        </div>
      );
    }

    if (state.status === "ok" && state.results.length === 0) {
      return (
        <div className={styles.empty} data-testid="global-search-empty">
          Ничего не найдено по запросу &ldquo;{debouncedQuery}&rdquo;
        </div>
      );
    }

    if (state.status === "ok") {
      const { tasks, agentReports } = groupResults(state.results);
      // Build a flat index offset for aria-selected mapping
      let globalIndex = 0;

      return (
        <div role="listbox" aria-label="Результаты поиска">
          {tasks.length > 0 ? (
            <div>
              <div className={styles.groupHeader} aria-hidden="true">
                Задачи
              </div>
              {tasks.map((result) => {
                const idx = globalIndex++;
                return (
                  <ResultRow
                    key={result.id}
                    result={result}
                    index={idx}
                    isFocused={focusedIndex === idx}
                    onSelect={handleSelect}
                    onHover={() => setFocusedIndex(idx)}
                  />
                );
              })}
            </div>
          ) : null}
          {agentReports.length > 0 ? (
            <div>
              <div className={styles.groupHeader} aria-hidden="true">
                Отчёты агента
              </div>
              {agentReports.map((result) => {
                const idx = globalIndex++;
                return (
                  <ResultRow
                    key={result.id}
                    result={result}
                    index={idx}
                    isFocused={focusedIndex === idx}
                    onSelect={handleSelect}
                    onHover={() => setFocusedIndex(idx)}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
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
          aria-label="Глобальный поиск"
          data-testid="global-search"
        >
          {/* Keyboard nav wrapper — arrow keys / enter move between results */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div onKeyDown={handleKeyDown}>
            {/* ── Search input ── */}
            <div className={styles.inputWrap}>
              <Search size={16} className={styles.searchIcon} aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                role="searchbox"
                aria-label="Поиск по задачам и отчётам"
                placeholder="Поиск задач, отчётов…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={styles.input}
                data-testid="global-search-input"
                autoComplete="off"
              />
            </div>

            {/* ── Results body ── */}
            <div className={styles.body}>{renderBody()}</div>
          </div>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

// ---------------------------------------------------------------------------
// ResultRow sub-component
// ---------------------------------------------------------------------------

interface ResultRowProps {
  result: SearchResult;
  index: number;
  isFocused: boolean;
  onSelect: (result: SearchResult) => void;
  onHover: () => void;
}

function ResultRow({
  result,
  index,
  isFocused,
  onSelect,
  onHover,
}: ResultRowProps): ReactElement {
  const rowRef = useRef<HTMLButtonElement>(null);

  // Scroll the focused row into view when focus moves via keyboard.
  // scrollIntoView may be absent in test environments (jsdom) — guard defensively.
  useEffect(() => {
    if (isFocused && rowRef.current) {
      rowRef.current.scrollIntoView?.({ block: "nearest" });
    }
  }, [isFocused]);

  return (
    <button
      ref={rowRef}
      type="button"
      role="option"
      aria-selected={isFocused}
      className={styles.resultItem}
      data-testid={`global-search-result-${index}`}
      data-focused={isFocused ? "true" : "false"}
      onClick={() => onSelect(result)}
      onMouseEnter={onHover}
    >
      <span className={styles.resultTitle}>{result.title}</span>
      <span className={styles.resultSnippet}>{result.snippet}</span>
    </button>
  );
}
