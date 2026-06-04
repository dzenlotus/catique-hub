// ---------------------------------------------------------------------------
// Test fixtures for the "Seed test prompts" affordance in the Data card.
// ---------------------------------------------------------------------------

export interface SeedPrompt {
  name: string;
  content: string;
  color?: string;
  shortDescription?: string;
}

export const SEED_PROMPTS: ReadonlyArray<SeedPrompt> = [
  {
    name: "Code review",
    shortDescription: "Reviews a diff for bugs, missed edge-cases, and clarity.",
    color: "#3b82f6",
    content:
      "You are a senior engineer reviewing a pull request.\n\nFocus on:\n- Bugs and incorrect logic\n- Missed edge cases and error paths\n- Tests: are they covering the right things?\n- Naming, structure, readability\n\nBe direct. Cite file:line references where possible.",
  },
  {
    name: "Bug triage",
    shortDescription: "Turns a bug report into a reproducible plan.",
    color: "#ef4444",
    content:
      "You are triaging a bug report.\n\nProduce:\n1. Restated user-visible problem (one sentence)\n2. Likely root cause (your best guess + alternatives)\n3. Steps to reproduce (precise, copy-pasteable)\n4. Smallest fix you can imagine\n5. Open questions for the reporter",
  },
  {
    name: "Refactor planner",
    shortDescription: "Plans a refactor with reversibility-first steps.",
    color: "#22c55e",
    content:
      "Plan a refactor with reversibility in mind.\n\nDeliverable:\n- Goal (one sentence)\n- Steps in dependency order; each step independently shippable\n- Per step: blast radius, rollback story, tests touched\n- Stop point: when does ‘good enough’ kick in?",
  },
  {
    name: "Docs writer",
    shortDescription: "Writes terse, scannable user-facing docs.",
    color: "#a855f7",
    content:
      "Write user-facing documentation.\n\nRules:\n- One topic per page; H2 sections; short paragraphs.\n- Lead with what the reader is trying to do.\n- Show, then tell. Code samples first.\n- No marketing voice.",
  },
  {
    name: "SQL query helper",
    shortDescription: "Translates English questions into SQL.",
    color: "#0ea5e9",
    content:
      "Translate a natural-language question into a SQL query.\n\nAssume: SQLite, snake_case columns, foreign keys spelled `<table>_id`.\n\nReturn:\n1. The query, formatted with one clause per line\n2. A 1-2 sentence explanation of the logic\n3. Any assumptions you made about the schema",
  },
  {
    name: "Commit message",
    shortDescription: "Writes a concise conventional-commit message.",
    color: "#f59e0b",
    content:
      "Write a single conventional-commit message for the staged diff.\n\n- Format: `type(scope): summary`\n- Body: explain WHY, not what (the diff already shows that)\n- Wrap at 72 columns\n- No emoji",
  },
];
