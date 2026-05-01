# Design System v1 — Анатомия компонентов

Источник образов: мокапы image.png (light), image2.png (dark), image5.png (edit modal + расширенный сайдбар).
Иконки: image3.png — пиксельный арт-сет.

Все токены referenced по имени CSS-переменной. Физические значения — в `tokens.md`.

---

## 1. Window Chrome

### Структура

```
┌─────────────────────────────────────────────────────┐
│ [●][●][●]   [Search…]  ⌘K        [+ New task] [⚙][🔔][👤] │
│ ─────────────────────────────────────────────────── │
│ [Sidebar 220px] │ [Main content area]               │
└─────────────────────────────────────────────────────┘
```

- Macbook: нативный `data-tauri-drag-region` применён к полосе шириной 48 px в самом верху. Кнопки светофора (●●●) — нативные macOS-кнопки, позиционированы системой (`padding-left: 72px` для очистки пространства).
- Минимальное окно: **900 × 600 px**.
- Тема переключается через `data-theme="dark"` на `<html>`.

### Токены

- `--color-surface-topbar` — фон верхней полосы
- `--color-bg-default` — фон всего окна
- `--shadow-low` — разделитель top-bar / content (тонкая тень вниз)

---

## 2. Sidebar

### Структура

```
Sidebar (220 px)
├── Wordmark block
│   ├── Logo (32×32 px кот-пиксель)
│   ├── "Catique Hub" (font-display, 17px bold)
│   └── "Orchestrate. Build. Ship." (12px, text-subtle)
├── SPACES label
│   └── SpaceRow × N
├── WORKSPACE label (image5.png)
│   ├── NavRow "Boards"
│   ├── NavRow "Agent roles"
│   ├── NavRow "Prompts"
│   ├── NavRow "Skills"
│   ├── NavRow "MCP servers"
│   └── NavRow "Settings"
├── RECENT BOARDS label
│   └── BoardRow × N
└── Mascot host: Catique (кот в берете, bottom — см. §10 Mascot system)
```

### SpaceRow / BoardRow / NavRow

Все строки — одна анатомия:

```
[indent][icon 16×16][label text][expand ▶ / chip]
```

- Высота: 32 px (`--space-8` top + bottom padding)
- Горизонтальный паддинг: `--space-12`
- Border-radius: `--radius-sm`
- Активная строка: фон `--color-accent-soft`, текст `--color-accent-bg`
- Hover: `--color-overlay-hover`
- Иконки из пиксельного арт-сета (16 px) или Lucide-совместимый сет (функциональные)

### Wordmark block

- Logo: 32 × 32 px SVG/PNG пиксельный кот
- «Catique Hub»: `--font-display`, `--font-size-display` (17 px), `--font-weight-bold`, `--color-text-wordmark`
- Tagline: `--font-sans`, `--font-size-body-sm` (12 px), `--color-text-wordmark-sub`
- Паддинг блока: `--space-16` по всем сторонам

### SPACES / WORKSPACE / RECENT BOARDS — Section labels

- Текст: все заглавные, `--font-size-caption` (11 px), `--font-weight-semibold`, `--color-text-subtle`
- `letter-spacing: 0.06em`
- Padding-top: `--space-16`, padding-bottom: `--space-4`, padding-x: `--space-12`

### Состояния

| Состояние  | Стиль                                           |
|------------|-------------------------------------------------|
| Default    | Прозрачный фон, `--color-text-muted`            |
| Hover      | `--color-overlay-hover` фон                    |
| Active     | `--color-accent-soft` фон, `--color-accent-bg` текст/иконка |
| Expanded   | Стрелка повёрнута на 90°, дочерние строки видны |

### Размеры

- Ширина: **220 px** (фиксированная, без ресайза в v1)
- Фон: `--color-surface-sidebar`
- Правая граница: `1px solid var(--color-border-default)`

---

## 3. Top Bar

### Структура

```
[drag region]
[Search field (flex-grow)] [Cmd+K hint] | [+ New task] [eq icon] [bell icon] [avatar]
```

- Высота: **48 px**
- Фон: `--color-surface-topbar`
- Нижняя граница: `1px solid var(--color-border-subtle)`

### Search field

- Ширина: flex-grow (занимает оставшееся пространство)
- Паддинг: `--space-8` vertical, `--space-12` horizontal
- Радиус: `--radius-md`
- Фон: `--color-overlay-hover` (еле заметный)
- Placeholder: «Search tasks, boards, agents…» `--color-text-subtle`
- Kbd hint «⌘K»: `--font-mono`, `--font-size-caption`, border `--color-border-default`, radius `--radius-xs`, padding `2px 4px`

### «+ New task» button (CTA)

- Вариант: `primary-cta` (красный)
- Фон: `--color-cta-bg` (`#e8413a`)
- Текст: `--color-text-on-cta` (белый), `--font-size-body` (13 px), `--font-weight-semibold`
- Радиус: `--radius-md`
- Паддинг: `--space-8` vertical, `--space-16` horizontal
- Иконка «+» 16 px + текст, gap `--space-6`
- Hover: `--color-cta-hover`; Active: `--color-cta-active`

### Иконочные кнопки (settings / activity / avatar)

- Размер зоны касания: 32 × 32 px (`--radius-sm`)
- Иконки 16 × 16 px, цвет `--color-text-muted`
- Hover: `--color-overlay-hover`
- Avatar: 28 × 28 px, `--radius-full`, border `1px solid var(--color-border-default)`

---

## 4. Board Header

### Структура

```
[Board name] [Board tagline / description]        [Group by: Status ▼]
```

- Высота: **56 px** (паддинг `--space-16` top + bottom)
- Фон: `--color-surface-canvas`
- Нижняя граница: `1px solid var(--color-border-default)`

### Элементы

- Board name: `--font-size-headline` (17 px), `--font-weight-semibold`, `--color-text-default`
- Tagline: `--font-size-body` (13 px), `--color-text-muted`
- «Group by:» dropdown: `--font-size-body-sm` (12 px), `--color-text-subtle` + `--color-text-default` для значения
- Gap между именем и тэглайном: `--space-8`

---

## 5. Kanban Column

### Структура

```
Column (min-width: 280 px, max-width: 320 px)
├── Column Header
│   ├── Column name ("Backlog") — bold, 15px
│   ├── Count chip ("4") — caption, accent-soft bg
│   └── [+ add card] button (ghost, sm)
├── Card list (scrollable, gap --space-8)
│   └── TaskCard × N
└── Column footer (placeholder: «+ Add task»)
```

### Column Header

- Высота: **40 px**
- Фон: прозрачный (наследует фон колонки)
- Паддинг: `--space-12` horizontal, `--space-8` vertical
- Column name: `--font-size-headline-sm` (15 px), `--font-weight-semibold`
- Count chip: `--font-size-caption`, `--color-text-subtle`, фон `--color-overlay-active`, padding `2px 6px`, radius `--radius-xs`

### Column Body

- Фон: `--color-surface-column`
- Радиус: `--radius-lg`
- Паддинг: `--space-12` по горизонтали, `--space-12` сверху/снизу
- Gap между карточками: `--space-8`
- Overflow-y: auto (scrollable)
- Минимальная высота: 200 px (показывает дроп-зону при пустой колонке)

### Состояния

| Состояние    | Стиль                                                         |
|--------------|---------------------------------------------------------------|
| Default      | `--color-surface-column` фон                                 |
| DragOver     | `--color-accent-soft` фон, `2px dashed var(--color-accent-bg)` граница |
| Empty        | Placeholder-текст «Drop here» в центре, `--color-text-subtle` |

---

## 6. Task Card

### Структура

```
TaskCard (full-width внутри колонки)
├── [Top row] slug-chip    [ID chip: ctq-42]
├── [Title] — основной текст
├── [Description excerpt] — опционально, 2 строки max
└── [Bottom row] [avatar] [tags/chips]
```

### Размеры и отступы

- Фон: `--color-surface-raised`
- Радиус: `--radius-md`
- Паддинг: `--space-12` (все стороны)
- Тень: `--shadow-low` default, `--shadow-med` при hover
- Border: `1px solid var(--color-border-card)`
- Gap между строками: `--space-6`

### Элементы

- **Slug chip**: см. компонент 9 «Slug chip»
- **ID**: `--font-mono`, `--font-size-caption`, `--color-text-subtle`; формат `ctq-42`
- **Title**: `--font-size-body-lg` (14 px), `--font-weight-medium`, `--color-text-default`; max 2 строки (line-clamp: 2)
- **Description excerpt**: `--font-size-body` (13 px), `--color-text-muted`; max 2 строки (line-clamp: 2); опционально, рендерится если длина > 0
- **Bottom row**: flex, space-between, align-center; gap `--space-8`

### Состояния

| Состояние  | Стиль                                           |
|------------|-------------------------------------------------|
| Default    | `--shadow-low`, border `--color-border-card`   |
| Hover      | `--shadow-med`, cursor grab                    |
| Dragging   | `opacity: 0.7`, `--shadow-high`, cursor grabbing |
| Focus      | outline `2px solid var(--color-border-focus)`, offset 2px |

### Поведение

- Клик по карточке → открывает Modal «Edit task»
- Drag-and-drop через `@dnd-kit/core` (уже подключён в виджете kanban-board)
- Поперечное перемещение между колонками меняет `status` через IPC

---

## 7. Modal — Edit Task

### Структура (v1 реальные поля)

```
Modal (max-width: 560px, max-height: 80vh)
├── Header
│   ├── [Slug chip: ctq-42]
│   └── [×] close button
├── Body (scroll если контент > max-height)
│   ├── Title input (полная ширина)
│   ├── Description textarea (markdown, 5 строк min)
│   ├── [Row] Board dropdown | Status/Column dropdown
│   ├── Role dropdown (Agent role)
│   ├── Attached prompts (multi-select chips)
│   └── Slug (read-only, mono font)
└── Footer
    ├── [Cancel] button (secondary)
    └── [Save changes] button (primary)
```

### Размеры и поведение

- Max-width: **560 px**
- Max-height: **80 vh** (body scrolls, header и footer фиксированы)
- Фон: `--color-surface-overlay`
- Радиус: `--radius-xl`
- Тень: `--shadow-high`
- Скрим: `--color-overlay-scrim`
- Анимация появления: fade-in + scale `0.96 → 1.0`, `--duration-normal`, `--easing-default`
- Закрытие: Escape, клик на скрим, кнопка ×

### Header

- Паддинг: `--space-24` horizontal, `--space-16` top
- Flex row, space-between, align-center
- Slug chip слева (см. компонент 9)
- Кнопка «×» справа: 28 × 28 px ghost, иконка из пиксельного арт-сета

### Body — v1 поля

| Поле               | Компонент               | Описание                                        |
|--------------------|-------------------------|-------------------------------------------------|
| **Title**          | Input (text)            | Обязательное, label «Title», placeholder «Task title» |
| **Description**    | Textarea (markdown)     | Необязательное, label «Description», 5 строк, resize vertical |
| **Board**          | Dropdown (select)       | Список досок пространства                       |
| **Status / Column**| Dropdown (select)       | Список колонок выбранной доски                  |
| **Role**           | Dropdown (select)       | Agent role (список ролей из БД)                 |
| **Attached prompts** | Multi-select chips    | Выбор промптов, chips с × для удаления          |
| **Slug**           | Read-only text field    | Авто-генерируется, моноширинный шрифт, не редактируется |

> НЕ в v1: Assignee, Priority, Due date, Estimate, Notes, Labels.

### Footer

- Паддинг: `--space-16` horizontal, `--space-16` bottom
- Border-top: `1px solid var(--color-border-subtle)`
- Flex row, justify-end, gap `--space-8`
- «Cancel»: secondary button, `--radius-md`
- «Save changes»: primary button (золото), `--radius-md`

### Токены

- `--color-surface-overlay`, `--radius-xl`, `--shadow-high`
- `--color-overlay-scrim` (скрим)
- `--duration-normal`, `--easing-default` (анимация)

---

## 8. Form Controls

### 8.1 Input (text)

```
[Label]
[Input field (full-width)]
[Error message — опционально]
```

- Label: `--font-size-body-sm` (12 px), `--font-weight-medium`, `--color-text-muted`; gap до поля `--space-4`
- Поле: высота 36 px, паддинг `--space-8` vertical `--space-12` horizontal
- Фон: `--color-surface-raised`
- Border: `1px solid var(--color-border-default)`
- Радиус: `--radius-md`
- Font: `--font-sans`, `--font-size-body` (13 px), `--color-text-default`
- Placeholder: `--color-text-subtle`
- Focus: border `2px solid var(--color-border-focus)`, shadow `0 0 0 3px var(--color-accent-ring)`
- Invalid: border `1px solid var(--color-status-danger)`, shadow `0 0 0 3px var(--color-status-danger-soft)`
- Error msg: `--font-size-body-sm`, `--color-status-danger`, gap `--space-4` сверху

### 8.2 Textarea

- Аналог Input по токенам
- Min-height: 5 строк (≈ 96 px при line-height 1.45 × 13 px)
- `resize: vertical` разрешён
- Scroll при переполнении

### 8.3 Dropdown (Select)

```
[Label]
[Selected value ▼]
   → Popover list
       [Option item]
       [Option item]
```

- Trigger: аналог Input (36 px), иконка шеврона 16 px справа
- Popover: `--color-surface-overlay`, `--radius-md`, `--shadow-med`
- Item: высота 32 px, паддинг `--space-8` horizontal, `--color-text-default`
- Hover item: `--color-overlay-hover`
- Selected item: `--color-accent-soft` фон, checkmark icon `--color-accent-bg`
- Макс высота popover: 240 px, scroll внутри

### 8.4 Multi-select chips

```
[Chip 1 ×] [Chip 2 ×] [+ Add...]
```

- Chip: inline-flex, align-center, gap `--space-4`
- Паддинг: `--space-2` vertical, `--space-8` horizontal
- Радиус: `--radius-full`
- Фон: `--color-accent-soft`; текст: `--color-accent-bg`; border: `1px solid var(--color-accent-ring)`
- Иконка «×»: 12 × 12 px, `--color-text-muted`, hover: `--color-status-danger`
- Font: `--font-size-body-sm` (12 px), `--font-weight-medium`
- «+ Add…»: ghost chip, пунктирный border `--color-border-default`, `--color-text-subtle`

### 8.5 Buttons

#### Primary (золото)

- Фон: `--color-accent-bg`; текст: `--color-accent-fg`
- Hover: `--color-accent-hover`; Active: `--color-accent-active`
- Радиус: `--radius-md`; паддинг: `--space-8` / `--space-16`
- Font: `--font-weight-semibold`, `--font-size-body`

#### Primary CTA (красный — «+ New task»)

- Фон: `--color-cta-bg`; текст: `--color-cta-fg`
- Hover: `--color-cta-hover`; Active: `--color-cta-active`
- Остальное — аналогично primary

#### Secondary

- Фон: прозрачный; border: `1px solid var(--color-border-strong)`
- Текст: `--color-text-default`; hover: `--color-overlay-hover`

#### Ghost

- Фон: прозрачный; border: none
- Текст: `--color-text-muted`; hover: `--color-overlay-hover`

#### Размеры (все варианты)

| Size | Height | Padding-x | Font-size             |
|------|--------|-----------|-----------------------|
| sm   | 28 px  | 10 px     | `--font-size-body-sm` |
| md   | 36 px  | 14 px     | `--font-size-body`    |
| lg   | 44 px  | 20 px     | `--font-size-body-lg` |

#### Состояния (все варианты)

- Disabled: `opacity: 0.4`, `cursor: not-allowed`
- Loading: spinner 16 px заменяет иконку, текст «Save changes…»
- Focus: `outline 2px solid var(--color-border-focus)`, offset 2px

### 8.6 Checkbox

- Размер: 16 × 16 px
- Радиус: `--radius-xs`
- Default border: `1px solid var(--color-border-strong)`
- Checked: фон `--color-accent-bg`, белая галочка SVG
- Indeterminate: фон `--color-accent-soft`, горизонтальная линия `--color-accent-bg`
- Label: `--font-size-body`, `--color-text-default`; gap от checkbox `--space-8`

---

## 9. Slug Chip

### Структура

```
[icon 12px] [slug text]
```

- Inline-flex, align-center, gap `--space-4`
- Паддинг: `--space-2` vertical, `--space-6` horizontal
- Радиус: `--radius-xs`
- Font: `--font-mono`, `--font-size-caption` (11 px), `--color-text-subtle`
- Фон: `--color-overlay-active`
- Border: `1px solid var(--color-border-subtle)`
- Пример: `ctq-42` (формат: `ctq-{id}`)

### Применения

- В карточке задачи (top row, рядом с ID)
- В модале (header, идентификатор задачи)
- В полях формы (read-only slug)

### Состояния

- Default: как описано выше
- При копировании в буфер: brief `--color-accent-soft` flash `80ms`

---

## 10. Mascot system

> **Voice & speech catalogues live in `docs/lore/lore-bible.md`** (ctq-72). This section owns geometry, tokens, and component contracts; the lore bible owns character profiles, tone calibration, quote pools, scheduling, and settings.

Catique HUB — это **галерея персонажей**, не один маскот. У продукта есть постоянный «host» (Catique) + page-specific персонажи на ключевых разделах. Каждый персонаж — embodied philosophy этого раздела; навигация превращается в discoverable experience.

### 10.1 Принципы

1. **Catique — константа.** Всегда в sidebar (bottom). Он brand anchor, не исчезает при переходе между страницами.
2. **Page mascots живут в main content area**, не в sidebar. Никогда не дублируем Catique и page-mascot в одной зоне.
3. **Единый визуальный стиль.** Все персонажи — pixel art, общая палитра (см. §10.6 Tokens). Должны читаться как одна семья.
4. **У каждого — signature quote** (одна фраза) или малая ротация (2–4 фразы). Никаких длинных монологов.
5. **Mascot — не на каждой странице.** Утверждённый список — §10.3 Roster. Premature mascot = mascot, который не подходит к финальной странице.
6. **Только на pages.** Не размещаем маскотов в dialogs / modals / toasts / tooltips.

### 10.2 Кто host

**Catique** — серый кот в берете, пиксельный арт. Tagline: «Bonjour, développeur. Stay curious. Ship lovely things.»

- Asset: `public/assets/mascot.png` (1024 × 1024, pixel art)
- Размещение: bottom of left sidebar column (см. §2 Sidebar)
- Размер: `width: 100%` сайдбара (220 px), `height: auto`, `image-rendering: pixelated`
- Позиция: `align-self: end` в grid sidebar (`grid-template-rows: auto auto 1fr`), визуально прижат к низу
- Граница сверху: нет (без `border-top` — мягкий переход)
- Интерактивность v1: декоративный, `pointer-events: none`, `user-select: none`
- Future v2: клик → user settings popover (username + handle/email строки появятся как часть user-block, обернувшего mascot)

### 10.3 Roster (утверждённый final list)

Final approved roster — **1 host + 6 page mascots = 7 персонажей**. Дальнейшие добавления — отдельные design+art задачи (см. §10.7 Process).

| Зона | Персонаж | Концепт | Status | Speech (sample) |
|---|---|---|---|---|
| Sidebar (host, all pages) | **Catique** | Серый кот в берете | ✅ ready | "Bonjour, développeur. Stay curious." |
| Page: **Roles** | **Frauge** (HR-frog) | Зелёная жаба в очках, brown bob, кремовый blazer, жемчужное ожерелье. За wooden desk с табличкой "HR". Brass plaque "MARKET DOWN. STAND UP." | ⏳ asset & integration pending Roles-page implementation | "Frauge speaking. Make it brief." |
| Page: **Prompts** | **Librarian-owl** | Сова в круглых очках, кардиган, держит свиток / индекс-карты | 📝 concept (next mascot task) | "Words inherit; meaning compounds." |
| Page: **MCP servers** | **Engineer-raccoon** | Енот в спецовке, гаечный ключ, утилитарный пояс | 📝 concept | "All ports green. Bridge is live." |
| Page: **Skills** | **Cat-sensei** | Старый кот в кимоно, посох, чайник на фоне | 📝 concept | "Practice the small move precisely." |
| Page: **Settings** | **Watchmaker-cat** | Кот с моноклем, шестерёнки, пинцет | 📝 concept | "Tune once. Trust afterwards." |
| Page: **Backups / Database** | **Mole-archivist** | Крот в очках с лампой-каской, картотека | 📝 concept | "Yesterday is shelved. Today is logged." |

> **Ratio rationale.** 6 page mascots — это ровно по одному на каждый ключевой top-level раздел приложения (Boards использует Catique-host без отдельного page-mascot, чтобы не конкурировать с brand anchor). Меньше 5 — невыразительная галерея, больше 7 — cluttered.

> **Voice pairing — Catique ↔ Frauge.** Catique (French, café, warm) и Frauge (German, bureaucratic, deadpan) — два европейских archetype, держат тоновый контраст бренда. Frauge — это HR-frog (см. ctq-74 для рационала имени); её voice **dry, ironic, deadpan, никогда не enthusiastic**. Полный quote rotation для Frauge живёт в lore bible (ctq-72), не дублируется здесь. Sample taglines: «Frauge speaking. Make it brief.» / «I am Frauge. The handbook is in the drawer.» / «Frauge. Personalabteilung. State your business.»

### 10.4 Sub-components

#### 10.4.a Sidebar host slot

Постоянный, всегда виден на >= 900 px ширины окна. На compact mode сайдбара (см. `layout.md` §narrow) — скрывается (`overflow: hidden`).

- Container: `<div data-testid="main-sidebar-mascot">`
- Asset: `<img src="/assets/mascot.png" alt="Catique mascot" />`
- CSS: `width: 100%; height: auto; display: block; pointer-events: none; user-select: none; image-rendering: pixelated; align-self: end;`

#### 10.4.b Page mascot slot

Conditional, появляется только если страница в Roster и asset доступен. Слот — часть layout-каркаса page-template, не отдельный widget.

- Container: `<aside data-testid="page-mascot" data-mascot="<id>">`
- Asset: pixel-art SVG/PNG, `aria-hidden="true"` (декоративный)
- Размер и позиция — зависят от **state**:

##### Sizing breakpoints

| State | Размер | Позиция |
|---|---|---|
| **Empty state** (page без данных, e.g. zero roles) | 240 × 240 px (квадрат) | по центру горизонтально, ~48% от верха content area |
| **Hero state** (заголовок + первая загрузка) | 160 × 160 px | top-right content area, `--space-24` от краёв |
| **Corner mode** (page с данными) | 96 × 96 px | bottom-right content area, `--space-24` от обоих краёв, `position: sticky; bottom: --space-24` |
| **Hidden** (page-template без mascot, не в Roster) | — | not rendered |

При ширине окна < 1100 px page mascot переходит в **corner mode** независимо от state, чтобы не отъедать у контента. При ширине < 900 px — `display: none` (мобиль-нерелевантно, но safety).

##### Position rules

- Page mascot **никогда** не перекрывает интерактивные элементы. Z-index: `--z-mascot` (новый токен, ниже modal/popover/toast, выше content).
- Empty-state mascot центрируется относительно content area (не viewport — sidebar его не сдвигает).
- Corner-mode mascot — `position: sticky` относительно ближайшего scroll-контейнера content area.

#### 10.4.c Speech bubble (опционально)

Speech bubble — отдельный sub-component, показывается только в `empty state` и `hero state`. В `corner mode` появляется только on `:hover` mascot-контейнера (с задержкой 300ms, `prefers-reduced-motion: reduce` → instant).

- Tail: треугольник 8 × 8 px, направлен в сторону mascot
- Background: `--color-surface-card`
- Border: `1px solid var(--color-border-default)`
- Radius: `--radius-md`
- Padding: `--space-12` horizontal, `--space-8` vertical
- Font: `--font-display`, `--font-size-body-sm` (14 px), `--font-weight-medium`, `--color-text-default`
- Max-width: 280 px (text wraps)
- Shadow: `--shadow-low`

### 10.5 Animation guidelines

Анимации **subtle**, не отвлекают.

| Trigger | Эффект | Длительность | Easing |
|---|---|---|---|
| Idle (passive) | 2-frame blink sprite, раз в 4–7 s | 100 ms (transition between frames) | linear |
| Hover на mascot (corner mode) | `translateY: -2px` + bubble fade-in | 200 ms | `--easing-default` |
| Page enter (mount mascot) | Fade-in + `translateY: 4px → 0` | 300 ms | `--easing-out` |
| Mascot exit (page navigate) | Fade-out (без translate) | 100 ms | linear |

**Обязательно** проверять `prefers-reduced-motion: reduce` — все анимации заменяются на instant (`opacity` без transform), idle blink выключается полностью (статический кадр).

### 10.6 Tokens (новые)

Добавить в `design-tokens/tokens.json` (затем `pnpm tokens:build`):

```json
{
  "color": {
    "surface": {
      "mascot-bubble-bg": "{color.surface.card}"
    },
    "text": {
      "mascot-quote": "{color.text.default}"
    }
  },
  "z": {
    "mascot": 5
  }
}
```

CSS variables (генерятся):
- `--color-surface-mascot-bubble-bg`
- `--color-text-mascot-quote`
- `--z-mascot`

### 10.7 Process — добавление нового персонажа

Каждый новый mascot — **отдельная задача в Promptery**. Один character per task. Не batching.

**Definition of done** для одной mascot-task:

1. Asset: pixel-art PNG в `public/assets/mascots/<id>.png` (минимум 256 × 256, transparent bg, `image-rendering: pixelated`-ready).
2. Опционально: SVG-версия в `assets/mascots/<id>.svg` (если возможен векторный source).
3. Signature quote (одна фраза) или ротация 2–4 фраз — в `src/shared/mascots/quotes.ts`.
4. Регистрация в `src/shared/mascots/registry.ts`: `{ id, name, asset, quote, page }`.
5. Запись в этой таблице (§10.3 Roster) — статус `📝 concept` → `✅ ready`.
6. Дизайн-ревью (визуальная гармония с существующими персонажами семьи).

**Запрещено**:
- Делать сразу несколько mascot-ов в одной задаче (batch).
- Использовать AI-сгенерированные mascot-ы без manual cleanup в pixel-art стиле.
- Ставить mascot-а на page, которая ещё не стабилизирована в продукте (риск: персонаж не подойдёт к финальной форме страницы).

### 10.8 Anti-patterns

- ❌ Mascot в dialog / modal / toast / tooltip.
- ❌ Mascot, перекрывающий interactive controls.
- ❌ Анимации длиннее 300 ms или с большой амплитудой.
- ❌ Mascot без quote (для page-mascot quote обязателен; host Catique — quote в tagline сайдбара, не на самом маскоте).
- ❌ Изменение размера host-mascot пользователем (статичен).
- ❌ Несколько page-mascot-ов на одной странице (один page = один mascot).

---

## 11. Avatar

### Структура

- Форма: круг (`--radius-full`)
- Размеры: 20 px (card compact), 28 px (topbar), 32 px (mascot block)
- Фон при отсутствии фото: `--color-accent-soft`, инициалы 1-2 символа, `--color-accent-bg` текст
- С фото: `object-fit: cover`, `border: 1px solid var(--color-border-default)`
- ARIA: `role="img"`, `aria-label="[Имя пользователя]"`

### Состояния

- Default: изображение или инициалы
- Loading: skeleton circle `--color-overlay-active` с pulse-анимацией

---

## 12. Иконки

### Набор (image3.png — пиксельный арт)

Три ряда тематических иконок (брендовые / декоративные):

**Ряд 1 (брендовые)**: кот, эспрессо, круассан, берет, Эйфелева башня, багет, скрепка(?), узор

**Ряд 2–6 (функциональные)**: дом, конверт, задачи/чеклист, документы, папка, тег/лейбл, флаг, звезда, сердечко, закладка; поиск, фильтр, настройки-сетка, окно, код, баг, колба, граф-ноды, дамббель; плюс, карандаш, корзина, глаз, пузырь-чата, уведомление, шестерня, профиль, группа; галочка, крест, предупреждение, инфо, часы, календарь, молния, ракета, глобус, монитор; БД, облако-загрузка, облако-выгрузка, граф-шкала, замок, ключ, щит, ссылка, загрузка вниз; браузер, плитки, диаграмма-пирог, график-баров, почта, что-то(?), буй/спасательный круг

### Сетка и размеры

| Вариант  | px    | Применение                            |
|----------|-------|---------------------------------------|
| xs       | 12 px | Иконки внутри chip, ×-кнопки         |
| sm       | 16 px | Строки сайдбара, inline кнопки       |
| md       | 20 px | Иконочные кнопки в top bar           |
| lg       | 24 px | Пустые состояния, иллюстрации        |

### Технические требования

- SVG, `currentColor` заливка — наследует цвет родителя
- `viewBox="0 0 16 16"` (или `24 24` для lg)
- `aria-hidden="true"` когда иконка декоративная
- При иконке-кнопке: обёртка с `aria-label` и `role="button"`

### Пиксельный арт vs. функциональный набор

Пиксельные иконки (кот, эспрессо и т.д.) используются **только декоративно**:
- Wordmark/логотип
- Mascot-блок
- Пустые состояния (иллюстрации)
- Брендовые заставки

Функциональные иконки (в кнопках, строках сайдбара, карточках) — Lucide или аналогичный SVG-сет с тем же 16 px / 24 px grid.
