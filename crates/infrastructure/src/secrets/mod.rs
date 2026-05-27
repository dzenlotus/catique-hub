//! Secret-resolver abstraction for upstream MCP-server credentials.
//!
//! ADR-0008 / ctq-130 / PROXY-S3. Catique HUB owns the secret store
//! lifecycle: the user pastes a raw token in the Create-MCP-Server
//! modal; HUB writes it to the OS keychain under
//! `catique.mcp.{server_id}` and persists only the reference in
//! `mcp_servers.auth_json`.
//!
//! At call time, the proxy use-case asks this module to resolve the
//! reference back into a usable secret string. The result is passed to
//! the Node-side outbound MCP client (lazily, once per call — never
//! cached in Node memory). The Rust side does not cache resolved
//! secrets either; we trust the OS keychain to amortise the cost.
//!
//! ## Backends
//!
//! * `EnvResolver` — reads `std::env::var(key)`. The escape hatch
//!   for users who insist on managing the secret outside the OS
//!   keychain (CI hosts, dev environments).
//! * `KeychainResolver` — reads the OS keychain via the `keyring`
//!   crate (PROXY-S3 round 2). Per-target feature flags in
//!   `crates/infrastructure/Cargo.toml` select the native backend:
//!   macOS Keychain, Windows Credential Manager, or Linux Secret
//!   Service over dbus. The `keyring` crate is plain Rust with no
//!   Tauri-plugin lifecycle; it does not need an app handle.
//!
//! ## Service / key shape
//!
//! Every entry is stored under the service name [`KEYCHAIN_SERVICE`]
//! (`"catique-hub"`). Per-server keys live under the namespace
//! `catique.mcp.{server_id}` ([`KEYCHAIN_KEY_NAMESPACE`]). The
//! application layer (`crates/application/src/mcp_servers.rs`) owns
//! the authoritative formatter [`keychain_key_for`]; we duplicate the
//! constant here (rather than depend on `catique-application`) to
//! avoid the cyclic dep — application already depends on
//! infrastructure.
//!
//! ## Errors
//!
//! Error messages must NEVER include the resolved secret value or
//! the keychain key (the key carries the `server_id`, which is not a
//! secret per se but is still caller-controlled and ends up in log
//! lines / `mcp_call_log.error`). Codes are deliberately short,
//! structured tokens:
//!
//! * `NotFound` — reference points at an entry that does not exist.
//! * `Backend` — underlying keychain backend failed for a reason
//!   other than a missing entry; the payload is a `&'static str` so
//!   no caller-controlled bytes can leak.
//! * `NotImplemented` — reserved for future backend stubs; unused
//!   after round 2 but kept for ABI stability with the
//!   `mcp_bridge` match arms.
//! * `MalformedRef` — `auth_json` was not a recognised shape.

use serde::Deserialize;

/// Service name under which every Catique HUB secret is stored in the
/// OS keychain. macOS Keychain calls this the "service", Windows
/// Credential Manager the "target", Secret Service the "schema".
///
/// Debug builds use the `-dev` suffix so a developer running
/// `pnpm tauri:dev` does not read or overwrite secrets owned by the
/// installed production `Catique HUB.app`. The two processes get
/// disjoint keychain buckets.
pub const KEYCHAIN_SERVICE: &str = if cfg!(debug_assertions) {
    "catique-hub-dev"
} else {
    "catique-hub"
};

/// Namespace prefix for per-MCP-server keychain keys. Must stay in
/// lockstep with `catique_application::mcp_servers::keychain_key_for`.
/// The validator there rejects any `auth_json` whose keychain `key`
/// does not start with this prefix and match the row's own `server_id`.
pub const KEYCHAIN_KEY_NAMESPACE: &str = "catique.mcp.";

/// Build the canonical keychain key for a given MCP server id. Mirror
/// of `catique_application::mcp_servers::keychain_key_for`; kept here
/// to avoid the cyclic dep (application already depends on
/// infrastructure). The application-layer validator is the single
/// source of truth for write-time enforcement — this helper exists so
/// callers inside infrastructure / use-cases that already hold a
/// `server_id` can compute the key without round-tripping through the
/// JSON auth-ref.
#[must_use]
pub fn keychain_key_for(server_id: &str) -> String {
    format!("{KEYCHAIN_KEY_NAMESPACE}{server_id}")
}

/// Authentication reference, parsed from `mcp_servers.auth_json`. The
/// JSON-side shape constraint (`{type, key}` with `type` in
/// `{keychain, env}`) is enforced in `crates/application/src/mcp_servers
/// .rs::validate_auth_ref`; this enum is the post-validation view.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum AuthRef {
    Keychain { key: String },
    Env { key: String },
}

impl AuthRef {
    /// Parse a stored `auth_json` string. Returns `None` for the empty
    /// (unauthenticated) server.
    ///
    /// # Errors
    ///
    /// `SecretError::MalformedRef` if the JSON does not match the
    /// expected shape. The application-layer validator should have
    /// caught this before persistence — this is the defensive
    /// read-time guard.
    pub fn parse(auth_json: Option<&str>) -> Result<Option<Self>, SecretError> {
        match auth_json {
            None => Ok(None),
            Some(s) => serde_json::from_str(s)
                .map(Some)
                .map_err(|e| SecretError::MalformedRef(e.to_string())),
        }
    }
}

/// Resolver error. Strings inside variants must be free of secret
/// values AND caller-controlled bytes — they end up in log lines and
/// `mcp_call_log.error`. The `Backend` variant deliberately carries a
/// `&'static str` so a future maintainer cannot accidentally forward
/// the underlying `keyring::Error` (which may reference the key /
/// server id) into the message.
#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("secret reference points at a missing entry")]
    NotFound,
    #[error("secret backend failure ({0})")]
    Backend(&'static str),
    #[error("backend not implemented yet ({0})")]
    NotImplemented(&'static str),
    #[error("malformed auth_json: {0}")]
    MalformedRef(String),
}

/// Resolve an [`AuthRef`] to the underlying secret string.
///
/// The dispatch is intentionally a free function: a per-process
/// resolver type would buy nothing — each call hits the OS keychain
/// or env directly, no shared state.
///
/// # Errors
///
/// See [`SecretError`].
pub fn resolve(auth_ref: &AuthRef) -> Result<String, SecretError> {
    match auth_ref {
        AuthRef::Env { key } => std::env::var(key).map_err(|_| SecretError::NotFound),
        AuthRef::Keychain { key } => keychain_get(key),
    }
}

/// Persist `value` under the canonical keychain entry for
/// `server_id`. Overwrites any existing entry — the caller (the MCP
/// servers use case) is expected to have already validated that the
/// row owns this slot, so this is a deliberate upsert.
///
/// The Node side reaches this via a future bridge dispatch arm — wired
/// in a separate commit (PROXY-S2 round 2 follow-up). For now the
/// function is consumed only by tests and by the Rust-side IPC handler
/// that will land alongside the bridge arm.
///
/// # Errors
///
/// * `SecretError::Backend` if the OS keychain rejects the write
///   (locked store, denied access, attribute too long, etc.).
pub fn store_secret(server_id: &str, value: &str) -> Result<(), SecretError> {
    let key = keychain_key_for(server_id);
    keychain_set(&key, value)
}

/// Delete the keychain entry for `server_id`. Returns `Ok(())` even
/// if no entry existed — the caller's intent (server gone) is
/// satisfied either way. Any other backend failure is surfaced as
/// `SecretError::Backend` so the use-case can decide whether to
/// abort the delete.
///
/// # Errors
///
/// See [`SecretError::Backend`].
pub fn delete_secret(server_id: &str) -> Result<(), SecretError> {
    let key = keychain_key_for(server_id);
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &key).map_err(map_keyring_err)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(map_keyring_err(e)),
    }
}

/// Inner keychain read. Split out so [`resolve`] stays a thin match.
fn keychain_get(key: &str) -> Result<String, SecretError> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(map_keyring_err)?;
    match entry.get_password() {
        Ok(s) => Ok(s),
        Err(keyring::Error::NoEntry) => Err(SecretError::NotFound),
        Err(e) => Err(map_keyring_err(e)),
    }
}

/// Inner keychain write.
fn keychain_set(key: &str, value: &str) -> Result<(), SecretError> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(map_keyring_err)?;
    entry.set_password(value).map_err(map_keyring_err)
}

/// Map a `keyring::Error` to a `SecretError` payload that carries no
/// caller-controlled bytes. The original error is intentionally
/// dropped — `keyring::Error::Display` may reference the key (which
/// embeds the `server_id`) or the underlying platform error message,
/// neither of which is safe to forward into our log lines.
///
/// Takes the error by value (vs `&keyring::Error`) so call sites can
/// pass it directly to `.map_err(map_keyring_err)` as a function
/// pointer — a reference signature would force a closure at every
/// call site for no real cost saving.
#[allow(clippy::needless_pass_by_value)]
fn map_keyring_err(e: keyring::Error) -> SecretError {
    match e {
        keyring::Error::NoEntry => SecretError::NotFound,
        keyring::Error::NoStorageAccess(_) => SecretError::Backend("storage_access_denied"),
        keyring::Error::PlatformFailure(_) => SecretError::Backend("platform_failure"),
        keyring::Error::BadEncoding(_) => SecretError::Backend("bad_encoding"),
        keyring::Error::TooLong(_, _) => SecretError::Backend("attribute_too_long"),
        keyring::Error::Invalid(_, _) => SecretError::Backend("invalid_attribute"),
        keyring::Error::Ambiguous(_) => SecretError::Backend("ambiguous_entry"),
        // `keyring::Error` is `#[non_exhaustive]`; future variants land
        // here under a stable bucket so this `match` keeps compiling
        // across minor `keyring` releases.
        _ => SecretError::Backend("unknown"),
    }
}

#[cfg(test)]
mod tests {
    //! ## Keychain test gating
    //!
    //! The `keychain_*` tests hit the real OS keychain. On macOS and
    //! Windows the user's default credential store is always available
    //! (macOS does prompt on first access for non-default keychains,
    //! but the login keychain — which `keyring::Entry::new` targets —
    //! is already unlocked for the running user session). On Linux the
    //! `sync-secret-service` backend requires a running Secret Service
    //! daemon (gnome-keyring-daemon, kwalletd5, or similar) reachable
    //! via dbus; headless CI runners typically have neither, and the
    //! call would fail with `NoStorageAccess`. We gate the keychain
    //! tests with `#[cfg(not(target_os = "linux"))]` rather than
    //! `#[ignore]` so they run by default on dev machines that DO have
    //! a working backend, and silently skip on the headless Linux CI
    //! where they would always fail. Maintainers running a desktop
    //! Linux can drop the gate locally — the tests will pass.

    use super::*;

    #[test]
    fn parse_keychain_ref_round_trip() {
        let parsed = AuthRef::parse(Some(r#"{"type":"keychain","key":"catique.mcp.abc"}"#))
            .unwrap()
            .unwrap();
        assert_eq!(
            parsed,
            AuthRef::Keychain {
                key: "catique.mcp.abc".into()
            }
        );
    }

    #[test]
    fn parse_env_ref_round_trip() {
        let parsed = AuthRef::parse(Some(r#"{"type":"env","key":"GITHUB_TOKEN"}"#))
            .unwrap()
            .unwrap();
        assert_eq!(
            parsed,
            AuthRef::Env {
                key: "GITHUB_TOKEN".into()
            }
        );
    }

    #[test]
    fn parse_none_returns_none() {
        assert_eq!(AuthRef::parse(None).unwrap(), None);
    }

    #[test]
    fn parse_malformed_surfaces_error() {
        let err = AuthRef::parse(Some(r#"{"raw_token":"abc"}"#)).expect_err("ml");
        assert!(matches!(err, SecretError::MalformedRef(_)));
    }

    #[test]
    fn resolve_env_returns_set_value() {
        // SAFETY: tests run single-threaded inside a process; modifying
        // env is local to this test. Use a high-entropy key so a
        // parallel test runner does not collide.
        let key = "CATIQUE_SECRET_TEST_KEY_PROXY_S3";
        std::env::set_var(key, "the-token");
        let resolved = resolve(&AuthRef::Env { key: key.into() }).unwrap();
        assert_eq!(resolved, "the-token");
        std::env::remove_var(key);
    }

    #[test]
    fn resolve_env_missing_returns_not_found() {
        let err = resolve(&AuthRef::Env {
            key: "CATIQUE_DEFINITELY_NOT_SET_PROXY_S3".into(),
        })
        .expect_err("nf");
        assert!(matches!(err, SecretError::NotFound));
    }

    #[test]
    fn keychain_key_for_uses_canonical_namespace() {
        assert_eq!(keychain_key_for("abc"), "catique.mcp.abc");
        assert!(keychain_key_for("xyz").starts_with(KEYCHAIN_KEY_NAMESPACE));
    }

    /// Drop-guard that wipes the keychain entry once the test exits.
    /// Holding this on the stack means even a panicking assert leaves
    /// the OS keychain clean — important because the macOS login
    /// keychain persists across `cargo test` invocations.
    #[cfg(not(target_os = "linux"))]
    struct KeychainCleanup<'a> {
        server_id: &'a str,
    }

    #[cfg(not(target_os = "linux"))]
    impl Drop for KeychainCleanup<'_> {
        fn drop(&mut self) {
            // Best-effort: ignore the error. The test has already
            // recorded its outcome; we just don't want to leave
            // entropy-suffixed entries littering the user's keychain.
            let _ = delete_secret(self.server_id);
        }
    }

    /// High-entropy id so parallel `cargo test` runs across crates or
    /// machines do not collide on the shared OS keychain.
    #[cfg(not(target_os = "linux"))]
    fn unique_server_id(tag: &str) -> String {
        // nanoid is already a workspace dep — reusing it keeps the
        // test-only entropy source consistent with production id
        // generation.
        format!("test-{tag}-{}", nanoid::nanoid!(12))
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn keychain_round_trip_writes_and_reads() {
        let server_id = unique_server_id("rt");
        let _cleanup = KeychainCleanup {
            server_id: &server_id,
        };

        store_secret(&server_id, "the-token").expect("store_secret should succeed");

        let resolved = resolve(&AuthRef::Keychain {
            key: keychain_key_for(&server_id),
        })
        .expect("resolve should find the entry just written");
        assert_eq!(resolved, "the-token");
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn keychain_missing_key_returns_not_found() {
        // Generate a fresh id but DO NOT store anything — the keychain
        // must not have an entry under this key. Cleanup is still
        // wired in case a previous failed run left a stray entry.
        let server_id = unique_server_id("missing");
        let _cleanup = KeychainCleanup {
            server_id: &server_id,
        };

        let err = resolve(&AuthRef::Keychain {
            key: keychain_key_for(&server_id),
        })
        .expect_err("missing entry should surface NotFound");
        assert!(matches!(err, SecretError::NotFound));
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn keychain_overwrite_updates_value() {
        // Documents the upsert semantics of `store_secret`. A second
        // write under the same id replaces the first value — Node-side
        // refresh flows rely on this.
        let server_id = unique_server_id("overwrite");
        let _cleanup = KeychainCleanup {
            server_id: &server_id,
        };

        store_secret(&server_id, "old-token").unwrap();
        store_secret(&server_id, "new-token").unwrap();

        let resolved = resolve(&AuthRef::Keychain {
            key: keychain_key_for(&server_id),
        })
        .unwrap();
        assert_eq!(resolved, "new-token");
    }
}
