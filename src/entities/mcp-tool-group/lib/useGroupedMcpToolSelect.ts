/**
 * useGroupedMcpToolSelect — adapter that lets a single `<SelectTag>` pick
 * THREE kinds of MCP unit at once:
 *   - whole MCP **servers** (live unit — all the server's tools, now and
 *     after re-introspection); option/value id `server:<id>`;
 *   - custom **MCP tool groups**; option/value id `group:<id>`;
 *   - individual **tools** (id = plain tool id), each labelled with its
 *     server name so a bare "get-docs" is distinguishable.
 *
 * `onChange` is demultiplexed into three setters. Tools already covered
 * by an attached server OR group are hidden from the list (unless also
 * directly attached, so their chip keeps a matching option).
 */

import { useCallback, useMemo } from "react";

import { useMcpTools } from "@entities/mcp-tool";
import { useMcpServers } from "@entities/mcp-server";
import type { SelectTagOption } from "@shared/ui";

import { useMcpToolGroups, useMcpToolGroupMembersMap } from "../model";

export const MCP_SERVER_VALUE_PREFIX = "server:";
export const MCP_GROUP_VALUE_PREFIX = "group:";

export interface GroupedMcpToolSelectArgs {
  attachedToolIds: readonly string[];
  attachedGroupIds: readonly string[];
  attachedServerIds: readonly string[];
  onChangeTools: (next: string[]) => void;
  onChangeGroups: (next: string[]) => void;
  onChangeServers: (next: string[]) => void;
}

export interface GroupedMcpToolSelectResult {
  options: SelectTagOption[];
  values: string[];
  onChange: (next: ReadonlyArray<string>) => void;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function useGroupedMcpToolSelect(
  args: GroupedMcpToolSelectArgs,
): GroupedMcpToolSelectResult {
  const {
    attachedToolIds,
    attachedGroupIds,
    attachedServerIds,
    onChangeTools,
    onChangeGroups,
    onChangeServers,
  } = args;

  const toolsQuery = useMcpTools();
  const serversQuery = useMcpServers();
  const groupsQuery = useMcpToolGroups();
  const membersMap = useMcpToolGroupMembersMap(attachedGroupIds);

  const serverNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of serversQuery.data ?? []) map.set(s.id, s.name);
    return map;
  }, [serversQuery.data]);

  // Tools covered by an attached group OR an attached server are hidden —
  // the unit represents them. A tool that is ALSO directly attached stays
  // visible so its chip keeps a matching option.
  const hiddenToolIds = useMemo(() => {
    const directly = new Set(attachedToolIds);
    const attachedServers = new Set(attachedServerIds);
    const hidden = new Set<string>();
    for (const gid of attachedGroupIds) {
      for (const tid of membersMap[gid] ?? []) {
        if (!directly.has(tid)) hidden.add(tid);
      }
    }
    for (const t of toolsQuery.data ?? []) {
      if (
        t.serverId != null &&
        attachedServers.has(t.serverId) &&
        !directly.has(t.id)
      ) {
        hidden.add(t.id);
      }
    }
    return hidden;
  }, [
    attachedGroupIds,
    attachedServerIds,
    attachedToolIds,
    membersMap,
    toolsQuery.data,
  ]);

  const options = useMemo<SelectTagOption[]>(() => {
    const serverOpts: SelectTagOption[] = (serversQuery.data ?? []).map((s) => ({
      id: `${MCP_SERVER_VALUE_PREFIX}${s.id}`,
      label: s.name,
      description: "Server — all its tools",
    }));
    const groupOpts: SelectTagOption[] = (groupsQuery.data ?? []).map((g) => ({
      id: `${MCP_GROUP_VALUE_PREFIX}${g.id}`,
      label: g.name,
      color: g.color,
      description: "Group",
    }));
    const toolOpts: SelectTagOption[] = (toolsQuery.data ?? [])
      .filter((t) => !hiddenToolIds.has(t.id))
      .map((t) => {
        // Flat list, but each tool is labelled with its server so a bare
        // tool name is distinguishable (e.g. "Context7").
        const serverName =
          t.serverId != null ? serverNameById.get(t.serverId) : undefined;
        const description = serverName ?? t.description ?? undefined;
        return description != null
          ? { id: t.id, label: t.name, description }
          : { id: t.id, label: t.name };
      });
    return [...serverOpts, ...groupOpts, ...toolOpts];
  }, [
    serversQuery.data,
    groupsQuery.data,
    toolsQuery.data,
    hiddenToolIds,
    serverNameById,
  ]);

  const values = useMemo(
    () => [
      ...attachedServerIds.map((s) => `${MCP_SERVER_VALUE_PREFIX}${s}`),
      ...attachedGroupIds.map((g) => `${MCP_GROUP_VALUE_PREFIX}${g}`),
      ...attachedToolIds,
    ],
    [attachedServerIds, attachedGroupIds, attachedToolIds],
  );

  const onChange = useCallback(
    (next: ReadonlyArray<string>): void => {
      const nextServers: string[] = [];
      const nextGroups: string[] = [];
      const nextTools: string[] = [];
      for (const v of next) {
        if (v.startsWith(MCP_SERVER_VALUE_PREFIX)) {
          nextServers.push(v.slice(MCP_SERVER_VALUE_PREFIX.length));
        } else if (v.startsWith(MCP_GROUP_VALUE_PREFIX)) {
          nextGroups.push(v.slice(MCP_GROUP_VALUE_PREFIX.length));
        } else {
          nextTools.push(v);
        }
      }
      if (!sameOrder(nextServers, attachedServerIds)) onChangeServers(nextServers);
      if (!sameOrder(nextGroups, attachedGroupIds)) onChangeGroups(nextGroups);
      if (!sameOrder(nextTools, attachedToolIds)) onChangeTools(nextTools);
    },
    [
      attachedServerIds,
      attachedGroupIds,
      attachedToolIds,
      onChangeServers,
      onChangeGroups,
      onChangeTools,
    ],
  );

  return { options, values, onChange };
}
