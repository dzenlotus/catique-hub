/**
 * Per-install app-shell preferences — sidebar collapse and "last active
 * space" pointer. Lives in localStorage in Phase 1; migrates to D-F's
 * `kv_settings` table when the backend ships.
 */
import { booleanCodec, stringCodec } from "./codecs";
import { LocalStorageStore } from "./LocalStorageStore";

const COLLAPSED_KEY = "catique:sidebarCollapsed";
const LAST_ACTIVE_SPACE_KEY = "catique:lastActiveSpaceId";

const collapsedStore = new LocalStorageStore<boolean>({
  key: COLLAPSED_KEY,
  codec: booleanCodec,
});

const lastSpaceStore = new LocalStorageStore<string>({
  key: LAST_ACTIVE_SPACE_KEY,
  codec: stringCodec,
});

export function readSidebarCollapsed(): boolean {
  return collapsedStore.get() ?? false;
}

export function writeSidebarCollapsed(next: boolean): void {
  collapsedStore.set(next);
}

export function subscribeSidebarCollapsed(listener: () => void): () => void {
  return collapsedStore.subscribe(listener);
}

export function readLastActiveSpaceId(): string | null {
  return lastSpaceStore.get();
}

export function writeLastActiveSpaceId(id: string | null): void {
  if (id === null || id === "") {
    lastSpaceStore.set("");
    return;
  }
  lastSpaceStore.set(id);
}
