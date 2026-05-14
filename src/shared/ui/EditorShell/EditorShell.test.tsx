/*
 * EditorShell — composition primitive tests.
 *
 * Surface covered:
 *   1. Slot order: header → body → footer.
 *   2. Body region is rendered with overflow-y: auto styling
 *      (asserted via the `styles.body` class on the body element).
 *   3. Footer is wired via the sticky-bottom layout class.
 *   4. Missing slots render the remaining regions without throwing.
 *   5. Root `testId` propagates to each slot as
 *      `<testId>-header` / `-body` / `-footer`.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { EditorShell } from "./EditorShell";

describe("EditorShell", () => {
  it("renders header → body → footer in DOM order", () => {
    render(
      <EditorShell testId="shell">
        <EditorShell.Header>
          <h2>Header text</h2>
        </EditorShell.Header>
        <EditorShell.Body>
          <p>Body text</p>
        </EditorShell.Body>
        <EditorShell.Footer>
          <button type="button">Save</button>
        </EditorShell.Footer>
      </EditorShell>,
    );

    const root = screen.getByTestId("shell");
    const children = Array.from(root.children) as HTMLElement[];
    expect(children).toHaveLength(3);

    // First child is the header — carries the derived test id.
    expect(children[0]).toHaveAttribute("data-testid", "shell-header");
    expect(children[0]).toContainElement(
      screen.getByRole("heading", { name: "Header text" }),
    );

    // Second child is the body.
    expect(children[1]).toHaveAttribute("data-testid", "shell-body");
    expect(children[1]).toContainElement(screen.getByText("Body text"));

    // Third child is the footer.
    expect(children[2]).toHaveAttribute("data-testid", "shell-footer");
    expect(children[2]).toContainElement(
      screen.getByRole("button", { name: "Save" }),
    );
  });

  it("body region is the scroll boundary (carries the body layout class)", () => {
    render(
      <EditorShell testId="shell">
        <EditorShell.Body>
          <p>Body text</p>
        </EditorShell.Body>
      </EditorShell>,
    );

    const body = screen.getByTestId("shell-body");
    // The body class name is namespaced by the CSS-modules pipeline
    // (`<localName>_<hash>` in jsdom). Asserting on the prefix keeps
    // the test resilient to hash changes while still proving the body
    // owns its scroll-container styling — the class is the surface
    // that carries `overflow-y: auto` in EditorShell.module.css.
    const bodyClass = body.getAttribute("class") ?? "";
    expect(bodyClass).toMatch(/body/);
  });

  it("footer carries the sticky-bottom layout class", () => {
    render(
      <EditorShell testId="shell">
        <EditorShell.Body>
          <p>Body</p>
        </EditorShell.Body>
        <EditorShell.Footer>
          <button type="button">Cancel</button>
          <button type="button">Save changes</button>
        </EditorShell.Footer>
      </EditorShell>,
    );

    const footer = screen.getByTestId("shell-footer");
    const footerClass = footer.getAttribute("class") ?? "";
    // `.footer` in EditorShell.module.css owns `flex: 0 0 auto` +
    // `border-top` — the class assertion proves the sticky-bottom
    // styling surface is wired.
    expect(footerClass).toMatch(/footer/);

    // Footer is a direct child of the shell root (sibling of body),
    // not nested inside it — required for the flex-column pin to keep
    // the footer at the bottom.
    const root = screen.getByTestId("shell");
    expect(footer.parentElement).toBe(root);
  });

  it("renders fine when the header slot is omitted", () => {
    render(
      <EditorShell testId="shell">
        <EditorShell.Body>
          <p>Body only</p>
        </EditorShell.Body>
        <EditorShell.Footer>
          <button type="button">Save</button>
        </EditorShell.Footer>
      </EditorShell>,
    );

    const root = screen.getByTestId("shell");
    const children = Array.from(root.children) as HTMLElement[];
    expect(children).toHaveLength(2);
    expect(children[0]).toHaveAttribute("data-testid", "shell-body");
    expect(children[1]).toHaveAttribute("data-testid", "shell-footer");
  });

  it("propagates root testId to slots when they omit their own", () => {
    render(
      <EditorShell testId="role-editor">
        <EditorShell.Header>
          <h2>Edit role</h2>
        </EditorShell.Header>
        <EditorShell.Body>
          <p>Form fields</p>
        </EditorShell.Body>
        <EditorShell.Footer>
          <button type="button">Save</button>
        </EditorShell.Footer>
      </EditorShell>,
    );

    expect(screen.getByTestId("role-editor-header")).toBeInTheDocument();
    expect(screen.getByTestId("role-editor-body")).toBeInTheDocument();
    expect(screen.getByTestId("role-editor-footer")).toBeInTheDocument();
  });

  it("respects an explicit slot testId over the derived one", () => {
    render(
      <EditorShell testId="shell">
        <EditorShell.Body testId="custom-body">
          <p>Body</p>
        </EditorShell.Body>
      </EditorShell>,
    );

    expect(screen.getByTestId("custom-body")).toBeInTheDocument();
    expect(screen.queryByTestId("shell-body")).not.toBeInTheDocument();
  });
});
