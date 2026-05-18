# PoC: lazy-loading prompts in agent / skill files

> Эксперимент catique-2. Ветка: `experiments/lazy-prompts` (ещё не нарезана).

## Проблема

Сегодняшний агентский файл (`AGENTS.md` / `CLAUDE.md`) — это «портянка» с встроенными промптами, ролями и скиллами. Это значит:

- Размер файла растёт линейно с количеством ролей и скиллов.
- При каждом изменении промпта файл переписывается целиком.
- Diff в git показывает изменения промптов вперемешку с logiстикой агентского файла, что мешает review.
- Каждый запуск агента грузит весь файл в контекст, даже если конкретной сессии нужна одна роль из десяти.

## Идея

Заменить inline-промпты на **ссылки**, которые resolver разрешает по требованию. Аналогия — ссылки `[[wiki-link]]` или JSON Schema `$ref`.

Пример «до»:

```md
## Owner

You are the maintainer of Catique HUB. Your job is to…
[40 lines]
```

Пример «после»:

```md
## Owner

@prompt:owner-base
```

Где `@prompt:owner-base` — стабильный slug, который при загрузке агента раскрывается через MCP-вызов `get_prompt(name="owner-base")` в Catique HUB.

## Дизайн

### Reference синтаксис

| Форма | Что разрешается | Откуда |
| --- | --- | --- |
| `@prompt:<slug>` | Тело промпта из библиотеки | `catique-hub::get_prompt` |
| `@role:<slug>` | Тело роли + её attached prompts | `catique-hub::get_role` + `list_role_prompts` |
| `@skill:<slug>` | Тело скилла + шаги + attachments | `catique-hub::get_skill` + `list_skill_steps` |
| `@group:<slug>` | Все промпты группы в порядке | `catique-hub::list_prompt_group_members` |

Slug стабилен (kebab-case, UNIQUE в своей таблице). При переименовании сущности в Catique HUB старый slug продолжает резолвиться через alias-таблицу (отложено — потребует миграции).

### Resolver

Resolver работает в двух режимах:

1. **Eager (compile-time)**. На записи в агентский файл (`agent_files::upsert_section`, catique-1) подставляем тела сразу. Тогда file `AGENTS.md` остаётся самодостаточным и не зависит от рантайма Catique HUB. Это сохраняет совместимость с агентами, которые не знают про Catique HUB.

2. **Lazy (run-time)**. Resolver встроен в `catique-hub-mcp` standalone binary; он экспортирует MCP-инструмент `expand_refs(text) → text`. Агент, понимающий формат, вызывает `expand_refs` перед использованием — и подгружает только нужные блоки. Файл `AGENTS.md` остаётся коротким («манифестом»), реальные тела хранятся в Catique HUB SQLite.

Стратегия — **сначала eager**, lazy включаем флагом в настройках пространства.

### Watermark

При записи в `AGENTS.md` маркер блока пополняется hash содержимого ссылок:

```md
<!-- catique-hub:owner:begin (refs-hash: a1b2c3) -->
…
<!-- catique-hub:owner:end -->
```

Если hash расходится с тем, что lazy-resolver получил из БД сейчас, агент знает что файл устарел и предлагает пересинхронизировать (или ставит warning).

### Schema

Никаких новых таблиц — переиспользуем существующие `prompts`, `roles`, `skills`, `prompt_groups`. Альтернативно: добавить `prompts.slug TEXT UNIQUE` (сейчас идёт по `name` UNIQUE; имя — отображаемое, slug — стабильный). Это миграция-кандидат, но не блокер для PoC.

## Метрики, которые надо снять

- Средний размер `AGENTS.md`: до vs после.
- Latency загрузки агентом: до vs после (eager — без изменений; lazy — +один MCP-вызов на блок).
- Diff-shrink: PR-ы, изменяющие промпт, должны больше не задевать `AGENTS.md` (eager — задевают; lazy — нет).

## Известные риски

| Риск | Митигация |
| --- | --- |
| Старые агенты не знают про `@prompt:...` | Eager-mode по умолчанию; lazy — opt-in |
| Конфликт slug между сущностями (`@prompt:owner` vs `@role:owner`) | Namespace в синтаксисе обязателен (`@<kind>:`) |
| Race: пользователь сменил промпт, файл устарел | Hash-watermark + UI-нотификация в Catique HUB |
| Lazy резолв падает (offline / MCP не запущен) | Fallback: показать ссылку как plain text, не падать |

## План

1. Ветка `experiments/lazy-prompts`.
2. В Catique HUB добавить `prompts.slug TEXT UNIQUE` (миграция 031).
3. Реализовать eager-resolver `expand_refs(text, mode=eager) → text` в `catique-application::workflow` или новом `agent_refs` модуле.
4. Использовать его в `agent_files::upsert_section` (catique-1) — рендерить тело роли через resolver.
5. Замерить diff-shrink на одном агентском файле (e.g. user's `~/.claude/agents/frontend-engineer.md`).
6. Решить о lazy-mode после метрик.

## Открытые вопросы

- Slug или UUID? — slug ради читаемости, UUID ради стабильности; гибрид через alias-таблицу.
- Cycle detection: `@role:A` ссылается на `@prompt:B`, тот на `@role:A`. Ограничить глубину 5 + детектить циклы в resolver.
- Synced AGENTS.md в репо: коммитим ли expanded версию? Скорее «да» (для агентов без рантайма), эксперимент это проверит.
