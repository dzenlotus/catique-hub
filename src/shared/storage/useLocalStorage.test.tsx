import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";

import { useLocalStorage } from "./useLocalStorage";
import { booleanCodec, stringCodec } from "./codecs";

beforeEach(() => {
  window.localStorage.clear();
});

function StringProbe({
  storageKey,
  defaultValue,
}: {
  storageKey: string;
  defaultValue: string;
}): ReactElement {
  const [value, setValue, remove] = useLocalStorage(
    storageKey,
    stringCodec,
    defaultValue,
  );
  return (
    <div>
      <span data-testid="value">{value}</span>
      <button type="button" onClick={() => setValue("written")}>
        write
      </button>
      <button
        type="button"
        onClick={() => setValue((prev) => `${prev}+`)}
      >
        append
      </button>
      <button type="button" onClick={remove}>
        remove
      </button>
    </div>
  );
}

function BooleanProbe({
  storageKey,
  defaultValue,
}: {
  storageKey: string;
  defaultValue: boolean;
}): ReactElement {
  const [value, setValue] = useLocalStorage(storageKey, booleanCodec, defaultValue);
  return (
    <div>
      <span data-testid="value">{String(value)}</span>
      <button type="button" onClick={() => setValue((prev) => !prev)}>
        toggle
      </button>
    </div>
  );
}

describe("useLocalStorage", () => {
  it("returns the defaultValue when nothing is stored", () => {
    render(<StringProbe storageKey="hook:default" defaultValue="fallback" />);
    expect(screen.getByTestId("value").textContent).toBe("fallback");
  });

  it("returns the stored value when present", () => {
    window.localStorage.setItem("hook:present", "stored");
    render(<StringProbe storageKey="hook:present" defaultValue="fallback" />);
    expect(screen.getByTestId("value").textContent).toBe("stored");
  });

  it("setValue with a value writes through and re-renders", async () => {
    const user = userEvent.setup();
    render(<StringProbe storageKey="hook:write" defaultValue="initial" />);
    await user.click(screen.getByText("write"));
    expect(screen.getByTestId("value").textContent).toBe("written");
    expect(window.localStorage.getItem("hook:write")).toBe("written");
  });

  it("setValue with an updater receives the previous value", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("hook:update", "seed");
    render(<StringProbe storageKey="hook:update" defaultValue="x" />);
    await user.click(screen.getByText("append"));
    expect(screen.getByTestId("value").textContent).toBe("seed+");
  });

  it("setValue updater uses the defaultValue when storage is empty", async () => {
    const user = userEvent.setup();
    render(<StringProbe storageKey="hook:update-empty" defaultValue="seed" />);
    await user.click(screen.getByText("append"));
    expect(screen.getByTestId("value").textContent).toBe("seed+");
  });

  it("remove clears storage and falls back to defaultValue", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("hook:remove", "stored");
    render(<StringProbe storageKey="hook:remove" defaultValue="fallback" />);
    expect(screen.getByTestId("value").textContent).toBe("stored");
    await user.click(screen.getByText("remove"));
    expect(screen.getByTestId("value").textContent).toBe("fallback");
    expect(window.localStorage.getItem("hook:remove")).toBeNull();
  });

  it("persists across remount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <StringProbe storageKey="hook:remount" defaultValue="x" />,
    );
    await user.click(screen.getByText("write"));
    expect(screen.getByTestId("value").textContent).toBe("written");
    unmount();

    render(<StringProbe storageKey="hook:remount" defaultValue="x" />);
    expect(screen.getByTestId("value").textContent).toBe("written");
  });

  it("toggles a boolean via updater fn", async () => {
    const user = userEvent.setup();
    render(<BooleanProbe storageKey="hook:bool" defaultValue={false} />);
    expect(screen.getByTestId("value").textContent).toBe("false");
    await user.click(screen.getByText("toggle"));
    expect(screen.getByTestId("value").textContent).toBe("true");
    await user.click(screen.getByText("toggle"));
    expect(screen.getByTestId("value").textContent).toBe("false");
  });

  it("re-renders on a cross-tab storage event for the same key", () => {
    render(<StringProbe storageKey="hook:cross-tab" defaultValue="default" />);
    expect(screen.getByTestId("value").textContent).toBe("default");

    act(() => {
      window.localStorage.setItem("hook:cross-tab", "from-other-tab");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "hook:cross-tab",
          newValue: "from-other-tab",
          oldValue: null,
          storageArea: window.localStorage,
        }),
      );
    });

    expect(screen.getByTestId("value").textContent).toBe("from-other-tab");
  });

  it("re-subscribes cleanly when the key changes mid-life", async () => {
    function KeySwap(): ReactElement {
      const [k, setK] = useState("hook:swap-a");
      const [value, setValue] = useLocalStorage(k, stringCodec, "init");
      return (
        <div>
          <span data-testid="key">{k}</span>
          <span data-testid="value">{value}</span>
          <button type="button" onClick={() => setK("hook:swap-b")}>
            swap
          </button>
          <button type="button" onClick={() => setValue("local-write")}>
            write
          </button>
        </div>
      );
    }

    const user = userEvent.setup();
    window.localStorage.setItem("hook:swap-a", "value-a");
    window.localStorage.setItem("hook:swap-b", "value-b");

    render(<KeySwap />);
    expect(screen.getByTestId("value").textContent).toBe("value-a");

    await user.click(screen.getByText("swap"));
    expect(screen.getByTestId("key").textContent).toBe("hook:swap-b");
    expect(screen.getByTestId("value").textContent).toBe("value-b");

    // Writing now should target the second key, not leak back to the first.
    await user.click(screen.getByText("write"));
    expect(window.localStorage.getItem("hook:swap-a")).toBe("value-a");
    expect(window.localStorage.getItem("hook:swap-b")).toBe("local-write");
  });
});
