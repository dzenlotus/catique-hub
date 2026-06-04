import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Attachment } from "../../model/types";
import { AttachmentRow } from "./AttachmentRow";

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "att-001",
    taskId: "tsk-001",
    filename: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 5242880n, // 5 MB
    storagePath: "/attachments/tsk-001/report.pdf",
    uploadedAt: 0n,
    uploadedBy: null,
    ...overrides,
  };
}

describe("AttachmentRow", () => {
  it("renders the filename", () => {
    render(<AttachmentRow attachment={makeAttachment()} />);
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("renders the humanised file size", () => {
    render(<AttachmentRow attachment={makeAttachment({ sizeBytes: 5242880n })} />);
    // 5 MB = 5242880 bytes → "5.0 MB"
    expect(screen.getByText("5.0 MB")).toBeInTheDocument();
  });

  it("renders size in KB for small files", () => {
    render(<AttachmentRow attachment={makeAttachment({ sizeBytes: 2048n })} />);
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("renders bytes for sub-KB files", () => {
    render(<AttachmentRow attachment={makeAttachment({ sizeBytes: 512n })} />);
    expect(screen.getByText("512 B")).toBeInTheDocument();
  });

  it("renders MIME type shortcode badge", () => {
    render(<AttachmentRow attachment={makeAttachment({ mimeType: "application/pdf" })} />);
    expect(screen.getByText("PDF")).toBeInTheDocument();
  });

  it("renders PNG shortcode for image/png", () => {
    render(
      <AttachmentRow
        attachment={makeAttachment({ mimeType: "image/png", filename: "screenshot.png" })}
      />,
    );
    expect(screen.getByText("PNG")).toBeInTheDocument();
  });

  it("renders a delete button with accessible label", () => {
    render(<AttachmentRow attachment={makeAttachment()} />);
    expect(
      screen.getByRole("button", { name: /delete attachment report\.pdf/i }),
    ).toBeInTheDocument();
  });

  it("calls onDelete with the attachment id on delete click", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <AttachmentRow attachment={makeAttachment({ id: "att-xyz" })} onDelete={onDelete} />,
    );
    await user.click(screen.getByTestId("attachment-row-delete-att-xyz"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("att-xyz");
  });

  it("does not throw when onDelete is not provided", async () => {
    const user = userEvent.setup();
    render(<AttachmentRow attachment={makeAttachment({ id: "att-noop" })} />);
    // Should not throw even with no handler.
    await expect(
      user.click(screen.getByTestId("attachment-row-delete-att-noop")),
    ).resolves.toBeUndefined();
  });

  it("disables the delete button and shows pending when isDeleting=true", () => {
    render(<AttachmentRow attachment={makeAttachment()} isDeleting />);
    const btn = screen.getByRole("button", { name: /delete attachment/i });
    expect(btn).toBeDisabled();
    expect(screen.getByTestId("button-spinner")).toBeInTheDocument();
  });

  it("attaches data-testid based on attachment id", () => {
    render(<AttachmentRow attachment={makeAttachment({ id: "att-testid" })} />);
    expect(screen.getByTestId("attachment-row-att-testid")).toBeInTheDocument();
  });
});
