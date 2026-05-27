# FSD-аудит фронтенда Catique HUB — 2026-05

> Слайс задачи: **catique-7** (рефакторинг клиента, пересборка FSD-модели).

## TL;DR

- Фактически используются **4 слоя** из канонических шести: `app / widgets / entities / shared`. Слои `pages` и `features` отсутствуют.
- В коде есть 4 категории явных нарушений направления импорта (детали ниже). Они мешают линтерному автоматическому контролю и будут расти, пока не зафиксируем правила.
- ~~Предлагается зафиксировать **5-слойную модель** (без `pages`, с возвращённым `features`) и поставить `eslint-plugin-boundaries` как gate в CI.~~
- **Обновлено 2026-05-27 (catique-router refactor):** цель пересмотрена на **6 канонических слоёв FSD** — `app / pages / widgets / features / entities / shared`. `pages/` нужен как точка композиции маршрутов для миграции на TanStack Router (file-based-like layout без переноса виджетов в `src/routes/`). Реализация в фазах F0–F5 ветки `refactor`.
- **F5 status:** `eslint-plugin-boundaries@^6` установлен, конфиг `eslint.config.js` написан, скрипт `pnpm lint` подключён, но **boundary-нарушения пока не репортятся**: v6 selector-API не совместим с конфигом, написанным под legacy `boundaries/element-types`. Follow-up F5b — либо мигрировать на v6 object-selectors, либо откатиться на `boundaries@5`. До тех пор список FSD-нарушений из секций ниже остаётся актуальным as-is.

## 1. Текущая структура

```
src/
├── app/        ← providers, routing, root composition
├── widgets/    ← composite UI блоки (BoardsList, Toaster, MainSidebar, ...)
├── entities/   ← domain primitives + хуки + типы (board, column, task, role, ...)
├── shared/     ← ui kit, api wrapper, utils, lib
├── e2e/        ← Playwright + mock IPC bridge
└── types/      ← глобальные .d.ts
```

`pages/` и `features/` физически отсутствуют. Часть «фич» сейчас живёт в `widgets/` (composite + бизнес-логика), часть — в `entities/<x>/ui/`.

## 2. Найденные нарушения FSD (grep, 2026-05-19)

### 2.1. `widgets → app/providers` (направление вверх)

> FSD: импорт строго **вниз** по слоям. Виджет не должен зависеть от `app/`.

| Файл | Импорт |
| --- | --- |
| `widgets/toaster/Toaster.tsx` | `useToast`, `Toast`, `ToastKind` из `@app/providers/ToastProvider` |
| `widgets/prompt-tags-field/PromptTagsField.tsx` | `useToast` |
| `widgets/mcp-server-create-dialog/McpServerCreateDialog.tsx` | `useToast` |
| `widgets/boards-list/BoardsList.tsx` | `useActiveSpace`, `boardSettingsPath` из `@app/routes` |
| тесты `widgets/**.test.tsx` | `ToastProvider` |

**Корень проблемы.** `ToastProvider` и `ActiveSpaceProvider` живут в `app/`, потому что они композят provider-tree. Но публичные хуки (`useToast`, `useActiveSpace`) — это **shared client utility**, и им место в `shared/lib/` или отдельном `shared/contexts/`.

### 2.2. `shared → entities` (критическое нарушение)

> FSD: `shared` — нижний слой. Импорт из `entities` запрещён.

| Файл | Импорт |
| --- | --- |
| `src/shared/lib/index.ts:8` | `spacesKeys` из `@entities/space` |

**Корень проблемы.** `spacesKeys` (TanStack query key factory) натянут в `shared` как удобный re-export. Это создаёт circular зависимость семантически: `entities` зависят от `shared`, и одновременно `shared` зависит от `entities`. Лечится переносом query-keys в `entities/space` (где они и созданы) и удалением re-export.

### 2.3. Cross-entity импорты

> FSD: slice одного слоя не должны импортить друг друга. Общее — выносим в `shared/`.

| Файл | Импорт |
| --- | --- |
| `entities/role-note/api/roleNotesApi.ts:20` | `AppErrorInstance` из `@entities/board` |

**Корень.** `AppErrorInstance` — общий runtime тип ошибок, его место в `shared/api/` (или `shared/lib/errors`). Сейчас он случайно прописан в `entities/board` и тянет за собой все остальные entity, кому он нужен.

### 2.4. Relative-escape за пределы slice

> FSD: за пределы slice — только через alias.

| Файл | Импорт |
| --- | --- |
| `widgets/settings-view/SettingsView.tsx:16` | `../../../package.json` |

Один-единственный случай, легко чинится через alias `@app/package` или Vite `define`.

## 3. Целевая модель

### 3.1. Слои

Закрепляем **5 слоёв** (без `pages`, с возвращённым `features`):

```
app → widgets → features → entities → shared
```

`pages/` опускаем сознательно: маршрутизация в `app/routes`, компоненты страниц — это `widgets/*-view`. Промежуточный `pages/` плодит boilerplate.

### 3.2. Сегменты внутри slice

Каждый slice (`<layer>/<slice>/`) имеет 1-N сегментов из канонического набора:

- `ui/` — компоненты
- `model/` — стор, хуки, бизнес-состояние
- `api/` — wrapper над `shared/api` (IPC / HTTP)
- `lib/` — slice-local utilities (нет — не плодим)
- `index.ts` — public API (явный re-export)

### 3.3. Public API

Импорт между slice одного слоя — **только** через `@<layer>/<slice>` (alias на `<slice>/index.ts`). Прямые пути в `<slice>/ui/...` извне slice запрещены.

## 4. План миграции

| # | Шаг | Размер | Зависимости |
| --- | --- | --- | --- |
| 1 | Перенести `useToast` / `ToastProvider` в `shared/contexts/toast/`, оставить тонкий wrapper в `app/` | S | — |
| 2 | Перенести `useActiveSpace` / `ActiveSpaceProvider` в `shared/contexts/active-space/` | S | — |
| 3 | Перенести `AppErrorInstance` в `shared/api/errors` + чистка re-export в `entities/board` | S | — |
| 4 | Убрать `spacesKeys` re-export из `shared/lib/index.ts` | XS | — |
| 5 | Завести `features/` слой и перенести `widgets/*-create-dialog` (это features по смыслу) | M | 1–4 |
| 6 | Поставить `eslint-plugin-boundaries`, конфиг для 5 слоёв | M | 1–5 |
| 7 | Включить правило `boundaries/element-types` как **error** | XS | 6 |
| 8 | Обновить `.claude/agents/frontend-engineer.md` — текущая FSD без `pages/` | XS | 6 |

Каждый шаг — отдельный PR ≤ 400 LOC, зелёный CI после каждого.

## 5. ESLint конфиг (черновик)

```js
// eslint.config.js (минимальный fragment)
import boundaries from "eslint-plugin-boundaries";

export default [
  {
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "app",      pattern: "src/app/*" },
        { type: "widgets",  pattern: "src/widgets/*" },
        { type: "features", pattern: "src/features/*" },
        { type: "entities", pattern: "src/entities/*" },
        { type: "shared",   pattern: "src/shared/*" },
      ],
    },
    rules: {
      "boundaries/element-types": ["error", {
        default: "disallow",
        rules: [
          { from: "app",      allow: ["widgets", "features", "entities", "shared"] },
          { from: "widgets",  allow: ["features", "entities", "shared"] },
          { from: "features", allow: ["entities", "shared"] },
          { from: "entities", allow: ["shared"] },
          { from: "shared",   allow: ["shared"] },
        ],
      }],
      "boundaries/no-private": "error",
    },
  },
];
```

`shared → shared` разрешён (внутренние под-слайсы), всё остальное по строгому направлению.

## 6. Ссылки

- [Feature-Sliced Design v2.1](https://feature-sliced.design)
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries)
- Memory: [feedback_default_english](feedback_default_english.md) — все user-facing строки/комментарии англоязычные.
- Memory: [project_catique_product_model](project_catique_product_model.md) — продуктовые инварианты, в том числе про shared/ui переиспользование.

## 7. Следующие действия

1. Подтверждение целевой 5-слойной модели у product-manager-cat.
2. PR-ы по шагам 1–4 (декомпозированные, без feature changes).
3. После шагов 1–4 — установка eslint-plugin-boundaries (шаг 6) и включение в CI.
