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
└── Mascot (кот с эспрессо, bottom)
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

## 10. Mascot

### Описание

Кот с эспрессо в нижней части сайдбара. Пиксельный арт (32 × 32 px или 48 × 48 px).

### Структура

```
[Mascot image 48×48]
[Username text line]
[email / handle text line]
```

- Позиция: `position: sticky; bottom: 0` в сайдбаре
- Фон: `--color-surface-sidebar` (совпадает с фоном сайдбара)
- Граница сверху: `1px solid var(--color-border-subtle)`
- Паддинг: `--space-12` horizontal, `--space-8` vertical
- Username: `--font-size-body-sm` (12 px), `--font-weight-semibold`, `--color-text-default`
- Handle/email: `--font-size-caption` (11 px), `--color-text-subtle`
- Иконка кота: берётся из пиксельного арт-сета (image3.png, позиция [0,0])

### Поведение

- Не интерактивна в v1 (нет меню пользователя)
- В будущем: клик → user settings popover

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
