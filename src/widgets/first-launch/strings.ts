/**
 * First-launch widget — string catalogue.
 *
 * E4.1 ships with hard-coded Russian strings; per the PRD Catique HUB
 * targets RU+EN at v1. Centralising them here means the future i18n
 * layer (E5+) has a single replacement target — swap this object for
 * `useTranslation()` calls without touching any TSX. We deliberately
 * do NOT add an i18n library yet — `i18next` / `react-intl` is a
 * separate decision Maria/Katya will weigh in on.
 *
 * Convention: nested object keyed by widget area, then by element.
 * Keys read top-to-bottom in the order strings appear on screen.
 */

export const strings = {
  gate: {
    loadingTitle: "Загрузка Catique HUB…",
    loadingHint: "Готовим рабочее пространство.",
  },
  importWizard: {
    detection: {
      title: "Импорт из Promptery",
      subtitle:
        "Найдена база Promptery. Можно перенести задачи, доски и промты в Catique HUB.",
      pathLabel: "Путь к базе",
      sizeLabel: "Размер",
      lastModifiedLabel: "Изменена",
      tasksCountLabel: "Задач в источнике",
      schemaMatchOk: "Схема совпадает — импорт безопасен",
      schemaMatchDrift:
        "Схема Promptery новее или старее ожидаемой версии. Импорт временно недоступен — обнови приложение или Promptery.",
      continueCta: "Продолжить",
      skipCta: "Пропустить — начать с нуля",
    },
    preview: {
      title: "Предпросмотр импорта",
      analyzing: "Анализирую данные…",
      analyzedTitle: "Что будет импортировано",
      preflightTitle: "Предполётные проверки",
      preflightOk: "Все проверки пройдены",
      preflightFailed: "Часть проверок не пройдена",
      attachmentsLabel: "Вложений",
      attachmentsTotalLabel: "Размер вложений",
      runImportCta: "Запустить импорт",
      backCta: "Назад",
      failureTitle: "Не получилось проанализировать базу",
    },
    running: {
      title: "Идёт импорт",
      hint: "Перенос данных. Не закрывай окно — операция атомарна.",
      hintReducedMotion: "Импорт выполняется…",
      noCancelHint: "Отменить нельзя — финальная фиксация делается атомарным переименованием файла.",
      progressFallback: "Импорт выполняется…",
      progressPhasePrefix: "Фаза:",
    },
    completed: {
      titlePrefix: "Импорт завершён за",
      titleSuffix: "мс",
      summaryHeader: "Перенесено",
      backupLabel: "Резервная копия предыдущей базы",
      openKanbanCta: "Открыть канбан",
    },
    failed: {
      title: "Импорт не удался",
      kindLabel: "Тип ошибки",
      messageLabel: "Сообщение",
      preflightHeader: "Предполётные проверки",
      retryCta: "Повторить",
      skipCta: "Пропустить — начать с нуля",
    },
  },
  welcome: {
    title: "Welcome to Catique HUB",
    subtitle:
      "Управляй командой AI-агентов через kanban + промт-инхеританс.",
    createSpaceCta: "Create your first space",
    locatePrompteryCta: "Locate Promptery DB",
    createSpaceDialogTitle: "Новое пространство",
    createSpaceDialogDescription:
      "Пространство — корневой контейнер. Имя и трёхбуквенный префикс используются в идентификаторах задач.",
    createSpaceNameLabel: "Имя пространства",
    createSpaceNameHint: "Например: «Команда A» или «Личное».",
    createSpacePrefixLabel: "Префикс (3 буквы)",
    createSpacePrefixHint:
      "Используется как префикс для slug задач, например prefix-001.",
    createSpaceSubmit: "Создать",
    createSpaceCancel: "Отмена",
    locateLabel: "Путь к Promptery DB",
    locateHint:
      "Подскажи абсолютный путь к файлу базы (обычно ~/.promptery/db.sqlite). Графический пикер появится позже.",
    locateSubmit: "Открыть мастер импорта",
    locateCancel: "Отмена",
  },
} as const;
