/**
 * Storybook — GlobalSearch.
 *
 * GlobalSearch fires `invoke("search_all", …)` via @shared/api which
 * wraps @tauri-apps/api/core. In Storybook, @tauri-apps/api/core is
 * aliased to .storybook/__mocks__/tauri-api-core.ts which exposes
 * `setMockInvoke` / `resetMockInvoke` helpers.
 *
 * Decorators use `setMockInvoke` to return stub data or errors so the
 * component drives into the desired state when the user types into the
 * search box.
 *
 * Deliberate skips:
 *   - "Loading" transient state: visible only during the 200ms debounce
 *     window — not worth story coverage.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SearchResult } from "@bindings/SearchResult";

import {
  setMockInvoke,
} from "@storybook-mocks/tauri-core";

import { GlobalSearch } from "./GlobalSearch";

// ── Stub data ─────────────────────────────────────────────────────────────────

const sampleResults: SearchResult[] = [
  {
    type: "task",
    id: "t-1",
    boardId: "b-1",
    columnId: "col-1",
    title: "Разработать дизайн-систему",
    snippet: "Создать компонентную библиотеку на основе CSS Modules и семантических токенов.",
  },
  {
    type: "task",
    id: "t-2",
    boardId: "b-1",
    columnId: "col-2",
    title: "Внедрить глобальный поиск",
    snippet: "Реализовать полнотекстовый поиск задач и отчётов через FTS5.",
  },
  {
    type: "agentReport",
    id: "rpt-1",
    taskId: "t-1",
    title: "Анализ требований к дизайн-системе",
    kind: "investigation",
    snippet: "Изучены существующие паттерны. Рекомендовано использовать CSS Modules с токенами.",
  },
  {
    type: "agentReport",
    id: "rpt-2",
    taskId: "t-2",
    title: "Ревью архитектуры поиска",
    kind: "review",
    snippet: "Предлагается FTS5 с двумя таблицами: tasks_fts и agent_reports_fts.",
  },
];

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: "widgets/global-search/GlobalSearch",
  component: GlobalSearch,
  args: {
    isOpen: false,
    onClose: () => undefined,
    onSelectResult: () => undefined,
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GlobalSearch>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ───────────────────────────────────────────────────────────────────

/** isOpen false — overlay not mounted. */
export const Closed: Story = {
  args: { isOpen: false },
};

/**
 * Open with empty query — shows "начните вводить" hint.
 * The mock returns an empty array for all searches.
 */
export const OpenEmpty: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => {
      setMockInvoke(() => Promise.resolve([]));
      return <Story />;
    },
  ],
};

/**
 * Open with results — tasks and agent reports mixed.
 * Type anything in the search box to trigger the mock and see results.
 */
export const OpenWithResults: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => {
      setMockInvoke(() => Promise.resolve(sampleResults));
      return <Story />;
    },
  ],
};

/**
 * Open with no results — mock returns empty array.
 * The "ничего не найдено" message appears after typing.
 */
export const OpenNoResults: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => {
      setMockInvoke(() => Promise.resolve([]));
      return <Story />;
    },
  ],
};

/**
 * Open with IPC error — mock rejects so the error banner renders.
 * Type anything in the search box to trigger the rejection.
 */
export const OpenWithError: Story = {
  args: { isOpen: true },
  decorators: [
    (Story) => {
      setMockInvoke(() =>
        Promise.reject(new Error("Ошибка подключения к базе данных")),
      );
      return <Story />;
    },
  ],
};
