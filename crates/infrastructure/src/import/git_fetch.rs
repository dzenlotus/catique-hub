//! HTTP fetcher for skill-import git URLs (SKILL-V2-A).
//!
//! Contract:
//!
//! * URL allowlist v1: `github.com`, `gitlab.com`,
//!   `raw.githubusercontent.com`, `gist.githubusercontent.com`.
//!   Anything else surfaces [`FetchError::UnsupportedHost`].
//! * URL normalisation: GitHub `…/blob/<ref>/<path>` becomes
//!   `https://raw.githubusercontent.com/<user>/<repo>/<ref>/<path>`;
//!   GitLab blob URLs map to their `raw` shape the same way.
//! * Hard size cap: 1 MiB. The cap is enforced **twice** — once via
//!   the inbound `Content-Length` header (when present) and once
//!   during the streamed read so a server that lies about its size
//!   cannot make us spend more memory than budgeted.
//! * Timeouts: 10 s connect, 30 s overall body read. Hard-coded; auth
//!   support (private repos) is deliberately deferred to a later
//!   round.
//! * Output: full UTF-8 body. Non-UTF-8 bytes surface
//!   [`FetchError::NotUtf8`].

use std::time::Duration;

use futures_util::StreamExt;
use reqwest::redirect::Policy;
use url::Url;

/// Hard upper bound on the response body size we'll accept. The cap
/// is enforced before we hand the bytes to the parser so a hostile
/// server cannot exhaust memory.
pub const MAX_FETCH_BYTES: usize = 1024 * 1024;

/// Connect-phase timeout. Anything that can't TCP within ten seconds
/// is probably either offline or rate-limiting us.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Total request budget (connect + body). Surfaces as
/// [`FetchError::Network`] when exceeded.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// User agent string on every outbound request. Includes a stable
/// identifier so upstream operators can recognise traffic from
/// Catique HUB if they need to.
const USER_AGENT: &str = "catique-hub/skill-import (+https://github.com/dzenlotus/catique-hub)";

/// One successful fetch.
#[derive(Debug, Clone)]
pub struct FetchedSkill {
    /// Final URL we read from (post-normalisation). For GitHub blob
    /// URLs this is the `raw.githubusercontent.com` form.
    pub raw_url: String,
    /// Original URL as the user typed it. Persisted alongside the
    /// imported content for traceability.
    pub source_url: String,
    /// Decoded UTF-8 body.
    pub content: String,
    /// Byte length of `content` (UTF-8 bytes).
    pub byte_size: usize,
}

/// Things that can go wrong on the fetch path. The use case maps
/// every variant onto an [`crate::db::pool::DbError`]-free
/// `AppError::Validation` or `AppError::Conflict` so the IPC
/// contract does not grow a new variant.
#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    /// URL did not parse, or carried no host segment.
    #[error("invalid url: {0}")]
    InvalidUrl(String),

    /// Host is not in the v1 allowlist.
    #[error("host not in allowlist: {0}")]
    UnsupportedHost(String),

    /// Upstream replied with a non-2xx status code. The numeric code
    /// is surfaced so the caller can disambiguate `401` (private repo
    /// — auth deferred) from `404` (typo).
    #[error("http status {0}")]
    HttpStatus(u16),

    /// Response would exceed the size cap. Reports the announced
    /// length (or zero for a chunked transfer where the streamed
    /// read tripped the cap) and the cap.
    #[error("payload too large: {0} bytes > {1} byte cap")]
    TooLarge(usize, usize),

    /// Anything else the transport layer raised (DNS failure,
    /// TLS error, timeout, mid-stream socket close, …).
    #[error("network error: {0}")]
    Network(String),

    /// Response body was not valid UTF-8. The parser only handles
    /// markdown; binary blobs are surfaced as a typed error rather
    /// than mangled through `from_utf8_lossy`.
    #[error("response body is not valid utf-8")]
    NotUtf8,
}

/// Fetch the resource at `url`, returning the decoded body.
///
/// # Errors
///
/// See [`FetchError`].
pub async fn fetch_text(url: &str) -> Result<FetchedSkill, FetchError> {
    let parsed = Url::parse(url).map_err(|e| FetchError::InvalidUrl(e.to_string()))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| FetchError::InvalidUrl("missing host".into()))?
        .to_ascii_lowercase();
    if !ALLOWLIST.contains(&host.as_str()) {
        return Err(FetchError::UnsupportedHost(host));
    }

    let normalised = normalise_url(&parsed);
    let target = normalised.to_string();

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        // Allow GitHub's transparent `blob` → `raw` redirect chain
        // (capped to keep a malicious chain from looping forever).
        .redirect(Policy::limited(5))
        .build()
        .map_err(|e| FetchError::Network(format!("client build: {e}")))?;

    let response = client
        .get(&target)
        .send()
        .await
        .map_err(|e| FetchError::Network(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        return Err(FetchError::HttpStatus(status.as_u16()));
    }

    // Header-based cap — preempts the streaming read for hosts that
    // surface `Content-Length` honestly.
    if let Some(declared) = response.content_length() {
        let as_usize: usize = usize::try_from(declared).unwrap_or(usize::MAX);
        if as_usize > MAX_FETCH_BYTES {
            return Err(FetchError::TooLarge(as_usize, MAX_FETCH_BYTES));
        }
    }

    // Stream the body so an honest-`Content-Length` lie can't trick
    // us. `bytes_stream` yields `Result<Bytes, _>` chunks; we accumulate
    // until either EOF or the cap is reached.
    let mut stream = response.bytes_stream();
    let mut buf: Vec<u8> = Vec::with_capacity(8 * 1024);
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| FetchError::Network(e.to_string()))?;
        if buf.len() + bytes.len() > MAX_FETCH_BYTES {
            return Err(FetchError::TooLarge(
                buf.len() + bytes.len(),
                MAX_FETCH_BYTES,
            ));
        }
        buf.extend_from_slice(&bytes);
    }

    let content = String::from_utf8(buf).map_err(|_| FetchError::NotUtf8)?;
    let byte_size = content.len();

    Ok(FetchedSkill {
        raw_url: target,
        source_url: url.to_owned(),
        content,
        byte_size,
    })
}

/// Host allowlist (post-normalisation). All entries lowercase.
const ALLOWLIST: &[&str] = &[
    "github.com",
    "gitlab.com",
    "raw.githubusercontent.com",
    "gist.githubusercontent.com",
];

/// Map GitHub / GitLab `blob` URLs onto their `raw` equivalents.
/// Other URLs are returned unchanged.
fn normalise_url(parsed: &Url) -> Url {
    match parsed.host_str().map(str::to_ascii_lowercase).as_deref() {
        Some("github.com") => normalise_github(parsed).unwrap_or_else(|| parsed.clone()),
        Some("gitlab.com") => normalise_gitlab(parsed).unwrap_or_else(|| parsed.clone()),
        _ => parsed.clone(),
    }
}

/// Map `github.com/<u>/<r>/blob/<ref>/<path>` →
/// `raw.githubusercontent.com/<u>/<r>/<ref>/<path>`.
fn normalise_github(parsed: &Url) -> Option<Url> {
    let segments: Vec<&str> = parsed.path_segments()?.collect();
    if segments.len() < 5 {
        return None;
    }
    let (user, repo, marker) = (segments[0], segments[1], segments[2]);
    if marker != "blob" {
        return None;
    }
    let ref_name = segments[3];
    let rest = &segments[4..];
    let path = rest.join("/");
    Url::parse(&format!(
        "https://raw.githubusercontent.com/{user}/{repo}/{ref_name}/{path}"
    ))
    .ok()
}

/// Map `gitlab.com/<u>/<r>/-/blob/<ref>/<path>` →
/// `gitlab.com/<u>/<r>/-/raw/<ref>/<path>`.
///
/// GitLab keeps the raw bytes on the same host (no equivalent of
/// `raw.githubusercontent.com`), so the rewrite only flips the
/// `blob` segment to `raw`.
fn normalise_gitlab(parsed: &Url) -> Option<Url> {
    let segments: Vec<&str> = parsed.path_segments()?.collect();
    let blob_idx = segments.iter().position(|s| *s == "blob")?;
    // The GitLab convention is `<user>/<repo>/-/blob/…`; require the
    // `-` separator one segment back so we don't rewrite anything
    // that just happens to have a `blob` segment in its path.
    if blob_idx == 0 || segments[blob_idx - 1] != "-" {
        return None;
    }
    let mut rewritten = segments.clone();
    rewritten[blob_idx] = "raw";
    let new_path = format!("/{}", rewritten.join("/"));
    let mut url = parsed.clone();
    url.set_path(&new_path);
    Some(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn normalises_github_blob_to_raw() {
        let parsed = Url::parse("https://github.com/user/repo/blob/main/scripts/run.sh").unwrap();
        let out = normalise_url(&parsed);
        assert_eq!(
            out.as_str(),
            "https://raw.githubusercontent.com/user/repo/main/scripts/run.sh",
        );
    }

    #[test]
    fn normalises_github_blob_with_nested_path() {
        // Standard branch name (`main`) + nested path. Branch names
        // with embedded slashes (`feature/x`) are NOT disambiguated by
        // the URL alone — GitHub uses an out-of-band lookup the
        // fetcher cannot replicate without an API call; the rewrite
        // treats the first segment after `blob` as the ref and the
        // rest as the path.
        let parsed = Url::parse("https://github.com/u/r/blob/main/docs/a/b/c.md").unwrap();
        let out = normalise_url(&parsed);
        assert_eq!(
            out.as_str(),
            "https://raw.githubusercontent.com/u/r/main/docs/a/b/c.md",
        );
    }

    #[test]
    fn normalises_gitlab_blob_to_raw() {
        let parsed = Url::parse("https://gitlab.com/group/proj/-/blob/main/README.md").unwrap();
        let out = normalise_url(&parsed);
        assert_eq!(
            out.as_str(),
            "https://gitlab.com/group/proj/-/raw/main/README.md",
        );
    }

    #[test]
    fn leaves_raw_github_unchanged() {
        let parsed = Url::parse("https://raw.githubusercontent.com/user/repo/main/a.md").unwrap();
        let out = normalise_url(&parsed);
        assert_eq!(out.as_str(), parsed.as_str());
    }

    #[tokio::test]
    async fn rejects_unsupported_host() {
        let err = fetch_text("https://example.com/r.md")
            .await
            .expect_err("must reject");
        match err {
            FetchError::UnsupportedHost(h) => assert_eq!(h, "example.com"),
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn rejects_invalid_url() {
        let err = fetch_text("not a url").await.expect_err("must reject");
        match err {
            FetchError::InvalidUrl(_) => {}
            other => panic!("got {other:?}"),
        }
    }

    /// Exercise the allowlist + fetch path against a mock server. We
    /// can't point the URL at the real GitHub from a unit test, so the
    /// mock server is bound to `127.0.0.1`; the allowlist check is
    /// covered by the previous tests. Here we hit the host directly
    /// via the `raw.githubusercontent.com` allowlist entry and a
    /// per-call client; that's why the public surface stays the
    /// same — see the integration plan in the SKILL-V2-A brief.
    ///
    /// Internally we use a thin wrapper that bypasses the host
    /// check so a bound-to-localhost mock can exercise the streaming
    /// + size-cap code path.
    #[tokio::test]
    async fn fetch_against_mock_returns_body() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/a.md"))
            .respond_with(ResponseTemplate::new(200).set_body_string("hello world"))
            .mount(&server)
            .await;

        let body = fetch_text_for_test(&format!("{}/a.md", server.uri()))
            .await
            .expect("ok");
        assert_eq!(body.content, "hello world");
        assert_eq!(body.byte_size, "hello world".len());
    }

    #[tokio::test]
    async fn fetch_against_mock_404_returns_http_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/missing.md"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let err = fetch_text_for_test(&format!("{}/missing.md", server.uri()))
            .await
            .expect_err("must surface 404");
        match err {
            FetchError::HttpStatus(404) => {}
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_against_mock_oversize_streamed_body_caps() {
        // Build a body that is larger than the cap. We deliberately do
        // NOT set Content-Length so the header-cap path is bypassed
        // and the streaming-cap path is the one we test.
        let too_big: String = "a".repeat(MAX_FETCH_BYTES + 16);
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/big"))
            .respond_with(ResponseTemplate::new(200).set_body_string(too_big.clone()))
            .mount(&server)
            .await;

        let err = fetch_text_for_test(&format!("{}/big", server.uri()))
            .await
            .expect_err("must trip cap");
        match err {
            FetchError::TooLarge(got, cap) => {
                assert!(got > cap, "got={got} cap={cap}");
                assert_eq!(cap, MAX_FETCH_BYTES);
            }
            other => panic!("got {other:?}"),
        }
    }

    /// Internal helper that mirrors `fetch_text` but skips the host
    /// allowlist so a bound-to-localhost mock server can exercise the
    /// streaming + cap code path. The production `fetch_text` always
    /// enforces the allowlist; the bypass is gated behind `#[cfg(test)]`.
    async fn fetch_text_for_test(url: &str) -> Result<FetchedSkill, FetchError> {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .redirect(Policy::limited(5))
            .build()
            .map_err(|e| FetchError::Network(format!("client build: {e}")))?;

        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| FetchError::Network(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            return Err(FetchError::HttpStatus(status.as_u16()));
        }

        if let Some(declared) = response.content_length() {
            let as_usize: usize = usize::try_from(declared).unwrap_or(usize::MAX);
            if as_usize > MAX_FETCH_BYTES {
                return Err(FetchError::TooLarge(as_usize, MAX_FETCH_BYTES));
            }
        }

        let mut stream = response.bytes_stream();
        let mut buf: Vec<u8> = Vec::with_capacity(8 * 1024);
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| FetchError::Network(e.to_string()))?;
            if buf.len() + bytes.len() > MAX_FETCH_BYTES {
                return Err(FetchError::TooLarge(
                    buf.len() + bytes.len(),
                    MAX_FETCH_BYTES,
                ));
            }
            buf.extend_from_slice(&bytes);
        }
        let content = String::from_utf8(buf).map_err(|_| FetchError::NotUtf8)?;
        let byte_size = content.len();
        Ok(FetchedSkill {
            raw_url: url.to_owned(),
            source_url: url.to_owned(),
            content,
            byte_size,
        })
    }
}
