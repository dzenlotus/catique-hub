/**
 * McpServersOverview — content-pane intro shown when nothing in the
 * rail is selected. Mirrors the look of other entity overview panes
 * (`<SkillsList>`'s header + create CTA) but with copy specific to the
 * MCP-servers surface.
 */

import { type ReactElement } from "react";

import { Button } from "@shared/ui";
import { PixelCodingAppsWebsitesDatabase } from "@shared/ui/Icon";

import styles from "./McpServersPage.module.css";

export interface McpServersOverviewProps {
  serverCount: number;
  onCreate: () => void;
}

export function McpServersOverview({
  serverCount,
  onCreate,
}: McpServersOverviewProps): ReactElement {
  return (
    <div
      className={styles.overviewRoot}
      data-testid="mcp-servers-page-overview"
    >
      <div className={styles.overviewHeading}>
        <PixelCodingAppsWebsitesDatabase
          width={28}
          height={28}
          className={styles.overviewIcon}
          aria-hidden
        />
        <div>
          <h1 className={styles.overviewTitle}>MCP servers</h1>
          <p className={styles.overviewDescription}>
            Upstream Model Context Protocol servers connected through
            Catique HUB. Tools auto-populate via introspection.
          </p>
        </div>
      </div>

      <p
        className={styles.overviewCount}
        data-testid="mcp-servers-page-overview-count"
      >
        {serverCount === 0
          ? "No servers registered yet."
          : serverCount === 1
            ? "1 server registered."
            : `${serverCount} servers registered.`}
      </p>

      <div className={styles.overviewActions}>
        <Button
          variant="primary"
          size="md"
          onPress={onCreate}
          data-testid="mcp-servers-page-overview-create"
        >
          Create server
        </Button>
      </div>

      <p className={styles.overviewHint}>
        Select a server on the left to see its tools and refresh /
        delete actions.
      </p>
    </div>
  );
}
