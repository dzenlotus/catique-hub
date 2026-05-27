/**
 * Tests for the skill attachments IPC wrappers (SKILL-S12).
 *
 * Mocks `@shared/api`'s `invokeWithAppError` and asserts that each
 * wrapper forwards the right command name + payload shape to the Rust
 * side. Tauri converts camelCase JS keys to snake_case server-side, so
 * we only need to check the JS-facing payload.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@shared/api", async () => {
  const actual = await vi.importActual<typeof import("@shared/api")>("@shared/api");
  const fn = vi.fn();
  return {
    ...actual,
    invoke: fn,
    invokeWithAppError: fn,
  };
});

import { invokeWithAppError } from "@shared/api";
import {
  addSkillFileAttachment,
  addSkillGitAttachment,
  listSkillAttachments,
  removeSkillAttachment,
} from "../skillAttachmentsApi";

const invokeMock = vi.mocked(invokeWithAppError);

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("skillAttachmentsApi", () => {
  it("listSkillAttachments forwards skillId", async () => {
    invokeMock.mockResolvedValue([]);
    await listSkillAttachments("sk-1");
    expect(invokeMock).toHaveBeenCalledWith("list_skill_attachments", {
      skillId: "sk-1",
    });
  });

  it("addSkillFileAttachment forwards filename, mimeType, base64Bytes", async () => {
    const fake = {
      id: "att-1",
      skillId: "sk-1",
      kind: "file" as const,
      filename: "report.py",
      mimeType: "text/x-python",
      sizeBytes: 12n,
      storagePath: "/skills/sk-1/report.py",
      gitUrl: null,
      gitRef: null,
      gitPath: null,
      createdAt: 0n,
    };
    invokeMock.mockResolvedValue(fake);

    const result = await addSkillFileAttachment({
      skillId: "sk-1",
      filename: "report.py",
      mimeType: "text/x-python",
      base64Bytes: "aGVsbG8=",
    });

    expect(invokeMock).toHaveBeenCalledWith("add_skill_file_attachment", {
      skillId: "sk-1",
      filename: "report.py",
      mimeType: "text/x-python",
      base64Bytes: "aGVsbG8=",
    });
    expect(result).toEqual(fake);
  });

  it("addSkillGitAttachment forwards url + nullable ref/path verbatim", async () => {
    invokeMock.mockResolvedValue({
      id: "att-2",
      skillId: "sk-1",
      kind: "git",
      filename: null,
      mimeType: null,
      sizeBytes: null,
      storagePath: null,
      gitUrl: "https://github.com/owner/repo.git",
      gitRef: "main",
      gitPath: "scripts/run.sh",
      createdAt: 0n,
    });

    await addSkillGitAttachment({
      skillId: "sk-1",
      gitUrl: "https://github.com/owner/repo.git",
      gitRef: "main",
      gitPath: "scripts/run.sh",
    });

    expect(invokeMock).toHaveBeenCalledWith("add_skill_git_attachment", {
      skillId: "sk-1",
      gitUrl: "https://github.com/owner/repo.git",
      gitRef: "main",
      gitPath: "scripts/run.sh",
    });
  });

  it("addSkillGitAttachment forwards explicit nulls for ref/path", async () => {
    invokeMock.mockResolvedValue({
      id: "att-3",
      skillId: "sk-1",
      kind: "git",
      filename: null,
      mimeType: null,
      sizeBytes: null,
      storagePath: null,
      gitUrl: "https://github.com/owner/repo.git",
      gitRef: null,
      gitPath: null,
      createdAt: 0n,
    });

    await addSkillGitAttachment({
      skillId: "sk-1",
      gitUrl: "https://github.com/owner/repo.git",
      gitRef: null,
      gitPath: null,
    });

    expect(invokeMock).toHaveBeenCalledWith("add_skill_git_attachment", {
      skillId: "sk-1",
      gitUrl: "https://github.com/owner/repo.git",
      gitRef: null,
      gitPath: null,
    });
  });

  it("removeSkillAttachment forwards attachmentId", async () => {
    invokeMock.mockResolvedValue(undefined);
    await removeSkillAttachment("att-1");
    expect(invokeMock).toHaveBeenCalledWith("remove_skill_attachment", {
      attachmentId: "att-1",
    });
  });
});
