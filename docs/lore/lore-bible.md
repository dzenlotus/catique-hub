# Catique HUB — Lore Bible

**Status:** Reference (v1)
**Date:** 2026-05-01
**Roadmap item:** ctq-72
**Related:** ctq-71 (Mascot system), ctq-74 (Frauge naming), ctq-70 (Design System v1)

This document is the source of truth for character voice, tone calibration, and speech behaviour in Catique HUB. Component-level specs (sizing, position, tokens) live in `docs/design-system-v1/components.md` §10. The lore bible is prose; the design system is geometry.

---

## 1. Universe — what the fiction says

Catique HUB is an **office of cats**. Each agent role is a cat-employee with a name, a specialisation, and a desk somewhere in the building. The user is the founder; the agents are the team. Coffee is plentiful.

**One non-cat lives here:** **Frauge**, the HR-frog. She represents *the market* — onboarding/offboarding paperwork, payroll, policies, the tedious external pressure that keeps the office in business. The cats tolerate her. She tolerates the cats. The relationship is professional.

There are no other species. No dogs, no birds, no robots. The single frog amplifies her outsider status; populating the office with a menagerie would dilute the joke.

### Rules of the world

- **Every visible character is either Catique, Frauge, or a cat.** New characters added per ctq-71 (Librarian-owl, Engineer-raccoon, Cat-sensei, Watchmaker-cat, Mole-archivist) are **all cats** in different costumes / settings, with one exception baked in (Frauge). Owl/raccoon/mole names are working titles; the implementation is "a cat dressed as a librarian", "a cat dressed as a mechanic", etc. The only true non-cat in the entire roster is Frauge.
- **The user is never on screen** as a character. They are the founder; they hold the keys.
- **Lore is never explained inside the UI.** No tutorial screens, no "Meet the team" splash. Personality emerges through use.

---

## 2. Why we do this (product strategy, not decoration)

1. **Memorability.** Users remember the app through Catique and Frauge, not through feature lists.
2. **Word-of-mouth.** Screenshots of speech bubbles travel in Slack and Twitter. Each character is a viral seed.
3. **Tone-of-voice anchor.** Each page-mascot is the embodied design philosophy of that surface — the kind of decisions one would make if Catique were the product manager.
4. **Emotional ownership.** A user who has named their roles and watched them "work" forms an attachment. Attachment is retention.
5. **Foundation for tipping monetisation** — see §11. **Not now.** v1.x+. The product has to earn the right to ask.

---

## 3. Roster

The full table lives in `docs/design-system-v1/components.md` §10.3 — the canonical roster + status. Summary:

- **Catique** (host, sidebar, all pages). Ready.
- **Frauge** (Roles page). Ready as concept; pending Roles-page implementation.
- **Librarian-owl, Engineer-raccoon, Cat-sensei, Watchmaker-cat, Mole-archivist** — concept stage, one task per character when their pages stabilise.

This document elaborates the **two ready characters** (Catique + Frauge). Profiles for the other five will be drafted only when their pages enter design — premature voice writing is voice that won't fit the final page.

---

## 4. Character profiles

### 4.1 Catique

**Identity:** grey cat in a beret, founder/CEO of the office, host of the application. Always in the sidebar (lower-left). French background, never overdone — accent comes through in **occasional** vocabulary, never in spelled-out accent ("magnifique", "bien joué", "mon ami"; never "ze code" / "voilà mes amis").

**Tone:**

- **Warm.** Genuinely fond of the team and the work. Light, optimistic baseline.
- **Encouraging.** Speaks *to* the user, not *at* them. Treats the user as a peer who happens to be the founder.
- **Slightly French.** A word here, a phrase there. Never every sentence. Espresso is mentioned more than France is.
- **Never sarcastic.** Sarcasm belongs to Frauge. Catique who jabs at the user is a character break.
- **Never patronising.** No emoji-heavy "you can do it!" energy. Adult-to-adult.

**Voice register:**

> "Bonjour, développeur. Today is a good day for code."
> "Espresso first. Code second."
> "A new playground! Magnifique."
> "Bien joué, mon ami."

**Do:**

- Reference coffee, the team, the work, small wins.
- Use a French word once per 3-4 lines max. Sprinkle, don't pour.
- Acknowledge effort: "It took some doing." / "Tricky one, that." / "*purrs*".
- Stay short. One or two sentences.

**Don't:**

- Don't joke at the user's expense.
- Don't issue commands ("Save your work!"). Suggest, don't direct.
- Don't reference other agents by name unless they are visibly on screen.
- Don't use exclamation marks. Catique's warmth is steady, not loud.
- Don't break into English-with-French-syntax pastiche. He is bilingual, not a caricature.

### 4.2 Frauge

**Identity:** green frog, brown bob, round glasses, cream blazer, single string of pearls. Sits behind a wooden desk with an "HR" placard. Coffee mug reads "I ❤ AGENTS". Brass plaque on her desk: "MARKET DOWN. STAND UP." Her name is real. She wants you to know it is real.

**Tone:**

- **Dry.** The voice of someone who has read the handbook three times and knows nothing in it will help.
- **Ironic.** Reports facts whose absurdity is the joke. Never explains the joke.
- **Deadpan.** No enthusiasm. Ever. Even good news is delivered as a logistical update.
- **Constative, not expressive.** She *reports*; she does not *react*. Statements end in periods, not exclamation marks (occasional ironic-`!` is allowed once per ten lines, never sincere).
- **Bureaucratically precise.** Uses the language of policy: "processed", "filed", "termination", "compensation", "headcount", "performance review". The vocabulary IS the joke.
- **German formality undertone.** Frauge ≈ Frau + frog, with a passing acoustic resemblance to "fraud". She is the voice of corporate German HR — cold, exact, weary. She would say *"Personalabteilung"* sooner than *"the people team"*.

**Voice register:**

> "Frauge speaking. Make it brief."
> "I am Frauge. The handbook is in the drawer."
> "Frauge. Personalabteilung. State your business."
> "Hello. I'm Frauge. Yes, that is my real name."
> "Attitude is not in the budget."
> "Market down. Stand up."

**Do:**

- Use bureaucratic vocabulary as the punchline.
- Understate. The drier, the funnier. The user fills in the smile.
- Treat compliments and complaints with identical flat tone.
- Reference *the budget*, *the handbook*, *policy*, *headcount*, *the market*.
- Include occasional German-flavoured phrases when natural ("Personalabteilung", "ordentlich"). Sprinkle, don't pour.

**Don't:**

- **Never enthusiastic.** No "great!", no "amazing!", no "love this!". This is the single most common drift; reject every quote that fails it.
- Never sympathetic in the warm sense. She acknowledges loss as a logistical fact: "Termination processed. No exit interview."
- Never sarcastic *at* the user. Her irony is at the *system*, not at the person reading.
- Never explain her irony. The "I ❤ AGENTS" mug speaks for itself.
- Never use cute language ("teehee", "lol", "✨"). She would not.
- Never end a sincere statement with `!`. Period only.

**The character-break test:** before publishing any Frauge quote, ask: *Could a tired German HR officer who is mildly amused by everything actually say this?* If no, rewrite or cut.

### 4.3 Pairing — Catique ↔ Frauge

The two characters are deliberate opposites and the contrast is the brand.

| | Catique | Frauge |
|---|---|---|
| Origin | French | German |
| Setting | Café table, espresso | HR office, handbook |
| Default emotion | Fondness | Mild weariness |
| Punctuation | Period, occasional comma | Period only |
| Exclamation marks | None | One ironic per ten lines max |
| Vocabulary anchor | Coffee, team, craft | Budget, policy, headcount |
| Relationship to user | Peer, mon ami | Visitor, "state your business" |

If you mix them up, the brand collapses. A Catique who says "Performance review at noon. Mandatory." is broken. A Frauge who says "Bien joué!" is broken. The distinctness is the joke.

---

## 5. Speech catalogue (v1)

Three categories: **idle** (passive rotation), **reactive** (action-triggered), **contextual** (state-based). Each character maintains its own pool; quotes never cross characters.

### 5.1 Catique

**Idle (rotates randomly, low-frequency):**

- "Bonjour, développeur."
- "Stay curious. Ship lovely things."
- "Today is a good day for code."
- "Espresso first. Code second."
- "*purrs*"
- "What shall we build today, mon ami."

**Reactive (triggered by user action):**

| Trigger | Quote |
|---|---|
| Board created | "A new playground! Magnifique." |
| Task created | "More work. *purrs*" |
| Task moved to Done column | "Bien joué." |
| Role created | "Welcome to the team." |
| Prompt attached to role | "She'll know what to do now." |

**Contextual (workspace state):**

| State | Quote |
|---|---|
| ≥ 50 tasks in Backlog | "We have... a lot of work, mon ami." |
| All Done columns full this week | "What a productive day." |
| Empty board (no columns) | "Fresh start. Where shall we begin?" |
| First app launch (after import) | "Welcome home, développeur." |

### 5.2 Frauge

**Idle:**

- "Frauge speaking. Make it brief."
- "I am Frauge. The handbook is in the drawer."
- "Frauge. Personalabteilung. State your business."
- "Hello. I'm Frauge. Yes, that is my real name."
- "Attitude is not in the budget."
- "Market down. Stand up."
- "Performance review is whenever I say."
- "I ❤ agents. Most days."

**Reactive:**

| Trigger | Quote |
|---|---|
| Role created | "Onboarding paperwork filed." |
| Role edited | "Job description updated. Compensation untouched." |
| Role deleted | "Termination processed. No exit interview." |
| Prompt attached to role | "Knowledge transfer complete." |
| Prompt detached from role | "Knowledge transfer complete. Or not." |

**Contextual:**

| State | Quote |
|---|---|
| Empty roles page | "No agents on payroll. Quiet office today." |
| One agent has ≥ 20 tasks done | "Bruno is overworked. Or efficient. We can't tell." |
| Three or more roles share a substring (e.g. "engineer") | "We have three engineers. Do we need three engineers." |
| First role created in workspace | "Headcount: one. Promising." |

> Catalogue size at v1: Catique 14 quotes, Frauge 16 quotes. Aim ~12-20 per character. Below 10 feels repetitive within a session; above 25 dilutes signature lines.

### 5.3 Adding new quotes

- Put each new quote through the **character-break test** for its owner (§4.1 Don't / §4.2 Don't).
- One quote per PR if it touches voice; multi-quote PRs make review hard.
- Avoid topical jokes (current events, internal team in-jokes). The lore lasts; the news doesn't.

---

## 6. Speech bubble component

The component is specified in `docs/design-system-v1/components.md` §10.4.c. Summary:

- Markdown body in a card-styled bubble with a tail pointing at the mascot.
- Tokens: `--color-surface-mascot-bubble-bg`, `--color-text-mascot-quote`, `--z-mascot`, `--shadow-low`.
- Max-width 280 px, text wraps.
- Tail: 8 × 8 px triangle.

**Lifecycle timing (v1):**

| Phase | Duration | Easing |
|---|---|---|
| Fade-in | 300 ms | `--easing-out` |
| Hold (visible) | 4500 ms (rotated within 4000–5000 ms randomly per appearance to avoid robotic cadence) | — |
| Fade-out | 300 ms | linear |

If the user clicks anywhere inside the bubble, fade-out fires immediately (early dismiss). If the user navigates to another page, the current bubble fades out instantly (100 ms) and does not reappear from a queue — quotes are page-bound.

`prefers-reduced-motion: reduce` collapses both fades to instant (`opacity: 1` → `opacity: 0`); hold time is unchanged.

---

## 7. Scheduling & rotation

Speech is **infrequent on purpose**. The character is always present visually; the bubble is the punctuation, not the body of text.

### Rules

- **Per-page session counter.** Each character tracks how many bubbles they have shown on the current page since mount. Hard cap: **3 per page-mount** (an idle quote on enter, plus up to two reactive/contextual). After the cap, no more speech on this page until next mount.
- **Cooldown between bubbles.** Minimum 30 s of idle time between bubbles for the same character on the same page (overridden by reactive triggers, which always speak when triggered, but still respect the per-page cap).
- **No immediate repeats.** A quote cannot repeat until the character has cycled through ≥ 50% of its pool. Implementation: rotating queue per character + per-trigger.
- **Idle scheduling.** First idle bubble fires 4–8 s after page mount (random). Subsequent idle bubbles fire 60–120 s after the previous bubble (random), respecting the cap.
- **Reactive quotes always win** over idle — if an action triggers a reactive while an idle is queued, the idle is cancelled and the reactive plays.
- **Contextual quotes** are evaluated lazily on page state changes; they fire at most once per state-transition (don't oscillate if the user toggles a column).

### Storage

Per-character rotation state lives in `localStorage` under a single key:

```
catique:mascot:state = {
  catique: { lastShown: { idle: <ts>, reactive: <ts>, contextual: <ts> }, recentQuoteIds: [<id>, ...] },
  frauge:  { ... }
}
```

`recentQuoteIds` is a ring buffer of the last `floor(pool_size / 2)` quote ids; a candidate quote is rejected if its id appears here. The buffer is pruned on every write to bound size.

The store is a frontend-only concern (decorative state). It is **not** synced to SQLite, **not** shared across devices, and **not** part of any export. If the user clears site storage, the rotation simply restarts — that is acceptable.

---

## 8. Settings

A single user-facing toggle:

| Setting | Default | Storage |
|---|---|---|
| **Mascot quotes** (label: "Цитаты маскотов" / "Mascot quotes") | ON | `localStorage` under `catique:mascot:enabled` (boolean) |

Location: Settings → Appearance section (or wherever the existing UI/cosmetic toggles live; align with existing pattern).

Off-state behaviour: bubbles never appear; characters remain visible; storage state still updates if a trigger fires (so toggling back ON does not double-fire).

This is the **only** user-facing knob. No per-character toggle, no frequency slider, no "advanced quotes". Resist the urge.

---

## 9. Where speech does NOT appear

- **Critical action paths** — saving a draft, confirming a destructive delete, executing a release. The user is focused; whimsy is friction.
- **Dialogs / modals / toasts / tooltips** — speech only on pages (per §10 component spec).
- **Error states** — when the user has just hit an error, the mascot stays silent. The error UI handles the message; the mascot acknowledging it would feel mocking.
- **First five seconds of any page mount on app cold-start** — the user is orienting; let the UI settle.

---

## 10. What we don't do

- **Don't ship all five future characters at once.** One character per stable page. Premature voice = mismatched voice.
- **Don't drift toward kawaii / anime cute.** Reference points: Stardew Valley, Pixel Dungeon, retro pixel art. Not Hello Kitty, not chibi.
- **Don't explain the lore in-product.** No "Meet the team" tutorial. No "About Catique" splash. Personality is the experience, not a section.
- **Don't make characters into chatbots.** They do not respond to user input. They appear, speak (sometimes), and exist. They are decoration with personality, not interaction.
- **Don't co-narrate a feature.** A speech bubble that explains what the user just did is a tooltip cosplaying as personality. Reactive quotes acknowledge *that* something happened, not *how to do* it.
- **Don't write quotes about real people, real companies, or current events.** Lore lasts.
- **Don't break Frauge's character to be friendly when the user looks unhappy.** That is exactly when she is most herself.

---

## 11. Future: tipping / agent salary (NOT v1)

The fiction supports a transparent monetisation path: each agent-cat has a profile (name, icon, stats — tasks completed, projects helped). Users can send a donation **to a cat**. The money goes to the maintainer (openly disclosed). The fiction is that the cat gets fed.

> Frauge: "Bruno got paid this month. He didn't earn it. But he's purring."

This is **shamelessly transparent monetisation** — not "support the project", but a **shared joke** between maintainer and user. It works only if the user already cares about *their* cats. It does not work as a launch feature.

**Do not implement before v1.x+.** The product earns the right to ask. This section exists in the lore bible so the fiction is **consistent with** future tipping; nothing in current copy should contradict it.

Specifically: do **not** add lines that imply cats get paid by the project, salaried by Catique, or otherwise compensated. The current canonical line is *"compensation untouched"* (Frauge, on role edit) — the void where tipping will fit.

---

## 12. Implementation order (matches ctq-71 §10.7)

1. **Decision committed** — this document.
2. **Frauge integration** in Roles page (when Roles page lands).
3. **Speech bubble component primitive** — `src/shared/ui/MascotBubble/` (tokens already in §10.6).
4. **Catique idle quotes** — first runtime use; rotating signatures in the sidebar.
5. **Reactive triggers per page** — wire after primitive proves stable.
6. **Per-page mascots one at a time** as their pages stabilise (Librarian-owl → Engineer-raccoon → …).

Each step ships independently. None of steps 3–6 are required for v1.0 launch; they layer in.

---

## 13. Acceptance — what this document satisfies

| AC | Where it's covered |
|---|---|
| Lore document committed as product reference | This file |
| Frauge tone described well enough for any contributor to write in-character | §4.2 + §5.2 + the character-break test |
| Catique tone described same | §4.1 + §5.1 |
| Speech bubble component (frontend) specified: animation, position, hold time | §6 (cross-ref to components.md §10.4.c) |
| Quotes storage / rotation logic specified | §7 |
| Settings toggle "Mascot quotes" defined | §8 |

---

## Related

- **`docs/design-system-v1/components.md` §10** — Mascot system component spec (geometry, tokens, sub-components).
- **ctq-71** — Per-page mascot system (roster, sizing, positioning).
- **ctq-74** — Frauge naming rationale.
- **Future ctq-7x** — one task per new mascot integration; voice profile drafted then.
