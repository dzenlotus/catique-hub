//! Infrastructure support for connected providers (round-21
//! Connected Providers refactor).
//!
//! Pre-round-21 this module backed a JSON-on-disk "registry"
//! (`~/.catique-hub/connected-clients.json`). Round-21 retires that
//! file in favour of the `connected_clients` SQL table — a row exists
//! iff the user has explicitly added the provider via the new
//! `add_provider` IPC. This module now houses the repo helpers that
//! read/write that table.

pub mod connected_clients;
