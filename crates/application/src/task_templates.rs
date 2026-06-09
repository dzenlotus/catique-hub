//! Task-template use case — named markdown skeletons for new tasks
//! (catique-1).
//!
//! ## Surface
//!
//! `TaskTemplatesUseCase` is plain CRUD over a global template list:
//! [`list`](Self::list), [`get`](Self::get), [`create`](Self::create),
//! [`update`](Self::update), [`delete`](Self::delete).
//!
//! ## Kind handling
//!
//! `kind` is the typed [`TaskTemplateKind`] enum end-to-end; the use
//! case maps it to / from the SQL CHECK literal. A tampered row with an
//! out-of-range kind surfaces a typed [`AppError::Validation`] rather
//! than silently coercing.

use catique_domain::{TaskTemplate, TaskTemplateKind};
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::task_templates::{
        self as repo, TaskTemplateDraft, TaskTemplatePatch, TaskTemplateRow,
    },
};

use crate::{
    error::AppError,
    error_map::{map_db_err, validate_non_empty},
};

/// Cap on the markdown body (64 KiB) — a skeleton, not a document.
const MAX_BODY_BYTES: usize = 64 * 1024;

/// Use case wrapper. Cheap clone (pool is Arc-backed).
pub struct TaskTemplatesUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> TaskTemplatesUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every template (position ASC, then name ASC).
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<TaskTemplate>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        rows.into_iter().map(hydrate).collect()
    }

    /// Lookup one template by id.
    ///
    /// # Errors
    ///
    /// [`AppError::NotFound`] if id unknown.
    pub fn get(&self, id: &str) -> Result<TaskTemplate, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => hydrate(row),
            None => Err(not_found(id)),
        }
    }

    /// Create one template.
    ///
    /// # Errors
    ///
    /// [`AppError::Validation`] on empty `name` or over-size `body`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        name: String,
        kind: TaskTemplateKind,
        description: String,
        body: String,
        icon: Option<String>,
        color: Option<String>,
    ) -> Result<TaskTemplate, AppError> {
        let name = validate_non_empty("name", &name)?;
        let body = validate_body(&body)?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::insert(
            &conn,
            &TaskTemplateDraft {
                name,
                kind: kind_to_sql(kind).to_owned(),
                description,
                body,
                icon,
                color,
                position: next_position(&conn)?,
            },
        )
        .map_err(map_db_err)?;
        hydrate(row)
    }

    /// Partial update.
    ///
    /// # Errors
    ///
    /// [`AppError::Validation`] on empty `name` (when set) / over-size
    /// `body`; [`AppError::NotFound`] if id unknown.
    #[allow(clippy::needless_pass_by_value, clippy::too_many_arguments)]
    pub fn update(
        &self,
        id: &str,
        name: Option<String>,
        kind: Option<TaskTemplateKind>,
        description: Option<String>,
        body: Option<String>,
        icon: Option<String>,
        color: Option<String>,
        position: Option<f64>,
    ) -> Result<TaskTemplate, AppError> {
        let name = match name.as_deref() {
            Some(s) => Some(validate_non_empty("name", s)?),
            None => None,
        };
        let body = match body.as_deref() {
            Some(s) => Some(validate_body(s)?),
            None => None,
        };
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::update(
            &conn,
            id,
            &TaskTemplatePatch {
                name,
                kind: kind.map(|k| kind_to_sql(k).to_owned()),
                description,
                body,
                icon,
                color,
                position,
            },
        )
        .map_err(map_db_err)?
        .ok_or_else(|| not_found(id))?;
        hydrate(row)
    }

    /// Delete one template.
    ///
    /// # Errors
    ///
    /// [`AppError::NotFound`] if id unknown.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        if repo::delete(&conn, id).map_err(map_db_err)? {
            Ok(())
        } else {
            Err(not_found(id))
        }
    }
}

// ---------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------

fn not_found(id: &str) -> AppError {
    AppError::NotFound {
        entity: "task_template".into(),
        id: id.to_owned(),
    }
}

fn kind_to_sql(kind: TaskTemplateKind) -> &'static str {
    match kind {
        TaskTemplateKind::Feature => "feature",
        TaskTemplateKind::Bug => "bug",
        TaskTemplateKind::Research => "research",
        TaskTemplateKind::Custom => "custom",
    }
}

fn kind_from_sql(s: &str) -> Result<TaskTemplateKind, AppError> {
    match s {
        "feature" => Ok(TaskTemplateKind::Feature),
        "bug" => Ok(TaskTemplateKind::Bug),
        "research" => Ok(TaskTemplateKind::Research),
        "custom" => Ok(TaskTemplateKind::Custom),
        other => Err(AppError::Validation {
            field: "kind".into(),
            reason: format!("unknown task-template kind `{other}`"),
        }),
    }
}

fn hydrate(row: TaskTemplateRow) -> Result<TaskTemplate, AppError> {
    Ok(TaskTemplate {
        kind: kind_from_sql(&row.kind)?,
        id: row.id,
        name: row.name,
        description: row.description,
        body: row.body,
        icon: row.icon,
        color: row.color,
        position: row.position,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn validate_body(body: &str) -> Result<String, AppError> {
    if body.len() > MAX_BODY_BYTES {
        return Err(AppError::Validation {
            field: "body".into(),
            reason: format!("must be at most {MAX_BODY_BYTES} bytes"),
        });
    }
    Ok(body.to_owned())
}

/// Append-at-end position: `max(position) + 1`. Keeps user-created
/// templates after the seeded built-ins without renumbering.
fn next_position(conn: &rusqlite::Connection) -> Result<f64, AppError> {
    let max: Option<f64> = conn
        .query_row("SELECT MAX(position) FROM task_templates", [], |r| r.get(0))
        .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
    Ok(max.unwrap_or(0.0) + 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool() -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn list_includes_seeded_builtins() {
        let pool = fresh_pool();
        let uc = TaskTemplatesUseCase::new(&pool);
        let all = uc.list().unwrap();
        assert!(all.iter().any(|t| t.kind == TaskTemplateKind::Feature));
        assert!(all.iter().any(|t| t.kind == TaskTemplateKind::Bug));
        assert!(all.iter().any(|t| t.kind == TaskTemplateKind::Research));
    }

    #[test]
    fn create_get_update_delete() {
        let pool = fresh_pool();
        let uc = TaskTemplatesUseCase::new(&pool);
        let t = uc
            .create(
                "Spike".into(),
                TaskTemplateKind::Custom,
                "investigate".into(),
                "## Spike".into(),
                None,
                None,
            )
            .unwrap();
        assert_eq!(uc.get(&t.id).unwrap().name, "Spike");
        let updated = uc
            .update(
                &t.id,
                None,
                None,
                None,
                Some("## Spike v2".into()),
                None,
                None,
                None,
            )
            .unwrap();
        assert_eq!(updated.body, "## Spike v2");
        uc.delete(&t.id).unwrap();
        match uc.get(&t.id).expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task_template"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_rejects_empty_name() {
        let pool = fresh_pool();
        let uc = TaskTemplatesUseCase::new(&pool);
        match uc
            .create(
                "  ".into(),
                TaskTemplateKind::Custom,
                String::new(),
                String::new(),
                None,
                None,
            )
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("got {other:?}"),
        }
    }
}
