//! Skill-import pipeline (SKILL-V2-A).
//!
//! Two responsibilities, kept in one module so the parser tests live
//! next to the orchestrator they support:
//!
//! 1. [`parse_markdown_into_steps`] — pure function. Splits a markdown
//!    document on top-level `## ` H2 headings; everything before the
//!    first H2 becomes `overview`, each H2 block becomes one step.
//!    A nested `### Expected outcome` / `### Result` subsection inside
//!    a step body is hoisted into `expected_outcome`.
//! 2. [`SkillImportUseCase`] — orchestrates fetch → parse → persist.
//!    `import_from_url` fetches the resource, runs the parser, opens a
//!    SQLite tx, swaps the step set (when `replace_steps = true`) or
//!    appends, sets `skills.description` (overview), and records the
//!    original URL as a `kind = git` attachment for traceability.
//!
//! The fetch errors from
//! [`catique_infrastructure::import::git_fetch::FetchError`] collapse
//! into the existing `AppError` variants (`Validation`, `Conflict`,
//! `NotFound`) — adding a new IPC variant is out of scope.

use catique_domain::SkillStep;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::{
        skill_attachments::{self as att_repo, GitAttachmentDraft},
        skill_steps::{self as steps_repo, SkillStepDraft as RepoStepDraft},
        skills::{self as skills_repo, SkillDraft, SkillPatch},
    },
};
use catique_infrastructure::import::git_fetch::{self, FetchError};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty},
    skill_steps::row_to_step,
};

/// Output of [`parse_markdown_into_steps`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedSkill {
    /// Text above the first H2. Used as the skill overview / TL;DR.
    pub overview: String,
    /// One entry per `## …` block.
    pub steps: Vec<ParsedStep>,
}

/// One step produced by the H2 splitter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedStep {
    pub title: String,
    pub body: String,
    pub expected_outcome: Option<String>,
}

/// Split `content` on top-level H2 headings. See module docs for the
/// rules.
#[must_use]
pub fn parse_markdown_into_steps(content: &str) -> ParsedSkill {
    let lines: Vec<&str> = content.lines().collect();
    // Scan for `## ` headings. A line counts as an H2 only when it
    // starts with two `#` followed by a space (no leading whitespace).
    let mut h2_indices: Vec<usize> = Vec::new();
    for (idx, line) in lines.iter().enumerate() {
        if is_h2(line) {
            h2_indices.push(idx);
        }
    }

    if h2_indices.is_empty() {
        return ParsedSkill {
            overview: trim_body(content),
            steps: Vec::new(),
        };
    }

    // Overview = everything before the first H2.
    let first_h2 = h2_indices[0];
    let overview_lines = &lines[..first_h2];
    let overview = trim_body(&overview_lines.join("\n"));

    let mut steps: Vec<ParsedStep> = Vec::with_capacity(h2_indices.len());
    for (i, &start) in h2_indices.iter().enumerate() {
        let end = h2_indices.get(i + 1).copied().unwrap_or(lines.len());
        let title_line = lines[start];
        let title = title_line.trim_start_matches('#').trim().to_owned();
        let body_lines = &lines[start + 1..end];
        let raw_body = body_lines.join("\n");
        let (body, expected_outcome) = extract_expected_outcome(&raw_body);
        steps.push(ParsedStep {
            title,
            body: trim_body(&body),
            expected_outcome: expected_outcome
                .map(|v| trim_body(&v))
                .filter(|v| !v.is_empty()),
        });
    }

    ParsedSkill { overview, steps }
}

/// `true` when the line is a top-level H2 heading (`## title`).
fn is_h2(line: &str) -> bool {
    if !line.starts_with("## ") {
        return false;
    }
    // Defensive: reject `###` (which also starts with `## `). Compare
    // the third byte explicitly so we don't accidentally swallow H3+.
    line.as_bytes().get(2) != Some(&b'#')
}

/// `true` when the line is an H3 heading whose text matches the
/// expected-outcome convention. Case-insensitive on the heading
/// label, tolerant of trailing punctuation / colons.
fn is_expected_outcome_heading(line: &str) -> bool {
    let Some(rest) = line.strip_prefix("### ") else {
        return false;
    };
    // Reject H4+ — same trick as `is_h2`.
    if rest.starts_with('#') {
        return false;
    }
    let normalised: String = rest
        .trim()
        .trim_end_matches(':')
        .trim()
        .to_ascii_lowercase();
    matches!(
        normalised.as_str(),
        "expected outcome" | "expected outcomes" | "result" | "results" | "outcome"
    )
}

/// Hoist a `### Expected outcome` (or `### Result`) subsection out of
/// `body`. Returns `(body_without_outcome, outcome_text)`.
///
/// We only honour the FIRST matching H3. Anything past the next H3 or
/// the end of body stays inside the outcome — the parser is a
/// best-effort heuristic.
fn extract_expected_outcome(body: &str) -> (String, Option<String>) {
    let lines: Vec<&str> = body.lines().collect();
    let Some(heading_idx) = lines.iter().position(|l| is_expected_outcome_heading(l)) else {
        return (body.to_owned(), None);
    };
    // Outcome ends at the next H3 (or further) or the end of the body.
    let end_idx = lines
        .iter()
        .enumerate()
        .skip(heading_idx + 1)
        .find(|(_, l)| l.starts_with("### ") || l.starts_with("## "))
        .map_or(lines.len(), |(i, _)| i);

    let outcome_lines = &lines[heading_idx + 1..end_idx];
    let outcome = outcome_lines.join("\n");
    // Keep everything before the heading + anything after the outcome.
    let before = &lines[..heading_idx];
    let after = &lines[end_idx..];
    let mut body_out = before.join("\n");
    if !after.is_empty() {
        if !body_out.is_empty() {
            body_out.push('\n');
        }
        body_out.push_str(&after.join("\n"));
    }
    (body_out, Some(outcome))
}

/// Trim leading + trailing blank lines while preserving the
/// internal structure of `body`.
fn trim_body(body: &str) -> String {
    // Trim trailing whitespace + a single trailing newline so the
    // round-trip preserves "real" content but normalises the slack.
    let trimmed = body.trim_matches(|c: char| c == '\n' || c == '\r');
    // Also strip trailing whitespace per-line tails left over from
    // copy-paste; the leading whitespace of each line stays because
    // markdown is whitespace-sensitive (code fences, lists).
    trimmed
        .split('\n')
        .map(|line| line.trim_end().to_owned())
        .collect::<Vec<_>>()
        .join("\n")
        .trim_end_matches('\n')
        .to_owned()
}

// ----------------------------------------------------------------------
// Import use case
// ----------------------------------------------------------------------

/// Target of an import call.
#[derive(Debug, Clone)]
pub enum ImportTarget {
    /// Create a fresh skill row using the supplied display name.
    CreateNew { name: String },
    /// Apply the imported content to an existing skill. When
    /// `replace_steps` is `true` the existing step list is wiped;
    /// otherwise the new steps are appended at the end.
    ApplyToExisting {
        skill_id: String,
        replace_steps: bool,
    },
}

/// Outcome surfaced back through the IPC layer.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub skill_id: String,
    pub overview_chars: usize,
    pub steps_added: usize,
    pub attachment_id: String,
}

/// Use case glue.
pub struct SkillImportUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> SkillImportUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// Import the resource at `url` and apply it to `target`.
    ///
    /// # Errors
    ///
    /// * `AppError::Validation` — invalid URL, unsupported host,
    ///   oversized payload, non-UTF-8 body, or empty parsed content.
    /// * `AppError::Conflict` — upstream returned a non-2xx status.
    ///   The numeric status is interpolated into the message.
    /// * `AppError::NotFound` — `target = ApplyToExisting` with an
    ///   unknown `skill_id`.
    pub async fn import_from_url(
        &self,
        url: &str,
        target: ImportTarget,
    ) -> Result<ImportReport, AppError> {
        // Step 1 — fetch.
        let fetched = git_fetch::fetch_text(url).await.map_err(map_fetch_err)?;

        // Step 2 — parse.
        let parsed = parse_markdown_into_steps(&fetched.content);
        let ParsedSkill { overview, steps } = parsed;

        // Step 3+ — persist. Everything from here onward is sync —
        // bounce onto `spawn_blocking` so we never hold a rusqlite
        // connection across an `.await`.
        let pool = self.pool.clone();
        let raw_url = fetched.raw_url.clone();
        let source_url = fetched.source_url.clone();
        let outcome = tokio::task::spawn_blocking(move || {
            persist_import(&pool, target, overview, steps, &source_url, &raw_url)
        })
        .await
        .map_err(|e| AppError::TransactionRolledBack {
            reason: format!("import join error: {e}"),
        })??;
        Ok(outcome)
    }
}

/// Inner sync persistence step. Single transaction: skill upsert,
/// description set, step swap/append, attachment insert.
#[allow(clippy::too_many_lines, clippy::needless_pass_by_value)]
fn persist_import(
    pool: &Pool,
    target: ImportTarget,
    overview: String,
    steps: Vec<ParsedStep>,
    source_url: &str,
    raw_url: &str,
) -> Result<ImportReport, AppError> {
    let mut conn = acquire(pool).map_err(map_db_err)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| AppError::TransactionRolledBack {
            reason: format!("import tx: {e}"),
        })?;

    // Resolve target → (skill_id, replace_steps?).
    let (skill_id, replace_steps) = match target {
        ImportTarget::CreateNew { name } => {
            let trimmed_name = validate_non_empty("name", &name)?;
            let row = skills_repo::insert(
                &tx,
                &SkillDraft {
                    name: trimmed_name,
                    description: if overview.is_empty() {
                        None
                    } else {
                        Some(overview.clone())
                    },
                    color: None,
                    position: 0.0,
                },
            )
            .map_err(|e| map_db_err_unique(e, "skill"))?;
            (row.id, true)
        }
        ImportTarget::ApplyToExisting {
            skill_id,
            replace_steps,
        } => {
            // Verify the skill exists; we need a typed NotFound rather
            // than a UPDATE-zero-rows ambiguity.
            let existing = skills_repo::get_by_id(&tx, &skill_id).map_err(map_db_err)?;
            if existing.is_none() {
                return Err(AppError::NotFound {
                    entity: "skill".into(),
                    id: skill_id,
                });
            }
            // Update the description in place.
            let patch = SkillPatch {
                description: Some(if overview.is_empty() {
                    None
                } else {
                    Some(overview.clone())
                }),
                ..SkillPatch::default()
            };
            skills_repo::update(&tx, &skill_id, &patch).map_err(map_db_err)?;
            (skill_id, replace_steps)
        }
    };

    // Apply the step set. `replace_steps = true` wipes the existing
    // list; `false` appends.
    let drafts: Vec<RepoStepDraft> = if replace_steps {
        // Resequence positions 1..N.
        #[allow(clippy::cast_precision_loss)]
        steps
            .iter()
            .enumerate()
            .map(|(idx, s)| RepoStepDraft {
                skill_id: skill_id.clone(),
                position: (idx as f64) + 1.0,
                title: s.title.clone(),
                body: s.body.clone(),
                expected_outcome: s.expected_outcome.clone(),
            })
            .collect()
    } else {
        // Resolve current max position, append after.
        let base: f64 = tx
            .query_row(
                "SELECT COALESCE(MAX(position), 0.0) FROM skill_steps WHERE skill_id = ?1",
                rusqlite::params![skill_id],
                |r| r.get(0),
            )
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        #[allow(clippy::cast_precision_loss)]
        steps
            .iter()
            .enumerate()
            .map(|(idx, s)| RepoStepDraft {
                skill_id: skill_id.clone(),
                position: base + (idx as f64) + 1.0,
                title: s.title.clone(),
                body: s.body.clone(),
                expected_outcome: s.expected_outcome.clone(),
            })
            .collect()
    };

    let inserted_rows: Vec<SkillStep> = if replace_steps {
        steps_repo::replace_all(&tx, &skill_id, &drafts)
            .map_err(map_db_err)?
            .into_iter()
            .map(row_to_step)
            .collect()
    } else {
        let mut out = Vec::with_capacity(drafts.len());
        for draft in &drafts {
            let row = steps_repo::insert(&tx, draft).map_err(map_db_err)?;
            out.push(row_to_step(row));
        }
        out
    };

    // Record the git URL as a `kind = git` attachment for
    // traceability. The original (user-typed) URL is stored —
    // the post-normalisation form is preserved in `git_ref` so
    // future re-imports can short-circuit the normalisation step.
    let attachment = att_repo::insert_git(
        &tx,
        &GitAttachmentDraft {
            skill_id: skill_id.clone(),
            git_url: source_url.to_owned(),
            git_ref: if raw_url == source_url {
                None
            } else {
                Some(raw_url.to_owned())
            },
            git_path: None,
        },
    )
    .map_err(map_db_err)?;

    tx.commit().map_err(|e| AppError::TransactionRolledBack {
        reason: format!("import commit: {e}"),
    })?;

    Ok(ImportReport {
        skill_id,
        overview_chars: overview.chars().count(),
        steps_added: inserted_rows.len(),
        attachment_id: attachment.id,
    })
}

/// Map a [`FetchError`] into the existing `AppError` taxonomy. We
/// deliberately collapse most failure modes onto `Validation` because
/// the IPC contract caps the variant set — adding a transport variant
/// here would force every downstream consumer (frontend + MCP) to
/// learn a new shape. Network / status failures collapse onto
/// `Conflict` so the UI can distinguish "user typed garbage"
/// (`Validation`) from "upstream said no" (`Conflict`).
fn map_fetch_err(err: FetchError) -> AppError {
    match err {
        FetchError::InvalidUrl(reason) => AppError::Validation {
            field: "url".into(),
            reason: format!("invalid url: {reason}"),
        },
        FetchError::UnsupportedHost(host) => AppError::Validation {
            field: "url".into(),
            reason: format!(
                "host not in allowlist (github.com / gitlab.com / raw.githubusercontent.com / gist.githubusercontent.com): {host}"
            ),
        },
        FetchError::NotUtf8 => AppError::Validation {
            field: "url".into(),
            reason: "response body is not valid utf-8".into(),
        },
        FetchError::TooLarge(got, cap) => AppError::Validation {
            field: "url".into(),
            reason: format!("response too large: {got} bytes > {cap} byte cap"),
        },
        FetchError::HttpStatus(code) => AppError::Conflict {
            entity: "skill_import".into(),
            reason: format!("upstream returned http status {code}"),
        },
        FetchError::Network(detail) => AppError::Conflict {
            entity: "skill_import".into(),
            reason: format!("network failure: {detail}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_no_h2_returns_full_overview_no_steps() {
        let parsed =
            parse_markdown_into_steps("This is a single-paragraph skill\nwith no headings.\n");
        assert_eq!(
            parsed.overview,
            "This is a single-paragraph skill\nwith no headings."
        );
        assert!(parsed.steps.is_empty());
    }

    #[test]
    fn parse_single_h2_returns_one_step() {
        let parsed = parse_markdown_into_steps("Intro\n\n## First\n\nDo the thing.\n");
        assert_eq!(parsed.overview, "Intro");
        assert_eq!(parsed.steps.len(), 1);
        assert_eq!(parsed.steps[0].title, "First");
        assert_eq!(parsed.steps[0].body, "Do the thing.");
        assert!(parsed.steps[0].expected_outcome.is_none());
    }

    #[test]
    fn parse_multiple_h2_returns_ordered_steps() {
        let md = "\
# Title\n\
\n\
Some context.\n\
\n\
## Validate input\n\
\n\
Check the args.\n\
\n\
## Run command\n\
\n\
Execute it.\n\
";
        let parsed = parse_markdown_into_steps(md);
        assert_eq!(parsed.overview, "# Title\n\nSome context.");
        assert_eq!(parsed.steps.len(), 2);
        assert_eq!(parsed.steps[0].title, "Validate input");
        assert_eq!(parsed.steps[0].body, "Check the args.");
        assert_eq!(parsed.steps[1].title, "Run command");
        assert_eq!(parsed.steps[1].body, "Execute it.");
    }

    #[test]
    fn parse_extracts_expected_outcome_subsection() {
        let md = "\
## Step A\n\
\n\
Run the script.\n\
\n\
### Expected outcome\n\
\n\
Exit code 0 and the log file appears.\n\
";
        let parsed = parse_markdown_into_steps(md);
        assert_eq!(parsed.steps.len(), 1);
        let step = &parsed.steps[0];
        assert_eq!(step.title, "Step A");
        assert_eq!(step.body, "Run the script.");
        assert_eq!(
            step.expected_outcome.as_deref(),
            Some("Exit code 0 and the log file appears.")
        );
    }

    #[test]
    fn parse_accepts_result_label_as_expected_outcome() {
        let md = "## Step\n\nBody.\n\n### Result\n\nDone.";
        let parsed = parse_markdown_into_steps(md);
        assert_eq!(parsed.steps[0].expected_outcome.as_deref(), Some("Done."));
    }

    #[test]
    fn parse_trims_trailing_whitespace() {
        let md = "## A\n\nbody\n\n\n\n## B\n\nbody2   \n  \n";
        let parsed = parse_markdown_into_steps(md);
        assert_eq!(parsed.steps.len(), 2);
        assert_eq!(parsed.steps[0].body, "body");
        // Per-line trailing whitespace stripped; the trailing blank
        // line is trimmed off entirely.
        assert_eq!(parsed.steps[1].body, "body2");
    }

    #[test]
    fn parse_h3_only_does_not_split_steps() {
        // H3 alone is NOT a step separator — guard against the
        // splitter treating a doc full of `### …` subsections as
        // a flat list of zero-step skills.
        let md = "Intro\n\n### Sub one\n\nbody\n\n### Sub two\n\nbody";
        let parsed = parse_markdown_into_steps(md);
        assert!(parsed.steps.is_empty());
        assert!(parsed.overview.contains("Sub one"));
    }

    #[test]
    fn is_h2_rejects_h3_and_indented_headings() {
        assert!(is_h2("## title"));
        assert!(!is_h2("### subhead"));
        assert!(!is_h2(" ## indented"));
        assert!(!is_h2("##missing space"));
    }

    #[test]
    fn map_fetch_err_unsupported_host_is_validation() {
        let err = map_fetch_err(FetchError::UnsupportedHost("example.com".into()));
        match err {
            AppError::Validation { field, reason } => {
                assert_eq!(field, "url");
                assert!(reason.contains("example.com"));
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn map_fetch_err_404_is_conflict() {
        let err = map_fetch_err(FetchError::HttpStatus(404));
        match err {
            AppError::Conflict { entity, reason } => {
                assert_eq!(entity, "skill_import");
                assert!(reason.contains("404"));
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn map_fetch_err_too_large_is_validation() {
        let err = map_fetch_err(FetchError::TooLarge(1_500_000, 1_048_576));
        match err {
            AppError::Validation { field, reason } => {
                assert_eq!(field, "url");
                assert!(reason.contains("byte cap"));
            }
            other => panic!("got {other:?}"),
        }
    }

    // ------------------------------------------------------------------
    // Helpers for tests that exercise the persistence path without
    // touching the network. `persist_import` is the right seam — it
    // accepts already-parsed input.
    // ------------------------------------------------------------------

    fn fresh_pool() -> catique_infrastructure::db::pool::Pool {
        let pool = catique_infrastructure::db::pool::memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        catique_infrastructure::db::runner::run_pending(&mut conn).unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn persist_create_new_skill_with_steps_and_attachment() {
        let pool = fresh_pool();
        let parsed = parse_markdown_into_steps(
            "Intro paragraph.\n\n## Step One\n\nDo X.\n\n## Step Two\n\nDo Y.\n",
        );
        let report = persist_import(
            &pool,
            ImportTarget::CreateNew {
                name: "Imported".into(),
            },
            parsed.overview,
            parsed.steps,
            "https://example.com/r.md",
            "https://example.com/r.md",
        )
        .expect("persist");
        assert_eq!(report.steps_added, 2);
        assert!(report.overview_chars > 0);
        assert!(!report.attachment_id.is_empty());

        // Steps round-trip via the use case.
        let uc = crate::skill_steps::SkillStepsUseCase::new(&pool);
        let list = uc.list_steps(&report.skill_id).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].title, "Step One");

        // Attachment round-trips via the skills use case.
        let skills_uc = crate::skills::SkillsUseCase::new(&pool);
        let atts = skills_uc.list_attachments(&report.skill_id).unwrap();
        assert_eq!(atts.len(), 1);
        assert_eq!(atts[0].git_url.as_deref(), Some("https://example.com/r.md"));
    }

    #[test]
    fn persist_apply_existing_replace_swaps_steps() {
        let pool = fresh_pool();
        let skill = crate::skills::SkillsUseCase::new(&pool)
            .create("Existing".into(), Some("old overview".into()), None, 0.0)
            .unwrap();
        let steps_uc = crate::skill_steps::SkillStepsUseCase::new(&pool);
        steps_uc
            .add_step(&skill.id, "OldA".into(), String::new(), None, None)
            .unwrap();
        steps_uc
            .add_step(&skill.id, "OldB".into(), String::new(), None, None)
            .unwrap();

        let parsed = parse_markdown_into_steps("New overview.\n\n## NewA\n\nbody\n");
        let report = persist_import(
            &pool,
            ImportTarget::ApplyToExisting {
                skill_id: skill.id.clone(),
                replace_steps: true,
            },
            parsed.overview,
            parsed.steps,
            "https://gist.githubusercontent.com/a/b/raw/c.md",
            "https://gist.githubusercontent.com/a/b/raw/c.md",
        )
        .expect("persist");
        assert_eq!(report.steps_added, 1);

        let list = steps_uc.list_steps(&skill.id).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "NewA");
    }

    #[test]
    fn persist_apply_existing_append_keeps_old_steps() {
        let pool = fresh_pool();
        let skill = crate::skills::SkillsUseCase::new(&pool)
            .create("Existing".into(), None, None, 0.0)
            .unwrap();
        let steps_uc = crate::skill_steps::SkillStepsUseCase::new(&pool);
        let _a = steps_uc
            .add_step(&skill.id, "OldA".into(), String::new(), None, None)
            .unwrap();

        let parsed = parse_markdown_into_steps("ov\n\n## NewB\n\nbody\n");
        let report = persist_import(
            &pool,
            ImportTarget::ApplyToExisting {
                skill_id: skill.id.clone(),
                replace_steps: false,
            },
            parsed.overview,
            parsed.steps,
            "https://example.com/r.md",
            "https://example.com/r.md",
        )
        .expect("persist");
        assert_eq!(report.steps_added, 1);

        let list = steps_uc.list_steps(&skill.id).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].title, "OldA");
        assert_eq!(list[1].title, "NewB");
    }

    #[test]
    fn persist_apply_existing_missing_skill_is_not_found() {
        let pool = fresh_pool();
        let err = persist_import(
            &pool,
            ImportTarget::ApplyToExisting {
                skill_id: "ghost".into(),
                replace_steps: true,
            },
            "ov".into(),
            Vec::new(),
            "https://example.com/r.md",
            "https://example.com/r.md",
        )
        .expect_err("nf");
        match err {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "skill"),
            other => panic!("got {other:?}"),
        }
    }
}
