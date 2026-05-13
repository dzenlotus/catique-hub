/**
 * Storybook — SelectTag.
 *
 * Every story wraps the component in a small `useState` harness so the
 * controlled-component contract is honored (parent owns `values`). The
 * `onCreate` and `splitOnPaste` stories optimistically append the new
 * id locally — production parents typically fire a mutation, then await
 * the server's resolved id before pushing it into `values`.
 */

import { useState, type ReactElement } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { SelectTag, type SelectTagOption } from "./SelectTag";

const STACK_OPTIONS: SelectTagOption[] = [
  { id: "react", label: "React", description: "v19" },
  { id: "vue", label: "Vue", description: "v3" },
  { id: "svelte", label: "Svelte", description: "v5" },
  { id: "solid", label: "Solid", description: "v1" },
  { id: "angular", label: "Angular", description: "v18" },
  { id: "qwik", label: "Qwik", description: "v1" },
];

const COLOURED_OPTIONS: SelectTagOption[] = [
  { id: "p1", label: "Frontend", color: "#3b9eff" },
  { id: "p2", label: "Backend", color: "#1f8e43" },
  { id: "p3", label: "QA", color: "#b87a1f" },
  { id: "p4", label: "DevOps", color: "#c23a30" },
];

interface HarnessProps {
  options?: SelectTagOption[];
  initial?: string[];
  label?: string;
  placeholder?: string;
  description?: string;
  errorMessage?: string;
  disabled?: boolean;
  readOnly?: boolean;
  isLoading?: boolean;
  isClearable?: boolean;
  maxVisibleChips?: number;
  splitOnPaste?: boolean;
  enableCreate?: boolean;
}

function Harness({
  options = STACK_OPTIONS,
  initial = [],
  label = "Stack",
  placeholder = "Search…",
  enableCreate = false,
  ...rest
}: HarnessProps): ReactElement {
  const [values, setValues] = useState<ReadonlyArray<string>>(initial);
  const [pool, setPool] = useState<SelectTagOption[]>(options);

  const handleCreate = (name: string): void => {
    const id = `created-${name.toLowerCase().replace(/\s+/g, "-")}`;
    if (pool.some((o) => o.id === id)) return;
    setPool((prev) => [...prev, { id, label: name }]);
    setValues((prev) => [...prev, id]);
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <SelectTag
        label={label}
        placeholder={placeholder}
        options={pool}
        values={values}
        onChange={setValues}
        {...(enableCreate ? { onCreate: handleCreate } : {})}
        data-testid="st-story"
        {...rest}
      />
    </div>
  );
}

const meta = {
  title: "shared/ui/SelectTag",
  component: Harness,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { initial: [] },
};

export const OneValue: Story = {
  args: { initial: ["react"] },
};

export const ManyValuesNoOverflow: Story = {
  args: { initial: ["react", "vue", "svelte", "solid"] },
};

export const ManyValuesWithOverflow: Story = {
  args: {
    initial: ["react", "vue", "svelte", "solid", "angular", "qwik"],
    maxVisibleChips: 3,
  },
};

export const Loading: Story = {
  args: { initial: ["react"], isLoading: true },
};

export const ErrorState: Story = {
  args: {
    initial: ["react", "vue"],
    errorMessage: "Pick at most one stack",
    description: "Helper text gets hidden once an error is present.",
  },
};

export const Disabled: Story = {
  args: { initial: ["react", "vue"], disabled: true, isClearable: true },
};

export const ReadOnly: Story = {
  args: { initial: ["react", "vue"], readOnly: true, isClearable: true },
};

export const WithOnCreate: Story = {
  args: {
    initial: ["react"],
    enableCreate: true,
    placeholder: "Type a new stack…",
    description:
      "Typing a name that doesn't match any option exposes a Create row.",
  },
};

export const WithSplitOnPaste: Story = {
  args: {
    initial: [],
    splitOnPaste: true,
    description: "Paste 'React, Vue, Svelte' to add three chips in one go.",
  },
};

export const ColouredSwatches: Story = {
  args: {
    options: COLOURED_OPTIONS,
    initial: ["p1", "p2"],
    label: "Squads",
    isClearable: true,
  },
};
