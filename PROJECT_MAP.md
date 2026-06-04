# Catique HUB — Project Map (v3)

> Карта спроектирована под mental model «я работаю над проектом X», под developer-аудиторию, и под центральный сценарий: подготовить эффективный контекст для агента → запустить → проверить результат.

---

## Navigation Hierarchy

```
Sidebar (single, unified, collapsible to icons)
├── 🔍 Search (Cmd+K, with quick actions)
│
├── Spaces                              ← primary navigation
│   ├── 📌 Pinned boards                ← user-pinned, across spaces
│   ├── 🕘 Recent boards (5)            ← auto-tracked
│   ├── ───────────
│   ├── 📁 MyProject
│   │   ├── 🤖 Backend Engineer · main board
│   │   ├── 🤖 Backend Engineer · refactor board    ← multiple boards per agent ✓
│   │   ├── 🤖 Frontend Dev
│   │   └── 🤖 Code Reviewer
│   └── 📁 AnotherProject
│       └── 🤖 Backend Engineer
│
├── ───────────
│
├── Agents                              ← reusable building blocks, top-level
├── Prompts                             ← (no longer hidden under "Library")
├── Skills
├── Integrations (MCP)
│
└── Settings

Status bar (always visible, bottom)
├── 🟢 MCP sidecar       (right-click → restart / logs / stop)
├── 🟢 Providers connected (right-click → reconnect / disconnect)
└── ⚙ Open system drawer
```

---

## Pages

### `/` — Home

- **Shows**: Если есть `last_active_space` — auto-redirect туда. Если нет — пустое состояние «Choose a project to start» + список spaces.
- **Actions**: Создать space, открыть существующий.

### `/spaces/:spaceId` — Space detail (главный экран дня)

- **Shows**: Имя проекта, иконка, project folder, **Resume panel**, agents-боты, project-level конфигурация.
- **Sections**:
  - **Resume where you left off** (top, primary) — последняя открытая таска, последняя активная сессия агента, последний редактируемый промпт в контексте проекта. Один клик — продолжить.
  - **Agents in this space** — карточки агентов с их досками. Один агент может иметь N досок в проекте (см. ниже). Кнопка «Add agent to this space».
  - **Project-level configuration** — promtps + skills + integrations, прикреплённые к space (унаследуются всеми досками всех агентов проекта).
  - **Activity log** (collapsible) — последние 20 events: task moved, report created, agent run started/finished. С фильтрами по типу.
- **Actions**: Открыть доску, добавить агента, открыть/редактировать конфигурацию, открыть settings.

### `/spaces/:spaceId/settings` — Space settings

- **Form fields**:
  - Name — text input (required)
  - Prefix — read-only badge (immutable per contract)
  - Icon & color — picker
  - Project folder — path picker (Tauri dialog)
- **Actions**: Save, delete, back.

### `/spaces/:spaceId/boards/:boardId` — Kanban board

- **Shows**: Колонки + таски. Заголовок: project name → agent name → board name (breadcrumb). Cog для settings. **Live-индикатор**: таски «в работе» у агента выделены спиннером + цветной полосой, с возможностью прервать или открыть live-log.
- **Form fields**:
  - Column: name (text)
  - Task: title (text, required), description (optional)
- **Actions**:
  - Create column (modal)
  - Create task (modal)
  - Drag tasks
  - Delete task
  - **Pin board** (toggle, появляется в Pinned секции сайдбара)
  - Open task detail
  - Open board settings

### `/spaces/:spaceId/boards/:boardId/settings` — Board settings

- **Form fields**:
  - Name — text input (required)
  - Description — textarea
  - Icon & color — picker
  - Position — float slider
  - Board-level prompts/skills/integrations — multiselect (с origin badges если что-то унаследовано от space)
- **Actions**: Save, delete board, back.

### `/tasks/:taskId` — Task detail (центральный экран продукта)

- **Layout**: Описание свернуто (если длинное), **Effective Context Panel развёрнут по умолчанию** — это главный контент.
- **Sections** (порядок сверху вниз):
  - **Title + slug** + status badge (idle / queued / running / completed / failed)
  - **Effective Context Panel** (expanded by default) — финальный набор того, что улетит агенту:
    - **Preview prompt** button — собирает финальный текст промпта, показывает в модалке. Dry-run без запуска.
    - Prompts (effective: N) — каждый с origin badge: `agent` / `space` / `board` / `task` / `★ override`
    - Skills (effective: N) — то же
    - Integrations (effective: N) — то же
    - Suppressed / replaced элементы — зачёркнутые, с `[restore]` или указанием замены
  - **Direct task attachments**:
    - Prompts [+ add] [+ override inherited]
    - Skills [+ add]
    - Integrations [+ add]
  - **Description** — markdown, collapsible если > N строк
  - **Files** — uploaded attachments
  - **Reports** — agent reports, с inline-search
- **Form fields**:
  - Title — text input
  - Description — markdown + preview
- **Actions**:
  - Run agent on this task
  - Stop running agent
  - Save / delete task
  - Preview final prompt (dry-run)
  - Override prompt = replace inherited X with Y for this task
  - Suppress inherited item
  - Restore suppressed item
  - Upload file
  - View / search reports

### `/agents` — Agents library

- **Shows**: Список всех агентов (карточки или таблица), фильтр по тэгам/spaces.
- **Actions**: Create agent (modal), select to edit.

### `/agents/:agentId` — Agent detail

- **Layout**: Toolkit сверху (используется чаще), instructions посередине, spaces снизу (контекстная инфа).
- **Sections** (порядок сверху вниз):
  - **Header** — имя, иконка, цвет, settings, **history button** (см. ниже)
  - **Agent's toolkit** — то, что унаследуется всеми досками этого агента во всех проектах:
    - Prompts — multiselect, drag-reorder
    - Skills — multiselect
    - Integrations (MCP tools) — multiselect
  - **Instructions** — markdown content (role-file body), с поддержкой diff/history
  - **Working in spaces** — список spaces с переходом на доски + кнопка «Add to space»
  - **Recent activity across all projects** — последние 20 events, с фильтром по space
- **Form fields**:
  - Name — text input
  - Content — markdown textarea (с историей версий)
  - Icon & color — picker
- **Actions**: Save, delete, add to space, remove from space, **view history**, **revert to version**.

### `/prompts` — Prompts library

- **Shows**: Левый сайдбар с prompt groups + tag filter, правая панель: grid / editor / group view.
- **Tabs at top**: `Prompts` | `Groups` | `Tags`
- **Form fields** (create/edit):
  - Name — text input (required)
  - Content — markdown textarea + preview (required, с историей версий)
  - Short description — text input
  - Color, icon — pickers
  - Examples — multi-input list
  - Tags — multiselect
- **Actions**:
  - Create prompt / group / tag
  - Edit, delete, drag between groups
  - **View history**, **revert version**
  - Token-count auto-backfill

### `/prompts/:promptId` — Prompt detail (inline pane)

- **Shows**: Полная форма, теги, group membership, history.
- **Actions**: Save, delete, manage tags, view/revert history, back.

### `/skills` — Skills library

- **Shows**: Sidebar tree, правая панель — overview или selected editor.
- **Actions**: Add skill, **import from URL**, **export skill** (markdown / git URL), select, edit, delete.

### `/skills/:skillId` — Skill detail

- **Form fields**:
  - Name — text input (required)
  - Overview — markdown
  - Steps (SKILL-V2-A): title, body, expected outcome — drag-reorderable
  - Attachments (SKILL-S10): file / git URL
- **Actions**: Save, add/delete/reorder steps, add/remove attachments, **import**, **export** (markdown / share via git URL), delete, back.

### `/integrations` — MCP servers & tools

- **Shows**: Sidebar tree (servers/tools), overview или selected detail.
- **Actions**: Add server, refresh, edit, toggle enabled, delete, search.

### `/integrations/:serverId` — MCP server detail

- **Form fields**:
  - Name — text input
  - Transport — stdio / http / sse
  - URL or command — text input
  - Auth reference — JSON (optional)
  - Enabled — toggle
- **Actions**: Save, refresh tools, delete, view status, back.

### `/integrations/:serverId/tools/:toolId` — MCP tool detail

- **Shows**: Name, description, JSON schema, source, position. Read-only.
- **Actions**: Back.

### `/settings` — Global settings

- **Sections**:
  - **Appearance** — theme, language
  - **Keyboard shortcuts** — reference
  - **Tokens** — API token management
  - **Data** — import/export, backup/restore
  - **About** — version, links
- **Actions**: Toggle theme, generate/revoke tokens, export/import, view version.

### System drawer (not a route — opens from status bar)

- **Shows**: MCP sidecar status + start/stop/restart, connected providers + connect/disconnect (OAuth), runtime info, recent errors.
- **Actions**: One-click sidecar restart, reconnect provider, view logs.

---

## Cmd+K — Global search & quick actions

**Searches across**: tasks, reports, prompts, skills, agents, spaces, integrations. Grouped by entity type in dropdown.

**Quick actions** (the killer feature):
- `Find prompt X → Enter` — opens prompt editor
- `Find prompt X → Cmd+Enter` — attaches to current task (if on task detail)
- `> New task in <space>` — command palette mode with prefix
- `> Go to space MyProject` — navigate
- `> Restart sidecar`
- `> Run agent on current task`

Powered by `search_all` API + local action registry.

---

## Key UI Components & Dialogs

### Create Dialogs (Modal-only creation invariant)

| Dialog | Fields | Actions |
|--------|--------|---------|
| **Space create** | name, prefix (unique, validated), icon, color, project folder | Create |
| **Add agent to space** | agent picker (multiselect existing) + «create new agent» option | Add |
| **Board create** | name, optional: copy from template, default columns config | Create (explicit, not auto) |
| **Column create** | name | Create |
| **Task create** | title, description (optional) | Create |
| **Agent create** | name, content (markdown), icon, color | Create |
| **Skill create** | name, overview | Create |
| **Prompt create** | name, content, short description, examples, color, icon, tags | Create |
| **Prompt group create** | name, color, icon | Create |
| **Tag create** | name, color | Create |
| **MCP server create** | name, transport, URL/command, auth ref | Create |

### Routed editor pages (`← Back`)

- Space detail / settings
- Board settings
- Task detail
- Agent detail
- Skill detail
- Prompt detail
- MCP server / tool detail

### Reused components

- **MultiSelect** — prompts, skills, tags, integrations, agents
- **Select** — transport, agent picker
- **IconColorPicker** — universal
- **MarkdownField** — with preview toggle and **version history** (для agent.content, prompts.content)
- **OriginBadge** — `agent` / `space` / `board` / `task` / `★ override` — используется везде, где видны attached элементы (не только в effective context)
- **EffectiveContextPanel** — на task detail
- **HistoryViewer** — diff между версиями + revert (для agent.content и prompts.content)
- **RunningTaskIndicator** — спиннер + цветная полоса на карточке таски в kanban
- **StatusDot** — для sidecar, providers, MCP servers

---

## Data Flow & Mutations

| Entity | Key mutations | Queries |
|--------|---------------|---------|
| Space | create, update, delete, **add/remove agent** | list, get by id |
| Agent (Role) | create, update, delete, **add to space**, **remove from space**, set toolkit, **create version on content change** | list, get by id, **list by space**, **list versions**, **get version diff** |
| Board | **create explicitly** on (space × agent), update, delete | list by space, **list by (space, agent)**, get by id |
| Column | create, update, delete, reorder | list, get by id |
| Task | create, update, delete, move, set direct prompts/skills/integrations, **set/clear override** (replace OR suppress), **mark running / completed / failed** | list by board, get by id, **get effective context (resolved)** |
| Prompt | create, update, delete, recompute token count, set tags, **create version on content change** | list, get by id, **list versions** |
| Prompt Group | create, delete, add/remove/set members | list, get members |
| Skill | create, update, delete, import from URL, **export to markdown / git**, manage steps/attachments | list, get by id |
| Tag | create, update, delete, set prompts | list, get by id |
| MCP Server | create, update, delete, refresh | list, get by id, get tools by server |
| MCP Tool | (upstream introspection or manual) | list by server, get by id |
| Attachment | upload, delete | list by task |
| Agent Report | create, update, delete, search | list by task, **list by space**, **list by agent**, FTS5 search |
| Pinned board | add, remove, reorder | list pinned |
| Recent board | (auto, tracked on board open) | list recent |

---

## Navigation Behavior

- **Spaces — primary entry point.** Mental model = «работаю над проектом».
- **Доска = (space × agent), но N досок на эту пару разрешены.** Например: «main», «refactor», «features».
- **Effective context вычислим на лету** через `get_task_bundle`. Для list-views (kanban с превью effective count) — denormalized counter, инвалидируемый при изменении источника наследования.
- **Origin badges везде**, где видны attached элементы.
- **Sidebar collapse** — иконочный режим как в VSCode.
- **Pinning + Recent** в сайдбаре для частого доступа без скролла.
- **Sidebar search** — узкое поле сверху, фильтрует spaces/boards.
- **Status bar постоянно виден**, right-click даёт быстрые actions.
- **Cmd+K = search + actions**, не только навигатор.
- **URL-driven state** — selected IDs из URL, не useState.
- **Deep-linking** — все routable пути bookmark-friendly.
- **Live indicators** для running tasks — спиннер в kanban + status badge в task detail.

---

## Open issues (требуют решения до реализации)

1. **Override для skills и integrations** — в API сейчас существует только `set_task_prompt_override`. Чтобы поддержать override (replace или suppress) для skills и integrations, нужно расширить API: `set_task_skill_override`, `set_task_integration_override`. **Решение требуется на backend-уровне.**

2. **Миграция данных** — существующие доски без agent owner (если такие есть в production БД). Варианты: запретить и заставить юзера явно назначить агента; auto-assign на «default agent» в space; пометить как «unassigned» и показать в специальной секции. **Нужен аудит существующих данных.**

3. **Effective context performance** — для kanban с 50+ тасками вычисление effective count для каждой = N×5 join'ов. Нужен либо denormalized cache на task-row (`effective_prompt_count`, инвалидируемый триггерами), либо batch-resolver. **Performance-тестирование обязательно перед релизом.**

4. **Activity log scope и retention** — что считать event'ом, какие сохранять, сколько хранить, как фильтровать. **Требует продуктового решения.**

5. **Version history granularity** — сохранять каждое сохранение или дебаунсить (например, версия раз в 5 минут активного редактирования)? Сколько версий хранить (последние 50? последние 30 дней?)? **Требует продуктового решения.**

6. **Sidecar / providers как separate concern** — выносим из Settings в drawer из status bar. Подтвердить, что Settings не теряет важной функциональности.

7. **Legacy routes** — `/boards/:id → /spaces/:spaceId/boards/:boardId` это не алиас, а полноценный lookup-redirect. Аналогично `/roles → /agents`, `/mcp-servers → /integrations`. **Нужен resolver-сервис, не просто config-аlias.**

---

## Changelog — что изменилось vs v2 и зачем

### Структурные изменения

- **Library как зона удалена.** Agents / Prompts / Skills / Integrations теперь top-level пункты сайдбара. Почему: разработчик ходит туда десятки раз в день; «library» подсознательно сигнализирует «архив, заходишь редко». Один клик вместо двух.

- **Допущены N досок на пару (space × agent).** Почему: реальный workflow — у одного агента в одном проекте параллельно идут разные потоки работ (refactor / features / bugs). Запрет одной доской — искусственное ограничение.

- **Auto-create board при «Add agent to space» убран.** Теперь это явное действие с модалкой: имя доски, опциональный template. Почему: developer tools не любят магию; скрытые побочные эффекты — плохой паттерн.

- **Sidebar получил Pinned + Recent секции.** Почему: при 8 проектах × 4 агента = 30+ досок раскрытый sidebar — это скролл. Pinning и recent дают O(1) доступ к рабочему набору.

- **Sidebar получил collapsible-режим** (VSCode-style). Почему: место.

- **Sidebar search field** для фильтрации spaces/boards. Почему: то же — масштаб.

### Task detail

- **Effective Context Panel развёрнут по умолчанию.** Описание свёрнуто, если длинное. Почему: effective context — главный контент таски в этом продукте, его проверяют каждый раз перед запуском. Описание читают один раз.

- **Preview prompt (dry-run) button.** Собирает финальный текст промпта для просмотра без запуска. Почему: промпты могут конфликтовать, дублировать, противоречить. Запуск без preview = «пускаю и молюсь».

- **Override = replace, не только suppress + add.** Семантика: на конкретной таске замена inherited prompt X на prompt Y, без вреда для других тасок. Почему: реальный use case — «обычно для агента используется Concise, но эта таска требует Verbose».

- **Live status badges и indicators** для running tasks. Спиннер в kanban + status badge (idle / queued / running / completed / failed) в task detail. Почему: агентский продукт без видимого «в работе» — странно. Пользователь должен видеть и иметь возможность прервать.

### Agent detail

- **Toolkit поднят наверх, instructions посередине, spaces вниз.** Почему: toolkit редактируется чаще всего; spaces — справочная инфа.

- **History / diff / revert для agent.content и prompt.content.** Почему: разработчик ожидает git-подобную историю. «Я случайно стёр половину инструкции — где undo?» — must-have.

### Skills

- **Export добавлен** (markdown / git URL share). Почему: импорт без экспорта = асимметрия. Команды делятся скиллами между собой.

### Search

- **Cmd+K с quick actions, а не только навигатор.** Ищет tasks/reports/prompts/skills/agents/spaces. Quick actions: «найти и прикрепить к текущей таске», «создать таску в space X», «restart sidecar». Почему: палитра без actions — половинчатая фича.

- **Глобальный search для reports** через Cmd+K. Reports остаются вкладками в Space и Agent detail для контекстного просмотра, но глобальный поиск решает кейс «когда я последний раз решал X».

### Settings

- **Sidecar + Connected providers вынесены из Settings в drawer из status bar.** Почему: это runtime-вещи, не настройки. Drawer открывается одним кликом, без ухода со страницы. Status bar даёт постоянную видимость + right-click для быстрых действий.

- **Settings содержит только настройки**: Appearance, Shortcuts, Tokens, Data, About. Profile удалён (если он только display, его место в About).

### Origin badges

- **Применяются везде**, не только в Effective Context Panel. На board settings, agent detail, в любом MultiSelect, где видны элементы — рядом с inherited элементом значок происхождения с tooltip.

### Resume panel

- **«Recent activity» заменена на «Resume where you left off»** на Space detail. Конкретные действия: продолжить с последней таски, открыть последний редактируемый промпт. Почему: рабочий день — это поток, а не feed. Resume говорит «здесь твоя работа», feed говорит «вот что произошло».

- **Activity log сохранён как collapsible секция** для тех, кому нужен audit.

### Не менялось

- API tools — все существующие операции сохранены. Добавлены: `list_boards_by_space_and_agent`, version-history-методы, override для skills/integrations (см. open issues), export для skills, pinned/recent persistence.
- Modal-only creation invariant — сохранён. Modal для create + routed page для edit — рабочий паттерн.
- Drag-and-drop tasks между колонками.
- Skills V2 (steps + attachments).
- Markdown editors, icon/color pickers, multiselect компоненты.
- URL-driven state, deep-linking.