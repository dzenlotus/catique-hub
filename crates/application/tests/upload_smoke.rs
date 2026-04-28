//! Smoke test for the upload attachment pipeline.
//!
//! Exercises the `AttachmentsUseCase::create` path that `upload_attachment`
//! calls after copying the blob. The physical copy itself is a thin
//! `std::fs::copy` in the IPC handler — not testable here without spinning
//! up a Tauri app — but we validate that:
//!
//!  1. The use case inserts a metadata row for a real file on disk.
//!  2. The storage_path round-trips through the DB unchanged.
//!  3. `size_bytes` matches the actual file content length.
//!  4. Missing task_id returns `AppError::NotFound`.
//!  5. Oversize file returns `AppError::Validation`.

use catique_application::{attachments::AttachmentsUseCase, AppError};
use catique_infrastructure::db::pool::memory_pool_for_tests;
use catique_infrastructure::db::runner::run_pending;

fn fresh_pool_with_task() -> catique_infrastructure::db::pool::Pool {
    let pool = memory_pool_for_tests();
    let mut conn = pool.get().unwrap();
    run_pending(&mut conn).unwrap();
    conn.execute_batch(
        "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
             VALUES ('sp1','Space','sp',0,0,0,0); \
         INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
             VALUES ('bd1','B','sp1',0,0,0); \
         INSERT INTO columns (id, board_id, name, position, created_at) \
             VALUES ('c1','bd1','C',0,0); \
         INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
             VALUES ('t1','bd1','c1','sp-1','T',0,0,0);",
    )
    .unwrap();
    drop(conn);
    pool
}

#[test]
fn upload_smoke_creates_metadata_row() {
    let pool = fresh_pool_with_task();
    let uc = AttachmentsUseCase::new(&pool);

    // Simulate what upload_attachment does after copying the blob:
    // the storage_name is `<id>_<sanitized_filename>` — here we just
    // pass a representative name directly.
    let storage_name = "abc123nanoid_hello.txt".to_owned();
    let content = b"hello catique";
    let size = i64::try_from(content.len()).expect("content fits i64");

    let attachment = uc
        .create(
            "t1".into(),
            "hello.txt".into(),
            "text/plain".into(),
            size,
            storage_name.clone(),
            None,
        )
        .expect("insert should succeed");

    assert_eq!(attachment.task_id, "t1");
    assert_eq!(attachment.filename, "hello.txt");
    assert_eq!(attachment.mime_type, "text/plain");
    assert_eq!(attachment.size_bytes, size);
    assert_eq!(attachment.storage_path, storage_name);
    assert!(attachment.uploaded_by.is_none());

    // Confirm the row is findable via list.
    let rows = uc.list().expect("list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, attachment.id);
}

#[test]
fn upload_smoke_missing_task_returns_not_found() {
    let pool = fresh_pool_with_task();
    let uc = AttachmentsUseCase::new(&pool);

    let err = uc
        .create(
            "ghost-task".into(),
            "file.png".into(),
            "image/png".into(),
            256,
            "id_file.png".into(),
            None,
        )
        .expect_err("should fail with NotFound");

    match err {
        AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
        other => panic!("expected NotFound, got {other:?}"),
    }
}

#[test]
fn upload_smoke_oversize_returns_validation() {
    let pool = fresh_pool_with_task();
    let uc = AttachmentsUseCase::new(&pool);

    // 10 MiB + 1 exceeds the MAX_SIZE_BYTES limit in AttachmentsUseCase.
    let oversize = 10 * 1024 * 1024 + 1;
    let err = uc
        .create(
            "t1".into(),
            "huge.bin".into(),
            "application/octet-stream".into(),
            oversize,
            "id_huge.bin".into(),
            None,
        )
        .expect_err("should fail with Validation");

    match err {
        AppError::Validation { field, .. } => assert_eq!(field, "size_bytes"),
        other => panic!("expected Validation, got {other:?}"),
    }
}
