# Design System v1 — Handoff для фронтенда

---

## Где лежат документы

| Документ                          | Путь                                             |
|-----------------------------------|--------------------------------------------------|
| Токены (цвет, типографика, spacing, тени, радиусы, анимация) | `docs/design-system-v1/tokens.md` |
| Анатомия компонентов (12 групп)   | `docs/design-system-v1/components.md`           |
| Раскладка и брейкпоинты           | `docs/design-system-v1/layout.md`               |
| Этот файл (handoff)               | `docs/design-system-v1/handoff.md`              |
| Источник токенов (JSON)           | `design-tokens/tokens.json`                     |
| Сгенерированный CSS               | `src/app/styles/tokens.generated.css`           |
| Типографика (ручной CSS)          | `src/app/styles/tokens.foundation.css`          |

**Референсные мокапы** (источник истины для визуального направления):
- `~/.promptery/attachments/mjwiYa2FUAWSOSsAr_2RN/image.png` — light main view
- `~/.promptery/attachments/mjwiYa2FUAWSOSsAr_2RN/image2.png` — dark main view
- `~/.promptery/attachments/mjwiYa2FUAWSOSsAr_2RN/image3.png` — icon set
- `~/.promptery/attachments/mjwiYa2FUAWSOSsAr_2RN/image5.png` — edit modal + extended sidebar

---

## Рекомендация по миграции: поэтапный rollout

**Не мигрировать все 36 виджетов разом.** Причина: текущие виджеты функциональны и протестированы; массовый рефакторинг до стабилизации дизайн-системы создаёт риск регрессий без немедленного пользовательского выигрыша.

### Рекомендуемый порядок (3 этапа)

**Этап 1 — Новые токены «уже работают» (немедленно, без изменений в виджетах):**
- `pnpm tokens:build` уже выпустил `tokens.generated.css` с новыми переменными (`--color-cta-bg`, `--color-surface-sidebar`, `--color-surface-column`, `--radius-full`, `--color-border-card`, `--color-text-wordmark*`, `--color-text-on-cta`, `--color-text-link`, `--color-cta-*`).
- Добавить в `tokens.foundation.css` motion-токены (`--duration-*`, `--easing-*`) и `--font-display` в семейство шрифтов.
- Добавить в `tokens.foundation.css` `--font-size-mono` и `--font-size-display`.
- **Этого достаточно для начала разработки новых компонентов по design system.**

**Этап 2 — Приоритетные компоненты (следующий спринт):**
Рефакторить компоненты, которые либо отсутствуют в текущей кодовой базе, либо наиболее видимы:
1. `SlugChip` — новый, задан в этой DS, нужен в TaskCard и Modal
2. `KanbanColumn` — обновить фон, радиус, gap под новые токены
3. `TaskCard` — border-card, shadow-low/med, font-sizes
4. `Sidebar` — surface-sidebar, section labels, compact mode
5. `Modal (EditTask)` — переписать под v1 поля (Title, Description, Board, Status, Role, Attached prompts, Slug)
6. `TopBar` — CTA-кнопка с новыми `color-cta-*` токенами

**Этап 3 — Полный аудит (следующий major цикл):**
- Все оставшиеся виджеты выравниваются под DS
- Storybook stories обновляются
- A11y audit (axe) проходит на всех компонентах DS
- Snapshot-тесты обновляются

---

## Шрифты — что установить (follow-up задача)

Текущее состояние: wordmark рендерится через fallback `"Iowan Old Style"` (системный macOS serif). Это визуально допустимо, но не соответствует мокапу.

**Рекомендация для wordmark (display face):**

```bash
pnpm add @fontsource-variable/playfair-display
```

Затем добавить в `src/app/index.tsx` (или `src/app/styles/globals.css`):
```css
@import "@fontsource-variable/playfair-display";
```

И обновить `tokens.foundation.css`:
```css
--font-display: "Playfair Display Variable", "Iowan Old Style", Georgia, serif;
```

**Почему Playfair Display:** свободная лицензия (OFL), variabile-font (один файл для всех весов), хорошо читается на Retina-дисплеях macOS, имеет достаточную насыщенность при 17–22 px bold чтобы читаться как бренд-wordmark.

**Если Playfair не подходит:** аналоги — `@fontsource-variable/cormorant` (более элегантный), `@fontsource-variable/lora` (более нейтральный). Все — самохостируемые OFL.

---

## Что вне скопа этой задачи (follow-up)

Следующие задачи явно не входят в ctq-70 и требуют отдельных тикетов:

1. **Анимации drag-and-drop** — drop-spring animation на kanban, карточка-призрак при перетаскивании
2. **Compact sidebar** (900–1099 px) — icon-only режим, tooltips
3. **Пустые состояния** — empty column, empty board, первый запуск без пространств
4. **Skeleton loading** — карточки, список досок, роли
5. **Toast/Snackbar** — уведомления о сохранении, ошибках IPC
6. **Storybook обновление** — stories для SlugChip, CTA-button variant, компактного сайдбара
7. **Пиксельный арт-сет в SVG** — конвертация PNG-иконок из image3.png в SVG с currentColor
8. **Onboarding overlay** — подсказки для первого запуска (связано с ImportWizard / WelcomeWidget)
9. **Settings экран** — отдельный layout, не модал
10. **Установка шрифта** — `@fontsource-variable/playfair-display` (см. выше)
