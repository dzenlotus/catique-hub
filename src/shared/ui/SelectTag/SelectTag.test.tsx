/**
 * SelectTag — unit tests.
 *
 * Each test sets up a controlled `<Harness>` that owns `values` so the
 * assertions can verify both the emitted `onChange` payload and the
 * subsequent DOM state. We never assert on internal state — only the
 * public contract (props in → DOM + callbacks out).
 */

import { useState, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SelectTag, type SelectTagOption } from "./SelectTag";

type Id = string;

const OPTIONS: SelectTagOption[] = [
  { id: "react", label: "React" },
  { id: "vue", label: "Vue" },
  { id: "svelte", label: "Svelte" },
  { id: "solid", label: "Solid" },
  { id: "angular", label: "Angular" },
];

interface HarnessProps {
  initial?: Id[];
  onChangeSpy?: (next: ReadonlyArray<Id>) => void;
  onCreate?: (name: string) => void;
  options?: SelectTagOption[];
  disabled?: boolean;
  readOnly?: boolean;
  isLoading?: boolean;
  isClearable?: boolean;
  errorMessage?: string;
  description?: string;
  maxVisibleChips?: number;
  splitOnPaste?: boolean;
}

function Harness({
  initial = [],
  onChangeSpy,
  onCreate,
  options = OPTIONS,
  ...rest
}: HarnessProps): ReactElement {
  const [values, setValues] = useState<ReadonlyArray<Id>>(initial);
  return (
    <SelectTag
      label="Stack"
      options={options}
      values={values}
      onChange={(next) => {
        onChangeSpy?.(next);
        setValues(next);
      }}
      {...(onCreate ? { onCreate } : {})}
      data-testid="st"
      {...rest}
    />
  );
}

describe("SelectTag", () => {
  it("renders chips for every value in `values`, in order", () => {
    render(<Harness initial={["react", "vue", "svelte"]} />);
    const chips = [
      screen.getByTestId("st-chip-react"),
      screen.getByTestId("st-chip-vue"),
      screen.getByTestId("st-chip-svelte"),
    ];
    for (const chip of chips) expect(chip).toBeInTheDocument();
    // DOM positions match selection order — query by the exact testid
    // prefix to avoid coupling to RAC's internal role assignments.
    const field = screen.getByTestId("st-field");
    const orderedTestIds = Array.from(
      field.querySelectorAll<HTMLElement>("[data-testid^='st-chip-']"),
    )
      .map((el) => el.getAttribute("data-testid") ?? "")
      .filter((id) => !id.includes("-remove-"));
    expect(orderedTestIds).toEqual([
      "st-chip-react",
      "st-chip-vue",
      "st-chip-svelte",
    ]);
  });

  it("selecting an option from the dropdown appends it via onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={["react"]} onChangeSpy={onChange} />);

    const cb = screen.getByRole("combobox", { name: "Stack" });
    await user.click(cb);
    const option = await screen.findByTestId("st-option-vue");
    await user.click(option);

    expect(onChange).toHaveBeenLastCalledWith(["react", "vue"]);
  });

  it("clicking a selected option in the dropdown toggles it off", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={["react", "vue"]} onChangeSpy={onChange} />);

    const cb = screen.getByRole("combobox", { name: "Stack" });
    await user.click(cb);
    const option = await screen.findByTestId("st-option-react");
    await user.click(option);

    expect(onChange).toHaveBeenLastCalledWith(["vue"]);
  });

  it("clicking a chip's × removes that single value, others preserved", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness
        initial={["react", "vue", "svelte"]}
        onChangeSpy={onChange}
      />,
    );

    await user.click(screen.getByTestId("st-chip-remove-vue"));

    expect(onChange).toHaveBeenLastCalledWith(["react", "svelte"]);
    expect(screen.queryByTestId("st-chip-vue")).not.toBeInTheDocument();
    expect(screen.getByTestId("st-chip-react")).toBeInTheDocument();
    expect(screen.getByTestId("st-chip-svelte")).toBeInTheDocument();
  });

  it("Backspace on empty input pops the last value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness
        initial={["react", "vue"]}
        onChangeSpy={onChange}
      />,
    );

    const input = screen.getByTestId("st-input");
    input.focus();
    await user.keyboard("{Backspace}");

    expect(onChange).toHaveBeenLastCalledWith(["react"]);
  });

  it("with onCreate + non-matching query the create row appears + fires onCreate", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCreate={onCreate} />);

    const input = screen.getByTestId("st-input");
    await user.click(input);
    await user.type(input, "Qwik");

    const createRow = await screen.findByTestId("st-create");
    expect(createRow).toHaveTextContent("Create");
    expect(createRow).toHaveTextContent("Qwik");

    await user.click(createRow);
    expect(onCreate).toHaveBeenCalledWith("Qwik");
  });

  it("without onCreate the create row does NOT appear", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByTestId("st-input");
    await user.click(input);
    await user.type(input, "Qwik");

    expect(screen.queryByTestId("st-create")).not.toBeInTheDocument();
  });

  it("`isClearable` + selected values shows clear-all; clicking resets to []", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness
        initial={["react", "vue"]}
        onChangeSpy={onChange}
        isClearable
      />,
    );

    const clear = screen.getByTestId("st-clear-all");
    expect(clear).toHaveAttribute("aria-label", "Clear all");
    await user.click(clear);

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("`disabled` hides chip-×, clear-all, input + suppresses popover", () => {
    render(
      <Harness
        initial={["react", "vue"]}
        disabled
        isClearable
      />,
    );

    expect(screen.queryByTestId("st-chip-remove-react")).not.toBeInTheDocument();
    expect(screen.queryByTestId("st-clear-all")).not.toBeInTheDocument();
    // Input is not rendered while disabled → no popover trigger surface.
    expect(screen.queryByTestId("st-input")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByTestId("st")).toHaveAttribute("data-disabled", "true");
  });

  it("`readOnly` hides chip-×, clear-all, popover; chips render normally", () => {
    render(
      <Harness
        initial={["react"]}
        readOnly
        isClearable
      />,
    );

    expect(screen.getByTestId("st-chip-react")).toBeInTheDocument();
    expect(screen.queryByTestId("st-chip-remove-react")).not.toBeInTheDocument();
    expect(screen.queryByTestId("st-clear-all")).not.toBeInTheDocument();
    expect(screen.queryByTestId("st-input")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByTestId("st")).toHaveAttribute("data-readonly", "true");
  });

  it("`errorMessage` renders the error string + invalid styling on field", () => {
    render(
      <Harness
        initial={["react"]}
        errorMessage="Pick at most 1"
        description="Helper text"
      />,
    );

    expect(screen.getByTestId("st-error")).toHaveTextContent("Pick at most 1");
    // Description suppressed in favour of error.
    expect(screen.queryByTestId("st-description")).not.toBeInTheDocument();

    const root = screen.getByTestId("st");
    expect(root).toHaveAttribute("data-invalid", "true");
  });

  it("`isLoading` shows 'Loading…' in popover; chips remain visible", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["react"]} isLoading />);

    expect(screen.getByTestId("st-chip-react")).toBeInTheDocument();

    const cb = screen.getByRole("combobox", { name: "Stack" });
    await user.click(cb);

    const loading = await screen.findByTestId("st-loading");
    expect(loading).toHaveTextContent("Loading");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("`maxVisibleChips=2` with 5 values renders 2 chips + a `+3` counter that reveals labels", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={["react", "vue", "svelte", "solid", "angular"]}
        maxVisibleChips={2}
      />,
    );

    expect(screen.getByTestId("st-chip-react")).toBeInTheDocument();
    expect(screen.getByTestId("st-chip-vue")).toBeInTheDocument();
    expect(screen.queryByTestId("st-chip-svelte")).not.toBeInTheDocument();

    const overflow = screen.getByTestId("st-overflow");
    expect(overflow).toHaveTextContent("+3");

    await user.click(overflow);
    const list = await screen.findByTestId("st-overflow-list");
    expect(within(list).getByTestId("st-overflow-item-svelte")).toHaveTextContent(
      "Svelte",
    );
    expect(within(list).getByTestId("st-overflow-item-solid")).toHaveTextContent(
      "Solid",
    );
    expect(within(list).getByTestId("st-overflow-item-angular")).toHaveTextContent(
      "Angular",
    );
  });

  it("`splitOnPaste` resolves comma-separated fragments into a single onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup({ writeToClipboard: true });
    render(<Harness onChangeSpy={onChange} splitOnPaste />);

    const input = screen.getByTestId("st-input");
    await user.click(input);
    // userEvent.paste fires a real paste event with clipboardData set,
    // exercising the component's paste-split branch end-to-end.
    await user.paste("React, Vue, Svelte");

    expect(onChange).toHaveBeenLastCalledWith(["react", "vue", "svelte"]);
  });

  it("chip × exposes aria-label='Remove <label>' and clear-all exposes 'Clear all'", () => {
    render(<Harness initial={["react"]} isClearable />);

    expect(screen.getByTestId("st-chip-remove-react")).toHaveAttribute(
      "aria-label",
      "Remove React",
    );
    expect(screen.getByTestId("st-clear-all")).toHaveAttribute(
      "aria-label",
      "Clear all",
    );
  });
});
