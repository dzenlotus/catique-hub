import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  // ── Headings ───────────────────────────────────────────────────────────
  it("renders h1 for # heading", () => {
    render(<MarkdownPreview source="# Hello" />);
    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
  });

  it("renders h2 for ## heading", () => {
    render(<MarkdownPreview source="## World" />);
    expect(screen.getByRole("heading", { level: 2, name: "World" })).toBeInTheDocument();
  });

  it("renders h3 for ### heading", () => {
    render(<MarkdownPreview source="### Sub" />);
    expect(screen.getByRole("heading", { level: 3, name: "Sub" })).toBeInTheDocument();
  });

  // ── Inline ─────────────────────────────────────────────────────────────
  it("renders **bold** as <strong>", () => {
    render(<MarkdownPreview source="This is **bold** text." />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("renders *italic* as <em>", () => {
    render(<MarkdownPreview source="This is *italic* text." />);
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders _italic_ as <em>", () => {
    render(<MarkdownPreview source="This is _italic_ too." />);
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders `inline code` as <code>", () => {
    render(<MarkdownPreview source="Use `npm install` to install." />);
    const code = screen.getByText("npm install");
    expect(code.tagName).toBe("CODE");
  });

  it("renders [text](url) as <a> with target=_blank", () => {
    render(<MarkdownPreview source="Visit [OpenAI](https://openai.com) today." />);
    const link = screen.getByRole("link", { name: "OpenAI" });
    expect(link).toHaveAttribute("href", "https://openai.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  // ── Code block ────────────────────────────────────────────────────────
  it("renders fenced code block as <pre><code>", () => {
    const source = "```\nconst x = 1;\n```";
    render(<MarkdownPreview source={source} />);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.closest("pre")).toBeInTheDocument();
  });

  // ── Lists ──────────────────────────────────────────────────────────────
  it("renders - items as <ul><li>", () => {
    render(<MarkdownPreview source={"- Alpha\n- Beta\n- Gamma"} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Alpha");
    expect(items[1]).toHaveTextContent("Beta");
    expect(items[2]).toHaveTextContent("Gamma");
    // Parent is a <ul>
    expect(items[0]!.closest("ul")).toBeInTheDocument();
  });

  it("renders * items as <ul><li>", () => {
    render(<MarkdownPreview source={"* One\n* Two"} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.closest("ul")).toBeInTheDocument();
  });

  it("renders 1. items as <ol><li>", () => {
    render(<MarkdownPreview source={"1. First\n2. Second"} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.closest("ol")).toBeInTheDocument();
  });

  // ── Paragraphs ─────────────────────────────────────────────────────────
  it("renders plain text as a <p>", () => {
    render(<MarkdownPreview source="Hello world." />);
    expect(screen.getByText("Hello world.").tagName).toBe("P");
  });

  it("separates paragraphs on double newline", () => {
    render(<MarkdownPreview source={"First para.\n\nSecond para."} />);
    const paras = document.querySelectorAll("p");
    expect(paras).toHaveLength(2);
    expect(paras[0]).toHaveTextContent("First para.");
    expect(paras[1]).toHaveTextContent("Second para.");
  });

  // ── HTML escaping ──────────────────────────────────────────────────────
  it("escapes <script> tags — does not inject HTML", () => {
    const source = "<script>alert('xss')</script>";
    const { container } = render(<MarkdownPreview source={source} />);
    // No actual <script> element must be present in the DOM.
    expect(container.querySelector("script")).toBeNull();
    // The text content is rendered as literal characters.
    expect(container.textContent).toContain("<script>");
  });

  it("escapes angle brackets in inline text", () => {
    render(<MarkdownPreview source="a < b > c & d" />);
    expect(screen.getByText("a < b > c & d")).toBeInTheDocument();
  });

  it("escapes HTML in a code block", () => {
    const source = "```\n<b>not bold</b>\n```";
    const { container } = render(<MarkdownPreview source={source} />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("pre")!.textContent).toContain("<b>not bold</b>");
  });

  // ── className forwarding ───────────────────────────────────────────────
  it("accepts an optional className prop", () => {
    const { container } = render(
      <MarkdownPreview source="test" className="my-custom-class" />,
    );
    expect(container.firstElementChild).toHaveClass("my-custom-class");
  });
});
