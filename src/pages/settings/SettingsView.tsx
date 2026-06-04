import type { ReactElement } from "react";
import { useCallback, useMemo, useState } from "react";

import {
  EntityTree,
  type EntityTreeNode,
  Scrollable,
} from "@shared/ui";
import { SidebarShell } from "@shared/ui/SidebarShell";
import { PixelInterfaceEssentialSettingCog } from "@shared/ui/Icon";

import { SETTINGS_SECTIONS } from "./sections";
import { type Theme, applyTheme, readActiveTheme } from "./theme";
import { useSettingsScrollSpy } from "./useSettingsScrollSpy";
import {
  AboutCard,
  AppearanceCard,
  DataCard,
  KeyboardShortcutsCard,
  SidecarCard,
  TokensCard,
} from "./ui";
import styles from "./SettingsView.module.css";

const SECTION_IDS: ReadonlyArray<string> = SETTINGS_SECTIONS.map((s) => s.id);

/**
 * Settings — top-level settings container.
 *
 * Thin composition over a TOC sidebar + a scrollable stack of section cards
 * (Appearance, Keyboard shortcuts, Tokens, Data, MCP Sidecar, About). All
 * stateful concerns live in colocated hooks (`useSettingsScrollSpy`,
 * `useSeedPrompts`, `useSidecarStatus`); theme switching is local.
 */
export function SettingsView(): ReactElement {
  // Theme state — controlled by the Appearance picker. Initial value is read
  // from `<html data-theme>` set synchronously by `app/index.tsx` before
  // mount; setting state here keeps the picker UI in sync after toggling.
  const [activeTheme, setActiveTheme] = useState<Theme>(readActiveTheme);

  const handleThemeChange = useCallback(
    (next: Theme): void => {
      if (next === activeTheme) return;
      applyTheme(next);
      setActiveTheme(next);
    },
    [activeTheme],
  );

  const { activeSectionId, navigateTo } = useSettingsScrollSpy(SECTION_IDS);

  const tocTreeData = useMemo<EntityTreeNode<{ sectionId: string }>[]>(
    () =>
      SETTINGS_SECTIONS.map((section) => ({
        id: section.id,
        label: section.label,
        data: { sectionId: section.id },
      })),
    [],
  );

  const rowConfig = useCallback(
    (node: EntityTreeNode<{ sectionId: string }>) => ({
      isActive: node.id === activeSectionId,
      onClick: () => navigateTo(node.id),
    }),
    [activeSectionId, navigateTo],
  );

  return (
    <div className={styles.layout}>
      <SidebarShell ariaLabel="Settings sections" testId="settings-view-sidebar">
        {/* TOC — flat label-only list, no custom row body needed. */}
        <EntityTree<{ sectionId: string }>
          testIdPrefix="settings-view-nav"
          title="Sections"
          data={tocTreeData}
          rowConfig={rowConfig}
        />
      </SidebarShell>

      <Scrollable
        axis="y"
        className={styles.scrollHost}
        data-testid="settings-view-scroll"
      >
        <div className={styles.root}>
          <header
            className={styles.pageHeader}
            aria-labelledby="settings-page-heading"
          >
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
              <p className={styles.pageDescription}>Application preferences.</p>
            </div>
          </header>

          <AppearanceCard
            activeTheme={activeTheme}
            onThemeChange={handleThemeChange}
          />
          <KeyboardShortcutsCard />
          <TokensCard />
          <DataCard />
          <SidecarCard />
          <AboutCard />
        </div>
      </Scrollable>
    </div>
  );
}
