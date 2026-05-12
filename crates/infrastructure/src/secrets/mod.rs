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
//! * `KeychainResolver` — reads the OS keychain. **Stub at PROXY-S3
//!   round 1**: returns [`SecretError::NotImplemented`] until the
//!   plugin choice is locked in (`tauri-plugin-keychain` vs
//!   `keyring-rs` direct — see PROXY-S3 task ctq-130).
//!
//! ## Errors
//!
//! Error messages must NEVER include the resolved secret value or
//! any user-supplied content that could leak into log lines. Codes
//! are deliberately short, structured tokens:
//!
//! * `NotFound` — reference points at an entry that does not exist.
//! * `NotImplemented` — backend is the keychain stub.
//! * `MalformedRef` — `auth_json` was not a recognised shape.

use serde::Deserialize;

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
/// values — they end up in log lines and `mcp_call_log.error`.
#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("secret reference points at a missing entry")]
    NotFound,
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
        AuthRef::Keychain { key: _ } => Err(SecretError::NotImplemented(
            "keychain backend lands in PROXY-S3 round 2 — see ctq-130",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_keychain_ref_round_trip() {
        let parsed = AuthRef::parse(Some(
            r#"{"type":"keychain","key":"catique.mcp.abc"}"#,
        ))
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
    fn resolve_keychain_returns_not_implemented_until_round_2() {
        let err = resolve(&AuthRef::Keychain {
            key: "catique.mcp.abc".into(),
        })
        .expect_err("ni");
        assert!(matches!(err, SecretError::NotImplemented(_)));
    }
}
