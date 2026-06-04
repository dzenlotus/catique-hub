import { LocalStorageStore, stringCodec } from "@shared/storage";

export type Theme = "dark" | "light";

const themeStore = new LocalStorageStore<string>({
  key: "catique:theme",
  codec: stringCodec,
});

export function readActiveTheme(): Theme {
  const attr = document.documentElement.dataset["theme"];
  return attr === "light" ? "light" : "dark";
}

export function applyTheme(next: Theme): void {
  document.documentElement.dataset["theme"] = next;
  themeStore.set(next);
}
