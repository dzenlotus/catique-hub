import type { ReactElement } from "react";
import { useState, useEffect, useRef } from "react";
import { Button, Input, Scrollable } from "@shared/ui";
import {
  SidebarShell,
  SidebarSectionLabel,
} from "@shared/ui/SidebarShell";
import { PixelInterfaceEssentialSettingCog } from "@shared/ui/Icon";
import { cn } from "@shared/lib";
import { LocalStorageStore, stringCodec } from "@shared/storage";
import { SettingsTokensView } from "@widgets/settings-tokens-view";
import { ConnectedAgentsSection } from "@widgets/connected-agents-section";
import { useCreatePromptMutation } from "@entities/prompt";
import { useToast } from "@app/providers/ToastProvider";
import { invoke } from "@shared/api";
import pkgJson from "../../../package.json";
import styles from "./SettingsView.module.css";

// resolveJsonModule is enabled in tsconfig.json, so direct import is fine.
const APP_VERSION: string = pkgJson.version;

// ---------------------------------------------------------------------------
// Sidebar table of contents (round-19c). Each entry is matched 1:1 against
// the `id` attribute on the corresponding `<section>` so click → scroll.
// ---------------------------------------------------------------------------

const SETTINGS_SECTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "settings-appearance", label: "Appearance" },
  { id: "settings-profile", label: "Profile" },
  { id: "settings-connected-agents", label: "Connected agents" },
  { id: "settings-keyboard-shortcuts", label: "Keyboard shortcuts" },
  { id: "settings-tokens", label: "Tokens" },
  { id: "settings-data", label: "Data" },
  { id: "settings-mcp-sidecar", label: "MCP sidecar" },
  { id: "settings-about", label: "About" },
];

/**
 * Smooth-scroll the visible Settings page so the section anchored on
 * `id` is at the top of the viewport. Falls back to `scrollIntoView`
 * default behaviour when `prefers-reduced-motion` is set, which the
 * platform respects automatically.
 */
function scrollToSection(id: string): void {
  if (typeof document === "undefined") return;
  const target = document.getElementById(id);
  if (target === null) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------------
// MCP Sidecar types — mirrors crates/sidecar/src/lib.rs SidecarStatus enum.
// PoC for ctq-56 ADR-0002 spike. Real TS bindings generated via ts-rs in E5.
// ---------------------------------------------------------------------------

type SidecarStatus =
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "running"; pid: number }
  | { state: "crashed"; exitCode: number | null };

const SIDECAR_POLL_MS = 5_000;

// ---------------------------------------------------------------------------
// MCP Sidecar status badge sub-component (inline — spike only).
// ---------------------------------------------------------------------------

function SidecarStatusPill({ status }: { status: SidecarStatus }): ReactElement {
  const dotStyle: React.CSSProperties = {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: "50%",
    marginRight: 6,
    verticalAlign: "middle",
  };

  switch (status.state) {
    case "running":
      return (
        <span>
          <span style={{ ...dotStyle, backgroundColor: "#22c55e" }} />
          Running (pid {status.pid})
        </span>
      );
    case "starting":
      return (
        <span>
          <span style={{ ...dotStyle, backgroundColor: "#eab308" }} />
          Starting…
        </span>
      );
    case "stopped":
      return (
        <span>
          <span style={{ ...dotStyle, backgroundColor: "#ef4444" }} />
          Stopped
        </span>
      );
    case "crashed":
      return (
        <span>
          <span style={{ ...dotStyle, backgroundColor: "#ef4444" }} />
          Crashed{status.exitCode !== null ? ` (exit ${String(status.exitCode)})` : ""}
        </span>
      );
  }
}

type Theme = "dark" | "light";

const themeStore = new LocalStorageStore<string>({
  key: "catique:theme",
  codec: stringCodec,
});

function readActiveTheme(): Theme {
  const attr = document.documentElement.dataset["theme"];
  return attr === "light" ? "light" : "dark";
}

function applyTheme(next: Theme): void {
  document.documentElement.dataset["theme"] = next;
  themeStore.set(next);
}

// ---------------------------------------------------------------------------
// Test fixtures for the "Seed test prompts" affordance in the Data card.
// ---------------------------------------------------------------------------

const SEED_PROMPTS: ReadonlyArray<{
  name: string;
  content: string;
  color?: string;
  shortDescription?: string;
}> = [
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

/**
 * Settings — top-level settings container.
 *
 * Four sub-sections: Appearance, Tokens, Data, About.
 * No interactive controls in this slice except disabled affordances in Data.
 * Theme switching is handled by the ThemeToggle in the sidebar footer.
 */
export function SettingsView(): ReactElement {
  // Theme state — controlled by the picker below. Initial value is read
  // from `<html data-theme>` set synchronously by `app/index.tsx` before
  // mount; setting state here keeps the picker UI in sync after the user
  // toggles.
  const [activeTheme, setActiveTheme] = useState<Theme>(readActiveTheme);

  function handleThemeChange(next: Theme): void {
    if (next === activeTheme) return;
    applyTheme(next);
    setActiveTheme(next);
  }

  // Active TOC section — highest section currently in the upper half of
  // the scroll viewport. Tracked via IntersectionObserver on each
  // `<section[id]>`.
  const [activeSectionId, setActiveSectionId] = useState<string>(
    SETTINGS_SECTIONS[0]?.id ?? "",
  );
  // Set from `scrollToSection` so the click target wins immediately
  // even before the scroll lands and the IO updates.
  const programmaticTargetRef = useRef<string | null>(null);

  useEffect(() => {
    const elements: HTMLElement[] = SETTINGS_SECTIONS
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry whose top is closest to (and above) 25% of the
        // viewport — same heuristic GitHub uses for sticky-section TOCs.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) =>
              Math.abs(a.boundingClientRect.top) -
              Math.abs(b.boundingClientRect.top),
          );
        if (visible.length === 0) return;
        const candidateId = visible[0]?.target.id;
        if (!candidateId) return;
        if (programmaticTargetRef.current === candidateId) {
          programmaticTargetRef.current = null;
        }
        setActiveSectionId(candidateId);
      },
      {
        // Trigger when the section enters the upper 25% of the viewport.
        rootMargin: "-15% 0px -70% 0px",
        threshold: 0,
      },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function handleNavClick(id: string): void {
    programmaticTargetRef.current = id;
    setActiveSectionId(id);
    scrollToSection(id);
  }

  // ── Seed-prompts mutation ─────────────────────────────────────────────────
  const createPromptMutation = useCreatePromptMutation();
  const { pushToast } = useToast();
  const [isSeeding, setIsSeeding] = useState(false);

  async function handleSeedPrompts(): Promise<void> {
    if (isSeeding) return;
    setIsSeeding(true);
    try {
      for (const seed of SEED_PROMPTS) {
        await createPromptMutation.mutateAsync(seed);
      }
      pushToast("success", `Seeded ${SEED_PROMPTS.length} test prompts`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast("error", `Failed to seed prompts: ${message}`);
    } finally {
      setIsSeeding(false);
    }
  }

  // ── MCP Sidecar state ─────────────────────────────────────────────────────
  // PoC for ctq-56 ADR-0002 spike. Real entity slice + react-query hooks in E5.

  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus>({ state: "stopped" });
  const [sidecarLatencyMs, setSidecarLatencyMs] = useState<number | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function pollStatus(): Promise<void> {
      try {
        const status = await invoke<SidecarStatus>("sidecar_status");
        if (!cancelled) setSidecarStatus(status);
      } catch {
        // Backend not available in test / storybook — stay Stopped.
      }
    }

    async function pollLatency(): Promise<void> {
      try {
        const latencyUs = await invoke<number>("sidecar_ping");
        if (!cancelled) setSidecarLatencyMs(latencyUs / 1000);
      } catch {
        if (!cancelled) setSidecarLatencyMs(null);
      }
    }

    void pollStatus();

    const intervalId = setInterval(() => {
      void pollStatus();
      void pollLatency();
    }, SIDECAR_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  async function handleSidecarRestart(): Promise<void> {
    setIsRestarting(true);
    try {
      await invoke<void>("sidecar_restart");
      // Give it a moment to transition to Running.
      setTimeout(() => {
        void invoke<SidecarStatus>("sidecar_status").then((s) => setSidecarStatus(s));
        setIsRestarting(false);
      }, 800);
    } catch {
      setIsRestarting(false);
    }
  }

  return (
    <div className={styles.layout}>
      <SidebarShell
        ariaLabel="Settings sections"
        testId="settings-view-sidebar"
      >
        <SidebarSectionLabel>Sections</SidebarSectionLabel>
        <ul className={styles.navList} role="list">
          {SETTINGS_SECTIONS.map((section) => {
            const isActive = section.id === activeSectionId;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  className={cn(
                    styles.navItem,
                    isActive && styles.navItemActive,
                  )}
                  onClick={() => handleNavClick(section.id)}
                  aria-current={isActive ? "true" : undefined}
                  data-testid={`settings-view-nav-${section.id}`}
                >
                  {section.label}
                </button>
              </li>
            );
          })}
        </ul>
      </SidebarShell>

      <Scrollable
        axis="y"
        className={styles.scrollHost}
        data-testid="settings-view-scroll"
      >
        <div className={styles.root}>
          <header className={styles.pageHeader} aria-labelledby="settings-page-heading">
        <PixelInterfaceEssentialSettingCog
          width={20}
          height={20}
          className={styles.pageHeaderIcon}
          aria-hidden={true}
        />
        <div className={styles.pageHeaderText}>
          <h2 id="settings-page-heading" className={styles.pageTitle}>
            Settings
          </h2>
          <p className={styles.pageDescription}>
            Application preferences.
          </p>
        </div>
      </header>

      {/* ── Appearance ─────────────────────────────────────────────── */}
      <section className={styles.card} aria-labelledby="settings-appearance">
        <h3 id="settings-appearance" className={styles.cardHeading}>
          Appearance
        </h3>
        <div className={styles.cardBody}>
          <div
            className={styles.themePicker}
            role="radiogroup"
            aria-label="Theme"
          >
            <span className={styles.themePickerLabel}>Theme</span>
            <div className={styles.themeButtonGroup}>
              <button
                type="button"
                role="radio"
                aria-checked={activeTheme === "light"}
                className={cn(
                  styles.themeButton,
                  activeTheme === "light" && styles.themeButtonActive,
                )}
                onClick={() => handleThemeChange("light")}
                data-testid="settings-theme-button-light"
              >
                Light
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={activeTheme === "dark"}
                className={cn(
                  styles.themeButton,
                  activeTheme === "dark" && styles.themeButtonActive,
                )}
                onClick={() => handleThemeChange("dark")}
                data-testid="settings-theme-button-dark"
              >
                Dark
              </button>
            </div>
            <span
              className={styles.hint}
              data-testid="active-theme-name"
              aria-live="polite"
            >
              {activeTheme === "light" ? "Light" : "Dark"}
            </span>
          </div>
        </div>
      </section>

      {/* ── Profile ─────────────────────────────────────────────────── */}
      <section
        className={styles.card}
        aria-labelledby="settings-profile"
        data-testid="settings-view-profile-section"
      >
        <h3 id="settings-profile" className={styles.cardHeading}>
          Profile
        </h3>
        <div className={styles.cardBody}>
          <div className={styles.profileRow}>
            <div
              className={styles.avatar}
              data-testid="settings-view-profile-avatar"
              aria-label="User avatar — M"
            >
              M
            </div>
            <div className={styles.profileFields}>
              <Input
                label="Name"
                defaultValue="Maintainer"
                isDisabled
                description="Local mode — single-user only. Accounts arrive in E6+."
                data-testid="settings-view-profile-name-input"
              />
              <Input
                label="Email"
                type="email"
                defaultValue=""
                placeholder="—"
                isDisabled
                data-testid="settings-view-profile-email-input"
              />
            </div>
          </div>
          <p className={cn(styles.hint, styles.profileCaption)}>
            Catique HUB currently runs in local mode. Accounts and sync are a
            future iteration.
          </p>
          <div>
            <span className={styles.localPill}>Local-first</span>
          </div>
        </div>
      </section>

      {/* ── Connected agents (ctq-67) ───────────────────────────────── */}
      <section
        className={styles.card}
        aria-labelledby="settings-connected-agents"
        data-testid="settings-connected-agents-section"
      >
        <h3 id="settings-connected-agents" className={styles.cardHeading}>
          Connected agents
        </h3>
        <div className={styles.cardBody}>
          <ConnectedAgentsSection />
        </div>
      </section>

      {/* ── Keyboard shortcuts ──────────────────────────────────────── */}
      <section
        className={styles.card}
        aria-labelledby="settings-keyboard-shortcuts"
        data-testid="settings-keyboard-shortcuts-section"
      >
        <h3 id="settings-keyboard-shortcuts" className={styles.cardHeading}>
          Keyboard shortcuts
        </h3>
        <div className={styles.cardBody}>
          <p className={styles.hint}>Quick reference for the available shortcuts.</p>
          <div className={styles.shortcutsGrid}>
            <kbd className={styles.kbd}>⌘K</kbd>
            <span className={styles.shortcutDesc}>Open global search</span>

            <kbd className={styles.kbd}>⌘N</kbd>
            <span className={styles.shortcutDesc}>New task</span>

            <kbd className={styles.kbd}>Esc</kbd>
            <span className={styles.shortcutDesc}>Close dialog / palette</span>

            <kbd className={styles.kbd}>Enter</kbd>
            <span className={styles.shortcutDesc}>Activate focused item</span>

            <kbd className={styles.kbd}>Tab / Shift+Tab</kbd>
            <span className={styles.shortcutDesc}>Move focus</span>
          </div>
        </div>
      </section>

      {/* ── Tokens ──────────────────────────────────────────────────── */}
      <section className={styles.card} aria-labelledby="settings-tokens">
        <h3 id="settings-tokens" className={styles.cardHeading}>
          Tokens
        </h3>
        <div className={styles.cardBody} data-testid="settings-tokens-section">
          <SettingsTokensView />
        </div>
      </section>

      {/* ── Data ────────────────────────────────────────────────────── */}
      <section className={styles.card} aria-labelledby="settings-data">
        <h3 id="settings-data" className={styles.cardHeading}>
          Data
        </h3>
        <div className={styles.cardBody}>
          <dl className={styles.dl}>
            <dt className={styles.dt}>Import from Promptery</dt>
            <dd className={styles.dd}>
              Use the import wizard in the application menu.
            </dd>

            <dt className={styles.dt}>Database location (SQLite)</dt>
            <dd className={styles.dd}>
              <code className={styles.code}>$APPLOCALDATA/catique/db.sqlite</code>
            </dd>

            <dt className={styles.dt}>Backups</dt>
            <dd className={styles.dd}>TBD</dd>
          </dl>

          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              isPending={isSeeding}
              onPress={() => void handleSeedPrompts()}
              data-testid="settings-data-seed-prompts"
            >
              Seed test prompts
            </Button>
            <Button variant="secondary" size="sm" isDisabled>
              Export data (TODO)
            </Button>
            <Button variant="secondary" size="sm" isDisabled>
              Clear data (TODO)
            </Button>
          </div>
        </div>
      </section>

      {/* ── MCP Sidecar ─────────────────────────────────────────────── */}
      {/* PoC for ctq-56 ADR-0002 spike. Real entity slice + react-query hooks in E5. */}
      <section
        className={styles.card}
        aria-labelledby="settings-mcp-sidecar"
        data-testid="settings-mcp-sidecar-section"
      >
        <h3 id="settings-mcp-sidecar" className={styles.cardHeading}>
          MCP Sidecar
        </h3>
        <div className={styles.cardBody}>
          <dl className={styles.dl}>
            <dt className={styles.dt}>Status</dt>
            <dd className={styles.dd} data-testid="sidecar-status-pill">
              <SidecarStatusPill status={sidecarStatus} />
            </dd>

            <dt className={styles.dt}>Latency</dt>
            <dd className={styles.dd} data-testid="sidecar-latency">
              {sidecarLatencyMs !== null
                ? `${sidecarLatencyMs.toFixed(2)} ms`
                : "—"}
            </dd>
          </dl>

          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              isDisabled={isRestarting}
              onPress={() => void handleSidecarRestart()}
              data-testid="sidecar-restart-button"
            >
              {isRestarting ? "Restarting…" : "Restart"}
            </Button>
          </div>
        </div>
      </section>

      {/* ── About ───────────────────────────────────────────────────── */}
      <section className={styles.card} aria-labelledby="settings-about">
        <h3 id="settings-about" className={styles.cardHeading}>
          About
        </h3>
        <div className={styles.cardBody}>
          <dl className={styles.dl}>
            <dt className={styles.dt}>Version</dt>
            <dd className={styles.dd} data-testid="app-version">
              {APP_VERSION}
            </dd>

            <dt className={styles.dt}>License</dt>
            <dd className={styles.dd}>Elastic-2.0</dd>

            <dt className={styles.dt}>Source code</dt>
            <dd className={styles.dd}>GitHub / catique-hub (link TBD)</dd>
          </dl>
        </div>
      </section>
        </div>
      </Scrollable>
    </div>
  );
}
