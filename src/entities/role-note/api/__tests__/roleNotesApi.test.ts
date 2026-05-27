/**
 * roleNotesApi — unit tests.
 *
 * Mocks `@shared/api`'s `invoke` so each wrapper can be asserted in
 * isolation: did we pass the right command name and the right payload
 * shape?
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@shared/api", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@shared/api";
import type { RoleNote } from "@bindings/RoleNote";

import {
  addRoleNote,
  deleteRoleNote,
  listRoleNoteTags,
  listRoleNotes,
  updateRoleNote,
} from "../roleNotesApi";

const invokeMock = vi.mocked(invoke);

function makeNote(overrides: Partial<RoleNote> = {}): RoleNote {
  return {
    id: "note-1",
    roleId: "role-1",
    sourceTaskId: null,
    body: "remember to lint",
    tags: ["lint"],
    priority: 0n,
    pinned: false,
    authoredBy: "user",
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("roleNotesApi", () => {
  it("listRoleNotes invokes list_role_notes with roleId", async () => {
    invokeMock.mockResolvedValueOnce([makeNote()]);
    const result = await listRoleNotes("role-x");
    expect(invokeMock).toHaveBeenCalledWith("list_role_notes", {
      roleId: "role-x",
    });
    expect(result).toHaveLength(1);
  });

  it("listRoleNoteTags invokes list_role_note_tags with roleId", async () => {
    invokeMock.mockResolvedValueOnce([{ tag: "style", count: 3 }]);
    const result = await listRoleNoteTags("role-y");
    expect(invokeMock).toHaveBeenCalledWith("list_role_note_tags", {
      roleId: "role-y",
    });
    expect(result).toEqual([{ tag: "style", count: 3 }]);
  });

  it("addRoleNote sends the full payload with authoredBy", async () => {
    invokeMock.mockResolvedValueOnce(
      makeNote({ id: "n-new", body: "use kebab-case", tags: ["style"] }),
    );
    await addRoleNote({
      roleId: "role-1",
      body: "use kebab-case",
      tags: ["style"],
      authoredBy: "user",
    });
    expect(invokeMock).toHaveBeenCalledWith("add_role_note", {
      roleId: "role-1",
      body: "use kebab-case",
      tags: ["style"],
      authoredBy: "user",
    });
  });

  it("addRoleNote omits sourceTaskId when undefined", async () => {
    invokeMock.mockResolvedValueOnce(makeNote());
    await addRoleNote({
      roleId: "role-1",
      body: "x",
      tags: [],
      authoredBy: "agent",
    });
    const call = invokeMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(call).not.toHaveProperty("sourceTaskId");
  });

  it("addRoleNote includes sourceTaskId when provided", async () => {
    invokeMock.mockResolvedValueOnce(makeNote());
    await addRoleNote({
      roleId: "role-1",
      body: "x",
      tags: [],
      authoredBy: "agent",
      sourceTaskId: "task-7",
    });
    const call = invokeMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(call.sourceTaskId).toBe("task-7");
  });

  it("updateRoleNote sends only fields that are defined", async () => {
    invokeMock.mockResolvedValueOnce(makeNote({ pinned: true }));
    await updateRoleNote({ id: "note-1", pinned: true });
    expect(invokeMock).toHaveBeenCalledWith("update_role_note", {
      id: "note-1",
      pinned: true,
    });
  });

  it("updateRoleNote forwards priority + tags + body together", async () => {
    invokeMock.mockResolvedValueOnce(makeNote());
    await updateRoleNote({
      id: "note-1",
      body: "updated body",
      tags: ["a", "b"],
      priority: 7,
    });
    expect(invokeMock).toHaveBeenCalledWith("update_role_note", {
      id: "note-1",
      body: "updated body",
      tags: ["a", "b"],
      priority: 7,
    });
  });

  it("deleteRoleNote invokes delete_role_note with id", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await deleteRoleNote("note-1");
    expect(invokeMock).toHaveBeenCalledWith("delete_role_note", {
      id: "note-1",
    });
  });
});
