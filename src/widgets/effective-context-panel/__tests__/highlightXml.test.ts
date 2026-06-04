/**
 * highlightXml — dependency-free XML tokenizer used by the task preview.
 *
 * The key invariant: tokenizing is loss-free — joining token text exactly
 * reproduces the input — so the preview's `<pre>` textContent (and the
 * `task-xml-preview-body` testid match) is never altered by highlighting.
 */
import { describe, expect, it } from "vitest";

import { highlightXml } from "../highlightXml";

function roundTrip(input: string): string {
  return highlightXml(input)
    .map((t) => t.text)
    .join("");
}

describe("highlightXml", () => {
  it("round-trips arbitrary XML losslessly", () => {
    const xml =
      '<task title="Hi">\n    <description>\n      body &amp; more\n' +
      "    </description>\n  </task>\n\n<prompts>\n" +
      '  <prompt name="P" origin="task">x</prompt>\n</prompts>';
    expect(roundTrip(xml)).toBe(xml);
  });

  it("round-trips plain text with no tags", () => {
    expect(roundTrip("no tags here")).toBe("no tags here");
  });

  it("classes element names as hljs-name", () => {
    const tokens = highlightXml("<task></task>");
    const names = tokens
      .filter((t) => t.className === "hljs-name")
      .map((t) => t.text);
    expect(names).toEqual(["task", "task"]);
  });

  it("classes attribute names as hljs-attr and quoted values as hljs-string", () => {
    const tokens = highlightXml('<a name="b" />');
    expect(
      tokens.find((t) => t.className === "hljs-attr")?.text,
    ).toBe("name");
    expect(
      tokens.find((t) => t.className === "hljs-string")?.text,
    ).toBe('"b"');
  });

  it("handles a self-closing tag", () => {
    const xml = '<skill id="s1" name="X" />';
    expect(roundTrip(xml)).toBe(xml);
    const tokens = highlightXml(xml);
    expect(tokens.some((t) => t.text === "/>")).toBe(true);
  });

  it("tolerates an unterminated angle bracket without throwing", () => {
    expect(roundTrip("text < dangling")).toBe("text < dangling");
  });
});
