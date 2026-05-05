import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  // ── Headings (CommonMark sanity) ──────────────────────────────────────
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

  it("renders `inline code` as <code>", () => {
    render(<MarkdownPreview source="Use `npm install` to install." />);
    const code = screen.getByText("npm install");
    expect(code.tagName).toBe("CODE");
  });

  // ── AC-4: External link target=_blank rel=noopener ────────────────────
  it("renders [text](url) as <a> with target=_blank and rel noopener", () => {
    render(<MarkdownPreview source="Visit [OpenAI](https://openai.com) today." />);
    const link = screen.getByRole("link", { name: "OpenAI" });
    expect(link).toHaveAttribute("href", "https://openai.com");
    expect(link).toHaveAttribute("target", "_blank");
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
  });

  // ── AC-3: Fenced code block with language class (highlighting hook) ───
  it("renders fenced code block with language class for highlighting", () => {
    const source = "```js\nconst x = 1;\n```";
    const { container } = render(<MarkdownPreview source={source} />);
    const code = container.querySelector("pre > code");
    expect(code).not.toBeNull();
    // rehype-highlight tags it as `hljs language-js` (or similar). The exact
    // ordering depends on the plugin version, so we just assert both bits.
    const cls = code!.className;
    expect(cls).toMatch(/language-js/);
  });

  it("renders fenced code block without language as <pre><code>", () => {
    const source = "```\nplain text\n```";
    const { container } = render(<MarkdownPreview source={source} />);
    const code = container.querySelector("pre > code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toContain("plain text");
  });

  // ── Lists ──────────────────────────────────────────────────────────────
  it("renders - items as <ul><li>", () => {
    render(<MarkdownPreview source={"- Alpha\n- Beta\n- Gamma"} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Alpha");
    expect(items[0]!.closest("ul")).toBeInTheDocument();
  });

  it("renders 1. items as <ol><li>", () => {
    render(<MarkdownPreview source={"1. First\n2. Second"} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.closest("ol")).toBeInTheDocument();
  });

  // ── AC-1: GFM tables ───────────────────────────────────────────────────
  it("renders GFM tables with header and body rows", () => {
    const source = [
      "| Name | Status |",
      "| ---- | ------ |",
      "| Alpha | ready |",
      "| Beta  | wip   |",
    ].join("\n");
    const { container } = render(<MarkdownPreview source={source} />);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table).toHaveAttribute("role", "table");
    // Header cells
    const ths = container.querySelectorAll("thead th");
    expect(ths).toHaveLength(2);
    expect(ths[0]).toHaveTextContent("Name");
    expect(ths[1]).toHaveTextContent("Status");
    // Body rows
    const bodyRows = container.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(2);
    expect(bodyRows[0]!.textContent).toContain("Alpha");
    expect(bodyRows[0]!.textContent).toContain("ready");
  });

  // ── AC-2: GFM task lists ──────────────────────────────────────────────
  it("renders GFM task list with read-only checkboxes", () => {
    const source = ["- [ ] Pending", "- [x] Done"].join("\n");
    const { container } = render(<MarkdownPreview source={source} />);
    const checkboxes = container.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]!.checked).toBe(false);
    expect(checkboxes[1]!.checked).toBe(true);
    // Spec mandates disabled.
    checkboxes.forEach((cb) => expect(cb).toBeDisabled());
  });

  // ── GFM strikethrough ─────────────────────────────────────────────────
  it("renders ~~strikethrough~~ as <del>", () => {
    render(<MarkdownPreview source="This is ~~gone~~ now." />);
    expect(screen.getByText("gone").tagName).toBe("DEL");
  });

  // ── Blockquote ────────────────────────────────────────────────────────
  it("renders > as <blockquote>", () => {
    const { container } = render(<MarkdownPreview source="> quoted" />);
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq!.textContent).toContain("quoted");
  });

  // ── Image with lazy loading ───────────────────────────────────────────
  it("renders ![alt](src) as <img loading=lazy>", () => {
    render(<MarkdownPreview source="![Logo](https://example.com/logo.png)" />);
    const img = screen.getByRole("img", { name: "Logo" });
    expect(img).toHaveAttribute("src", "https://example.com/logo.png");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  // ── Paragraphs ─────────────────────────────────────────────────────────
  it("renders plain text as a <p>", () => {
    render(<MarkdownPreview source="Hello world." />);
    expect(screen.getByText("Hello world.").tagName).toBe("P");
  });

  it("separates paragraphs on double newline", () => {
    const { container } = render(
      <MarkdownPreview source={"First para.\n\nSecond para."} />,
    );
    const paras = container.querySelectorAll("p");
    expect(paras).toHaveLength(2);
    expect(paras[0]).toHaveTextContent("First para.");
    expect(paras[1]).toHaveTextContent("Second para.");
  });

  // ── HTML escaping (rehype-raw NOT enabled — confirms no passthrough) ──
  it("does not inject raw <script> tags", () => {
    const source = "<script>alert('xss')</script>";
    const { container } = render(<MarkdownPreview source={source} />);
    expect(container.querySelector("script")).toBeNull();
  });

  // ── className forwarding ──────────────────────────────────────────────
  it("accepts an optional className prop", () => {
    const { container } = render(
      <MarkdownPreview source="test" className="my-custom-class" />,
    );
    expect(container.firstElementChild).toHaveClass("my-custom-class");
  });

  // ── data-testid root ──────────────────────────────────────────────────
  it("exposes a stable data-testid on the root element", () => {
    render(<MarkdownPreview source="hi" />);
    expect(screen.getByTestId("shared-markdown-preview-root")).toBeInTheDocument();
  });
});
