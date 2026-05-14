//! Skill import pipeline — git-URL fetcher.
//!
//! SKILL-V2-A. Lets the user paste a public GitHub / GitLab / gist
//! raw URL pointing at a markdown file; the fetcher pulls the body,
//! normalises blob → raw URLs along the way, and hands the text to the
//! application-layer parser.
//!
//! The fetcher lives in `infrastructure` (not `application`) because
//! it owns the HTTP transport and the URL allowlist — both
//! external-IO concerns the application layer must stay free of.

pub mod git_fetch;
