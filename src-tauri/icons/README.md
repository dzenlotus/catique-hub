# Icons (placeholder)

These are 1×1 transparent placeholder icons committed only so that
`tauri build` doesn't error on missing files during the E1.1 scaffold.

`.icns` and `.ico` are empty zero-byte files — `tauri build` **will** fail
on those until they are replaced.

**TODO (E1.2 / Olga or design pass):**

- Source 1024×1024 master `icon.png` (Catique HUB logo).
- Run `pnpm tauri icon path/to/icon.png` to regenerate the full set.
- Delete this README once real icons land.
