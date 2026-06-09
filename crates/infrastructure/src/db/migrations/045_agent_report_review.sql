-- 045_agent_report_review.sql — human review surface for agent reports
-- (catique).
--
-- Two additions to `agent_reports`:
--   * `approved`       — sign-off checkbox. `0` (false) by default; a
--                        person flips it to `1` once they reviewed the
--                        report.
--   * `review_comment` — optional reviewer note (corrections to make /
--                        approval context). NULL when no comment.
--
-- The `kind` column stays free-form TEXT — the application layer maps it
-- onto the `AgentReportKind` enum (investigation / plan / summary /
-- review / approval) and tolerates legacy values.

ALTER TABLE agent_reports
  ADD COLUMN approved INTEGER NOT NULL DEFAULT 0;

ALTER TABLE agent_reports
  ADD COLUMN review_comment TEXT;
